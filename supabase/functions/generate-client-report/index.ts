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

    // ── Access control: check generate_report permission ──────
    const adminClient = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )
    const { data: callerEmp } = await adminClient
      .from('employees')
      .select('id, role, department')
      .eq('email', user.email)
      .single()

    if (callerEmp?.role !== 'super_admin') {
      const { data: accessRows } = await adminClient
        .from('access_matrix')
        .select('id')
        .eq('department', callerEmp?.department)
        .eq('module', 'client_dashboard')
        .eq('feature', 'generate_report')
        .neq('access_level', 'no_access')
        .limit(1)
      if (!accessRows || accessRows.length === 0) {
        return json({ error: 'Access denied.' }, 403)
      }
    }

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
      post_image_urls?:   string[]                 // Up to 3 post URLs; images inserted into {{POST_1_IMAGE}}, {{POST_2_IMAGE}}, {{POST_3_IMAGE}}
      apify_fallback?:    Record<string, { imageUrl?: string | null; caption?: string | null }>
                                                     // post_url -> Apify's own image/caption, used only when
                                                     // the live fetch below comes back empty (LinkedIn serving
                                                     // a blocked page instead of erroring outright)
    }
    const { client_id, month, year, tokens, chart_images, links, top_post_url, post_image_urls, apify_fallback } = body
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
    const statusDir    = await ensureFolder(accessToken, statusFolder(client.status), opsRootId)
    const clientDir    = await ensureFolder(accessToken, client.client_name.trim(), statusDir)
    const reportsDir   = await ensureFolder(accessToken, 'Monthly Reports', clientDir)
    const monthLabel   = `${MONTH_NAMES[month - 1]} ${year}`
    const monthDir     = await ensureFolder(accessToken, monthLabel, reportsDir)

    // ── Replace, don't accumulate: clear anything already in this
    //    month's folder before generating the fresh report + charts.
    //    This folder only ever holds one report at a time.
    await clearFolder(accessToken, monthDir)

    // ── Copy the template into that folder ─────────────────────
    const reportName = `${client.client_name.trim()} — ${monthLabel} Report`
    const newFileId   = await copyFile(accessToken, templateId, reportName, monthDir)

    // ── Pre-fetch all LinkedIn post data in parallel (caption + image bytes) ──
    // Each URL is fetched ONCE: caption and image come from the same request.
    // All fetches have 8-second timeouts so a slow LinkedIn response can't hang
    // the function and cause a "Failed to fetch" timeout error on the client.
    const allPostUrls = [
      ...(top_post_url ? [top_post_url] : []),
      ...(Array.isArray(post_image_urls) ? post_image_urls.filter(Boolean) : []),
    ]
    // De-dupe (top_post_url may equal post_image_urls[0])
    const uniqueUrls = [...new Set(allPostUrls)]
    const postDataMap = new Map<string, { caption: string; imageBytes: Uint8Array | null; mimeType: string }>()
    await Promise.allSettled(
      uniqueUrls.map(async url => {
        let data = await fetchLinkedInPost(url)
        // Fallback to Apify's own copy when the live fetch comes back empty —
        // LinkedIn increasingly serves a blocked/consent page here instead of
        // erroring, so fetchLinkedInPost sees a normal response with nothing
        // usable in it. Apify already scraped the same post successfully
        // (whenever "Apify" was last run), so use that instead of leaving
        // the image/caption blank.
        const fallback = apify_fallback?.[url]
        if (fallback && (!data.imageBytes || !data.caption)) {
          let imageBytes = data.imageBytes
          let mimeType = data.mimeType
          if (!imageBytes && fallback.imageUrl) {
            try {
              const imgRes = await fetch(fallback.imageUrl, { signal: AbortSignal.timeout(8_000) })
              if (imgRes.ok) {
                mimeType = imgRes.headers.get('content-type')?.split(';')[0] ?? 'image/jpeg'
                imageBytes = new Uint8Array(await imgRes.arrayBuffer())
              }
            } catch (e) {
              console.warn('[generate-client-report] Apify fallback image fetch failed:', e)
            }
          }
          data = {
            caption: data.caption || fallback.caption || '',
            imageBytes,
            mimeType,
          }
        }
        postDataMap.set(url, data)
      })
    )

    // ── For personal profiles: fill title tokens from scraped captions ──
    if (reportType === 'personal') {
      const topData = top_post_url ? postDataMap.get(top_post_url) : null
      if (topData?.caption) {
        tokens['TOP_POST_TITLE']       = topData.caption
        tokens['TOP_POST_TITLE_SHORT'] = topData.caption
      }
      for (const [linkToken, url] of Object.entries(links || {})) {
        if (linkToken.endsWith('_TITLE') && !['TOP_POST_TITLE', 'TOP_POST_TITLE_SHORT'].includes(linkToken)) {
          const d = postDataMap.get(url)
          if (d?.caption) tokens[linkToken] = d.caption
        }
      }
    }

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

    // ── Enforce white text on the exec summary top-post title ───────────
    // replaceAllText can reset text style to theme default (black). Force white
    // so the title stays readable on the dark-blue card background.
    // Company template uses the objectId 's2_post_title' (set during rebuild).
    // Personal template uses the native objectId 'g3f637b59831_1_182'.
    if (top_post_url) {
      const titleOid = reportType === 'company' ? 's2_post_title' : 'g3f637b59831_1_182'
      await batchUpdate(accessToken, newFileId, [{
        updateTextStyle: {
          objectId: titleOid,
          style: {
            foregroundColor: { opaqueColor: { rgbColor: { red: 1, green: 1, blue: 1 } } },
            bold:     true,
            fontSize: { magnitude: 14, unit: 'PT' },
          },
          textRange: { type: 'ALL' },
          fields:    'foregroundColor,bold,fontSize',
        },
      }]).catch(() => {})
    }

    // ── Drop in every chart image provided, one per named placeholder ──
    for (const [chartToken, base64] of Object.entries(chart_images || {})) {
      await insertChartImage(accessToken, newFileId, monthDir, `{{${chartToken}}}`, base64)
    }

    // ── Drop in post images (reuse pre-fetched bytes — no extra LinkedIn requests) ──
    if (top_post_url) {
      const d = postDataMap.get(top_post_url)
      await insertPostImage('{{TOP_POST_IMAGE}}', accessToken, newFileId, monthDir, top_post_url, d?.imageBytes ?? undefined, d?.mimeType)
    }

    if (Array.isArray(post_image_urls)) {
      const postTokens = ['{{POST_1_IMAGE}}', '{{POST_2_IMAGE}}', '{{POST_3_IMAGE}}']
      for (let i = 0; i < Math.min(post_image_urls.length, 3); i++) {
        const url = post_image_urls[i]
        if (!url) continue
        const d = postDataMap.get(url)
        if (url) await insertPostImage(postTokens[i], accessToken, newFileId, monthDir, url, d?.imageBytes ?? undefined, d?.mimeType)
      }
    }

    // ── Directly hyperlink the Top Performing Posts left card title ──────
    // Company template: objectId 'lc_title' (set during rebuild).
    // Personal template: objectId 'g3f637b59831_1_365'.
    // Sets the link and the white color together in one request — applying
    // a link on its own resets Slides' rendering to the default blue/
    // underline link style, with nothing to override it back to white for
    // readability on this card's dark-blue background.
    if (top_post_url) {
      const lcTitleOid = reportType === 'company' ? 'lc_title' : 'g3f637b59831_1_365'
      await batchUpdate(accessToken, newFileId, [{
        updateTextStyle: {
          objectId: lcTitleOid,
          style: {
            link: { url: top_post_url },
            foregroundColor: { opaqueColor: { rgbColor: { red: 1, green: 1, blue: 1 } } },
            bold: true,
          },
          textRange: { type: 'ALL' },
          fields:    'link,foregroundColor,bold',
        },
      }]).catch(() => {})
    }

    // ── Turn post titles into real hyperlinks back to the original post ──
    for (const [linkToken, url] of Object.entries(links || {})) {
      await applyHyperlink(accessToken, newFileId, tokens[linkToken], url)
    }

    // Log the generation — fire-and-forget (don't block the response)
    adminClient.from('report_generation_log').insert({
      client_id:    client_id,
      report_type:  reportType,
      month,
      year,
      file_id:      newFileId,
      generated_by: callerEmp?.id || null,
    }).then(() => {}).catch(() => {})

    return json({
      fileId: newFileId,
      link:   `https://docs.google.com/presentation/d/${newFileId}/edit`,
    })

  } catch (err) {
    console.error('[generate-client-report]', err)
    return json({ error: String(err) }, 500)
  }
})

