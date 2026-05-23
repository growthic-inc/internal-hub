// Growthic One — Edge Function: create-client-folder
// Creates the base client folder in both Shared Drives the moment a new
// client is added to the Client Directory — before any files are uploaded.
//
// Ops Drive:  {status} Clients / {Client Name} /
// BD Drive:   Client Directory / {status} Clients / {Client Name} /
//
// Env vars required (same as upload-client-doc):
//   GOOGLE_DRIVE_BD_DRIVE_ID
//   GOOGLE_DRIVE_OPS_DRIVE_ID
//   GOOGLE_SERVICE_ACCOUNT_JSON
//   SUPABASE_URL / SUPABASE_ANON_KEY

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

function statusFolder(status: string): string {
  if (status === 'paused')   return 'Paused Clients'
  if (status === 'inactive') return 'Inactive Clients'
  return 'Active Clients'
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    // ── Auth ──────────────────────────────────────────────────
    const authHeader = req.headers.get('Authorization') || ''
    if (!authHeader) return json({ error: 'Unauthorized' }, 401)

    const anonClient = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } },
    )
    const { data: { user }, error: userErr } = await anonClient.auth.getUser()
    if (userErr || !user) return json({ error: 'Unauthorized' }, 401)

    // ── Parse body ────────────────────────────────────────────
    const { client_name, client_status } = await req.json()
    if (!client_name) return json({ error: 'client_name is required' }, 400)

    const name    = (client_name as string).trim()
    const sfolder = statusFolder((client_status as string) || 'active')

    const saJson      = JSON.parse(Deno.env.get('GOOGLE_SERVICE_ACCOUNT_JSON')!)
    const accessToken = await getGoogleAccessToken(saJson)

    // Create base folder in both drives in parallel
    const [opsClientFolderId, bdClientFolderId] = await Promise.all([
      // Ops Drive: {status} Clients / {Client Name}
      (async () => {
        let parent = Deno.env.get('GOOGLE_DRIVE_OPS_DRIVE_ID')!
        parent = await findOrCreateFolder(accessToken, sfolder, parent)
        parent = await findOrCreateFolder(accessToken, name,    parent)
        return parent
      })(),
      // BD Drive: Client Directory / {status} Clients / {Client Name}
      (async () => {
        let parent = Deno.env.get('GOOGLE_DRIVE_BD_DRIVE_ID')!
        parent = await findOrCreateFolder(accessToken, 'Client Directory', parent)
        parent = await findOrCreateFolder(accessToken, sfolder,            parent)
        parent = await findOrCreateFolder(accessToken, name,               parent)
        return parent
      })(),
    ])

    return json({ created: true, opsClientFolderId, bdClientFolderId })

  } catch (err) {
    console.error('[create-client-folder]', err)
    return json({ error: String(err) }, 500)
  }
})

/* ── Google Drive helpers ─────────────────────────────────── */

async function getGoogleAccessToken(sa: Record<string, string>): Promise<string> {
  const now     = Math.floor(Date.now() / 1000)
  const header  = { alg: 'RS256', typ: 'JWT' }
  const payload = {
    iss: sa.client_email, scope: 'https://www.googleapis.com/auth/drive',
    aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600,
  }
  const b64url = (o: object) =>
    btoa(JSON.stringify(o)).replace(/=/g,'').replace(/\+/g,'-').replace(/\//g,'_')
  const signingInput = `${b64url(header)}.${b64url(payload)}`
  const pemBody = sa.private_key
    .replace(/-----BEGIN PRIVATE KEY-----/,'').replace(/-----END PRIVATE KEY-----/,'')
    .replace(/\\n/g,'\n').replace(/\n/g,'')
  const keyBytes  = Uint8Array.from(atob(pemBody), c => c.charCodeAt(0))
  const cryptoKey = await crypto.subtle.importKey(
    'pkcs8', keyBytes, { name:'RSASSA-PKCS1-v1_5', hash:'SHA-256' }, false, ['sign'],
  )
  const sigBytes = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', cryptoKey, new TextEncoder().encode(signingInput))
  const sig = btoa(String.fromCharCode(...new Uint8Array(sigBytes))).replace(/=/g,'').replace(/\+/g,'-').replace(/\//g,'_')
  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${signingInput}.${sig}`,
  })
  const td = await tokenRes.json() as { access_token: string }
  return td.access_token
}

async function findOrCreateFolder(token: string, name: string, parentId: string): Promise<string> {
  const q = `name='${name.replace(/'/g,"\\'")}' and '${parentId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`
  const sr = await fetch(
    `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id)&supportsAllDrives=true&includeItemsFromAllDrives=true`,
    { headers: { Authorization: `Bearer ${token}` } },
  )
  const sd = await sr.json() as { files: { id: string }[]; error?: unknown }
  if (sd.error) throw new Error(`Drive folder search failed: ${JSON.stringify(sd.error)}`)
  if (sd.files?.length > 0) return sd.files[0].id
  const cr = await fetch('https://www.googleapis.com/drive/v3/files?supportsAllDrives=true', {
    method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, mimeType: 'application/vnd.google-apps.folder', parents: [parentId] }),
  })
  const cd = await cr.json() as { id?: string; error?: unknown }
  if (!cd.id) throw new Error(`Drive folder create failed: ${JSON.stringify(cd.error || cd)}`)
  return cd.id
}

function json(body: object, status = 200) {
  return new Response(JSON.stringify(body), {
    status, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}
