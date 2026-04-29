// Growthic One — Edge Function: upload-receipt
// Uploads an expense receipt to Google Drive.
// Returns { driveUrl: string } — no DB record inserted here.
//
// Drive path: Reimbursements / {clientName} / {entityName?} / {YYYY-MM Month} / {DD} /
//
// Files are made viewable by anyone with the link (reader permission).
//
// Secrets required (shared with upload-to-drive):
//   SUPABASE_URL
//   SUPABASE_ANON_KEY
//   GOOGLE_SERVICE_ACCOUNT_JSON
//   GOOGLE_DRIVE_ROOT_FOLDER_ID

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
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    // ── Verify caller ──────────────────────────────────────────
    const authHeader = req.headers.get('Authorization') || ''
    if (!authHeader) return json({ error: 'Unauthorized' }, 401)

    const anonClient = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } },
    )
    const { data: { user }, error: userErr } = await anonClient.auth.getUser()
    if (userErr || !user) return json({ error: 'Unauthorized' }, 401)

    // ── Parse multipart ────────────────────────────────────────
    const form        = await req.formData()
    const file        = form.get('file')        as File   | null
    const clientName  = form.get('client_name') as string | null  // e.g. "Crystal Crop Protection"
    const entityName  = form.get('entity_name') as string | null  // optional
    const expenseDate = form.get('expense_date') as string | null  // YYYY-MM-DD

    if (!file) return json({ error: 'file is required' }, 400)
    if (file.size > 15 * 1024 * 1024) return json({ error: 'File exceeds 15 MB limit' }, 400)

    // Parse date → month label + day folder
    const dateObj  = expenseDate ? new Date(expenseDate) : new Date()
    const yearStr  = String(dateObj.getFullYear())
    const monthIdx = dateObj.getMonth()
    const monthLabel = `${MONTHS[monthIdx]} ${yearStr}`        // e.g. "April 2026"
    const dayFolder  = String(dateObj.getDate()).padStart(2, '0') // e.g. "24"

    // ── Google Drive auth ──────────────────────────────────────
    const saJson      = JSON.parse(Deno.env.get('GOOGLE_SERVICE_ACCOUNT_JSON')!)
    const accessToken = await getGoogleAccessToken(saJson)
    const rootId      = Deno.env.get('GOOGLE_DRIVE_ROOT_FOLDER_ID')!

    // ── Build folder: Reimbursements / Client / [Entity] / Month / Day ──
    let parent = rootId
    parent = await findOrCreateFolder(accessToken, 'Reimbursements', parent)
    parent = await findOrCreateFolder(accessToken, clientName || 'General', parent)
    if (entityName && entityName.trim()) {
      parent = await findOrCreateFolder(accessToken, entityName.trim(), parent)
    }
    parent = await findOrCreateFolder(accessToken, monthLabel, parent)
    parent = await findOrCreateFolder(accessToken, dayFolder,  parent)

    // ── Upload file ────────────────────────────────────────────
    const fileBytes = new Uint8Array(await file.arrayBuffer())
    const { fileId, webViewLink } = await uploadFileToDrive(
      accessToken, parent, file.name, fileBytes, file.type || 'application/octet-stream',
    )

    // ── Make file viewable by anyone with the link ────────────
    await setPublicReadPermission(accessToken, fileId)

    return json({ driveUrl: webViewLink })

  } catch (err) {
    return json({ error: String(err) }, 500)
  }
})

/* ── Google Drive helpers ────────────────────────────────── */

