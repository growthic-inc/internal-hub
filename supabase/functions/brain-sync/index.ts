// ============================================================
// Brain — Gmail Sync Edge Function
//
// Two modes:
//   Incremental (default): fetches threads since last_synced_at
//   Backfill:              paginates backwards through 2yr history
//                          100 threads per call, stores nextPageToken
//                          between calls. Call repeatedly until
//                          has_more = false.
//
// Body:
//   { employee_id?: string, backfill?: boolean }
//   employee_id — target a specific employee; omit to pick the
//                 least-recently synced one automatically
//   backfill    — run one page of the historical backfill instead
//                 of the normal incremental sync
//
// Deploy: supabase functions deploy brain-sync
// ============================================================

import { serve }        from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SB_URL     = Deno.env.get('SUPABASE_URL')             ?? ''
const SB_SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const SA_JSON    = Deno.env.get('BRAIN_SERVICE_ACCOUNT_KEY') ?? ''

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  })

// ── DWD JWT ──────────────────────────────────────────────────
async function getAccessToken(employeeEmail: string, sa: any, scope: string): Promise<string> {
  const now    = Math.floor(Date.now() / 1000)
  const b64url = (obj: any) =>
    btoa(JSON.stringify(obj)).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_')

  const header  = b64url({ alg: 'RS256', typ: 'JWT' })
  const payload = b64url({
    iss: sa.client_email, sub: employeeEmail, scope,
    aud: 'https://oauth2.googleapis.com/token',
    exp: now + 3600, iat: now,
  })
  const sigInput = `${header}.${payload}`

  const pemBody = sa.private_key.replace(/-----[^-]+-----/g, '').replace(/\s/g, '')
  const keyDer  = Uint8Array.from(atob(pemBody), c => c.charCodeAt(0))
  const key     = await crypto.subtle.importKey(
    'pkcs8', keyDer, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign'],
  )
  const sig    = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(sigInput))
  const sigB64 = btoa(String.fromCharCode(...new Uint8Array(sig)))
    .replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_')

  const jwt  = `${sigInput}.${sigB64}`
  const resp = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: jwt }),
  })
  const data = await resp.json()
  if (!data.access_token) throw new Error(`DWD token error: ${JSON.stringify(data)}`)
  return data.access_token
}

// ── Gmail helpers ─────────────────────────────────────────────
function extractHeader(headers: any[], name: string): string {
  return headers?.find((h: any) => h.name?.toLowerCase() === name.toLowerCase())?.value ?? ''
}

