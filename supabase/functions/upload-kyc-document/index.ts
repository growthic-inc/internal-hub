// Growthic One — Edge Function: upload-kyc-document
// Uploads a KYC identity document to the HR Shared Drive.
//
// Drive path (HR Drive):
//   Employee Database / {Employee Name} / {doc_type}.{ext}
//
// Files are made viewable by anyone with the link (HR folder permissions
// on the Drive restrict who can actually browse to it).
//
// Env vars required:
//   GOOGLE_DRIVE_HR_DRIVE_ID    — HR Shared Drive ID
//   GOOGLE_SERVICE_ACCOUNT_JSON
//   SUPABASE_URL / SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const VALID_DOC_TYPES = new Set(['aadhar', 'pan', 'passport', 'passport_photo'])

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
    const employeeId   = form.get('employee_id')   as string | null
    const employeeName = form.get('employee_name') as string | null
    const docType      = form.get('doc_type')      as string | null

    if (!file || !employeeId || !employeeName || !docType) {
      return json({ error: 'file, employee_id, employee_name, and doc_type are required.' }, 400)
    }
    if (!VALID_DOC_TYPES.has(docType)) {
      return json({ error: `Invalid doc_type: ${docType}. Must be one of: ${[...VALID_DOC_TYPES].join(', ')}` }, 400)
    }
    if (file.size > 10 * 1024 * 1024) return json({ error: 'File exceeds 10 MB limit.' }, 400)

    // Only the employee themselves, or HR / super_admin, may upload KYC docs
    if (user.id !== employeeId) {
      const adminClient = createClient(
        Deno.env.get('SUPABASE_URL')!,
        Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
      )
      const { data: callerEmp } = await adminClient
        .from('employees')
        .select('role, department')
        .eq('id', user.id)
        .single()
      const isHr = callerEmp?.role === 'super_admin' || callerEmp?.department === 'people_culture'
      if (!isHr) return json({ error: 'You can only upload your own KYC documents.' }, 403)
    }

    // ── Google Drive ──────────────────────────────────────────
    const saJson      = JSON.parse(Deno.env.get('GOOGLE_SERVICE_ACCOUNT_JSON')!)
    const accessToken = await getGoogleAccessToken(saJson)
    const hrRootId    = Deno.env.get('GOOGLE_DRIVE_HR_DRIVE_ID')!

    // Path: HR / Employee Database / {Employee Name} / {doc_type}.{ext}
    let parent = hrRootId
    parent = await findOrCreateFolder(accessToken, 'Employee Database',    parent)
    parent = await findOrCreateFolder(accessToken, employeeName.trim(),    parent)

    // Use doc_type as file name so re-uploads cleanly overwrite the previous file
    const originalExt = file.name.includes('.') ? file.name.split('.').pop()!.toLowerCase() : 'pdf'
    const fileName    = `${docType}.${originalExt}`

    // Delete any existing file with the same name (clean replace)
    await deleteExistingFile(accessToken, parent, fileName)

    // ── Upload ────────────────────────────────────────────────
    const fileBytes = new Uint8Array(await file.arrayBuffer())
    const { driveFileId, webViewLink } = await uploadFileToDrive(
      accessToken, parent, fileName, fileBytes, file.type || 'application/octet-stream',
    )

    await fetch(`https://www.googleapis.com/drive/v3/files/${driveFileId}/permissions?supportsAllDrives=true`, {
      method:'POST', headers:{ Authorization:`Bearer ${accessToken}`, 'Content-Type':'application/json' },
      body: JSON.stringify({ role:'reader', type:'anyone' }),
    }).catch(() => {})

    return json({ success: true, drive_url: webViewLink })

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
  if (sd.files?.length > 0) return sd.files[0].id
  const cr = await fetch('https://www.googleapis.com/drive/v3/files?supportsAllDrives=true', {
    method:'POST', headers:{ Authorization:`Bearer ${token}`, 'Content-Type':'application/json' },
    body: JSON.stringify({ name, mimeType:'application/vnd.google-apps.folder', parents:[parentId] }),
  })
  const cd = await cr.json() as { id?: string; error?: unknown }
  if (!cd.id) throw new Error(`Drive folder create failed: ${JSON.stringify(cd.error || cd)}`)
  return cd.id
}

async function deleteExistingFile(token: string, folderId: string, fileName: string): Promise<void> {
  const q = `name='${fileName.replace(/'/g,"\\'")}' and '${folderId}' in parents and trashed=false`
  const sr = await fetch(
    `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id)&supportsAllDrives=true&includeItemsFromAllDrives=true`,
    { headers:{ Authorization:`Bearer ${token}` } },
  )
  const sd = await sr.json() as { files: { id: string }[] }
  for (const f of sd.files || []) {
    await fetch(`https://www.googleapis.com/drive/v3/files/${f.id}?supportsAllDrives=true`, {
      method:'DELETE', headers:{ Authorization:`Bearer ${token}` },
    }).catch(() => {})
  }
}

async function uploadFileToDrive(
  token: string, folderId: string, fileName: string, fileBytes: Uint8Array, mimeType: string,
): Promise<{ driveFileId: string; webViewLink: string }> {
  const boundary = 'growthic_kyc_boundary'
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
