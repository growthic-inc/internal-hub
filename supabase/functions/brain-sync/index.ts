// ============================================================
// Brain — Gmail Sync Edge Function
//
// Pulls Gmail threads for employees using Domain-Wide Delegation,
// matches them to clients via domain/contact, and upserts into
// brain_threads.
//
// Body: { employee_id?: string, full_sync?: boolean }
//   employee_id — sync only this employee; omit for all active
//   full_sync   — go back 2 years; otherwise 7 days / last sync
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

// ── DWD JWT (pure Deno Web Crypto, no npm) ──────────────────
async function getAccessToken(employeeEmail: string, sa: any, scope: string): Promise<string> {
  const now    = Math.floor(Date.now() / 1000)
  const b64url = (obj: any) =>
    btoa(JSON.stringify(obj))
      .replace(/=/g, '')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')

  const header  = b64url({ alg: 'RS256', typ: 'JWT' })
  const payload = b64url({
    iss:  sa.client_email,
    sub:  employeeEmail,
    scope,
    aud:  'https://oauth2.googleapis.com/token',
    exp:  now + 3600,
    iat:  now,
  })
  const sigInput = `${header}.${payload}`

  const pemBody = sa.private_key.replace(/-----[^-]+-----/g, '').replace(/\s/g, '')
  const keyDer  = Uint8Array.from(atob(pemBody), c => c.charCodeAt(0))
  const key     = await crypto.subtle.importKey(
    'pkcs8', keyDer,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false, ['sign'],
  )
  const sig    = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(sigInput))
  const sigB64 = btoa(String.fromCharCode(...new Uint8Array(sig)))
    .replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_')

  const jwt  = `${sigInput}.${sigB64}`
  const resp = await fetch('https://oauth2.googleapis.com/token', {
    method:  'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body:    new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion:  jwt,
    }),
  })
  const data = await resp.json()
  if (!data.access_token) throw new Error(`DWD token error: ${JSON.stringify(data)}`)
  return data.access_token
}

// ── Gmail helpers ────────────────────────────────────────────
interface GmailThread {
  id:       string
  snippet?: string
}

interface ThreadMeta {
  gmailThreadId: string
  subject:       string
  participants:  string[]
  firstDate:     string | null
  lastDate:      string | null
  messageCount:  number
  snippet:       string
}

function extractHeader(headers: any[], name: string): string {
  return headers?.find((h: any) => h.name?.toLowerCase() === name.toLowerCase())?.value ?? ''
}

