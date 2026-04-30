// Growthic One — Edge Function: ingest-analytics
// Ingests social metrics and post data for a client/platform pair.
// Caller must be super_admin or have upload_performance_data access in their department.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { client_id, platform, metrics = [], posts = [] } = await req.json()

    // Validate inputs
    if (!client_id) return json({ error: 'client_id is required.' }, 400)
    if (!['linkedin', 'instagram'].includes(platform)) {
      return json({ error: "platform must be 'linkedin' or 'instagram'." }, 400)
    }
    if (metrics.length === 0 && posts.length === 0) {
      return json({ error: 'At least one of metrics or posts must be non-empty.' }, 400)
    }

    // Verify calling user
    const authHeader = req.headers.get('Authorization') || ''
    if (!authHeader) return json({ error: 'Unauthorized' }, 401)

    const anonClient = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } }
    )

    const { data: { user: caller }, error: callerErr } = await anonClient.auth.getUser()
    if (callerErr || !caller) return json({ error: 'Unauthorized' }, 401)

    const adminClient = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )

    // Fetch caller's employee record
    const { data: callerEmp, error: empErr } = await adminClient
      .from('employees')
      .select('id, role, department')
      .eq('email', caller.email)
      .single()

    if (empErr || !callerEmp) return json({ error: 'Caller employee record not found.' }, 403)

    // Access check: super_admin or access_matrix allows upload_performance_data
    let isAuthorized = callerEmp.role === 'super_admin'

    if (!isAuthorized) {
      const { data: accessRows } = await adminClient
        .from('access_matrix')
        .select('id')
        .eq('department', callerEmp.department)
        .eq('module', 'client_dashboard')
        .eq('feature', 'upload_performance_data')
        .neq('access_level', 'no_access')
        .limit(1)

      isAuthorized = !!(accessRows && accessRows.length > 0)
    }

    if (!isAuthorized) return json({ error: 'Access denied.' }, 403)

    const uploadedBy = callerEmp.id

    // --- Metrics ingestion ---
    let metricsFrom: string | null = null, metricsTo: string | null = null
    if (metrics.length > 0) {
      const d = metrics.map((m: { date: string }) => m.date).sort()
      ;[metricsFrom, metricsTo] = [d[0], d[d.length - 1]]
      const { error: e1 } = await adminClient.from('social_metrics_daily').delete()
        .eq('client_id', client_id).eq('platform', platform).gte('date', metricsFrom).lte('date', metricsTo)
      if (e1) return json({ error: `Metrics delete failed: ${e1.message}` }, 500)
      const { error: e2 } = await adminClient.from('social_metrics_daily')
        .insert(metrics.map((m: object) => ({ ...m, client_id, platform, uploaded_by: uploadedBy })))
      if (e2) return json({ error: `Metrics insert failed: ${e2.message}` }, 500)
    }

    // --- Posts ingestion ---
    let postsFrom: string | null = null, postsTo: string | null = null
    if (posts.length > 0) {
      const d = posts.map((p: { created_date: string }) => p.created_date).sort()
      ;[postsFrom, postsTo] = [d[0], d[d.length - 1]]
      const { error: e1 } = await adminClient.from('social_posts').delete()
        .eq('client_id', client_id).eq('platform', platform).gte('created_date', postsFrom).lte('created_date', postsTo)
      if (e1) return json({ error: `Posts delete failed: ${e1.message}` }, 500)
      const { error: e2 } = await adminClient.from('social_posts')
        .insert(posts.map((p: object) => ({ ...p, client_id, platform, uploaded_by: uploadedBy })))
      if (e2) return json({ error: `Posts insert failed: ${e2.message}` }, 500)
    }

    // --- Audit log ---
    await adminClient.from('analytics_upload_log').insert({
      client_id,
      platform,
      metrics_from:   metricsFrom,
      metrics_to:     metricsTo,
      posts_from:     postsFrom,
      posts_to:       postsTo,
      metrics_count:  metrics.length,
      posts_count:    posts.length,
      uploaded_by:    uploadedBy,
    })

    return json({
      success:          true,
      metrics_inserted: metrics.length,
      posts_inserted:   posts.length,
      date_range: {
        metrics_from: metricsFrom,
        metrics_to:   metricsTo,
        posts_from:   postsFrom,
        posts_to:     postsTo,
      },
    })

  } catch (err) {
    return json({ error: String(err) }, 500)
  }
})

function json(body: object, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}
