// Growthic One — Edge Function: upload-to-drive
// Uploads operational client files to the Operations Shared Drive,
// or asset photos to the HR Shared Drive.
//
// Operations Drive paths:
//   {status} Clients / {Client} / {Entity?} / {Year} / {Month} / Content    / {file}
//   {status} Clients / {Client} / {Entity?} / {Year} / {Month} / Creative   / {file}
//   {status} Clients / {Client} / {Entity?} / {Year} / {Month} / Reports    / {file}
//   {status} Clients / {Client} / {Entity?} / {Year} / {Month} / Analytics  / {Platform} / {file}
//
// HR Drive paths (asset photos):
//   Assets / {Asset Category} / {Asset Name} / Repairs / {file}
//   Assets / {Asset Category} / {Asset Name} / Other   / {file}
//
// Env vars required:
//   GOOGLE_DRIVE_OPS_DRIVE_ID   — Operations Shared Drive ID
//   GOOGLE_DRIVE_HR_DRIVE_ID    — HR Shared Drive ID
//   GOOGLE_SERVICE_ACCOUNT_JSON
//   SUPABASE_URL / SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// Maps folder_type → Drive sub-folder name inside the month folder
const FOLDER_TYPE_LABELS: Record<string, string> = {
  approved_content:    'Content',
  creatives:           'Creative',
  reports:             'Reports',
  analytics_linkedin:  'Analytics',
  analytics_instagram: 'Analytics',
}

// Analytics goes one level deeper: Analytics / {Platform}
const ANALYTICS_PLATFORM: Record<string, string | null> = {
  approved_content:    null,
  creatives:           null,
  reports:             null,
  analytics_linkedin:  'LinkedIn',
  analytics_instagram: 'Instagram',
}

// Analytics uploads are NOT recorded in master_folder_files
const SKIP_DB_RECORD = new Set(['analytics_linkedin', 'analytics_instagram'])

const MONTHS = [
  'January','February','March','April','May','June',
  'July','August','September','October','November','December',
]