/* ── Fetch a LinkedIn post: caption + image bytes in minimal requests ──
   Fetches the page at most once per call (oembed first, page scrape fallback).
   All outbound requests have an 8-second timeout so a slow LinkedIn response
   cannot hang the edge function and cause a "Failed to fetch" on the client. */

async function fetchLinkedInPost(postUrl: string): Promise<{
  caption: string
  imageBytes: Uint8Array | null
  mimeType: string
}> {
  const t = () => AbortSignal.timeout(8_000)

  // Strategy 1: oembed — single request, returns thumbnail_url + sometimes description
  try {
    const oembedRes = await fetch(
      `https://www.linkedin.com/oembed?url=${encodeURIComponent(postUrl)}&format=json`,
      { headers: { 'User-Agent': 'LinkedInBot/1.0 (compatible; Jakarta Commons-HttpClient/3.1 +http://www.linkedin.com)' }, signal: t() },
    )
    if (oembedRes.ok) {
      const data = await oembedRes.json() as { thumbnail_url?: string; description?: string }
      const rawCaption = (data.description || '').trim()
      const caption = (rawCaption && !rawCaption.toLowerCase().includes('linkedin.com'))
        ? firstSentence(rawCaption) : ''
      if (data.thumbnail_url) {
        try {
          const imgRes = await fetch(data.thumbnail_url, { signal: t() })
          if (imgRes.ok) {
            const mimeType = imgRes.headers.get('content-type')?.split(';')[0] ?? 'image/jpeg'
            const imageBytes = new Uint8Array(await imgRes.arrayBuffer())
            return { caption, imageBytes, mimeType }
          }
        } catch {}
      }
      if (caption) return { caption, imageBytes: null, mimeType: 'image/jpeg' }
    }
  } catch (e) {
    console.warn('[fetchLinkedInPost] oembed failed:', e)
  }

  // Strategy 2: page scrape — ONE fetch extracts both og:description and og:image
  try {
    const pageRes = await fetch(postUrl, {
      headers: { 'User-Agent': 'Googlebot/2.1 (+http://www.google.com/bot.html)', 'Accept': 'text/html,application/xhtml+xml' },
      redirect: 'follow',
      signal: t(),
    })
    const html = await pageRes.text()

    // Caption from og:description
    const descM = html.match(/<meta[^>]+property="og:description"[^>]+content="([^"]+)"/) ||
                  html.match(/<meta[^>]+content="([^"]+)"[^>]+property="og:description"/)
    let caption = ''
    if (descM) {
      let txt = descM[1].replace(/&amp;/g,'&').replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/&lt;/g,'<').replace(/&gt;/g,'>').trim()
      const prefixed = txt.match(/^.+? on LinkedIn:\s*["""']([\s\S]+?)['"""]*$/)
      if (prefixed) txt = prefixed[1].trim()
      caption = firstSentence(txt)
    }

    // Image from og:image
    const imgM = html.match(/<meta[^>]+property="og:image"[^>]+content="([^"]+)"/) ||
                 html.match(/<meta[^>]+content="([^"]+)"[^>]+property="og:image"/)
    if (imgM) {
      try {
        const imageUrl = imgM[1].replace(/&amp;/g, '&')
        const imgRes = await fetch(imageUrl, { signal: t() })
        if (imgRes.ok) {
          const mimeType = imgRes.headers.get('content-type')?.split(';')[0] ?? 'image/jpeg'
          const imageBytes = new Uint8Array(await imgRes.arrayBuffer())
          return { caption, imageBytes, mimeType }
        }
      } catch {}
    }
    return { caption, imageBytes: null, mimeType: 'image/jpeg' }
  } catch (e) {
    console.warn('[fetchLinkedInPost] page scrape failed:', e)
  }

  return { caption: '', imageBytes: null, mimeType: 'image/jpeg' }
}

