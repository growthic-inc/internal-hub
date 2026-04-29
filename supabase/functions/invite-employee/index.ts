// Growthic One — Edge Function: invite-employee
// Invites a new employee via Supabase Auth and creates their employee record atomically.
// Requires: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY as Supabase secrets.
// Caller must be authenticated as hr or super_admin.

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
    const { name, email, role, department, manager_id, joining_date } = await req.json()

    if (!name || !email || !role || !department) {
      return json({ error: 'name, email, role, and department are required.' }, 400)
    }

    const allowedRoles = ['super_admin', 'founders_office', 'team_lead', 'bde', 'delivery', 'hr', 'finance']
    if (!allowedRoles.includes(role)) {
      return json({ error: `Invalid role: ${role}` }, 400)
    }

    // Verify the calling user is authenticated
    const authHeader = req.headers.get('Authorization') || ''
    const jwt        = authHeader.replace('Bearer ', '')
    if (!jwt) return json({ error: 'Unauthorized' }, 401)

    const anonClient = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } }
    )

    const { data: { user: caller }, error: callerErr } = await anonClient.auth.getUser()
    if (callerErr || !caller) return json({ error: 'Unauthorized' }, 401)

    // Check caller is hr or super_admin
    const adminClient = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )

    const { data: callerEmp, error: empErr } = await adminClient
      .from('employees')
      .select('role')
      .eq('id', caller.id)
      .single()

    if (empErr || !callerEmp) return json({ error: 'Caller employee record not found.' }, 403)
    if (!['super_admin', 'hr'].includes(callerEmp.role)) {
      return json({ error: 'Only HR or Super Admin can invite employees.' }, 403)
    }

    // Check if email already exists in employees
    const { data: existing } = await adminClient
      .from('employees')
      .select('id')
      .eq('email', email)
      .maybeSingle()

    if (existing) return json({ error: 'An employee with this email already exists.' }, 409)

    // Send Supabase Auth invite
    const { data: inviteData, error: inviteErr } = await adminClient.auth.admin.inviteUserByEmail(email, {
      redirectTo: `${Deno.env.get('SITE_URL') || 'https://internal-hub-xi.vercel.app'}/`,
    })

    if (inviteErr) return json({ error: inviteErr.message }, 400)

    const authUser = inviteData.user
    if (!authUser) return json({ error: 'Invite sent but could not retrieve user ID.' }, 500)

    // Create the employee record immediately with the auth UUID
    const { error: insertErr } = await adminClient.from('employees').insert({
      id:           authUser.id,
      name,
      email,
      role,
      department,
      manager_id:   manager_id || null,
      joining_date: joining_date || null,
      status:       'active',
    })

    if (insertErr) {
      // Attempt cleanup: delete the auth user we just created
      await adminClient.auth.admin.deleteUser(authUser.id)
      return json({ error: `Employee record creation failed: ${insertErr.message}` }, 500)
    }

    return json({ success: true, employee_id: authUser.id })

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
