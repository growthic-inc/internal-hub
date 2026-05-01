// Growthic One — Edge Function: ingest-analytics
// Handles content (metrics+posts), followers, and visitors uploads.
// Caller must be super_admin or have upload_performance_data access.

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
    const {
      client_id,
      platform,
      entity_id    = null,
      data_type    = 'content',
      metrics      = [],
      posts        = [],
      followers_daily = [],
      visitors_daily  = [],
      demographics    = [],
      drive_url    = null,
    } = await req.json()

    // Validate inputs
    if (!client_id) return json({ error: 'client_id is required.' }, 400)
    if (!['linkedin', 'instagram'].includes(platform)) {
      return json({ error: "platform must be 'linkedin' or 'instagram'." }, 400)
    }
    if (data_type === 'content' && metrics.length === 0 && posts.length === 0) {
      return json({ error: 'At least one of metrics or posts must be non-empty.' }, 400)
    }
    if (data_type === 'followers' && followers_daily.length === 0) {
      return json({ error: 'followers_daily must be non-empty.' }, 400)
    }
    if (data_type === 'visitors' && visitors_daily.length === 0) {
      return json({ error: 'visitors_daily must be non-empty.' }, 400)
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

    // Access check
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

    // Helper: apply entity_id filter to a query
    function withEntity(q: any) {
      return entity_id ? q.eq('entity_id', entity_id) : q.is('entity_id', null)
    }

    let rowsInserted = 0
    let dateFrom: string | null = null
    let dateTo:   string | null = null

    // ── CONTENT (metrics + posts) ────────────────────────────
    if (data_type === 'content') {
      if (metrics.length > 0) {
        const dates = metrics.map((m: { date: string }) => m.date).sort()
        dateFrom = dates[0]; dateTo = dates[dates.length - 1]

        const { error: e1 } = await withEntity(
          adminClient.from('social_metrics_daily').delete()
            .eq('client_id', client_id).eq('platform', platform)
            .gte('date', dateFrom).lte('date', dateTo)
        )
        if (e1) return json({ error: `Metrics delete failed: ${e1.message}` }, 500)

        const { error: e2 } = await adminClient.from('social_metrics_daily')
          .insert(metrics.map((m: object) => ({ ...m, client_id, platform, entity_id, uploaded_by: uploadedBy })))
        if (e2) return json({ error: `Metrics insert failed: ${e2.message}` }, 500)
        rowsInserted += metrics.length
      }

      if (posts.length > 0) {
        const dates = posts.map((p: { created_date: string }) => p.created_date).filter(Boolean).sort()
        const pFrom = dates[0], pTo = dates[dates.length - 1]

        const { error: e1 } = await withEntity(
          adminClient.from('social_posts').delete()
            .eq('client_id', client_id).eq('platform', platform)
            .gte('created_date', pFrom).lte('created_date', pTo)
        )
        if (e1) return json({ error: `Posts delete failed: ${e1.message}` }, 500)

        const { error: e2 } = await adminClient.from('social_posts')
          .insert(posts.map((p: object) => ({ ...p, client_id, platform, entity_id, uploaded_by: uploadedBy })))
        if (e2) return json({ error: `Posts insert failed: ${e2.message}` }, 500)
        rowsInserted += posts.length
      }
    }

    // ── FOLLOWERS ────────────────────────────────────────────
    if (data_type === 'followers') {
      const dates = followers_daily.map((r: { date: string }) => r.date).sort()
      dateFrom = dates[0]; dateTo = dates[dates.length - 1]

      const { error: e1 } = await withEntity(
        adminClient.from('social_followers_daily').delete()
          .eq('client_id', client_id).eq('platform', platform)
          .gte('date', dateFrom).lte('date', dateTo)
      )
      if (e1) return json({ error: `Followers delete failed: ${e1.message}` }, 500)

      const { error: e2 } = await adminClient.from('social_followers_daily')
        .insert(followers_daily.map((r: object) => ({ ...r, client_id, platform, entity_id, uploaded_by: uploadedBy })))
      if (e2) return json({ error: `Followers insert failed: ${e2.message}` }, 500)
      rowsInserted += followers_daily.length

      // Demographics — replace entire snapshot for this client+platform+followers+entity
      if (demographics.length > 0) {
        const { error: e3 } = await withEntity(
          adminClient.from('social_audience_demographics').delete()
            .eq('client_id', client_id).eq('platform', platform).eq('export_type', 'followers')
        )
        if (e3) return json({ error: `Demographics delete failed: ${e3.message}` }, 500)

        const { error: e4 } = await adminClient.from('social_audience_demographics')
          .insert(demographics.map((d: object) => ({ ...d, client_id, platform, entity_id, export_type: 'followers', uploaded_by: uploadedBy })))
        if (e4) return json({ error: `Demographics insert failed: ${e4.message}` }, 500)
        rowsInserted += demographics.length
      }
    }

    // ── VISITORS ─────────────────────────────────────────────
    if (data_type === 'visitors') {
      const dates = visitors_daily.map((r: { date: string }) => r.date).sort()
      dateFrom = dates[0]; dateTo = dates[dates.length - 1]

      const { error: e1 } = await withEntity(
        adminClient.from('social_visitors_daily').delete()
          .eq('client_id', client_id).eq('platform', platform)
          .gte('date', dateFrom).lte('date', dateTo)
      )
      if (e1) return json({ error: `Visitors delete failed: ${e1.message}` }, 500)

      const { error: e2 } = await adminClient.from('social_visitors_daily')
        .insert(visitors_daily.map((r: object) => ({ ...r, client_id, platform, entity_id, uploaded_by: uploadedBy })))
      if (e2) return json({ error: `Visitors insert failed: ${e2.message}` }, 500)
      rowsInserted += visitors_daily.length

      // Demographics — replace entire snapshot for this client+platform+visitors+entity
      if (demographics.length > 0) {
        const { error: e3 } = await withEntity(
          adminClient.from('social_audience_demographics').delete()
            .eq('client_id', client_id).eq('platform', platform).eq('export_type', 'visitors')
        )
        if (e3) return json({ error: `Demographics delete failed: ${e3.message}` }, 500)

        const { error: e4 } = await adminClient.from('social_audience_demographics')
          .insert(demographics.map((d: object) => ({ ...d, client_id, platform, entity_id, export_type: 'visitors', uploaded_by: uploadedBy })))
        if (e4) return json({ error: `Demographics insert failed: ${e4.message}` }, 500)
        rowsInserted += demographics.length
      }
    }

    // ── Audit log ────────────────────────────────────────────
    await adminClient.from('analytics_upload_log').insert({
      client_id,
      platform,
      entity_id,
      data_type,
      date_from:     dateFrom,
      date_to:       dateTo,
      metrics_count: data_type === 'content'   ? metrics.length         : null,
      posts_count:   data_type === 'content'   ? posts.length           : null,
      rows_count:    data_type !== 'content'   ? rowsInserted           : null,
      drive_url,
      uploaded_by:   uploadedBy,
    })

    return json({ success: true, data_type, rows_inserted: rowsInserted, date_from: dateFrom, date_to: dateTo })

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