function extractEmails(raw: string): string[] {
  const matches = raw.match(/[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g) ?? []
  return [...new Set(matches.map(e => e.toLowerCase()))]
}

async function fetchThreadMeta(threadId: string, token: string) {
  const url = `https://gmail.googleapis.com/gmail/v1/users/me/threads/${threadId}?format=metadata` +
    `&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Subject&metadataHeaders=Date`
  const res  = await fetch(url, { headers: { Authorization: `Bearer ${token}` } })
  if (!res.ok) return null
  const data = await res.json()
  const messages: any[] = data.messages ?? []
  if (!messages.length) return null

  const firstMsg = messages[0]
  const lastMsg  = messages[messages.length - 1]
  const subject  = extractHeader(firstMsg.payload?.headers ?? [], 'Subject') || '(no subject)'
  const firstDate = extractHeader(firstMsg.payload?.headers ?? [], 'Date')
  const lastDate  = extractHeader(lastMsg.payload?.headers ?? [],  'Date')

  const allParticipants: string[] = []
  for (const msg of messages) {
    const h = msg.payload?.headers ?? []
    allParticipants.push(...extractEmails(extractHeader(h, 'From')))
    allParticipants.push(...extractEmails(extractHeader(h, 'To')))
  }

  return {
    gmailThreadId: threadId,
    subject,
    participants:  [...new Set(allParticipants)],
    firstDate:     firstDate ? new Date(firstDate).toISOString() : null,
    lastDate:      lastDate  ? new Date(lastDate).toISOString()  : null,
    messageCount:  messages.length,
    snippet:       data.snippet ?? '',
  }
}

// ── Client matching ───────────────────────────────────────────
interface ClientRecord { id: string; client_domain: string | null; client_contacts: string[] | null }

function matchClient(participants: string[], clients: ClientRecord[]): string | null {
  for (const p of participants) {
    const atIdx = p.indexOf('@')
    if (atIdx < 0) continue
    const domain = p.slice(atIdx + 1)
    for (const c of clients) {
      if (c.client_domain && c.client_domain === domain) return c.id
      if (c.client_contacts?.some(x => x === p))         return c.id
    }
  }
  return null
}

// ── Upsert a matched thread ───────────────────────────────────
async function upsertThread(meta: NonNullable<Awaited<ReturnType<typeof fetchThreadMeta>>>, clientId: string, db: any) {
  const { data: existing } = await db
    .from('brain_threads').select('last_date').eq('gmail_thread_id', meta.gmailThreadId).maybeSingle()
  const lastDateChanged = !existing || existing.last_date !== meta.lastDate

  await db.from('brain_threads').upsert({
    gmail_thread_id: meta.gmailThreadId,
    client_id:       clientId,
    subject:         meta.subject,
    participants:    meta.participants,
    first_date:      meta.firstDate,
    last_date:       meta.lastDate,
    message_count:   meta.messageCount,
    snippet:         meta.snippet,
    ...(lastDateChanged ? { processed: false } : {}),
  }, { onConflict: 'gmail_thread_id' })
}

// ── BACKFILL MODE ─────────────────────────────────────────────
// Fetches one page (100 threads) of historical Gmail going back
// 2 years, storing nextPageToken between calls. Call repeatedly
// until has_more = false.
async function backfillEmployee(
  employee: { id: string; email: string },
  sa: any, db: any, clients: ClientRecord[],
): Promise<{ synced: number; matched: number; has_more: boolean; backfill_complete: boolean }> {
  const { data: state } = await db
    .from('brain_sync_state')
    .select('backfill_cursor, backfill_complete')
    .eq('employee_id', employee.id)
    .maybeSingle()

  if (state?.backfill_complete) {
    return { synced: 0, matched: 0, has_more: false, backfill_complete: true }
  }

  let token: string
  try {
    token = await getAccessToken(employee.email, sa, 'https://www.googleapis.com/auth/gmail.readonly')
  } catch (err) {
    console.error(`[brain-sync] DWD failed for ${employee.email}:`, err)
    return { synced: 0, matched: 0, has_more: false, backfill_complete: false }
  }

  // Build the list URL — use stored cursor if we have one, otherwise start
  // from 2 years ago. Gmail returns threads newest-first; pageToken advances
  // to progressively older threads on each successive call.
  const twoYearsAgo = new Date(Date.now() - 2 * 365 * 86400_000)
  const dateStr = [
    twoYearsAgo.getFullYear(),
    String(twoYearsAgo.getMonth() + 1).padStart(2, '0'),
    String(twoYearsAgo.getDate()).padStart(2, '0'),
  ].join('/')

  let listUrl = `https://gmail.googleapis.com/gmail/v1/users/me/threads?q=after:${dateStr}&maxResults=100`
  if (state?.backfill_cursor) listUrl += `&pageToken=${encodeURIComponent(state.backfill_cursor)}`

  const res = await fetch(listUrl, { headers: { Authorization: `Bearer ${token}` } })
  if (!res.ok) return { synced: 0, matched: 0, has_more: false, backfill_complete: false }

  const data          = await res.json()
  const threadIds: string[] = (data.threads ?? []).map((t: any) => t.id)
  const nextPageToken: string | null = data.nextPageToken ?? null

  let synced = 0, matched = 0
  for (const id of threadIds) {
    const meta = await fetchThreadMeta(id, token)
    if (!meta) continue
    const clientId = matchClient(meta.participants, clients)
    if (!clientId) continue
    matched++
    await upsertThread(meta, clientId, db)
    synced++
  }

  // No nextPageToken means we've reached the end — backfill complete
  const backfill_complete = !nextPageToken

  await db.from('brain_sync_state').upsert({
    employee_id:       employee.id,
    backfill_cursor:   nextPageToken,
    backfill_complete,
    last_synced_at:    new Date().toISOString(),
  }, { onConflict: 'employee_id' })

  return { synced, matched, has_more: !backfill_complete, backfill_complete }
}

// ── INCREMENTAL MODE ──────────────────────────────────────────
// Fetches threads since last_synced_at (default: last 7 days).
// This is the normal daily sync mode.
async function syncEmployee(
  employee: { id: string; email: string },
  sa: any, db: any, clients: ClientRecord[],
): Promise<{ synced: number; matched: number }> {
  const { data: state } = await db
    .from('brain_sync_state')
    .select('last_synced_at')
    .eq('employee_id', employee.id)
    .maybeSingle()

  const afterDate = state?.last_synced_at
    ? new Date(state.last_synced_at)
    : new Date(Date.now() - 7 * 86400_000)

  const dateStr = [
    afterDate.getFullYear(),
    String(afterDate.getMonth() + 1).padStart(2, '0'),
    String(afterDate.getDate()).padStart(2, '0'),
  ].join('/')

  let token: string
  try {
    token = await getAccessToken(employee.email, sa, 'https://www.googleapis.com/auth/gmail.readonly')
  } catch (err) {
    console.error(`[brain-sync] DWD failed for ${employee.email}:`, err)
    return { synced: 0, matched: 0 }
  }

  // Cap at 100 threads — daily incremental syncs are small enough
  const threadIds: string[] = []
  let pageToken: string | undefined
  while (threadIds.length < 100) {
    const pageSize = Math.min(100, 100 - threadIds.length)
    let listUrl = `https://gmail.googleapis.com/gmail/v1/users/me/threads?q=after:${dateStr}&maxResults=${pageSize}`
    if (pageToken) listUrl += `&pageToken=${pageToken}`

    const res  = await fetch(listUrl, { headers: { Authorization: `Bearer ${token}` } })
    if (!res.ok) break
    const data = await res.json()
    for (const t of (data.threads ?? [])) threadIds.push(t.id)
    if (!data.nextPageToken || threadIds.length >= 100) break
    pageToken = data.nextPageToken
  }

  let synced = 0, matched = 0
  for (const id of threadIds) {
    const meta = await fetchThreadMeta(id, token)
    if (!meta) continue
    const clientId = matchClient(meta.participants, clients)
    if (!clientId) continue
    matched++
    await upsertThread(meta, clientId, db)
    synced++
  }

  await db.from('brain_sync_state').upsert({
    employee_id:    employee.id,
    last_synced_at: new Date().toISOString(),
  }, { onConflict: 'employee_id' })

  return { synced, matched }
}

// ── Main handler ──────────────────────────────────────────────
serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })

  try {
    const auth   = req.headers.get('Authorization') ?? ''
    const apikey = req.headers.get('apikey')        ?? ''
    if (!auth.startsWith('Bearer ')) return json({ error: 'Unauthorized' }, 401)

    const userClient = createClient(SB_URL, apikey, { global: { headers: { Authorization: auth } } })
    const { data: { user }, error: authErr } = await userClient.auth.getUser()
    if (authErr || !user) return json({ error: 'Unauthorized' }, 401)

    if (!SA_JSON) return json({ error: 'BRAIN_SERVICE_ACCOUNT_KEY not configured' }, 500)
    const sa = JSON.parse(SA_JSON)
    const db = createClient(SB_URL, SB_SERVICE)

    const body     = await req.json().catch(() => ({}))
    const { employee_id, backfill = false } = body

    // Load clients with Brain matching fields
    const { data: clients, error: clientErr } = await db
      .from('clients').select('id, client_domain, client_contacts')
    if (clientErr) return json({ error: clientErr.message }, 500)

    // Resolve which employee to process
    let employee: { id: string; email: string } | null = null
    if (employee_id) {
      const { data: emp } = await db
        .from('employees').select('id, email').eq('id', employee_id).maybeSingle()
      employee = emp ?? null
    } else {
      // Pick least-recently synced employee
      const { data: emps } = await db
        .from('employees')
        .select('id, email, brain_sync_state(last_synced_at)')
        .not('email', 'is', null)
        .order('brain_sync_state.last_synced_at', { ascending: true, nullsFirst: true })
        .limit(1)
      employee = emps?.[0] ?? null
    }

    if (!employee?.email) return json({ synced: 0, matched: 0, employees_processed: 0 })

    if (backfill) {
      const result = await backfillEmployee(employee, sa, db, clients ?? [])
      return json({ ...result, employee_email: employee.email, employees_processed: 1 })
    } else {
      const result = await syncEmployee(employee, sa, db, clients ?? [])
      return json({ ...result, employee_email: employee.email, employees_processed: 1 })
    }

  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error('[brain-sync] Fatal:', msg)
    return json({ error: msg }, 500)
  }
})
