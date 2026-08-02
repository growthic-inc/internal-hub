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
      chart_images?:      Record<string, string>   // token name (no braces) -> raw base64, e.g. { PERFORMANCE_CHART: '...', PUBLISHING_CHART: '...' }
      links?:             Record<string, string>   // token name -> URL; hyperlinks that token's replaced text (e.g. TOP_POST_TITLE) to the original post
      top_post_url?:      string                   // LinkedIn post URL; edge fn fetches og:image and inserts it into {{TOP_POST_IMAGE}} placeholder
    }
    const { client_id, month, year, tokens, chart_images, links, top_post_url } = body
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

    // ── Replace, don't accumulate: clear anything already in this
    //    month's folder before generating the fresh report + charts.
    //    This folder only ever holds one report at a time.
    await clearFolder(accessToken, monthDir)

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

    // ── Drop in every chart image provided, one per named placeholder ──
    for (const [chartToken, base64] of Object.entries(chart_images || {})) {
      await insertChartImage(accessToken, newFileId, monthDir, `{{${chartToken}}}`, base64)
    }

    // ── Drop in the top post's OG image (company reports only) ─────────
    if (top_post_url && reportType === 'company') {
      await insertPostImage(accessToken, newFileId, monthDir, top_post_url)
    }

    // ── Turn post titles into real hyperlinks back to the original post ──
    for (const [linkToken, url] of Object.entries(links || {})) {
      await applyHyperlink(accessToken, newFileId, tokens[linkToken], url)
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

/* ── Top post OG image: fetch from LinkedIn URL and insert into slide 2 ── */

async function fetchOgImageBytes(postUrl: string): Promise<{ bytes: Uint8Array; mimeType: string } | null> {
  try {
    const pageRes = await fetch(postUrl, {
      headers: {
        'User-Agent': 'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)',
        'Accept': 'text/html,application/xhtml+xml',
      },
      redirect: 'follow',
    })
    const html = await pageRes.text()
    const m = html.match(/<meta[^>]+property="og:image"[^>]+content="([^"]+)"/) ||
              html.match(/<meta[^>]+content="([^"]+)"[^>]+property="og:image"/)
    if (!m) return null
    const imageUrl = m[1].replace(/&amp;/g, '&')
    const imgRes = await fetch(imageUrl)
    if (!imgRes.ok) return null
    const mimeType = imgRes.headers.get('content-type')?.split(';')[0] ?? 'image/jpeg'
    const bytes = new Uint8Array(await imgRes.arrayBuffer())
    return { bytes, mimeType }
  } catch {
    return null
  }
}

function jpegDimensions(bytes: Uint8Array): { width: number; height: number } | null {
  // Scan for SOF0-SOF3 markers (FF C0–C3); each has height then width after a 1-byte precision field.
  for (let i = 2; i < bytes.length - 8; i++) {
    if (bytes[i] === 0xFF && bytes[i + 1] >= 0xC0 && bytes[i + 1] <= 0xC3 && bytes[i + 1] !== 0xC4) {
      const h = (bytes[i + 5] << 8) | bytes[i + 6]
      const w = (bytes[i + 7] << 8) | bytes[i + 8]
      if (w > 0 && h > 0) return { width: w, height: h }
    }
  }
  return null
}

async function insertPostImage(
  token: string, presentationId: string, folderId: string, postUrl: string,
): Promise<void> {
  const result = await fetchOgImageBytes(postUrl)
  if (!result) {
    console.warn('[generate-client-report] Could not fetch top post OG image — skipping')
    return
  }
  const { bytes, mimeType } = result

  const pres  = await getPresentation(token, presentationId)
  const found = findShapeByText(pres, '{{TOP_POST_IMAGE}}')
  if (!found) {
    console.warn('[generate-client-report] {{TOP_POST_IMAGE}} placeholder not found — skipping')
    return
  }

  const { fileId: imageFileId } = await uploadFileToDrive(token, folderId, 'top-post-image.jpg', bytes, mimeType)
  await setPublicReadPermission(token, imageFileId)
  const imageUrl = `https://drive.google.com/uc?export=view&id=${imageFileId}`

  // Contain-fit within the placeholder's bounding box
  const sz   = found.size as { width?: { magnitude: number }; height?: { magnitude: number } } | undefined
  const boxW = sz?.width?.magnitude  ?? 2631600   // ~7.31 cm
  const boxH = sz?.height?.magnitude ?? 2808000   // ~7.80 cm
  const dims = mimeType === 'image/png' ? pngDimensions(bytes) : jpegDimensions(bytes)
  let width = boxW, height = boxH
  if (dims && dims.height > 0) {
    const aspect = dims.width / dims.height
    width  = boxW
    height = width / aspect
    if (height > boxH) { height = boxH; width = height * aspect }
  }

  const t = found.transform as { translateX?: number; translateY?: number; unit?: string } | undefined
  await batchUpdate(token, presentationId, [
    { deleteObject: { objectId: found.objectId } },
    {
      createImage: {
        url: imageUrl,
        elementProperties: {
          pageObjectId: found.pageObjectId,
          size: {
            width:  { magnitude: width,  unit: 'EMU' },
            height: { magnitude: height, unit: 'EMU' },
          },
          transform: {
            scaleX: 1, scaleY: 1,
            translateX: t?.translateX ?? 0,
            translateY: t?.translateY ?? 0,
            unit: t?.unit ?? 'EMU',
          },
        },
      },
    },
  ])
}

