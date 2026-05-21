// Growthic One — Edge Function: send-push
// Looks up all Web Push subscriptions for an employee and dispatches
// a Web Push message (RFC 8030 + VAPID, RFC 8292) to each one.
// Expired/invalid subscriptions (410/404) are auto-deleted.
//
// Required env vars (set in Supabase dashboard → Settings → Edge Functions):
//   VAPID_PRIVATE_KEY  — base64url-encoded VAPID private key
//   VAPID_PUBLIC_KEY   — base64url-encoded VAPID public key (same as push.js)
//   VAPID_SUBJECT      — mailto: or https: contact URL  e.g. mailto:tech@growthic.in

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// ── VAPID / Web Push helpers ──────────────────────────────────────────────────

function b64urlToUint8(b64: string): Uint8Array {
  const pad = '='.repeat((4 - (b64.length % 4)) % 4)
  const b64s = (b64 + pad).replace(/-/g, '+').replace(/_/g, '/')
  const raw  = atob(b64s)
  return Uint8Array.from([...raw].map(c => c.charCodeAt(0)))
}

function uint8ToB64url(buf: Uint8Array): string {
  return btoa(String.fromCharCode(...buf))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

async function importVapidKeys(publicB64: string, privateB64: string) {
  // Import the key pair as an ECDH key pair so we can derive the shared secret,
  // then re-import private key as ECDSA for signing the JWT.
  const publicKey = await crypto.subtle.importKey(
    'raw',
    b64urlToUint8(publicB64),
    { name: 'ECDH', namedCurve: 'P-256' },
    true,
    []
  )
  const privateKey = await crypto.subtle.importKey(
    'pkcs8',
    b64urlToUint8(privateB64),
    { name: 'ECDSA', namedCurve: 'P-256' },
    true,
    ['sign']
  )
  return { publicKey, privateKey }
}

async function makeVapidJwt(audience: string, subject: string, privateKey: CryptoKey): Promise<string> {
  const header  = { typ: 'JWT', alg: 'ES256' }
  const payload = {
    aud: audience,
    exp: Math.floor(Date.now() / 1000) + 12 * 3600,
    sub: subject,
  }
  const enc = new TextEncoder()
  const toSign = `${uint8ToB64url(enc.encode(JSON.stringify(header)))}.${uint8ToB64url(enc.encode(JSON.stringify(payload)))}`
  const sig    = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, privateKey, enc.encode(toSign))
  return `${toSign}.${uint8ToB64url(new Uint8Array(sig))}`
}

// Encrypt payload for a given subscription using Web Push message encryption (RFC 8188 / draft-ietf-webpush-encryption).
async function encryptPayload(
  payload:   string,
  p256dhB64: string,
  authB64:   string,
): Promise<{ ciphertext: Uint8Array; salt: Uint8Array; serverPublicKey: Uint8Array }> {
  const enc = new TextEncoder()

  // Receiver's public key & auth secret
  const receiverPublicKey = await crypto.subtle.importKey(
    'raw',
    b64urlToUint8(p256dhB64),
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    []
  )
  const authSecret = b64urlToUint8(authB64)

  // Ephemeral sender key pair
  const senderKeyPair = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveKey', 'deriveBits'])
  const senderPublicKeyRaw = new Uint8Array(await crypto.subtle.exportKey('raw', senderKeyPair.publicKey))

  // ECDH shared secret
  const sharedSecret = new Uint8Array(await crypto.subtle.deriveBits(
    { name: 'ECDH', public: receiverPublicKey },
    senderKeyPair.privateKey,
    256
  ))

  // Salt
  const salt = crypto.getRandomValues(new Uint8Array(16))

  // PRK (pseudo-random key) via HKDF from sharedSecret + authSecret
  const ikm = await crypto.subtle.importKey('raw', sharedSecret, { name: 'HKDF' }, false, ['deriveKey', 'deriveBits'])

  const prkInfo = concat(enc.encode('WebPush: info\x00'), b64urlToUint8(p256dhB64), senderPublicKeyRaw)
  const prk = new Uint8Array(await crypto.subtle.deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt: authSecret, info: prkInfo },
    ikm,
    256
  ))

  // CEK and nonce via HKDF from PRK + salt
  const prkKey = await crypto.subtle.importKey('raw', prk, { name: 'HKDF' }, false, ['deriveBits'])

  const cekInfo   = enc.encode('Content-Encoding: aes128gcm\x00')
  const nonceInfo = enc.encode('Content-Encoding: nonce\x00')

  const cek   = new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info: cekInfo },   prkKey, 128))
  const nonce = new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info: nonceInfo }, prkKey, 96))

  // AES-128-GCM encrypt with 2-byte padding delimiter
  const plaintext  = concat(enc.encode(payload), new Uint8Array([0x02])) // padding delimiter
  const cekCrypto  = await crypto.subtle.importKey('raw', cek, { name: 'AES-GCM' }, false, ['encrypt'])
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, cekCrypto, plaintext))

  return { ciphertext, salt, serverPublicKey: senderPublicKeyRaw }
}

