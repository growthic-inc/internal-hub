// Growthic One — Edge Function: create-employee
// Creates a Supabase Auth user with a given password (no invite email)
// and inserts the matching employee record atomically.
// Caller must be authenticated as super_admin or people_culture department.

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
      name, email, password,
      designation, department, role,
      employment_type, work_location,
      joining_date, manager_id,
    } = await req.json()

    // Validate required fields
    if (!name || !email || !password || !designation || !department || !employment_type || !work_location || !joining_date) {
      return json({ error: 'name, email, password, designation, department, employment_type, work_location, and joining_date are required.' }, 400)
    }

    if (password.length < 8) {
      return json({ error: 'Password must be at least 8 characters.' }, 400)
    }

    // Verify the calling user is authenticated
    const authHeader = req.headers.get('Authorization') || ''
    if (!authHeader) return json({ error: 'Unauthorized' }, 401)

    const anonClient = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } }
    )

    const { data: { user: caller }, error: callerErr } = await anonClient.auth.getUser()
    if (callerErr || !caller) return json({ error: 'Unauthorized' }, 401)

    // Privileged client for admin operations
    const adminClient = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )

    // Check caller is super_admin or people_culture
    const { data: callerEmp, error: empErr } = await adminClient
      .from('employees')
      .select('role, department')
      .eq('email', caller.email)
      .single()

    if (empErr || !callerEmp) return json({ error: 'Caller employee record not found.' }, 403)

    const isAuthorized =
      callerEmp.role === 'super_admin' ||
      callerEmp.department === 'people_culture'

    if (!isAuthorized) {
      return json({ error: 'Only HR (People & Culture) or Super Admin can create employees.' }, 403)
    }

    // Check email does not already exist
    const { data: existing } = await adminClient
      .from('employees')
      .select('id')
      .eq('email', email)
      .maybeSingle()

    if (existing) return json({ error: 'An employee with this email already exists.' }, 409)

    // Create the Supabase Auth user with the given password
    // email_confirm: true skips the confirmation email — access is immediate
    const { data: authData, error: authErr } = await adminClient.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    })

    if (authErr) return json({ error: authErr.message }, 400)

    const authUser = authData.user
    if (!authUser) return json({ error: 'Auth user created but ID could not be retrieved.' }, 500)

    // Insert the employee record using the auth user's UUID as primary key
    const { data: employee, error: insertErr } = await adminClient
      .from('employees')
      .insert({
        id:               authUser.id,
        name,
        email,
        role:             role || 'employee',
        designation,
        department,
        employment_type,
        work_location,
        joining_date,
        manager_id:       manager_id || null,
        status:           'active',
        profile_completed: false,   // employee must complete profile on first login
      })
      .select()
      .single()

    if (insertErr) {
      // Rollback: delete the auth user we just created
      await adminClient.auth.admin.deleteUser(authUser.id)
      return json({ error: `Employee record creation failed: ${insertErr.message}` }, 500)
    }

    return json({ success: true, employee })

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
