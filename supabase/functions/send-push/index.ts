// Growthic One — Edge Function: send-push
// Dispatches Web Push messages (RFC 8030 + VAPID RFC 8292 + aes128gcm RFC 8188)
// to every registered device for a given employee.
//
// Required env vars (Supabase dashboard → Settings → Edge Functions):
//   VAPID_PRIVATE_KEY  — 32-byte raw P-256 private scalar, base64url
//   VAPID_PUBLIC_KEY   — 65-byte uncompressed P-256 point, base64url (same as push.js)
//   VAPID_SUBJECT      — mailto: or https: contact, e.g. mailto:tech@growthic.in

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// ── Encoding helpers ──────────────────────────────────────────────────────────

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

// ── VAPID JWT ─────────────────────────────────────────────────────────────────

// Import a raw 32-byte P-256 private key for ECDSA signing.
// web-push generate-vapid-keys outputs a raw scalar, not PKCS8 —
// we must build a JWK from the raw bytes + the matching public point.
async function importVapidSigningKey(privateB64: string, publicB64: string): Promise<CryptoKey> {
  const privBytes = b64urlDecode(privateB64)   // 32 bytes: raw EC private scalar
  const pubBytes  = b64urlDecode(publicB64)    // 65 bytes: 0x04 + x(32) + y(32)

  return crypto.subtle.importKey(
    'jwk',
    {
      kty: 'EC',
      crv: 'P-256',
      x:   b64urlEncode(pubBytes.slice(1, 33)),
      y:   b64urlEncode(pubBytes.slice(33, 65)),
      d:   b64urlEncode(privBytes),
    },
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign'],
  )
}

async function makeVapidJwt(audience: string, subject: string, signingKey: CryptoKey): Promise<string> {
  const enc     = new TextEncoder()
  const header  = b64urlEncode(enc.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })))
  const payload = b64urlEncode(enc.encode(JSON.stringify({
    aud: audience,
    exp: Math.floor(Date.now() / 1000) + 43200, // 12 h
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

// ── Web Push message encryption (RFC 8291 + RFC 8188 aes128gcm) ───────────────

async function encryptPayload(
  payloadStr: string,
  p256dhB64:  string,   // subscription public key
  authB64:    string,   // subscription auth secret
): Promise<Uint8Array> {
  const enc = new TextEncoder()

  // 1. Import receiver's public key for ECDH
  const receiverPublicKey = await crypto.subtle.importKey(
    'raw',
    b64urlDecode(p256dhB64),
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    [],
  )

  // 2. Generate ephemeral sender key pair
  const senderPair = await crypto.subtle.generateKey(
    { name: 'ECDH', namedCurve: 'P-256' },
    true,
    ['deriveBits'],
  )
  const senderPublicRaw = new Uint8Array(await crypto.subtle.exportKey('raw', senderPair.publicKey))

  // 3. ECDH shared secret
  const ecdhSecret = new Uint8Array(await crypto.subtle.deriveBits(
    { name: 'ECDH', public: receiverPublicKey },
    senderPair.privateKey,
    256,
  ))

  // 4. Random 16-byte salt for content encoding
  const salt = crypto.getRandomValues(new Uint8Array(16))

  // 5. RFC 8291 §3.3: derive IKM from ECDH secret + auth
  //    HKDF(salt=auth_secret, ikm=ecdhSecret, info="WebPush: info\x00" + ua_pub + as_pub, L=32)
  const authSecret = b64urlDecode(authB64)
  const ikm = new Uint8Array(await crypto.subtle.deriveBits(
    {
      name: 'HKDF', hash: 'SHA-256',
      salt: authSecret,
      info: concat(enc.encode('WebPush: info\x00'), b64urlDecode(p256dhB64), senderPublicRaw),
    },
    await crypto.subtle.importKey('raw', ecdhSecret, { name: 'HKDF' }, false, ['deriveBits']),
    256,
  ))

  // 6. RFC 8291 §3.4: derive CEK (16 bytes) and nonce (12 bytes) from IKM + salt
  const ikmKey = await crypto.subtle.importKey('raw', ikm, { name: 'HKDF' }, false, ['deriveBits'])

  const cek = new Uint8Array(await crypto.subtle.deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt, info: enc.encode('Content-Encoding: aes128gcm\x00') },
    ikmKey, 128,
  ))
  const nonce = new Uint8Array(await crypto.subtle.deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt, info: enc.encode('Content-Encoding: nonce\x00') },
    ikmKey, 96,
  ))

  // 7. AES-128-GCM encrypt  (padding delimiter byte 0x02, no extra padding)
  const plaintext = concat(enc.encode(payloadStr), new Uint8Array([0x02]))
  const cekKey    = await crypto.subtle.importKey('raw', cek, { name: 'AES-GCM' }, false, ['encrypt'])
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: nonce },
    cekKey,
    plaintext,
  ))

  // 8. Build RFC 8188 aes128gcm header:
  //    salt(16) + rs(4, big-endian) + idlen(1) + keyid(65)
  const header = new Uint8Array(16 + 4 + 1 + senderPublicRaw.length)
  header.set(salt, 0)
  new DataView(header.buffer).setUint32(16, 4096, false)
  header[20] = senderPublicRaw.length          // 65
  header.set(senderPublicRaw, 21)

  return concat(header, ciphertext)
}

// ── Main handler ──────────────────────────────────────────────────────────────

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

    if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) {
      console.error('[send-push] VAPID env vars not set')
      return new Response(JSON.stringify({ error: 'VAPID env vars not configured' }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // Import signing key once — shared across all subscriptions in this request
    const signingKey = await importVapidSigningKey(VAPID_PRIVATE_KEY, VAPID_PUBLIC_KEY)

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )

    const { data: subs, error: subErr } = await supabase
      .from('push_subscriptions')
      .select('id, endpoint, p256dh, auth')
      .eq('employee_id', employee_id)

    if (subErr) throw subErr
    if (!subs?.length) {
      return new Response(JSON.stringify({ sent: 0 }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const payload  = JSON.stringify({ title, body, url })
    const staleIds: string[] = []
    let sent = 0

    await Promise.all(subs.map(async (sub) => {
      try {
        const audience   = new URL(sub.endpoint).origin
        const jwt        = await makeVapidJwt(audience, VAPID_SUBJECT, signingKey)
        const encBody    = await encryptPayload(payload, sub.p256dh, sub.auth)

        const res = await fetch(sub.endpoint, {
          method: 'POST',
          headers: {
            'Authorization':    `vapid t=${jwt},k=${VAPID_PUBLIC_KEY}`,
            'Content-Type':     'application/octet-stream',
            'Content-Encoding': 'aes128gcm',
            'TTL':              '86400',
          },
          body: encBody,
        })

        if (res.status === 201 || res.status === 200) {
          sent++
        } else if (res.status === 410 || res.status === 404) {
          staleIds.push(sub.id)
        } else {
          const txt = await res.text().catch(() => '')
          console.warn(`[send-push] ${res.status} from push service:`, txt)
        }
      } catch (err) {
        console.warn('[send-push] delivery error for', sub.endpoint, err)
      }
    }))

    if (staleIds.length) {
      await supabase.from('push_subscriptions').delete().in('id', staleIds)
    }

    return new Response(JSON.stringify({ sent, stale: staleIds.length }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (err) {
    console.error('[send-push] fatal:', err)
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
