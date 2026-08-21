// Growthic One — Edge Function: fetch-linkedin-engagement
//
// LinkedIn's own personal-profile analytics export only gives one lumped
// "Engagements" number per post, not a likes/comments/reposts breakdown
// (see client-dashboard.js's personal-profile KPI comment). This function
// fills that gap: it calls the "LinkedIn Profile Posts Scraper (No Cookies)"
// Apify actor for a client_entities row's own LinkedIn URL — personal
// profiles here are the CLIENT's own people (e.g. Akhilesh Srivastava),
// not Growthic employees, so the URL lives on the entity, not `employees`
// — and writes the real per-post breakdown into personal_post_engagement,
// keyed by post_url, the same key generate-client-report already uses.
//
// Triggered by the "Apify" button in Client Dashboard, before "Fetch Report".
//
// Env vars required:
//   APIFY_API_TOKEN
//   SUPABASE_URL / SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const APIFY_ACTOR_ID = 'harvestapi~linkedin-profile-posts'
// maxPosts: 0 (scrape everything) timed out Supabase's edge function
// execution limit (546 after ~151s) for a profile with meaningful post
// history — run-sync-get-dataset-items blocks until the whole scrape
// finishes. 80 is a bounded middle ground: wider than the original 20
// (a report's "top performing post" can be an old one that resurfaced in
// impressions this period, which a small recent-post window would always
// miss) while staying fast enough to avoid the timeout. Doesn't guarantee
// covering every old post for a high-frequency poster — the real fix for
// that is switching to Apify's async run+poll pattern instead of this
// synchronous call, if this bound keeps missing posts in practice.
const MAX_POSTS = 80

type ApifyPost = {
  linkedinUrl?:  string
  repostId?:     string        // present only on reposts/quote-reposts — NOT reflected in `type`
  content?:      string        // full caption text — needed for the content-matching fallback
                                // below, since Apify returns a bare "/posts/activity-<id>" URL
                                // (no author handle at all) for roughly half of any profile's posts
  postImages?:   { url?: string }[]   // fallback image source — generate-client-report's own
                                       // live fetch has started coming back blocked/empty
  engagement?:   { likes?: number; comments?: number; shares?: number }
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

    // ── Access control: same gate as generate-client-report ───
    const adminClient = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )
    const { data: callerEmp } = await adminClient
      .from('employees')
      .select('role, department')
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
    const { entity_id } = await req.json() as { entity_id: string }
    if (!entity_id) return json({ error: 'entity_id is required.' }, 400)

    const { data: entity, error: entityErr } = await adminClient
      .from('client_entities')
      .select('linkedin_url')
      .eq('id', entity_id)
      .single()
    if (entityErr || !entity) return json({ error: 'Entity not found.' }, 404)
    if (!entity.linkedin_url) {
      return json({ error: 'This entity has no LinkedIn Profile URL on file.' }, 400)
    }

    // ── Call the Apify actor synchronously and get the dataset back ──
    const apifyToken = Deno.env.get('APIFY_API_TOKEN')!
    const runRes = await fetch(
      `https://api.apify.com/v2/acts/${APIFY_ACTOR_ID}/run-sync-get-dataset-items?token=${apifyToken}`,
      {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          targetUrls:        [entity.linkedin_url],
          maxPosts:          MAX_POSTS,
          includeReposts:    false,
          includeQuotePosts: false,
          scrapeReactions:   false,
          scrapeComments:    false,
        }),
      },
    )
    if (!runRes.ok) {
      const errText = await runRes.text().catch(() => '')
      return json({ error: `Apify run failed: ${runRes.status} ${errText}` }, 502)
    }
    const posts = await runRes.json() as ApifyPost[]

    // Belt-and-suspenders: `type` is "post" on reposts too, so the only
    // reliable original-post check is the absence of repostId (confirmed
    // by manually testing a known repost against this same actor).
    const originalPosts = posts.filter(p => p.linkedinUrl && !p.repostId)

    if (originalPosts.length === 0) {
      return json({ entity_id, posts_scraped: 0, posts_written: 0 })
    }

    // ── Upsert into personal_post_engagement, keyed by post_url ───────
    const rows = originalPosts.map(p => ({
      post_url:   p.linkedinUrl!,
      entity_id,
      likes:      p.engagement?.likes    ?? 0,
      comments:   p.engagement?.comments ?? 0,
      reposts:    p.engagement?.shares   ?? 0,
      content:    p.content ?? null,
      image_url:  p.postImages?.[0]?.url ?? null,
      scraped_at: new Date().toISOString(),
    }))

    const { error: upsertErr } = await adminClient
      .from('personal_post_engagement')
      .upsert(rows, { onConflict: 'post_url' })
    if (upsertErr) return json({ error: `Failed to save engagement data: ${upsertErr.message}` }, 500)

    return json({ entity_id, posts_scraped: posts.length, posts_written: rows.length })
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : String(err) }, 500)
  }
})

function json(body: object, status = 200) {
  return new Response(JSON.stringify(body), {
    status, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}
