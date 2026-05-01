// Growthic One — Edge Function: upload-policy-file
// Uploads a policy/document file to Google Drive.
//
// Drive path:
//   {categoryName} / {filename}
//
// Env vars required:
//   GOOGLE_DRIVE_POLICIES_FOLDER_ID = 1FcWD--S7r6cyuMQsP7RFZoeHFsDtnD5j
//
// Returns: { driveUrl: string, driveFileId: string }

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
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

    // ── Parse form ────────────────────────────────────────────
    const form         = await req.formData()
    const file         = form.get('file')          as File   | null
    const categoryName = form.get('category_name') as string | null

    if (!file || !categoryName) return json({ error: 'file and category_name are required.' }, 400)
    if (file.size > 50 * 1024 * 1024) return json({ error: 'File exceeds 50 MB limit.' }, 400)

    // ── Folder path: {categoryName} / {filename} ──────────────
    const saJson      = JSON.parse(Deno.env.get('GOOGLE_SERVICE_ACCOUNT_JSON')!)
    const accessToken = await getGoogleAccessToken(saJson)
    const rootId      = Deno.env.get('GOOGLE_DRIVE_POLICIES_FOLDER_ID')!

    const parent = await findOrCreateFolder(accessToken, categoryName.trim(), rootId)

    // ── Upload ────────────────────────────────────────────────
    const fileBytes = new Uint8Array(await file.arrayBuffer())
    const { fileId, webViewLink } = await uploadFileToDrive(
      accessToken, parent, file.name, fileBytes,
      file.type || 'application/octet-stream',
    )

    await setPublicReadPermission(accessToken, fileId)
    return json({ driveUrl: webViewLink, driveFileId: fileId })

  } catch (err) {
    return json({ error: String(err) }, 500)
  }
})

/* ── Google Drive helpers ─────────────────────────────────── */

async function getGoogleAccessToken(sa: Record<string, string>): Promise<string> {
  const now     = Math.floor(Date.now() / 1000)
  const header  = { alg: 'RS256', typ: 'JWT' }
  const payload = {
    iss: sa.client_email,
    scope: 'https://www.googleapis.com/auth/drive',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now, exp: now + 3600,
  }
  const b64url = (obj: object) =>
    btoa(JSON.stringify(obj)).replace(/=/g,'').replace(/\+/g,'-').replace(/\//g,'_')
  const signingInput = `${b64url(header)}.${b64url(payload)}`
  const pemBody = sa.private_key
    .replace(/-----BEGIN PRIVATE KEY-----/, '').replace(/-----END PRIVATE KEY-----/, '')
    .replace(/\\n/g, '\n').replace(/\n/g, '')
  const keyBytes  = Uint8Array.from(atob(pemBody), c => c.charCodeAt(0))
  const cryptoKey = await crypto.subtle.importKey(
    'pkcs8', keyBytes, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign'],
  )
  const sigBytes = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', cryptoKey, new TextEncoder().encode(signingInput))
  const sig = btoa(String.fromCharCode(...new Uint8Array(sigBytes)))
    .replace(/=/g,'').replace(/\+/g,'-').replace(/\//g,'_')
  const jwt = `${signingInput}.${sig}`
  const tokenRes  = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`,
  })
  const tokenData = await tokenRes.json() as { access_token: string }
  return tokenData.access_token
}

async function findOrCreateFolder(token: string, name: string, parentId: string): Promise<string> {
  const q = `name='${name.replace(/'/g,"\\'")}' and '${parentId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`
  const searchRes  = await fetch(
    `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id)&supportsAllDrives=true&includeItemsFromAllDrives=true`,
    { headers: { Authorization: `Bearer ${token}` } },
  )
  const searchData = await searchRes.json() as { files: { id: string }[]; error?: unknown }
  if (searchData.error) throw new Error(`Drive folder search failed: ${JSON.stringify(searchData.error)}`)
  if (searchData.files?.length > 0) return searchData.files[0].id

  const createRes  = await fetch('https://www.googleapis.com/drive/v3/files?supportsAllDrives=true', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, mimeType: 'application/vnd.google-apps.folder', parents: [parentId] }),
  })
  const createData = await createRes.json() as { id?: string; error?: unknown }
  if (!createData.id) throw new Error(`Drive folder create failed: ${JSON.stringify(createData.error || createData)}`)
  return createData.id
}

async function uploadFileToDrive(
  token: string, folderId: string, fileName: string,
  fileBytes: Uint8Array, mimeType: string,
): Promise<{ fileId: string; webViewLink: string }> {
  const boundary = 'growthic_policy_boundary'
  const enc      = new TextEncoder()
  const metaPart = enc.encode(
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n` +
    JSON.stringify({ name: fileName, parents: [folderId] }) +
    `\r\n--${boundary}\r\nContent-Type: ${mimeType}\r\n\r\n`,
  )
  const footer = enc.encode(`\r\n--${boundary}--`)
  const body   = new Uint8Array(metaPart.length + fileBytes.length + footer.length)
  body.set(metaPart, 0)
  body.set(fileBytes, metaPart.length)
  body.set(footer, metaPart.length + fileBytes.length)

  const uploadRes  = await fetch(
    `https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,webViewLink&supportsAllDrives=true`,
    { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': `multipart/related; boundary=${boundary}` }, body },
  )
  const uploadData = await uploadRes.json() as { id?: string; webViewLink?: string; error?: unknown }
  if (!uploadData.id) throw new Error(`Drive upload failed: ${JSON.stringify(uploadData.error || uploadData)}`)

  const id  = uploadData.id
  const raw = uploadData.webViewLink || ''
  let viewUrl: string
  if (raw.includes('docs.google.com/document/d/'))          viewUrl = `https://docs.google.com/document/d/${id}/view`
  else if (raw.includes('docs.google.com/spreadsheets/d/')) viewUrl = `https://docs.google.com/spreadsheets/d/${id}/view`
  else if (raw.includes('docs.google.com/presentation/d/')) viewUrl = `https://docs.google.com/presentation/d/${id}/view`
  else viewUrl = `https://drive.google.com/file/d/${id}/view`

  return { fileId: id, webViewLink: viewUrl }
}

async function setPublicReadPermission(token: string, fileId: string): Promise<void> {
  await fetch(
    `https://www.googleapis.com/drive/v3/files/${fileId}/permissions?supportsAllDrives=true`,
    { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: 'reader', type: 'anyone' }) },
  )
}

function json(body: object, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}
