// Growthic One — Edge Function: generate-client-report
//
// Copies the client-report Slides template, fills in every {{TOKEN}}
// with real values computed by the Client Dashboard, drops in the
// performance chart image, and saves the result into that client's
// existing Ops Drive folder — same folder tree create-client-folder
// and move-client-folder already maintain, just one level deeper
// (a month-named subfolder).
//
// The frontend does all the number-crunching (reusing the dashboard's
// own KPI logic) and sends the finished values here as a flat
// { tokenName: value } map — this function never recomputes metrics
// itself, so there is only ever one place that math can drift.
//
// Env vars required (same as create-client-folder / move-client-folder):
//   GOOGLE_DRIVE_OPS_DRIVE_ID
//   GOOGLE_SERVICE_ACCOUNT_JSON
//   SUPABASE_URL / SUPABASE_ANON_KEY

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const TEMPLATE_SETTING_KEY          = 'reports.company_page_template_id'
const PERSONAL_TEMPLATE_SETTING_KEY = 'reports.personal_profile_template_id'
const CHART_PLACEHOLDER    = '{{PERFORMANCE_CHART}}'
const MONTH_NAMES = ['January','February','March','April','May','June',
  'July','August','September','October','November','December']

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
    const body = await req.json() as {
      client_id:          string
      month:              number   // 1-12
      year:               number
      report_type?:       'company' | 'personal'   // defaults to 'company'
      tokens:             Record<string, string>   // e.g. { CLIENT_NAME: 'Acme Co', FOLLOWER_COUNT: '1,234', ... }
      chart_image_base64?: string  // raw base64, no data: prefix
    }
    const { client_id, month, year, tokens, chart_image_base64 } = body
    const reportType = body.report_type === 'personal' ? 'personal' : 'company'
    if (!client_id || !month || !year || !tokens) {
      return json({ error: 'client_id, month, year, and tokens are required.' }, 400)
    }

    // ── Look up the client (name + current status) ───────────
    const { data: client, error: clientErr } = await anonClient
      .from('clients')
      .select('client_name, status')
      .eq('id', client_id)
      .single()
    if (clientErr || !client) return json({ error: 'Client not found.' }, 404)

    // ── Look up the right template's Slides file ID ────────────
    const settingKey = reportType === 'personal' ? PERSONAL_TEMPLATE_SETTING_KEY : TEMPLATE_SETTING_KEY
    const { data: setting, error: settingErr } = await anonClient
      .from('app_settings')
      .select('value')
      .eq('key', settingKey)
      .single()
    if (settingErr || !setting?.value) {
      return json({ error: `Report template not configured (${settingKey} missing from app_settings).` }, 500)
    }
    const templateId = setting.value

    // ── Google auth ─────────────────────────────────────────────
    const saJson      = JSON.parse(Deno.env.get('GOOGLE_SERVICE_ACCOUNT_JSON')!)
    const accessToken = await getGoogleAccessToken(saJson)
    const opsRootId   = Deno.env.get('GOOGLE_DRIVE_OPS_DRIVE_ID')!

    // ── Build/find the destination folder: {status} Clients / {Client Name} / {Month Year} ──
    const statusDir  = await ensureFolder(accessToken, statusFolder(client.status), opsRootId)
    const clientDir  = await ensureFolder(accessToken, client.client_name.trim(), statusDir)
    const monthLabel = `${MONTH_NAMES[month - 1]} ${year}`
    const monthDir   = await ensureFolder(accessToken, monthLabel, clientDir)

    // ── Copy the template into that folder ─────────────────────
    const reportName = `${client.client_name.trim()} — ${monthLabel} Report`
    const newFileId   = await copyFile(accessToken, templateId, reportName, monthDir)

    // ── Fill in every text token in one batch ───────────────────
    const textRequests = Object.entries(tokens).map(([key, value]) => ({
      replaceAllText: {
        containsText: { text: `{{${key}}}`, matchCase: true },
        replaceText:  String(value ?? ''),
      },
    }))
    if (textRequests.length > 0) {
      await batchUpdate(accessToken, newFileId, textRequests)
    }

    // ── Drop in the performance chart image, if provided ────────
    if (chart_image_base64) {
      await insertChartImage(accessToken, newFileId, monthDir, chart_image_base64)
    }

    return json({
      fileId: newFileId,
      link:   `https://docs.google.com/presentation/d/${newFileId}/edit`,
    })

  } catch (err) {
    console.error('[generate-client-report]', err)
    return json({ error: String(err) }, 500)
  }
})