async function getGoogleAccessToken(sa: Record<string, string>): Promise<string> {
  const now = Math.floor(Date.now() / 1000)

  const header  = { alg: 'RS256', typ: 'JWT' }
  const payload = {
    iss:   sa.client_email,
    scope: 'https://www.googleapis.com/auth/drive',
    aud:   'https://oauth2.googleapis.com/token',
    iat:   now,
    exp:   now + 3600,
  }

  const b64url = (obj: object) =>
    btoa(JSON.stringify(obj)).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_')

  const signingInput = `${b64url(header)}.${b64url(payload)}`

  const pemBody = sa.private_key
    .replace(/-----BEGIN PRIVATE KEY-----/, '')
    .replace(/-----END PRIVATE KEY-----/, '')
    .replace(/\\n/g, '\n')
    .replace(/\n/g, '')
  const keyBytes = Uint8Array.from(atob(pemBody), c => c.charCodeAt(0))

  const cryptoKey = await crypto.subtle.importKey(
    'pkcs8', keyBytes,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false, ['sign'],
  )

  const sigBytes = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5', cryptoKey,
    new TextEncoder().encode(signingInput),
  )
  const sig = btoa(String.fromCharCode(...new Uint8Array(sigBytes)))
    .replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_')

  const jwt      = `${signingInput}.${sig}`
  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method:  'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body:    `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`,
  })
  const tokenData = await tokenRes.json() as { access_token: string }
  return tokenData.access_token
}

async function findOrCreateFolder(token: string, name: string, parentId: string): Promise<string> {
  const q = `name='${name.replace(/'/g, "\\'")}' and '${parentId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`
  const searchRes  = await fetch(
    `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id)&supportsAllDrives=true&includeItemsFromAllDrives=true`,
    { headers: { Authorization: `Bearer ${token}` } },
  )
  const searchData = await searchRes.json() as { files: { id: string }[]; error?: unknown }
  if (searchData.error) throw new Error(`Drive folder search failed: ${JSON.stringify(searchData.error)}`)
  if (searchData.files?.length > 0) return searchData.files[0].id

  const createRes  = await fetch('https://www.googleapis.com/drive/v3/files?supportsAllDrives=true', {
    method:  'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body:    JSON.stringify({ name, mimeType: 'application/vnd.google-apps.folder', parents: [parentId] }),
  })
  const createData = await createRes.json() as { id?: string; error?: unknown }
  if (!createData.id) throw new Error(`Drive folder create failed: ${JSON.stringify(createData.error || createData)}`)
  return createData.id
}

async function uploadFileToDrive(
  token: string, folderId: string, fileName: string,
  fileBytes: Uint8Array, mimeType: string,
): Promise<{ fileId: string; webViewLink: string }> {
  const boundary = 'growthic_receipt_boundary'
  const enc      = new TextEncoder()

  const metaPart = enc.encode(
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n` +
    JSON.stringify({ name: fileName, parents: [folderId] }) +
    `\r\n--${boundary}\r\nContent-Type: ${mimeType}\r\n\r\n`,
  )
  const footer = enc.encode(`\r\n--${boundary}--`)

  const body = new Uint8Array(metaPart.length + fileBytes.length + footer.length)
  body.set(metaPart, 0)
  body.set(fileBytes, metaPart.length)
  body.set(footer, metaPart.length + fileBytes.length)

  const uploadRes  = await fetch(
    `https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,webViewLink&supportsAllDrives=true`,
    {
      method:  'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': `multipart/related; boundary=${boundary}` },
      body,
    },
  )
  const uploadData = await uploadRes.json() as { id?: string; webViewLink?: string; error?: unknown }
  if (!uploadData.id) throw new Error(`Drive upload failed: ${JSON.stringify(uploadData.error || uploadData)}`)
  return { fileId: uploadData.id, webViewLink: uploadData.webViewLink! }
}

/* Make a Drive file viewable by anyone with the link */
async function setPublicReadPermission(token: string, fileId: string): Promise<void> {
  await fetch(
    `https://www.googleapis.com/drive/v3/files/${fileId}/permissions?supportsAllDrives=true`,
    {
      method:  'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body:    JSON.stringify({ role: 'reader', type: 'anyone' }),
    },
  )
  // Non-critical — don't throw if permission setting fails
}

function json(body: object, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}