function firstSentence(text: string): string {
  const m = text.match(/^[^.?!]*[.?!]/)
  return (m ? m[0] : text).trim()
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
  placeholderToken: string, token: string, presentationId: string, folderId: string,
  postUrl: string, preloadedBytes?: Uint8Array, preloadedMime?: string,
): Promise<void> {
  console.log('[insertPostImage] starting, token:', placeholderToken, 'postUrl:', postUrl)
  let bytes: Uint8Array | null = preloadedBytes ?? null
  let mimeType = preloadedMime ?? 'image/jpeg'
  if (!bytes) {
    const result = await fetchLinkedInPost(postUrl)
    bytes = result.imageBytes
    mimeType = result.mimeType
  }
  if (!bytes) {
    console.warn('[insertPostImage] Could not fetch image — skipping', placeholderToken)
    return
  }
  console.log('[insertPostImage] image fetched, proceeding to insert')

  const pres  = await getPresentation(token, presentationId)
  const found = findShapeByText(pres, placeholderToken)
  if (!found) {
    console.warn('[generate-client-report]', placeholderToken, 'placeholder not found — skipping')
    return
  }

  const { fileId: imageFileId } = await uploadFileToDrive(token, folderId, 'top-post-image.jpg', bytes, mimeType)
  await setPublicReadPermission(token, imageFileId)
  const imageUrl = `https://drive.google.com/uc?export=view&id=${imageFileId}`

  // Contain-fit within the placeholder's bounding box.
  // Google Slides API ignores the size field in createShape for TEXT_BOX elements,
  // defaulting them all to 8.33×8.33cm (3,000,000 EMU). Cap each token to its
  // intended design height so images don't overflow into the title area below.
  const TOKEN_MAX_H: Record<string, number> = {
    '{{TOP_POST_IMAGE}}': 2_322_047,  // 6.45 cm — exec summary card
    '{{POST_1_IMAGE}}':   1_598_739,  // 4.44 cm — left card
    '{{POST_2_IMAGE}}':   1_548_000,  // 4.30 cm — right-top card
    '{{POST_3_IMAGE}}':   1_710_866,  // 4.75 cm — right-bottom card
  }
  const sz   = found.size as { width?: { magnitude: number }; height?: { magnitude: number } } | undefined
  const boxW = sz?.width?.magnitude  ?? 2631600
  const rawH = sz?.height?.magnitude ?? 2808000
  const boxH = Math.min(rawH, TOKEN_MAX_H[placeholderToken] ?? rawH)
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

  // Ensure text elements that sit over the image area stay in front of the
  // newly created image (createImage places the image at the top of the z-stack).
  // Two groups per token: company template objectIds and personal template objectIds.
  // Each group is tried independently — whichever has valid IDs succeeds, the other is caught.
  const FRONT_ID_GROUPS: Record<string, string[][]> = {
    '{{TOP_POST_IMAGE}}': [
      ['s2_post_title', 's2_post_divider', 's2_post_label'],                        // company
      ['g3f637b59831_1_182', 'g3f637b59831_1_183'],                                 // personal
    ],
    '{{POST_1_IMAGE}}': [
      ['lc_title', 'lc_badge', 'lc_impressions_v', 'lc_impressions_l', 'lc_likes_v', 'lc_likes_l', 'lc_comments_v', 'lc_comments_l'],  // company
      ['g3f637b59831_1_365', 'g3f637b59831_1_358', 'g3f637b59831_1_359', 'g3f637b59831_1_360', 'g3f637b59831_1_361', 'g3f637b59831_1_362', 'g3f637b59831_1_363', 'g3f637b59831_1_364'],  // personal
    ],
  }
  const groups = FRONT_ID_GROUPS[placeholderToken]
  if (groups) {
    await Promise.allSettled(groups.map(ids =>
      batchUpdate(token, presentationId, [{
        updatePageElementsZOrder: { pageObjectIds: ids, operation: 'BRING_TO_FRONT' },
      }])
    ))
  }
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
  const req: Record<string, unknown> = {
    objectId:  found.objectId,
    style:     { link: { url } },
    textRange: { type: 'ALL' },
    fields:    'link',
  }
  if (found.cellLocation) req.cellLocation = found.cellLocation
  await batchUpdate(accessToken, presentationId, [{ updateTextStyle: req }])
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

type FoundElement = {
  objectId: string; pageObjectId: string; size: unknown; transform: unknown
  cellLocation?: { rowIndex: number; columnIndex: number }
}

/** Recursively search all slides/groups/tables for an element whose full text matches `text` exactly. */
function findShapeByText(pres: { slides?: SlidesPage[] }, text: string): FoundElement | null {
  for (const slide of pres.slides || []) {
    const hit = searchElements(slide.pageElements || [], slide.objectId, text)
    if (hit) return hit
  }
  return null
}

// Normalize Unicode punctuation that may differ between what the client sends
// and what the Slides API returns after storing (e.g. curly apostrophes, ellipsis).
function normText(s: string): string {
  return s
    .replace(/[‘’ʼ′]/g, "'")  // curly/modifier apostrophes → straight
    .replace(/[“”ʺ]/g, '"')          // curly double quotes → straight
    .replace(/…/g, '...')                      // Unicode ellipsis → three dots
    .replace(/\s+/g, ' ')                           // collapse whitespace
    .trim()
}

function searchElements(elements: PageElement[], pageObjectId: string, text: string): FoundElement | null {
  const normTarget = normText(text)
  for (const el of elements) {
    // Regular shape
    const runs = el.shape?.text?.textElements || []
    const shapeText = runs.map(r => r.textRun?.content || '').join('')
    if (normText(shapeText) === normTarget) {
      return { objectId: el.objectId, pageObjectId, size: el.size, transform: el.transform }
    }
    // Nested group
    if (el.elementGroup?.children) {
      const nested = searchElements(el.elementGroup.children, pageObjectId, text)
      if (nested) return nested
    }
    // Table cells
    const rows = el.table?.tableRows || []
    for (let r = 0; r < rows.length; r++) {
      const cells = rows[r].tableCells || []
      for (let c = 0; c < cells.length; c++) {
        const cellRuns = cells[c].text?.textElements || []
        const cellText = cellRuns.map(tr => tr.textRun?.content || '').join('')
        if (normText(cellText) === normTarget) {
          return {
            objectId: el.objectId, pageObjectId, size: el.size, transform: el.transform,
            cellLocation: { rowIndex: r, columnIndex: c },
          }
        }
      }
    }
  }
  return null
}

type TableCell = { text?: { textElements?: { textRun?: { content?: string } }[] } }
type PageElement = {
  objectId: string
  size?: unknown
  transform?: unknown
  shape?: { text?: { textElements?: { textRun?: { content?: string } }[] } }
  elementGroup?: { children?: PageElement[] }
  table?: { tableRows?: { tableCells?: TableCell[] }[] }
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