function concat(...arrays: Uint8Array[]): Uint8Array {
  const total = arrays.reduce((n, a) => n + a.length, 0)
  const out   = new Uint8Array(total)
  let offset  = 0
  for (const a of arrays) { out.set(a, offset); offset += a.length }
  return out
}

// Build the aes128gcm encrypted content-coding header + ciphertext body (RFC 8188)
function buildEncryptedBody(salt: Uint8Array, serverPublicKey: Uint8Array, ciphertext: Uint8Array): Uint8Array {
  // Header: salt(16) + rs(4, big-endian) + idlen(1) + keyid(65)
  const rs     = 4096
  const header = new Uint8Array(16 + 4 + 1 + serverPublicKey.length)
  header.set(salt, 0)
  new DataView(header.buffer).setUint32(16, rs, false)
  header[20] = serverPublicKey.length
  header.set(serverPublicKey, 21)
  return concat(header, ciphertext)
}

// ── Main dispatcher ───────────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const { employee_id, title, body, url = '/home' } = await req.json()
    if (!employee_id || !title || !body) {
      return new Response(JSON.stringify({ error: 'employee_id, title, body required' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const VAPID_PUBLIC_KEY  = Deno.env.get('VAPID_PUBLIC_KEY')!
    const VAPID_PRIVATE_KEY = Deno.env.get('VAPID_PRIVATE_KEY')!
    const VAPID_SUBJECT     = Deno.env.get('VAPID_SUBJECT') || 'mailto:tech@growthic.in'

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )

    // Load all subscriptions for this employee
    const { data: subs, error: subErr } = await supabase
      .from('push_subscriptions')
      .select('id, endpoint, p256dh, auth')
      .eq('employee_id', employee_id)

    if (subErr) throw subErr
    if (!subs || subs.length === 0) {
      return new Response(JSON.stringify({ sent: 0 }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const { privateKey } = await importVapidKeys(VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY)
    const payload = JSON.stringify({ title, body, url })
    const staleIds: string[] = []
    let sent = 0

    await Promise.all(subs.map(async (sub) => {
      try {
        const audience = new URL(sub.endpoint).origin
        const jwt      = await makeVapidJwt(audience, VAPID_SUBJECT, privateKey)
        const vapidKey = `vapid t=${jwt},k=${VAPID_PUBLIC_KEY}`

        const { ciphertext, salt, serverPublicKey } = await encryptPayload(payload, sub.p256dh, sub.auth)
        const encBody = buildEncryptedBody(salt, serverPublicKey, ciphertext)

        const res = await fetch(sub.endpoint, {
          method: 'POST',
          headers: {
            'Authorization':      vapidKey,
            'Content-Type':       'application/octet-stream',
            'Content-Encoding':   'aes128gcm',
            'TTL':                '86400',
          },
          body: encBody,
        })

        if (res.status === 201 || res.status === 200) {
          sent++
        } else if (res.status === 410 || res.status === 404) {
          // Subscription expired / unregistered — clean it up
          staleIds.push(sub.id)
        } else {
          console.warn('[send-push] push server responded', res.status, sub.endpoint)
        }
      } catch (err) {
        console.warn('[send-push] delivery error for', sub.endpoint, err)
      }
    }))

    // Delete stale subscriptions in bulk
    if (staleIds.length > 0) {
      await supabase.from('push_subscriptions').delete().in('id', staleIds)
    }

    return new Response(JSON.stringify({ sent, stale: staleIds.length }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (err) {
    console.error('[send-push]', err)
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
