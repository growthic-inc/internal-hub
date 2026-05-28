// Growthic One — Edge Function: daily-out-wfh-notify
// Runs every weekday at 9:00 AM IST (3:30 AM UTC) via pg_cron.
// Queries today's approved leave + WFH requests, builds a concise
// team-availability message, and fires a Web Push to every subscribed device.
//
// Env vars required:
//   VAPID_PUBLIC_KEY        — 65-byte uncompressed P-256 point, base64url
//   VAPID_PRIVATE_KEY       — 32-byte raw P-256 private scalar, base64url
//   VAPID_SUBJECT           — mailto: or https: contact
//   SUPABASE_SERVICE_ROLE_KEY
//   SUPABASE_URL
//   CRON_SECRET             — arbitrary secret; pg_cron passes it as Bearer token

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

// ── Encoding helpers (shared with send-push) ─────────────────────────────────

function b64urlDecode(b64: string): Uint8Array {
  const pad = '='.repeat((4 - (b64.length % 4)) % 4)
  return Uint8Array.from(atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0))
}

function b64urlEncode(buf: Uint8Array): string {
  return btoa(String.fromCharCode(...buf)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function concat(...arrays: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(arrays.reduce((n, a) => n + a.length, 0))
  let off = 0
  for (const a of arrays) { out.set(a, off); off += a.length }
  return out
}

// ── VAPID ────────────────────────────────────────────────────────────────────

async function importVapidSigningKey(privateB64: string, publicB64: string): Promise<CryptoKey> {
  const privBytes = b64urlDecode(privateB64)
  const pubBytes  = b64urlDecode(publicB64)
  return crypto.subtle.importKey(
    'jwk',
    {
      kty: 'EC', crv: 'P-256',
      x: b64urlEncode(pubBytes.slice(1, 33)),
      y: b64urlEncode(pubBytes.slice(33, 65)),
      d: b64urlEncode(privBytes),
    },
    { name: 'ECDSA', namedCurve: 'P-256' },
    false, ['sign'],
  )
}

async function makeVapidJwt(audience: string, subject: string, signingKey: CryptoKey): Promise<string> {
  const enc     = new TextEncoder()
  const header  = b64urlEncode(enc.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })))
  const payload = b64urlEncode(enc.encode(JSON.stringify({
    aud: audience,
    exp: Math.floor(Date.now() / 1000) + 43200,
    sub: subject,
  })))
  const toSign = `${header}.${payload}`
  const sig    = new Uint8Array(await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    signingKey,
    enc.encode(toSign),
  ))
  return `${toSign}.${b64urlEncode(sig)}`
}

// ── Payload encryption (RFC 8291 + RFC 8188 aes128gcm) ───────────────────────

async function encryptPayload(payloadStr: string, p256dhB64: string, authB64: string): Promise<Uint8Array> {
  const enc = new TextEncoder()

  const receiverPublicKey = await crypto.subtle.importKey(
    'raw', b64urlDecode(p256dhB64),
    { name: 'ECDH', namedCurve: 'P-256' }, false, [],
  )
  const senderPair      = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits'])
  const senderPublicRaw = new Uint8Array(await crypto.subtle.exportKey('raw', senderPair.publicKey))
  const ecdhSecret      = new Uint8Array(await crypto.subtle.deriveBits(
    { name: 'ECDH', public: receiverPublicKey }, senderPair.privateKey, 256,
  ))
  const salt        = crypto.getRandomValues(new Uint8Array(16))
  const authSecret  = b64urlDecode(authB64)
  const ikm         = new Uint8Array(await crypto.subtle.deriveBits(
    {
      name: 'HKDF', hash: 'SHA-256', salt: authSecret,
      info: concat(enc.encode('WebPush: info\x00'), b64urlDecode(p256dhB64), senderPublicRaw),
    },
    await crypto.subtle.importKey('raw', ecdhSecret, { name: 'HKDF' }, false, ['deriveBits']),
    256,
  ))
  const ikmKey = await crypto.subtle.importKey('raw', ikm, { name: 'HKDF' }, false, ['deriveBits'])
  const cek    = new Uint8Array(await crypto.subtle.deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt, info: enc.encode('Content-Encoding: aes128gcm\x00') },
    ikmKey, 128,
  ))
  const nonce  = new Uint8Array(await crypto.subtle.deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt, info: enc.encode('Content-Encoding: nonce\x00') },
    ikmKey, 96,
  ))
  const plaintext  = concat(enc.encode(payloadStr), new Uint8Array([0x02]))
  const cekKey     = await crypto.subtle.importKey('raw', cek, { name: 'AES-GCM' }, false, ['encrypt'])
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, cekKey, plaintext))

  const header = new Uint8Array(16 + 4 + 1 + senderPublicRaw.length)
  header.set(salt, 0)
  new DataView(header.buffer).setUint32(16, 4096, false)
  header[20] = senderPublicRaw.length
  header.set(senderPublicRaw, 21)

  return concat(header, ciphertext)
}

// ── Notification message builder ─────────────────────────────────────────────

function todayLabel(): string {
  return new Date().toLocaleDateString('en-IN', {
    weekday: 'short', day: 'numeric', month: 'short',
    timeZone: 'Asia/Kolkata',
  })
}

function nameList(names: string[], max = 3): string {
  if (!names.length) return ''
  const shown = names.slice(0, max).map(n => n.split(' ')[0]) // first names only
  const extra  = names.length - max
  return extra > 0 ? `${shown.join(', ')} +${extra} more` : shown.join(', ')
}

