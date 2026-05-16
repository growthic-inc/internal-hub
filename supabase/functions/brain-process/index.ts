// ============================================================
// Brain — Intelligence Processing Edge Function
//
// Reads unprocessed brain_threads, calls Groq (Llama 3.3 70B)
// to classify and extract intelligence, then recalculates
// health scores.
//
// Body: { limit?: number } — default 20 threads per call
//
// Deploy: supabase functions deploy brain-process
// Secrets: GROQ_API_KEY — get a free key at console.groq.com
// ============================================================

import { serve }        from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SB_URL    = Deno.env.get('SUPABASE_URL')             ?? ''
const SB_SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const GROQ_KEY  = Deno.env.get('GROQ_API_KEY')             ?? ''

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

// ── Groq API call (OpenAI-compatible, JSON mode) ─────────────
async function callGroq(prompt: string, apiKey: string): Promise<any> {
  const resp = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method:  'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type':  'application/json',
    },
    body: JSON.stringify({
      model:           'llama-3.3-70b-versatile',
      messages:        [{ role: 'user', content: prompt }],
      response_format: { type: 'json_object' },
      temperature:     0.1,
    }),
  })
  const data = await resp.json()
  const text = data.choices?.[0]?.message?.content
  if (!text) throw new Error(`Groq empty response: ${JSON.stringify(data)}`)
  return JSON.parse(text)
}

// ── Build Gemini prompt ──────────────────────────────────────
function buildPrompt(thread: {
  subject:      string | null
  first_date:   string | null
  last_date:    string | null
  participants: string[] | null
  snippet:      string | null
}): string {
  return `You are an AI assistant for a digital marketing agency. Analyze this email thread and extract structured intelligence.

Thread details:
Subject: ${thread.subject ?? '(no subject)'}
Date range: ${thread.first_date ?? 'unknown'} to ${thread.last_date ?? 'unknown'}
Participants: ${(thread.participants ?? []).join(', ')}
Snippet: ${thread.snippet ?? ''}

Extract and return ONLY valid JSON in this exact format:
{
  "data_class": "client_work|finance|hr_internal|sales|ops|general",
  "decisions": [{"content": "specific decision made", "date": "YYYY-MM-DD or null"}],
  "preferences": [{"content": "client preference or working style noted"}],
  "contacts": [{"name": "full name", "role": "their role", "email": "email if mentioned"}],
  "open_items": [{"content": "pending action or unresolved item"}],
  "health_signals": [{"signal": "positive|negative|neutral", "reason": "brief reason"}],
  "summary": "one sentence describing what this thread is about"
}

Classification guide:
- client_work: creative briefs, campaigns, strategy, reporting, general project work
- finance: invoices, payments, billing, budget approvals, contracts with money
- hr_internal: hiring, salaries, performance, personal employee matters
- sales: pitches, proposals, new business conversations
- ops: tools, vendors, subscriptions, internal operations
- general: misc, announcements, introductions

Return empty arrays [] if nothing to extract for a category. Keep content concise and factual.`
}

