// Growthic One — Edge Function: delivery-calendar
//
// Feeds the "Delivery Calendar" tab of the Client Dashboard. Reads the content writers'
// Master Google Sheet (read-only) and returns, per client tab, the dated deliverables
// and their status. Nothing from the sheet is copied into the database.
//
// The only thing stored in Supabase is which tabs the team has chosen to hide
// (table delivery_calendar_tabs, keyed by the Master tab's GID so renames never break it).
// This function creates / re-links those rows when it sees new or recreated tabs.
//
// Request:  POST { refresh?: boolean }        (Authorization: Bearer <user JWT>)
// Response: { sheetId, fetchedAt, referenceYear, statuses, clients: [{ gid, name, hidden, looksLikeClient, deliverables }] }
//           Hidden tabs are listed (so they can be shown again) but carry no deliverables.
//
// Env vars required:
//   DELIVERY_SHEETS_SERVICE_ACCOUNT_JSON  — service account with Viewer access to the Master Sheet
//   SUPABASE_URL / SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY
// Optional:
//   DELIVERY_MASTER_SHEET_ID              — overrides the default Master Sheet ID below

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import {
  NON_CLIENT_TABS, STATUSES, columnIndexToLetter, parseTab, quoteSheetName, referenceYearFor, splitHeader,
  type ColumnMap, type Row,
} from './parse.ts'
import { reconcileTabs } from './reconcile.ts'

const DEFAULT_MASTER_SHEET_ID = '1vtKPH9sjfm6SEWJRyDObStMAxTyAF4V5CjME7FClGz0'
const CACHE_TTL_MS     = 60_000   // sheet reads are shared by everyone for a minute
const REFRESH_MIN_GAP  = 10_000   // "Sync" cannot force a re-read more often than this

const corsHeaders = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

interface SheetTab {
  gid: number
  name: string
  sourceId: string | null
  sourceGid: string | null
  looksLikeClient: boolean
  deliverables: ReturnType<typeof parseTab>['deliverables']
}
interface Parsed { fetchedAt: string; referenceYear: number; tabs: SheetTab[] }

let cache: { sheetId: string; at: number; data: Parsed } | null = null

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    // ── Auth: logged-in user with Client Dashboard access ─────────────
    const authHeader = req.headers.get('Authorization') || ''
    if (!authHeader) return json({ error: 'Unauthorized' }, 401)

    const userClient = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } },
    )
    const { data: { user }, error: userErr } = await userClient.auth.getUser()
    if (userErr || !user) return json({ error: 'Unauthorized' }, 401)

    const { data: allowed, error: accessErr } = await userClient.rpc('can_access_client_dashboard')
    if (accessErr) return json({ error: 'Could not verify access.' }, 500)
    if (allowed !== true) return json({ error: 'You do not have access to the Client Dashboard.' }, 403)

    let body: { refresh?: boolean } = {}
    try { body = await req.json() } catch { /* empty body is fine */ }

    const sheetId = Deno.env.get('DELIVERY_MASTER_SHEET_ID') || DEFAULT_MASTER_SHEET_ID

    // ── Sheet data (cached briefly) ───────────────────────────────────
    const now = Date.now()
    const minAge = body.refresh ? REFRESH_MIN_GAP : CACHE_TTL_MS
    let parsed: Parsed
    if (cache && cache.sheetId === sheetId && now - cache.at < minAge) {
      parsed = cache.data
    } else {
      parsed = await readMasterSheet(sheetId)
      cache = { sheetId, at: now, data: parsed }
    }

    // ── Shared hidden list (database), re-linked if tabs were recreated ─
    const admin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )
    const hiddenByGid = await reconcileTabs(admin, sheetId, parsed.tabs)

    const clients = parsed.tabs
      .map(t => {
        const hidden = hiddenByGid.get(t.gid) ?? !t.looksLikeClient
        return {
          gid: t.gid,
          name: t.name,
          hidden,
          looksLikeClient: t.looksLikeClient,
          deliverables: hidden ? [] : t.deliverables,
        }
      })
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }))

    return json({ sheetId, fetchedAt: parsed.fetchedAt, referenceYear: parsed.referenceYear, statuses: STATUSES, clients })
  } catch (err) {
    console.error('delivery-calendar failed:', err)
    return json({ error: err instanceof Error ? err.message : 'Failed to load the delivery calendar.' }, 500)
  }
})