/* ── Chart image: find the placeholder shape, replace it with a real picture ── */
async function insertChartImage(
  token: string, presentationId: string, folderId: string, base64: string,
): Promise<void> {
  // 1. Find the shape whose text is exactly the chart placeholder token.
  const pres = await getPresentation(token, presentationId)
  const found = findShapeByText(pres, CHART_PLACEHOLDER)
  if (!found) {
    console.warn(`[generate-client-report] "${CHART_PLACEHOLDER}" shape not found — skipping chart image.`)
    return
  }
  const { objectId, size, transform } = found

  // 2. Upload the image to Drive and make it fetchable by Slides' rendering service.
  const bytes = Uint8Array.from(atob(base64), c => c.charCodeAt(0))
  const { fileId: imageFileId } = await uploadFileToDrive(token, folderId, 'performance-chart.png', bytes, 'image/png')
  await setPublicReadPermission(token, imageFileId)
  const imageUrl = `https://drive.google.com/uc?export=view&id=${imageFileId}`

  // 3. Swap the placeholder shape for a real image in the same spot —
  //    expanding the size first if the placeholder was too small to be a real chart.
  const resized = resizeIfTooSmall(size, transform)
  await batchUpdate(token, presentationId, [
    { deleteObject: { objectId } },
    {
      createImage: {
        url: imageUrl,
        elementProperties: {
          pageObjectId: found.pageObjectId,
          size:      resized.size,
          transform: resized.transform,
        },
      },
    },
  ])
}

// Minimum sensible chart dimensions, in points. A {{PERFORMANCE_CHART}} text
// box is typically drawn just large enough to fit that short token — using
// its raw size verbatim produces a tiny sliver of an image. If the shape's
// *effective* on-page size (size × transform scale) is smaller than this,
// keep its top-left position but expand it to a real chart-sized box instead
// of trusting a placeholder that was never meant to define real dimensions.
const MIN_CHART_WIDTH_PT  = 400
const MIN_CHART_HEIGHT_PT = 200
const PT_TO_EMU = 12700

function resizeIfTooSmall(size: unknown, transform: unknown): { size: unknown; transform: unknown } {
  const s = size as { width?: { magnitude: number; unit: string }; height?: { magnitude: number; unit: string } } | undefined
  const t = transform as { scaleX?: number; scaleY?: number; translateX?: number; translateY?: number; unit?: string } | undefined

  const scaleX = t?.scaleX ?? 1
  const scaleY = t?.scaleY ?? 1
  const effectiveWidthPt  = s?.width  ? (s.width.magnitude  / PT_TO_EMU) * scaleX : 0
  const effectiveHeightPt = s?.height ? (s.height.magnitude / PT_TO_EMU) * scaleY : 0

  if (effectiveWidthPt >= MIN_CHART_WIDTH_PT && effectiveHeightPt >= MIN_CHART_HEIGHT_PT) {
    return { size, transform }
  }

  return {
    size: {
      width:  { magnitude: MIN_CHART_WIDTH_PT  * PT_TO_EMU, unit: 'EMU' },
      height: { magnitude: MIN_CHART_HEIGHT_PT * PT_TO_EMU, unit: 'EMU' },
    },
    transform: {
      scaleX: 1, scaleY: 1,
      translateX: t?.translateX ?? 0,
      translateY: t?.translateY ?? 0,
      unit: t?.unit ?? 'EMU',
    },
  }
}

/** Recursively search all slides/groups for a shape whose full text matches `text` exactly. */
function findShapeByText(
  pres: { slides?: SlidesPage[] }, text: string,
): { objectId: string; pageObjectId: string; size: unknown; transform: unknown } | null {
  for (const slide of pres.slides || []) {
    const hit = searchElements(slide.pageElements || [], slide.objectId, text)
    if (hit) return hit
  }
  return null
}

function searchElements(
  elements: PageElement[], pageObjectId: string, text: string,
): { objectId: string; pageObjectId: string; size: unknown; transform: unknown } | null {
  for (const el of elements) {
    const runs = el.shape?.text?.textElements || []
    const shapeText = runs.map(r => r.textRun?.content || '').join('').trim()
    if (shapeText === text) {
      return { objectId: el.objectId, pageObjectId, size: el.size, transform: el.transform }
    }
    if (el.elementGroup?.children) {
      const nested = searchElements(el.elementGroup.children, pageObjectId, text)
      if (nested) return nested
    }
  }
  return null
}

type PageElement = {
  objectId: string
  size?: unknown
  transform?: unknown
  shape?: { text?: { textElements?: { textRun?: { content?: string } }[] } }
  elementGroup?: { children?: PageElement[] }
}
type SlidesPage = { objectId: string; pageElements?: PageElement[] }