// Maps client.status → Drive status-category folder name
function statusFolder(status: string): string {
  if (status === 'paused')   return 'Paused Clients'
  if (status === 'inactive') return 'Inactive Clients'
  return 'Active Clients'   // 'active' and any unknown value default to Active
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

    const adminClient = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )

    // ── Parse form ────────────────────────────────────────────
    const form       = await req.formData()
    const file       = form.get('file')        as File   | null
    const folderType = form.get('folder_type') as string | null

    if (!file || !folderType) return json({ error: 'file and folder_type are required.' }, 400)

    const validTypes = ['approved_content', 'creatives', 'reports', 'analytics_linkedin', 'analytics_instagram', 'asset_photos']
    if (!validTypes.includes(folderType)) return json({ error: `Invalid folder_type: ${folderType}` }, 400)

    const saJson      = JSON.parse(Deno.env.get('GOOGLE_SERVICE_ACCOUNT_JSON')!)
    const accessToken = await getGoogleAccessToken(saJson)

    // ─────────────────────────────────────────────────────────
    // ASSET PHOTOS — HR Drive: Assets/{Category}/{Name}/Repairs or Other
    // ─────────────────────────────────────────────────────────
    if (folderType === 'asset_photos') {
      const assetId       = form.get('asset_id')       as string | null
      const context       = (form.get('context')       as string | null) || 'other'
      const assetCategory = (form.get('asset_category') as string | null) || 'Uncategorised'
      const assetName     = (form.get('asset_name')    as string | null) || (assetId || 'Unknown')

      if (!assetId) return json({ error: 'asset_id is required for asset_photos.' }, 400)

      // context === 'repair' or 'issue' → Repairs folder; everything else → Other
      const subFolder = (context === 'repair' || context === 'issue') ? 'Repairs' : 'Other'

      const hrRootId = Deno.env.get('GOOGLE_DRIVE_HR_DRIVE_ID')!
      let parent = hrRootId
      parent = await findOrCreateFolder(accessToken, 'Assets',            parent)
      parent = await findOrCreateFolder(accessToken, assetCategory.trim(), parent)
      parent = await findOrCreateFolder(accessToken, assetName.trim(),     parent)
      parent = await findOrCreateFolder(accessToken, subFolder,            parent)

      const ext      = file.name.includes('.') ? file.name.split('.').pop() : 'jpg'
      const stamp    = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
      const fileName = `${context}_${stamp}.${ext}`

      const fileBytes = new Uint8Array(await file.arrayBuffer())
      const { driveFileId, webViewLink } = await uploadFileToDrive(
        accessToken, parent, fileName, fileBytes, file.type || 'image/jpeg',
      )
      return json({ success: true, drive_file_id: driveFileId, drive_url: webViewLink })
    }

    // ─────────────────────────────────────────────────────────
    // CLIENT FILES — Operations Drive
    // ─────────────────────────────────────────────────────────
    const clientId = form.get('client_id') as string | null
    const entityId = form.get('entity_id') as string | null || null
    const month    = form.get('month')     as string | null  // YYYY-MM

    if (!clientId || !month) {
      return json({ error: 'client_id and month are required for client file uploads.' }, 400)
    }

    // Lookup client name + current status
    const { data: client } = await adminClient
      .from('clients')
      .select('client_name, status')
      .eq('id', clientId)
      .single()
    if (!client) return json({ error: 'Client not found.' }, 404)

    // Lookup entity name if provided
    let entityName: string | null = null
    if (entityId) {
      const { data: entity } = await adminClient
        .from('client_entities')
        .select('entity_name')
        .eq('id', entityId)
        .single()
      entityName = entity?.entity_name || null
    }

    // Parse month: YYYY-MM → year string + month name
    const [yearStr, monthNum] = month.split('-')
    const monthName  = MONTHS[parseInt(monthNum, 10) - 1]
    const folderLabel = FOLDER_TYPE_LABELS[folderType]
    const platform    = ANALYTICS_PLATFORM[folderType]

    // Build path in Operations Drive
    const opsRootId = Deno.env.get('GOOGLE_DRIVE_OPS_DRIVE_ID')!
    let parent = opsRootId

    parent = await findOrCreateFolder(accessToken, statusFolder(client.status), parent)
    parent = await findOrCreateFolder(accessToken, client.client_name,          parent)
    if (entityName) {
      parent = await findOrCreateFolder(accessToken, entityName, parent)
    }
    parent = await findOrCreateFolder(accessToken, yearStr,     parent)
    parent = await findOrCreateFolder(accessToken, monthName,   parent)
    parent = await findOrCreateFolder(accessToken, folderLabel, parent)
    if (platform) {
      parent = await findOrCreateFolder(accessToken, platform, parent)
    }

    const fileBytes = new Uint8Array(await file.arrayBuffer())
    const { driveFileId, webViewLink } = await uploadFileToDrive(
      accessToken, parent, file.name, fileBytes, file.type || 'application/octet-stream',
    )

    // Analytics uploads: skip DB record — ingest-analytics handles its own log
    if (SKIP_DB_RECORD.has(folderType)) {
      return json({ success: true, drive_file_id: driveFileId, drive_url: webViewLink })
    }

    // Insert master_folder_files record
    const { data: record, error: insertErr } = await adminClient
      .from('master_folder_files')
      .insert({
        client_id:     clientId,
        entity_id:     entityId,
        month,
        folder_type:   folderType,
        file_name:     file.name,
        file_type:     file.type || null,
        drive_file_id: driveFileId,
        drive_url:     webViewLink,
        uploaded_by:   user.id,
      })
      .select()
      .single()

    if (insertErr) {
      // Best-effort cleanup: remove the dangling Drive file
      await fetch(`https://www.googleapis.com/drive/v3/files/${driveFileId}?supportsAllDrives=true`, {
        method: 'DELETE', headers: { Authorization: `Bearer ${accessToken}` },
      }).catch(() => {})
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
): Promise<{ driveFileId: string; webViewLink: string }> {
  const boundary = 'growthic_ops_boundary'
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
  return { driveFileId: ud.id, webViewLink: ud.webViewLink! }
}

function json(body: object, status = 200) {
  return new Response(JSON.stringify(body), {
    status, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}