function extractEmails(raw: string): string[] {
  const matches = raw.match(/[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g) ?? []
  return [...new Set(matches.map(e => e.toLowerCase()))]
}

async function fetchThreadMeta(threadId: string, token: string): Promise<ThreadMeta | null> {
  const url = `https://gmail.googleapis.com/gmail/v1/users/me/threads/${threadId}?format=metadata` +
    `&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Subject&metadataHeaders=Date`
  const res  = await fetch(url, { headers: { Authorization: `Bearer ${token}` } })
  if (!res.ok) return null
  const data = await res.json()

  const messages: any[] = data.messages ?? []
  if (!messages.length) return null

  const firstMsg  = messages[0]
  const lastMsg   = messages[messages.length - 1]
  const fHeaders  = firstMsg.payload?.headers ?? []
  const lHeaders  = lastMsg.payload?.headers ?? []

  const subject   = extractHeader(fHeaders, 'Subject') || '(no subject)'
  const firstDate = extractHeader(fHeaders, 'Date')
  const lastDate  = extractHeader(lHeaders, 'Date')

  const allParticipants: string[] = []
  for (const msg of messages) {
    const h = msg.payload?.headers ?? []
    allParticipants.push(...extractEmails(extractHeader(h, 'From')))
    allParticipants.push(...extractEmails(extractHeader(h, 'To')))
  }
  const participants = [...new Set(allParticipants)]

  return {
    gmailThreadId: threadId,
    subject,
    participants,
    firstDate: firstDate ? new Date(firstDate).toISOString() : null,
    lastDate:  lastDate  ? new Date(lastDate).toISOString()  : null,
    messageCount: messages.length,
    snippet:   data.snippet ?? '',
  }
}

// ── Client matching ──────────────────────────────────────────
interface ClientRecord {
  id:              string
  client_name:     string
  client_domain:   string | null
  client_contacts: string[] | null
}

function matchClient(participants: string[], clients: ClientRecord[]): string | null {
  for (const participant of participants) {
    const atIdx  = participant.indexOf('@')
    if (atIdx < 0) continue
    const domain = participant.slice(atIdx + 1).toLowerCase()

    for (const client of clients) {
      // Domain match
      if (client.client_domain && client.client_domain.toLowerCase() === domain) {
        return client.id
      }
      // Full email match in client_contacts
      if (client.client_contacts?.some(c => c.toLowerCase() === participant)) {
        return client.id
      }
    }
  }
  return null
}

// ── Sync a single employee ───────────────────────────────────
async function syncEmployee(
  employee: { id: string; email: string },
  sa: any,
  db: any,
  clients: ClientRecord[],
  fullSync: boolean,
): Promise<{ synced: number; matched: number }> {
  // Determine date filter
  let afterDate: Date
  if (fullSync) {
    afterDate = new Date(Date.now() - 2 * 365 * 86400000)
  } else {
    const { data: state } = await db
      .from('brain_sync_state')
      .select('last_synced_at')
      .eq('employee_id', employee.id)
      .maybeSingle()
    afterDate = state?.last_synced_at
      ? new Date(state.last_synced_at)
      : new Date(Date.now() - 7 * 86400000)
  }

  const dateStr = `${afterDate.getFullYear()}/${String(afterDate.getMonth() + 1).padStart(2, '0')}/${String(afterDate.getDate()).padStart(2, '0')}`
  const query   = `after:${dateStr}`

  let token: string
  try {
    token = await getAccessToken(employee.email, sa, 'https://www.googleapis.com/auth/gmail.readonly')
  } catch (err) {
    console.error(`[brain-sync] DWD failed for ${employee.email}:`, err)
    return { synced: 0, matched: 0 }
  }

  // Cap at 100 threads per employee per call to stay within compute limits.
  // For historical backfill run brain-sync repeatedly (last_synced_at advances each run).
  const MAX_THREADS = 100
  const threadIds: string[] = []
  let pageToken: string | undefined
  while (threadIds.length < MAX_THREADS) {
    const pageSize = Math.min(100, MAX_THREADS - threadIds.length)
    let listUrl = `https://gmail.googleapis.com/gmail/v1/users/me/threads?q=${encodeURIComponent(query)}&maxResults=${pageSize}`
    if (pageToken) listUrl += `&pageToken=${pageToken}`

    const res  = await fetch(listUrl, { headers: { Authorization: `Bearer ${token}` } })
    if (!res.ok) break
    const data = await res.json()

    for (const t of (data.threads ?? []) as GmailThread[]) {
      threadIds.push(t.id)
    }
    if (!data.nextPageToken || threadIds.length >= MAX_THREADS) break
    pageToken = data.nextPageToken
  }

  let synced  = 0
  let matched = 0

  for (const threadId of threadIds) {
    const meta = await fetchThreadMeta(threadId, token)
    if (!meta) continue

    const clientId = matchClient(meta.participants, clients)
    if (!clientId) continue  // skip unmatched threads

    matched++

    // Check existing thread to determine if processed should reset
    const { data: existing } = await db
      .from('brain_threads')
      .select('id, last_date')
      .eq('gmail_thread_id', threadId)
      .maybeSingle()

    const lastDateChanged = !existing || existing.last_date !== meta.lastDate

    await db.from('brain_threads').upsert({
      gmail_thread_id: threadId,
      client_id:       clientId,
      subject:         meta.subject,
      participants:    meta.participants,
      first_date:      meta.firstDate,
      last_date:       meta.lastDate,
      message_count:   meta.messageCount,
      snippet:         meta.snippet,
      // Reset processed only if new thread or new messages arrived
      ...(lastDateChanged ? { processed: false } : {}),
    }, { onConflict: 'gmail_thread_id' })

    synced++
  }

  // Update sync state
  await db.from('brain_sync_state').upsert({
    employee_id:    employee.id,
    last_synced_at: new Date().toISOString(),
  }, { onConflict: 'employee_id' })

  return { synced, matched }
}

// ── Main handler ─────────────────────────────────────────────
serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })

  try {
    // Verify caller JWT
    const auth   = req.headers.get('Authorization') ?? ''
    const apikey = req.headers.get('apikey')        ?? ''
    if (!auth.startsWith('Bearer ')) return json({ error: 'Unauthorized' }, 401)

    const userClient = createClient(SB_URL, apikey, {
      global: { headers: { Authorization: auth } },
    })
    const { data: { user }, error: authErr } = await userClient.auth.getUser()
    if (authErr || !user) return json({ error: 'Unauthorized' }, 401)

    const db   = createClient(SB_URL, SB_SERVICE)
    const body = await req.json().catch(() => ({}))
    const { employee_id, full_sync = false } = body

    if (!SA_JSON) return json({ error: 'BRAIN_SERVICE_ACCOUNT_KEY not configured' }, 500)
    const sa = JSON.parse(SA_JSON)

    // Load clients
    const { data: clients, error: clientErr } = await db
      .from('clients')
      .select('id, client_name, client_domain, client_contacts')
    if (clientErr) return json({ error: clientErr.message }, 500)

    // Sync one employee per call to stay within compute limits.
    // When employee_id is given: sync that person.
    // When omitted: pick the employee least-recently synced so a cron
    // cycling every ~hour naturally rotates through all 17 accounts.
    let employee: { id: string; email: string } | null = null

    if (employee_id) {
      const { data: emp } = await db
        .from('employees')
        .select('id, email')
        .eq('id', employee_id)
        .maybeSingle()
      employee = emp ?? null
    } else {
      // Left-join sync state so employees never synced sort first (null < timestamp)
      const { data: emps } = await db
        .from('employees')
        .select('id, email, brain_sync_state(last_synced_at)')
        .not('email', 'is', null)
        .order('brain_sync_state.last_synced_at', { ascending: true, nullsFirst: true })
        .limit(1)
      employee = emps?.[0] ?? null
    }

    if (!employee?.email) return json({ synced: 0, matched: 0, employees_processed: 0 })

    const { synced, matched } = await syncEmployee(employee, sa, db, clients ?? [], full_sync)

    return json({
      synced,
      matched,
      employees_processed: 1,
      employee_email:      employee.email,
    })

  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error('[brain-sync] Fatal error:', msg)
    return json({ error: msg }, 500)
  }
})
