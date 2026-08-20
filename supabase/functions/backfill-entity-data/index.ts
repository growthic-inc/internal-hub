// Growthic One — Edge Function: backfill-entity-data
//
// When a client's first-ever entity gets created (Client Directory), any
// analytics rows uploaded before that entity existed sit with entity_id =
// NULL. The dashboard's entity filter then silently excludes them once a
// real entity exists to filter by — the exact bug that made Akhilesh's and
// Indranil's dashboards briefly show "No data uploaded yet" despite having
// real historical data. Safe only when the client had zero entities before
// this call: with exactly one entity now, there's no ambiguity about which
// entity the orphaned rows belong to.
//
// Runs with the service role because these analytics tables are only ever
// written by ingest-analytics (also service role) — regular authenticated
// writes to them are intentionally not permitted.
//
// Env vars required:
//   SUPABASE_URL / SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const ORPHAN_TABLES = [
  'social_metrics_daily', 'social_posts', 'analytics_upload_log',
  'social_followers_daily', 'social_visitors_daily', 'social_audience_demographics',
]

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const authHeader = req.headers.get('Authorization') || ''
    if (!authHeader) return json({ error: 'Unauthorized' }, 401)

    const anonClient = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } },
    )
    const { data: { user }, error: userErr } = await anonClient.auth.getUser()
    if (userErr || !user) return json({ error: 'Unauthorized' }, 401)

    const { client_id, entity_id } = await req.json() as { client_id: string; entity_id: string }
    if (!client_id || !entity_id) return json({ error: 'client_id and entity_id are required.' }, 400)

    const adminClient = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )

    // Only safe when this entity really is the client's only one — refuse
    // otherwise rather than risk mis-attributing orphaned rows.
    const { count: entityCount } = await adminClient
      .from('client_entities')
      .select('id', { count: 'exact', head: true })
      .eq('client_id', client_id)
    if ((entityCount ?? 0) !== 1) {
      return json({ error: 'Refusing to backfill: client does not have exactly one entity.' }, 400)
    }

    const results: Record<string, number> = {}
    for (const table of ORPHAN_TABLES) {
      const { data, error } = await adminClient
        .from(table)
        .update({ entity_id })
        .eq('client_id', client_id)
        .is('entity_id', null)
        .select('id')
      if (error) return json({ error: `Failed on ${table}: ${error.message}` }, 500)
      results[table] = data?.length ?? 0
    }

    return json({ client_id, entity_id, backfilled: results })
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : String(err) }, 500)
  }
})

function json(body: object, status = 200) {
  return new Response(JSON.stringify(body), {
    status, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}
