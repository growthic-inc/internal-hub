// Growthic One — Edge Function: upload-to-drive
// Receives a file + metadata from the frontend, authenticates with Google Drive
// using a service account, creates the folder hierarchy if needed, uploads the
// file, then inserts a record into master_folder_files.
//
// Secrets required:
//   SUPABASE_URL
//   SUPABASE_ANON_KEY
//   SUPABASE_SERVICE_ROLE_KEY
//   GOOGLE_SERVICE_ACCOUNT_JSON   — full service account JSON as a string
//   GOOGLE_DRIVE_ROOT_FOLDER_ID   — ID of the "Clients" root folder in shared Drive

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const FOLDER_TYPE_LABELS: Record<string, string> = {
  approved_content:    'Content',
  creatives:           'Creatives',
  reports:             'Reports',
  analytics_linkedin:  'Analytics',
  analytics_instagram: 'Analytics',
}

// Sub-folder created inside the folder type label (platform level for analytics)
const FOLDER_TYPE_SUBFOLDERS: Record<string, string | null> = {
  approved_content:    null,
  creatives:           null,
  reports:             null,
  analytics_linkedin:  'LinkedIn',
  analytics_instagram: 'Instagram',
}

// Analytics uploads are NOT recorded in master_folder_files — they live
// only on Drive. The caller (ingest-analytics) stores the URL itself.
const SKIP_DB_RECORD = new Set(['analytics_linkedin', 'analytics_instagram'])

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

    const adminClient = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )

    // ── Parse multipart form data ──────────────────────────────
    const form       = await req.formData()
    const file       = form.get('file') as File | null
    const clientId   = form.get('client_id') as string | null
    const entityId   = form.get('entity_id') as string | null || null
    const month      = form.get('month') as string | null      // YYYY-MM
    const folderType = form.get('folder_type') as string | null

    if (!file || !clientId || !month || !folderType) {
      return json({ error: 'file, client_id, month, and folder_type are required.' }, 400)
    }

    const validFolderTypes = ['approved_content', 'creatives', 'reports', 'analytics_linkedin', 'analytics_instagram']
    if (!validFolderTypes.includes(folderType)) {
      return json({ error: `Invalid folder_type: ${folderType}` }, 400)
    }

    // ── Resolve client and entity names ───────────────────────
    const { data: client } = await adminClient
      .from('clients')
      .select('client_name')
      .eq('id', clientId)
      .single()
    if (!client) return json({ error: 'Client not found.' }, 404)

    let entityName: string | null = null
    if (entityId) {
      const { data: entity } = await adminClient
        .from('client_entities')
        .select('entity_name')
        .eq('id', entityId)
        .single()
      entityName = entity?.entity_name || null
    }

    // ── Build folder path ──────────────────────────────────────
    // YYYY-MM → year string + month name
    const [yearStr, monthNum] = month.split('-')
    const monthName = MONTHS[parseInt(monthNum, 10) - 1]
    const folderLabel = FOLDER_TYPE_LABELS[folderType]

    const rootFolderId = Deno.env.get('GOOGLE_DRIVE_ROOT_FOLDER_ID')!

    // ── Get Google Drive access token ──────────────────────────
    const saJson = JSON.parse(Deno.env.get('GOOGLE_SERVICE_ACCOUNT_JSON')!)
    const accessToken = await getGoogleAccessToken(saJson)

    // ── Create folder hierarchy ────────────────────────────────
    let currentParent = rootFolderId

    // /[Client Name]
    currentParent = await findOrCreateFolder(accessToken, client.client_name, currentParent)

    // /[Entity Name]  — only if client has entities
    if (entityName) {
      currentParent = await findOrCreateFolder(accessToken, entityName, currentParent)
    }

    // /[Year] / [Month] / [Folder Type]
    currentParent = await findOrCreateFolder(accessToken, yearStr,     currentParent)
    currentParent = await findOrCreateFolder(accessToken, monthName,   currentParent)
    currentParent = await findOrCreateFolder(accessToken, folderLabel, currentParent)

    // Optional platform sub-folder (analytics_linkedin → 'LinkedIn', etc.)
    const subfolder = FOLDER_TYPE_SUBFOLDERS[folderType]
    if (subfolder) {
      currentParent = await findOrCreateFolder(accessToken, subfolder, currentParent)
    }

    // ── Upload file ────────────────────────────────────────────
    const fileBytes = new Uint8Array(await file.arrayBuffer())
    const { driveFileId, webViewLink } = await uploadFileToDrive(
      accessToken,
      currentParent,
      file.name,
      fileBytes,
      file.type || 'application/octet-stream',
    )

    // ── Insert DB record (skip for analytics types — caller handles logging) ──
    if (SKIP_DB_RECORD.has(folderType)) {
      return json({ success: true, drive_file_id: driveFileId, drive_url: webViewLink })
    }

    const { data: record, error: insertErr } = await adminClient
      .from('master_folder_files')
      .insert({
        client_id:    clientId,
        entity_id:    entityId,
        month,
        folder_type:  folderType,
        file_name:    file.name,
        file_type:    file.type || null,
        drive_file_id: driveFileId,
        drive_url:    webViewLink,
        uploaded_by:  user.id,
      })
      .select()
      .single()

    if (insertErr) {
      // Best-effort: delete the Drive file we just created so it doesn't dangle
      await fetch(`https://www.googleapis.com/drive/v3/files/${driveFileId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${accessToken}` },
      })
      return json({ error: `DB insert failed: ${insertErr.message}` }, 500)
    }

    return json({ success: true, file: record })

  } catch (err) {
    return json({ error: String(err) }, 500)
  }
})

