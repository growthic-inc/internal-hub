// Growthic One — Edge Function: send-email
// Sends a branded transactional email via Resend for a given employee.
// Mirrors send-push's shape/conventions so createNotification() can call
// both the same way — this is the email leg of the same notification.
//
// Required env vars:
//   RESEND_API_KEY — Resend API key
//   SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY — to look up the employee's email, bypassing RLS

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const APP_BASE_URL = 'https://one.thegrowthic.com'
const LOGO_URL      = 'https://one.thegrowthic.com/assets/img/logo.jpg'
const FROM_ADDRESS   = 'Growthic One <contact@thegrowthic.com>'

function buildEmailHtml(subject: string, body: string, url: string): string {
  const absoluteUrl = url.startsWith('http') ? url : `${APP_BASE_URL}${url.startsWith('/') ? '' : '/'}${url}`
  return `<!doctype html>
<html>
<body style="margin:0;padding:0;background:#F1F5F9;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F1F5F9;padding:32px 16px;">
    <tr><td align="center">
      <table role="presentation" width="480" cellpadding="0" cellspacing="0" style="max-width:480px;width:100%;background:#ffffff;border-radius:12px;overflow:hidden;">
        <tr><td style="background:#0F4799;padding:20px;text-align:center;">
          <img src="${LOGO_URL}" alt="Growthic One" width="32" height="32" style="vertical-align:middle;border-radius:6px;display:inline-block;">
          <span style="color:#ffffff;font-size:16px;font-weight:600;letter-spacing:0.3px;vertical-align:middle;margin-left:10px;">Growthic One</span>
        </td></tr>
        <tr><td style="padding:28px 24px;">
          <p style="margin:0 0 20px;font-size:15px;line-height:1.6;color:#111827;">${body}</p>
          <table role="presentation" cellpadding="0" cellspacing="0" style="margin:24px auto;">
            <tr><td style="background:#0F4799;border-radius:8px;">
              <a href="${absoluteUrl}" style="display:inline-block;padding:10px 24px;font-size:14px;font-weight:600;color:#ffffff;text-decoration:none;">View in Growthic One</a>
            </td></tr>
          </table>
        </td></tr>
        <tr><td style="padding:16px 24px;border-top:1px solid #E5E7EB;text-align:center;">
          <p style="margin:0;font-size:12px;color:#9CA3AF;">Automated notification from Growthic One. Do not reply to this email.</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const { employee_id, subject, body, url = '/home' } = await req.json()

    if (!employee_id || !subject || !body) {
      return new Response(JSON.stringify({ error: 'employee_id, subject, body required' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY')!
    if (!RESEND_API_KEY) {
      console.error('[send-email] RESEND_API_KEY not set')
      return new Response(JSON.stringify({ error: 'RESEND_API_KEY not configured' }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )

    const { data: employee, error: empErr } = await supabase
      .from('employees')
      .select('email, name')
      .eq('id', employee_id)
      .single()

    if (empErr || !employee?.email) {
      console.warn('[send-email] no employee/email found for', employee_id, empErr?.message)
      return new Response(JSON.stringify({ sent: false, reason: 'no email on file' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const html = buildEmailHtml(subject, body, url)

    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${RESEND_API_KEY}`,
        'Content-Type':  'application/json',
      },
      body: JSON.stringify({
        from:    FROM_ADDRESS,
        to:      [employee.email],
        subject,
        html,
      }),
    })

    const resendData = await res.json().catch(() => ({}))
    if (!res.ok) {
      console.error('[send-email] Resend error:', resendData)
      return new Response(JSON.stringify({ sent: false, error: resendData }), {
        status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    return new Response(JSON.stringify({ sent: true, id: resendData.id }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (err) {
    console.error('[send-email] fatal:', err)
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