/* ── Chart image: find the placeholder shape, replace it with a real picture ── */
async function insertChartImage(
  token: string, presentationId: string, folderId: string, placeholderText: string, base64: string,
): Promise<void> {
  // 1. Find the shape whose text is exactly the chart placeholder token.
  const pres = await getPresentation(token, presentationId)
  const found = findShapeByText(pres, placeholderText)
  if (!found) {
    console.warn(`[generate-client-report] "${placeholderText}" shape not found — skipping that chart image.`)
    return
  }
  const { objectId, transform } = found

  // 2. Upload the image to Drive and make it fetchable by Slides' rendering service.
  const bytes = Uint8Array.from(atob(base64), c => c.charCodeAt(0))
  const { fileId: imageFileId } = await uploadFileToDrive(token, folderId, 'performance-chart.png', bytes, 'image/png')
  await setPublicReadPermission(token, imageFileId)
  const imageUrl = `https://drive.google.com/uc?export=view&id=${imageFileId}`

  // 3. Swap the placeholder shape for a real image in the same spot —
  //    sized to actually use the space available on the slide, in the
  //    image's own aspect ratio, rather than trusting the placeholder's
  //    box (which was only ever drawn to fit a short token of text).
  const resized = fitImageSize(pres.pageSize, transform, pngDimensions(bytes))
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

/** Find the shape whose text is now exactly `text` (i.e. the token's
 *  already-replaced value) and make that whole run a clickable link to `url`. */
async function applyHyperlink(
  accessToken: string, presentationId: string, text: string, url: string,
): Promise<void> {
  if (!text || !url) return
  const pres = await getPresentation(accessToken, presentationId)
  const found = findShapeByText(pres, text)
  if (!found) {
    console.warn(`[generate-client-report] link target text "${text}" not found — skipping hyperlink.`)
    return
  }
  await batchUpdate(accessToken, presentationId, [{
    updateTextStyle: {
      objectId:  found.objectId,
      style:     { link: { url } },
      textRange: { type: 'ALL' },
      fields:    'link',
    },
  }])
}

// A {{CHART_TOKEN}} text box is typically drawn just large enough to fit
// that short token, or at best some arbitrary modest box — neither is a
// real chart size. Rather than trust the placeholder's own dimensions,
// size the image to fill the space actually left on the slide (from the
// placeholder's top-left position to a margin near the page edge), in
// the image's own aspect ratio, so it neither gets squished nor sits
// tiny in a sea of white space regardless of how the template was drawn.
const MIN_CHART_WIDTH_PT  = 300
const MIN_CHART_HEIGHT_PT = 150
const MARGIN_PT           = 36  // ~0.5in breathing room at the page edge
const PT_TO_EMU = 12700

type PageSize = { width?: { magnitude: number; unit: string }; height?: { magnitude: number; unit: string } }

/** Read pixel width/height straight out of a PNG's IHDR chunk (bytes 16-23, big-endian). */
function pngDimensions(bytes: Uint8Array): { width: number; height: number } | null {
  const sig = [137, 80, 78, 71, 13, 10, 26, 10]
  if (bytes.length < 24 || !sig.every((b, i) => bytes[i] === b)) return null
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  return { width: dv.getUint32(16, false), height: dv.getUint32(20, false) }
}

function fitImageSize(
  pageSize: PageSize | undefined, transform: unknown, imgDims: { width: number; height: number } | null,
): { size: unknown; transform: unknown } {
  const t = transform as { translateX?: number; translateY?: number; unit?: string } | undefined
  const translateX = t?.translateX ?? 0
  const translateY = t?.translateY ?? 0

  const pageWidthEmu  = pageSize?.width?.magnitude  ?? 9144000  // fallback: standard 10in-wide slide
  const pageHeightEmu = pageSize?.height?.magnitude ?? 5143500  // fallback: standard 5.63in-tall slide
  const marginEmu = MARGIN_PT * PT_TO_EMU

  const maxWidth  = Math.max(pageWidthEmu  - translateX - marginEmu, MIN_CHART_WIDTH_PT  * PT_TO_EMU)
  const maxHeight = Math.max(pageHeightEmu - translateY - marginEmu, MIN_CHART_HEIGHT_PT * PT_TO_EMU)

  const aspect = imgDims && imgDims.height > 0 ? imgDims.width / imgDims.height : (MIN_CHART_WIDTH_PT / MIN_CHART_HEIGHT_PT)

  // Contain-fit within (maxWidth, maxHeight): start from full available
  // width, then shrink to the available height if that would overflow.
  let width  = maxWidth
  let height = width / aspect
  if (height > maxHeight) {
    height = maxHeight
    width  = height * aspect
  }

  return {
    size: {
      width:  { magnitude: width,  unit: 'EMU' },
      height: { magnitude: height, unit: 'EMU' },
    },
    transform: { scaleX: 1, scaleY: 1, translateX, translateY, unit: t?.unit ?? 'EMU' },
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

async function getPresentation(token: string, presentationId: string): Promise<{ slides?: SlidesPage[]; pageSize?: PageSize }> {
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

/** Delete every file directly inside a folder (not the folder itself).
 *  Used so re-running Export for the same client/month replaces the
 *  previous report and its chart images instead of piling up copies. */
async function clearFolder(token: string, folderId: string): Promise<void> {
  const q = `'${folderId}' in parents and trashed=false`
  const sr = await fetch(
    `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id)&supportsAllDrives=true&includeItemsFromAllDrives=true`,
    { headers: { Authorization: `Bearer ${token}` } },
  )
  const sd = await sr.json() as { files?: { id: string }[] }
  await Promise.all((sd.files || []).map(f =>
    fetch(`https://www.googleapis.com/drive/v3/files/${f.id}?supportsAllDrives=true`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    }).catch(() => {}),
  ))
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
