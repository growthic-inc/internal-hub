// ============================================================
// Growthic One — send-push Edge Function
//
// Sends a Web Push notification to all registered devices
// of a given employee.
//
// Body: { employee_id, title, body, url? }
//
// Deploy: supabase functions deploy send-push
// Secrets: VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT
// ============================================================

import { serve }        from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import webpush          from 'npm:web-push'

const VAPID_PUBLIC_KEY  = Deno.env.get('VAPID_PUBLIC_KEY')  ?? ''
const VAPID_PRIVATE_KEY = Deno.env.get('VAPID_PRIVATE_KEY') ?? ''
const VAPID_SUBJECT     = Deno.env.get('VAPID_SUBJECT')     ?? 'mailto:admin@growthic.in'
const SB_URL            = Deno.env.get('SUPABASE_URL')      ?? ''
const SB_SERVICE        = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''

if (VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY) {
  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY)
}

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

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })

  try {
    const { employee_id, title, body, url = '/home' } = await req.json()

    if (!employee_id || !title) {
      return json({ error: 'Missing required fields: employee_id, title' }, 400)
    }
    if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) {
      return json({ error: 'VAPID keys not configured' }, 500)
    }

    const supabase = createClient(SB_URL, SB_SERVICE)

    // Fetch all push subscriptions for this employee
    const { data: subs, error } = await supabase
      .from('push_subscriptions')
      .select('id, endpoint, p256dh, auth')
      .eq('employee_id', employee_id)

    if (error) return json({ error: error.message }, 500)
    if (!subs?.length) return json({ sent: 0, message: 'No subscriptions found' })

    const payload = JSON.stringify({ title, body, url })

    const results = await Promise.allSettled(
      subs.map(async (sub) => {
        try {
          await webpush.sendNotification(
            { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
            payload,
            { TTL: 60 * 60 * 24 },  // 24-hour TTL
          )
        } catch (err: any) {
          // 410 Gone / 404 = subscription expired or invalid — clean it up
          if (err?.statusCode === 410 || err?.statusCode === 404) {
            await supabase.from('push_subscriptions').delete().eq('id', sub.id)
          }
          throw err
        }
      })
    )

    const sent   = results.filter(r => r.status === 'fulfilled').length
    const failed = results.filter(r => r.status === 'rejected').length
    return json({ sent, failed })

  } catch (err: any) {
    return json({ error: err.message }, 500)
  }
})
