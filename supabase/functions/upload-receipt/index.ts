// Growthic One — Edge Function: upload-receipt
// Uploads an expense receipt to the HR Shared Drive.
// Returns { driveUrl: string } — no DB record inserted here.
//
// Drive path (HR Drive):
//   Reimbursement Receipts / {clientName} / {entityName?} / {YYYY} / {Month} / {DD} / {file}
//
// Date is always today's upload date — not the expense date.
//
// Env vars required:
//   GOOGLE_DRIVE_HR_DRIVE_ID    — HR Shared Drive ID
//   GOOGLE_SERVICE_ACCOUNT_JSON
//   SUPABASE_URL / SUPABASE_ANON_KEY

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const MONTHS = [
  'January','February','March','April','May','June',
  'July','August','September','October','November','December',
]

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

    // ── Parse form ────────────────────────────────────────────
    const form       = await req.formData()
    const file       = form.get('file')        as File   | null
    const clientName = form.get('client_name') as string | null
    const entityName = form.get('entity_name') as string | null

    if (!file) return json({ error: 'file is required.' }, 400)
    if (file.size > 15 * 1024 * 1024) return json({ error: 'File exceeds 15 MB limit.' }, 400)

    // Date is always the upload date — not the expense date
    const now       = new Date()
    const yearStr   = String(now.getFullYear())
    const monthName = MONTHS[now.getMonth()]
    const dayStr    = String(now.getDate()).padStart(2, '0')

    // ── Google Drive ──────────────────────────────────────────
    const saJson      = JSON.parse(Deno.env.get('GOOGLE_SERVICE_ACCOUNT_JSON')!)
    const accessToken = await getGoogleAccessToken(saJson)
    const hrRootId    = Deno.env.get('GOOGLE_DRIVE_HR_DRIVE_ID')!

    // Path: Reimbursement Receipts / {Client} / {Entity?} / {YYYY} / {Month} / {DD} /
    let parent = hrRootId
    parent = await findOrCreateFolder(accessToken, 'Reimbursement Receipts',     parent)
    parent = await findOrCreateFolder(accessToken, clientName?.trim() || 'General', parent)
    if (entityName?.trim()) {
      parent = await findOrCreateFolder(accessToken, entityName.trim(), parent)
    }
    parent = await findOrCreateFolder(accessToken, yearStr,   parent)
    parent = await findOrCreateFolder(accessToken, monthName, parent)
    parent = await findOrCreateFolder(accessToken, dayStr,    parent)

    // ── Upload ────────────────────────────────────────────────
    const fileBytes = new Uint8Array(await file.arrayBuffer())
    const { fileId, webViewLink } = await uploadFileToDrive(
      accessToken, parent, file.name, fileBytes, file.type || 'application/octet-stream',
    )

    await setPublicReadPermission(accessToken, fileId)
    return json({ driveUrl: webViewLink })

  } catch (err) {
    return json({ error: String(err) }, 500)
  }
})

/* ── Google Drive helpers ─────────────────────────────────── */

async function getGoogleAccessToken(sa: Record<string, string>): Promise<string> {
  const now = Math.floor(Date.now() / 1000)
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
    method:'POST', headers:{'Content-Type':'application/x-www-form-urlencoded'},
    body:`grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${signingInput}.${sig}`,
  })
  const td = await tokenRes.json() as { access_token: string }
  return td.access_token
}

async function findOrCreateFolder(token: string, name: string, parentId: string): Promise<string> {
  const q = `name='${name.replace(/'/g,"\\'")}' and '${parentId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`
  const sr = await fetch(
    `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id)&supportsAllDrives=true&includeItemsFromAllDrives=true`,
    { headers:{ Authorization:`Bearer ${token}` } },
  )
  const sd = await sr.json() as { files: { id: string }[]; error?: unknown }
  if (sd.error) throw new Error(`Drive folder search failed: ${JSON.stringify(sd.error)}`)
  if (sd.files?.length > 0) return sd.files[0].id
  const cr = await fetch('https://www.googleapis.com/drive/v3/files?supportsAllDrives=true', {
    method:'POST', headers:{ Authorization:`Bearer ${token}`, 'Content-Type':'application/json' },
    body: JSON.stringify({ name, mimeType:'application/vnd.google-apps.folder', parents:[parentId] }),
  })
  const cd = await cr.json() as { id?: string; error?: unknown }
  if (!cd.id) throw new Error(`Drive folder create failed: ${JSON.stringify(cd.error || cd)}`)
  return cd.id
}

async function uploadFileToDrive(
  token: string, folderId: string, fileName: string, fileBytes: Uint8Array, mimeType: string,
): Promise<{ fileId: string; webViewLink: string }> {
  const boundary = 'growthic_receipt_boundary'
  const enc = new TextEncoder()
  const meta = enc.encode(
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n` +
    JSON.stringify({ name: fileName, parents: [folderId] }) +
    `\r\n--${boundary}\r\nContent-Type: ${mimeType}\r\n\r\n`,
  )
  const footer = enc.encode(`\r\n--${boundary}--`)
  const body   = new Uint8Array(meta.length + fileBytes.length + footer.length)
  body.set(meta, 0); body.set(fileBytes, meta.length); body.set(footer, meta.length + fileBytes.length)
  const ur = await fetch(
    `https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,webViewLink&supportsAllDrives=true`,
    { method:'POST', headers:{ Authorization:`Bearer ${token}`, 'Content-Type':`multipart/related; boundary=${boundary}` }, body },
  )
  const ud = await ur.json() as { id?: string; webViewLink?: string; error?: unknown }
  if (!ud.id) throw new Error(`Drive upload failed: ${JSON.stringify(ud.error || ud)}`)
  return { fileId: ud.id, webViewLink: ud.webViewLink! }
}

async function setPublicReadPermission(token: string, fileId: string): Promise<void> {
  await fetch(
    `https://www.googleapis.com/drive/v3/files/${fileId}/permissions?supportsAllDrives=true`,
    { method:'POST', headers:{ Authorization:`Bearer ${token}`, 'Content-Type':'application/json' },
      body: JSON.stringify({ role:'reader', type:'anyone' }) },
  ).catch(() => {})
}

function json(body: object, status = 200) {
  return new Response(JSON.stringify(body), {
    status, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}