/* ── Master Sheet → parsed tabs ─────────────────────────────── */

async function readMasterSheet(sheetId: string): Promise<Parsed> {
  const token = await getGoogleAccessToken()
  const base  = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}`
  const auth  = { Authorization: `Bearer ${token}` }

  // Tab list, plus the Apps Script's source tags where the sheet exposes them.
  let metaRes = await fetch(
    `${base}?fields=${encodeURIComponent('sheets(properties(sheetId,title,index),developerMetadata(metadataKey,metadataValue))')}`,
    { headers: auth },
  )
  if (!metaRes.ok) {
    // The source tags are only a fallback identifier — never let them block the calendar.
    metaRes = await fetch(`${base}?fields=${encodeURIComponent('sheets.properties(sheetId,title,index)')}`, { headers: auth })
  }
  if (!metaRes.ok) throw new Error(await googleError(metaRes, 'read the sheet'))
  const meta = await metaRes.json() as {
    sheets: { properties: { sheetId: number; title: string; index: number }; developerMetadata?: { metadataKey: string; metadataValue: string }[] }[]
  }

  const tabs = meta.sheets
    .map(s => ({
      gid: s.properties.sheetId,
      title: s.properties.title,
      index: s.properties.index,
      sourceId:  s.developerMetadata?.find(d => d.metadataKey === 'SOURCE_ID')?.metadataValue  ?? null,
      sourceGid: s.developerMetadata?.find(d => d.metadataKey === 'SOURCE_GID')?.metadataValue ?? null,
    }))
    .filter(t => !NON_CLIENT_TABS.has(t.title.trim().toLowerCase()))
    .sort((a, b) => a.index - b.index)

  if (!tabs.length) return { fetchedAt: new Date().toISOString(), referenceYear: new Date().getUTCFullYear(), tabs: [] }

  // All tab values in one batched call. Row 1 is the header (columns are matched by label).
  const valuesParams = new URLSearchParams({ valueRenderOption: 'UNFORMATTED_VALUE' })
  for (const t of tabs) valuesParams.append('ranges', `${quoteSheetName(t.title)}!A1:I5000`)
  const valuesRes = await fetch(`${base}/values:batchGet?${valuesParams}`, { headers: auth })
  if (!valuesRes.ok) throw new Error(await googleError(valuesRes, 'read the tab data'))
  const valueRanges = (await valuesRes.json() as { valueRanges?: { values?: Row[] }[] }).valueRanges || []

  const raw = tabs.map((t, i) => ({ tab: t, ...splitHeader(valueRanges[i]?.values || []) }))

  // Creative Link cells can hold a label with the URL attached as a hyperlink underneath —
  // values.get can't see that, so ask for the hyperlink metadata of just that column.
  const linksByGid = new Map<number, (string | null)[]>()
  const linkParams = new URLSearchParams({ fields: 'sheets(properties.sheetId,data.rowData.values.hyperlink)' })
  let anyLinkRange = false
  for (const r of raw) {
    const idx = r.colMap.creativeLink
    if (idx == null || idx < 0 || !r.rows.length) continue
    const letter = columnIndexToLetter(idx)
    // Data starts on row 2 (after the header), or row 1 if the tab has no header row.
    const firstRow = r.hasHeader ? 2 : 1
    linkParams.append('ranges', `${quoteSheetName(r.tab.title)}!${letter}${firstRow}:${letter}${r.rows.length + firstRow - 1}`)
    anyLinkRange = true
  }
  if (anyLinkRange) {
    const linkRes = await fetch(`${base}?${linkParams}`, { headers: auth })
    if (linkRes.ok) {   // links are a nicety; a failure here must not hide the calendar
      const linkJson = await linkRes.json() as {
        sheets?: { properties: { sheetId: number }; data?: { rowData?: { values?: { hyperlink?: string }[] }[] }[] }[]
      }
      for (const s of linkJson.sheets || []) {
        const rowData = s.data?.[0]?.rowData || []
        linksByGid.set(s.properties.sheetId, rowData.map(rd => rd.values?.[0]?.hyperlink || null))
      }
    }
  }

  const referenceYear = referenceYearFor(raw.map(r => ({ rows: r.rows, colMap: r.colMap as ColumnMap })), new Date().getUTCFullYear())

  const parsedTabs: SheetTab[] = raw.map(r => {
    const result = parseTab(r.rows, r.colMap, linksByGid.get(r.tab.gid) || [], referenceYear)
    return {
      gid: r.tab.gid,
      name: r.tab.title.trim(),
      sourceId: r.tab.sourceId,
      sourceGid: r.tab.sourceGid,
      looksLikeClient: result.looksLikeClient,
      deliverables: result.deliverables,
    }
  })

  return { fetchedAt: new Date().toISOString(), referenceYear, tabs: parsedTabs }
}

/* ── Google auth (service account → read-only Sheets token) ─── */

let tokenCache: { token: string; exp: number } | null = null

async function getGoogleAccessToken(): Promise<string> {
  if (tokenCache && tokenCache.exp - 60 > Math.floor(Date.now() / 1000)) return tokenCache.token

  const raw = Deno.env.get('DELIVERY_SHEETS_SERVICE_ACCOUNT_JSON')
  if (!raw) throw new Error('DELIVERY_SHEETS_SERVICE_ACCOUNT_JSON is not set.')
  let sa: { client_email: string; private_key: string }
  try { sa = JSON.parse(raw) } catch { throw new Error('DELIVERY_SHEETS_SERVICE_ACCOUNT_JSON is not valid JSON.') }

  const now = Math.floor(Date.now() / 1000)
  const header  = { alg: 'RS256', typ: 'JWT' }
  const payload = {
    iss: sa.client_email, scope: 'https://www.googleapis.com/auth/spreadsheets.readonly',
    aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600,
  }
  const b64url = (o: object) => btoa(JSON.stringify(o)).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_')
  const signingInput = `${b64url(header)}.${b64url(payload)}`
  const pemBody = sa.private_key
    .replace(/-----BEGIN PRIVATE KEY-----/, '').replace(/-----END PRIVATE KEY-----/, '')
    .replace(/\\n/g, '\n').replace(/\n/g, '')
  const keyBytes  = Uint8Array.from(atob(pemBody), c => c.charCodeAt(0))
  const cryptoKey = await crypto.subtle.importKey(
    'pkcs8', keyBytes, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign'],
  )
  const sigBytes = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', cryptoKey, new TextEncoder().encode(signingInput))
  const sig = btoa(String.fromCharCode(...new Uint8Array(sigBytes))).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_')

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${signingInput}.${sig}`,
  })
  const td = await res.json() as { access_token?: string; error_description?: string }
  if (!td.access_token) throw new Error(`Google sign-in failed: ${td.error_description || 'no token returned'}`)
  tokenCache = { token: td.access_token, exp: now + 3500 }
  return td.access_token
}

async function googleError(res: Response, what: string): Promise<string> {
  let detail = ''
  try { detail = ((await res.json()) as { error?: { message?: string } }).error?.message || '' } catch { /* ignore */ }
  if (res.status === 403 || res.status === 404) {
    return `Google would not let the service account ${what}${detail ? ` (${detail})` : ''}. Check that the Master Sheet is shared with it as Viewer.`
  }
  return `Google error while trying to ${what} (${res.status})${detail ? `: ${detail}` : ''}`
}

function json(body: object, status = 200) {
  return new Response(JSON.stringify(body), {
    status, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}