/* ── Google Drive helpers ─────────────────────────────────── */

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

  // Parse PKCS#8 private key
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

  const jwt = `${signingInput}.${sig}`

  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`,
  })
  const tokenData = await tokenRes.json() as { access_token: string }
  return tokenData.access_token
}

async function findOrCreateFolder(token: string, name: string, parentId: string): Promise<string> {
  const q = `name='${name.replace(/'/g, "\\'")}' and '${parentId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`
  const searchRes = await fetch(
    `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id)&supportsAllDrives=true&includeItemsFromAllDrives=true`,
    { headers: { Authorization: `Bearer ${token}` } },
  )
  const searchData = await searchRes.json() as { files: { id: string }[]; error?: unknown }
  if (searchData.error) throw new Error(`Drive folder search failed: ${JSON.stringify(searchData.error)}`)

  if (searchData.files?.length > 0) return searchData.files[0].id

  const createRes = await fetch('https://www.googleapis.com/drive/v3/files?supportsAllDrives=true', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name,
      mimeType: 'application/vnd.google-apps.folder',
      parents:  [parentId],
    }),
  })
  const createData = await createRes.json() as { id?: string; error?: unknown }
  if (!createData.id) throw new Error(`Drive folder create failed: ${JSON.stringify(createData.error || createData)}`)
  return createData.id
}

async function uploadFileToDrive(
  token: string,
  folderId: string,
  fileName: string,
  fileBytes: Uint8Array,
  mimeType: string,
): Promise<{ driveFileId: string; webViewLink: string }> {
  const boundary = 'growthic_boundary_x7k2m'
  const enc = new TextEncoder()

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

  const uploadRes = await fetch(
    `https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,webViewLink&supportsAllDrives=true`,
    {
      method:  'POST',
      headers: {
        Authorization:  `Bearer ${token}`,
        'Content-Type': `multipart/related; boundary=${boundary}`,
      },
      body,
    },
  )
  const uploadData = await uploadRes.json() as { id?: string; webViewLink?: string; error?: unknown }
  if (!uploadData.id) throw new Error(`Drive file upload failed: ${JSON.stringify(uploadData.error || uploadData)}`)
  return { driveFileId: uploadData.id, webViewLink: uploadData.webViewLink! }
}

function json(body: object, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}