/* ── Slides API ──────────────────────────────────────────────── */

async function getPresentation(token: string, presentationId: string): Promise<{ slides?: SlidesPage[] }> {
  const res = await fetch(
    `https://slides.googleapis.com/v1/presentations/${presentationId}`,
    { headers: { Authorization: `Bearer ${token}` } },
  )
  if (!res.ok) throw new Error(`Slides get failed: ${await res.text()}`)
  return res.json()
}

async function batchUpdate(token: string, presentationId: string, requests: unknown[]): Promise<void> {
  const res = await fetch(
    `https://slides.googleapis.com/v1/presentations/${presentationId}:batchUpdate`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ requests }),
    },
  )
  if (!res.ok) throw new Error(`Slides batchUpdate failed: ${await res.text()}`)
}

/* ── Drive API ───────────────────────────────────────────────── */

async function copyFile(token: string, fileId: string, name: string, parentId: string): Promise<string> {
  const res = await fetch(
    `https://www.googleapis.com/drive/v3/files/${fileId}/copy?supportsAllDrives=true&fields=id`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, parents: [parentId] }),
    },
  )
  const data = await res.json() as { id?: string; error?: unknown }
  if (!data.id) throw new Error(`Drive copy failed: ${JSON.stringify(data.error || data)}`)
  return data.id
}

/** Find an existing folder by name under a parent. Returns null if not found. */
async function findFolder(token: string, name: string, parentId: string): Promise<string | null> {
  const q = `name='${name.replace(/'/g,"\\'")}' and '${parentId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`
  const sr = await fetch(
    `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id)&supportsAllDrives=true&includeItemsFromAllDrives=true`,
    { headers: { Authorization: `Bearer ${token}` } },
  )
  const sd = await sr.json() as { files: { id: string }[] }
  return sd.files?.length > 0 ? sd.files[0].id : null
}

/** Find or create a folder by name under a parent. */
async function ensureFolder(token: string, name: string, parentId: string): Promise<string> {
  const existing = await findFolder(token, name, parentId)
  if (existing) return existing
  const cr = await fetch('https://www.googleapis.com/drive/v3/files?supportsAllDrives=true', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, mimeType: 'application/vnd.google-apps.folder', parents: [parentId] }),
  })
  const cd = await cr.json() as { id?: string; error?: unknown }
  if (!cd.id) throw new Error(`Drive folder create failed: ${JSON.stringify(cd.error || cd)}`)
  return cd.id
}

async function uploadFileToDrive(
  token: string, folderId: string, fileName: string, fileBytes: Uint8Array, mimeType: string,
): Promise<{ fileId: string }> {
  const boundary = 'growthic_report_boundary'
  const enc = new TextEncoder()
  const meta = enc.encode(
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n` +
    JSON.stringify({ name: fileName, parents: [folderId] }) +
    `\r\n--${boundary}\r\nContent-Type: ${mimeType}\r\n\r\n`,
  )
  const footer = enc.encode(`\r\n--${boundary}--`)
  const uploadBody = new Uint8Array(meta.length + fileBytes.length + footer.length)
  uploadBody.set(meta, 0); uploadBody.set(fileBytes, meta.length); uploadBody.set(footer, meta.length + fileBytes.length)
  const ur = await fetch(
    `https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id&supportsAllDrives=true`,
    { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': `multipart/related; boundary=${boundary}` }, body: uploadBody },
  )
  const ud = await ur.json() as { id?: string; error?: unknown }
  if (!ud.id) throw new Error(`Drive upload failed: ${JSON.stringify(ud.error || ud)}`)
  return { fileId: ud.id }
}

async function setPublicReadPermission(token: string, fileId: string): Promise<void> {
  await fetch(
    `https://www.googleapis.com/drive/v3/files/${fileId}/permissions?supportsAllDrives=true`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: 'reader', type: 'anyone' }),
    },
  ).catch(() => {})
}

/* ── Google auth ─────────────────────────────────────────────── */

async function getGoogleAccessToken(sa: Record<string, string>): Promise<string> {
  const now     = Math.floor(Date.now() / 1000)
  const header  = { alg: 'RS256', typ: 'JWT' }
  const payload = {
    iss: sa.client_email,
    scope: 'https://www.googleapis.com/auth/drive https://www.googleapis.com/auth/presentations',
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
  const td = await tokenRes.json() as { access_token?: string; error?: unknown }
  if (!td.access_token) throw new Error(`Google auth failed: ${JSON.stringify(td)}`)
  return td.access_token
}

function json(body: object, status = 200) {
  return new Response(JSON.stringify(body), {
    status, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}