function buildMessage(
  leaveRows: { name: string; typeName: string }[],
  wfhRows:   { name: string }[],
): { title: string; body: string } {
  const title = `Team Today — ${todayLabel()}`

  if (!leaveRows.length && !wfhRows.length) {
    return { title, body: "Everyone's in the office today! 👍" }
  }

  const parts: string[] = []

  if (leaveRows.length) {
    // Group by leave type for a cleaner message
    const byType: Record<string, string[]> = {}
    for (const r of leaveRows) {
      const t = r.typeName || 'Leave'
      ;(byType[t] ||= []).push(r.name)
    }
    for (const [type, names] of Object.entries(byType)) {
      parts.push(`${type}: ${nameList(names)}`)
    }
  }

  if (wfhRows.length) {
    parts.push(`WFH: ${nameList(wfhRows.map(r => r.name))}`)
  }

  return { title, body: parts.join(' • ') }
}

// ── Main handler ──────────────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  // Only POST allowed
  if (req.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405 })
  }

  // Verify CRON_SECRET
  const cronSecret = Deno.env.get('CRON_SECRET')
  if (cronSecret) {
    const auth = req.headers.get('Authorization') || ''
    if (auth !== `Bearer ${cronSecret}`) {
      console.error('[daily-out-wfh-notify] Unauthorized request')
      return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 })
    }
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )

    // ── Today in IST ─────────────────────────────────────────────────────────
    const todayIST = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' }) // "YYYY-MM-DD"

    // ── Query leave + WFH in parallel ────────────────────────────────────────
    const [leaveRes, wfhRes, subsRes] = await Promise.all([
      supabase
        .from('leave_requests')
        .select('employees!employee_id(name), leave_types(name)')
        .eq('status', 'approved')
        .lte('start_date', todayIST)
        .gte('end_date', todayIST),
      supabase
        .from('wfh_requests')
        .select('employees!employee_id(name)')
        .eq('status', 'approved')
        .lte('start_date', todayIST)
        .gte('end_date', todayIST),
      supabase
        .from('push_subscriptions')
        .select('id, endpoint, p256dh, auth'),
    ])

    if (leaveRes.error) throw leaveRes.error
    if (wfhRes.error)   throw wfhRes.error
    if (subsRes.error)  throw subsRes.error

    const leaveRows = (leaveRes.data || []).map((r: Record<string, unknown>) => ({
      name:     ((r.employees as Record<string, string>)?.name || 'Unknown'),
      typeName: ((r.leave_types as Record<string, string>)?.name || 'Leave'),
    }))

    const wfhRows = (wfhRes.data || []).map((r: Record<string, unknown>) => ({
      name: ((r.employees as Record<string, string>)?.name || 'Unknown'),
    }))

    const subs = subsRes.data || []

    console.log(`[daily-out-wfh-notify] date=${todayIST} leave=${leaveRows.length} wfh=${wfhRows.length} subs=${subs.length}`)

    if (!subs.length) {
      return new Response(JSON.stringify({ sent: 0, reason: 'no_subscriptions' }), {
        headers: { 'Content-Type': 'application/json' },
      })
    }

    // ── Build message ─────────────────────────────────────────────────────────
    const { title, body } = buildMessage(leaveRows, wfhRows)
    const url             = '/home#leave-tracker'
    const payloadStr      = JSON.stringify({ title, body, url })

    console.log(`[daily-out-wfh-notify] Sending: "${title}" / "${body}"`)

    // ── VAPID setup ───────────────────────────────────────────────────────────
    const VAPID_PUBLIC_KEY  = Deno.env.get('VAPID_PUBLIC_KEY')!
    const VAPID_PRIVATE_KEY = Deno.env.get('VAPID_PRIVATE_KEY')!
    const VAPID_SUBJECT     = Deno.env.get('VAPID_SUBJECT') || 'mailto:tech@growthic.in'

    if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) {
      throw new Error('VAPID env vars not configured')
    }

    const signingKey = await importVapidSigningKey(VAPID_PRIVATE_KEY, VAPID_PUBLIC_KEY)

    // ── Fan out to all subscriptions ──────────────────────────────────────────
    const staleIds: string[] = []
    let sent = 0

    await Promise.all(subs.map(async (sub: { id: string; endpoint: string; p256dh: string; auth: string }) => {
      try {
        const audience = new URL(sub.endpoint).origin
        const jwt      = await makeVapidJwt(audience, VAPID_SUBJECT, signingKey)
        const encBody  = await encryptPayload(payloadStr, sub.p256dh, sub.auth)

        const res = await fetch(sub.endpoint, {
          method: 'POST',
          headers: {
            'Authorization':    `vapid t=${jwt},k=${VAPID_PUBLIC_KEY}`,
            'Content-Type':     'application/octet-stream',
            'Content-Encoding': 'aes128gcm',
            'TTL':              '43200', // 12 h — stale by lunch? drop it
          },
          body: encBody,
        })

        if (res.status === 201 || res.status === 200) {
          sent++
        } else if (res.status === 410 || res.status === 404) {
          staleIds.push(sub.id)
        } else {
          const txt = await res.text().catch(() => '')
          console.warn(`[daily-out-wfh-notify] push ${res.status}:`, txt)
        }
      } catch (err) {
        console.warn('[daily-out-wfh-notify] delivery error:', err)
      }
    }))

    // Clean up expired subscriptions
    if (staleIds.length) {
      await supabase.from('push_subscriptions').delete().in('id', staleIds)
      console.log(`[daily-out-wfh-notify] removed ${staleIds.length} stale subscriptions`)
    }

    return new Response(JSON.stringify({ sent, stale: staleIds.length, leave: leaveRows.length, wfh: wfhRows.length }), {
      headers: { 'Content-Type': 'application/json' },
    })

  } catch (err) {
    console.error('[daily-out-wfh-notify] fatal:', err)
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500, headers: { 'Content-Type': 'application/json' },
    })
  }
})