// ── Health score recalculation ───────────────────────────────
async function recalculateHealthScore(clientId: string, db: any): Promise<void> {
  // Days since last contact
  const { data: lastThread } = await db
    .from('brain_threads')
    .select('last_date')
    .eq('client_id', clientId)
    .order('last_date', { ascending: false })
    .limit(1)
    .maybeSingle()

  const daysSinceContact = lastThread
    ? Math.floor((Date.now() - new Date(lastThread.last_date).getTime()) / 86400000)
    : 999

  // Open items count
  const { count: openItems } = await db
    .from('brain_intelligence')
    .select('*', { count: 'exact', head: true })
    .eq('client_id', clientId)
    .eq('category', 'open_item')

  // Health signals last 30 days
  const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000).toISOString()
  const { data: signals } = await db
    .from('brain_intelligence')
    .select('content')
    .eq('client_id', clientId)
    .eq('category', 'health_signal')
    .gte('source_date', thirtyDaysAgo)

  const positive = (signals ?? []).filter((s: any) => s.content.startsWith('positive')).length
  const negative = (signals ?? []).filter((s: any) => s.content.startsWith('negative')).length

  let score = 70
  if (daysSinceContact > 7) score -= Math.min((daysSinceContact - 7) * 2, 30)
  score -= Math.min((openItems ?? 0) * 3, 20)
  score += positive * 5
  score -= negative * 5
  score = Math.max(0, Math.min(100, score))

  await db.from('brain_health_scores').upsert({
    client_id: clientId,
    score,
    signals: {
      days_since_contact: daysSinceContact,
      open_items:         openItems ?? 0,
      positive_signals:   positive,
      negative_signals:   negative,
    },
    scored_at: new Date().toISOString().split('T')[0],
  }, { onConflict: 'client_id,scored_at' })
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

    if (!GROQ_KEY) return json({ error: 'GROQ_API_KEY not configured' }, 500)

    const db   = createClient(SB_URL, SB_SERVICE)
    const body = await req.json().catch(() => ({}))
    const limit = Number(body.limit) || 20

    // Fetch unprocessed threads that have a client
    const { data: threads, error: threadErr } = await db
      .from('brain_threads')
      .select('id, client_id, subject, participants, first_date, last_date, snippet')
      .eq('processed', false)
      .not('client_id', 'is', null)
      .order('last_date', { ascending: false })
      .limit(limit)

    if (threadErr) return json({ error: threadErr.message }, 500)
    if (!threads?.length) return json({ processed: 0, clients_scored: 0 })

    const affectedClients = new Set<string>()
    let processed = 0
    const errors: string[] = []

    for (const thread of threads) {
      try {
        const prompt = buildPrompt(thread)
        const result = await callGroq(prompt, GROQ_KEY)

        const clientId   = thread.client_id
        const sourceDate = thread.last_date
        const dataClass  = result.data_class ?? 'general'

        const intelRows: any[] = []

        for (const d of (result.decisions ?? [])) {
          if (d?.content) intelRows.push({ client_id: clientId, data_class: dataClass, category: 'decision',     content: d.content,                                            source_thread_id: thread.id, source_date: d.date ?? sourceDate })
        }
        for (const p of (result.preferences ?? [])) {
          if (p?.content) intelRows.push({ client_id: clientId, data_class: dataClass, category: 'preference',   content: p.content,                                            source_thread_id: thread.id, source_date: sourceDate })
        }
        for (const c of (result.contacts ?? [])) {
          if (c?.name)    intelRows.push({ client_id: clientId, data_class: dataClass, category: 'contact',      content: [c.name, c.role, c.email].filter(Boolean).join(' — '), source_thread_id: thread.id, source_date: sourceDate })
        }
        for (const o of (result.open_items ?? [])) {
          if (o?.content) intelRows.push({ client_id: clientId, data_class: dataClass, category: 'open_item',    content: o.content,                                            source_thread_id: thread.id, source_date: sourceDate })
        }
        for (const h of (result.health_signals ?? [])) {
          if (h?.signal)  intelRows.push({ client_id: clientId, data_class: dataClass, category: 'health_signal', content: `${h.signal}: ${h.reason ?? ''}`,                   source_thread_id: thread.id, source_date: sourceDate })
        }

        if (intelRows.length) {
          await db.from('brain_intelligence').insert(intelRows)
        }

        // Only mark processed AFTER successfully writing intelligence
        await db.from('brain_threads').update({
          data_class: dataClass,
          processed:  true,
        }).eq('id', thread.id)

        if (clientId) affectedClients.add(clientId)
        processed++

      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        errors.push(`thread ${thread.id.slice(0, 8)}: ${msg}`)
        // Do NOT mark as processed — leave it retryable
      }
    }

    // Recalculate health scores for all affected clients
    for (const clientId of affectedClients) {
      try {
        await recalculateHealthScore(clientId, db)
      } catch (err) {
        console.error(`[brain-process] Health score failed for ${clientId}:`, err)
      }
    }

    return json({
      processed,
      clients_scored: affectedClients.size,
      ...(errors.length ? { errors } : {}),
    })

  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error('[brain-process] Fatal error:', msg)
    return json({ error: msg }, 500)
  }
})
