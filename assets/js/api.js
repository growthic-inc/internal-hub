/* ============================================================
   GROWTHIC ONE — API Layer
   All Supabase queries live here. Never query Supabase directly
   from page modules — always go through API.
   ============================================================ */

const API = (() => {
  const { supabase } = Config

  /* ── Clients ──────────────────────────────────────────────── */
  async function getClients(includeArchived = false) {
    let query = supabase
      .from('clients')
      .select('id, client_name, project_code, category, status, created_at, am_id, overview, account_manager:employees!am_id(name, profile_image_url), client_entities(id, entity_name), client_platforms(id, platform_name)')
      .order('client_name')
    if (!includeArchived) query = query.neq('status', 'archived')
    return query
  }

  async function getClient(clientId) {
    return supabase
      .from('clients')
      .select(`
        *,
        account_manager:employees!am_id(id, name),
        client_entities(
          id, entity_name,
          entity_platforms(platform),
          entity_services(service)
        ),
        client_platforms(*),
        scope_of_work(*)
      `)
      .eq('id', clientId)
      .single()
  }

  async function getClientByProjectCode(projectCode) {
    return supabase
      .from('clients')
      .select('id, client_name, project_code, category, status')
      .eq('project_code', projectCode)
      .single()
  }

  /* ── Employees ────────────────────────────────────────────── */
  async function getEmployees(activeOnly = true) {
    let query = supabase
      .from('employees')
      .select('id, name, email, role, department, status')
      .order('name')
    if (activeOnly) query = query.eq('status', 'active')
    return query
  }

  async function getEmployee(employeeId) {
    return supabase
      .from('employees')
      .select('id, name, email, role, department, status')
      .eq('id', employeeId)
      .single()
  }

  async function getTeamLeads() {
    return supabase
      .from('employees')
      .select('id, name, email')
      .eq('role', 'team_lead')
      .eq('status', 'active')
      .order('name')
  }

  /* ── Timesheets ───────────────────────────────────────────── */
  async function getTimesheetEntries(employeeId, from, to) {
    return supabase
      .from('timesheets')
      .select('*, clients(client_name, project_code)')
      .eq('employee_id', employeeId)
      .gte('date', from)
      .lte('date', to)
      .order('date')
      .order('created_at')
  }

  async function getTeamTimesheetEntries(from, to, empId = null) {
    // RLS policy on timesheets filters to the team lead's reports automatically.
    let q = supabase
      .from('timesheets')
      .select('*, employees!employee_id(id, name, profile_image_url, department), clients!client_id(client_name, project_code)')
      .gte('date', from)
      .lte('date', to)
      .in('status', ['submitted', 'approved', 'rejected'])
      .order('date', { ascending: false })
    if (empId) q = q.eq('employee_id', empId)
    return q
  }

  async function upsertTimesheetEntry(entry) {
    return supabase.from('timesheets').upsert(entry).select().single()
  }

  /* ── Master Folders ───────────────────────────────────────── */
  async function insertMasterFolderFile(file) {
    return supabase.from('master_folder_files').insert(file).select().single()
  }

  async function softDeleteMasterFolderFile(fileId, deletedBy) {
    return supabase
      .from('master_folder_files')
      .update({ deleted_at: new Date().toISOString(), deleted_by: deletedBy })
      .eq('id', fileId)
  }

  /* ── Reimbursements ───────────────────────────────────────── */
  async function getReimbursements(employeeId) {
    return supabase
      .from('reimbursements')
      .select('*, clients(client_name, project_code)')
      .eq('employee_id', employeeId)
      .order('created_at', { ascending: false })
  }

  async function getAllReimbursements(filters = {}) {
    let query = supabase
      .from('reimbursements')
      .select('*, employees(name), clients(client_name, project_code)')
      .order('created_at', { ascending: false })
    if (filters.status) query = query.eq('status', filters.status)
    return query
  }

  async function insertReimbursement(claim) {
    return supabase.from('reimbursements').insert(claim).select().single()
  }

  /* ── Assets ───────────────────────────────────────────────── */
  async function getAssets() {
    return supabase
      .from('assets')
      .select('*, employees(name)')
      .order('name')
  }

  async function getMyAssetRequests(employeeId) {
    return supabase
      .from('approvals')
      .select('*, assets(name, type)')
      .eq('entity_type', 'asset')
      .eq('approver_id', employeeId)
      .order('created_at', { ascending: false })
  }

  /* ── Approvals ────────────────────────────────────────────── */
  async function getPendingApprovals(approverId, entityTypes = []) {
    let query = supabase
      .from('approvals')
      .select('*')
      .eq('approver_id', approverId)
      .eq('status', 'pending')
      .order('created_at', { ascending: false })
    if (entityTypes.length) query = query.in('entity_type', entityTypes)
    return query
  }

  async function updateApproval(approvalId, status, comment) {
    return supabase
      .from('approvals')
      .update({ status, comment, acted_at: new Date().toISOString() })
      .eq('id', approvalId)
  }

  /* ── Notifications ────────────────────────────────────────── */
  async function getUnreadNotifications(employeeId) {
    return supabase
      .from('notifications')
      .select('*')
      .eq('recipient_employee_id', employeeId)
      .eq('read', false)
      .order('created_at', { ascending: false })
  }

  async function markNotificationRead(notificationId) {
    return supabase
      .from('notifications')
      .update({ read: true })
      .eq('id', notificationId)
  }

  async function markAllNotificationsRead(employeeId) {
    return supabase
      .from('notifications')
      .update({ read: true })
      .eq('recipient_employee_id', employeeId)
      .eq('read', false)
  }

  /* ── Reimbursements (Phase 2) ────────────────────────────── */
  async function getMyReimbursements(employeeId, type = null) {
    let q = supabase
      .from('reimbursements')
      .select('*, clients(client_name, project_code), approver:employees!approved_by(name)')
      .eq('employee_id', employeeId)
      .order('created_at', { ascending: false })
    if (type) q = q.eq('type', type)
    return q
  }

  async function getReimbursementInbox(type = null) {
    let q = supabase
      .from('reimbursements')
      .select('*, submitter:employees!employee_id(name, role), clients(client_name, project_code)')
      .eq('status', 'pending')
      .order('created_at', { ascending: true })
    if (type) q = q.eq('type', type)
    return q
  }

  async function getApprovedClaims() {
    return supabase
      .from('reimbursements')
      .select('*, submitter:employees!employee_id(name), clients(client_name, project_code)')
      .eq('type', 'claim')
      .in('status', ['approved', 'paid'])
      .order('updated_at', { ascending: false })
  }

  async function insertReimbursement(record) {
    return supabase.from('reimbursements').insert(record).select().single()
  }

  async function getMyPreApprovals(employeeId) {
    return supabase
      .from('reimbursements')
      .select('id, expense_type, estimated_amount, expected_date, status, reason, client_id, entity_id, clients(client_name, project_code), entity:client_entities!entity_id(entity_name)')
      .eq('employee_id', employeeId)
      .eq('type', 'pre_approval')
      .eq('status', 'approved')
      .order('created_at', { ascending: false })
  }

  /* ── Tools (Phase 2) ──────────────────────────────────────── */
  async function getTools(activeOnly = true) {
    let q = supabase
      .from('tools')
      .select('*, employees!owner_id(name)')
      .order('name')
    if (activeOnly) q = q.eq('status', 'active')
    return q
  }

  async function getToolAccess(toolId) {
    return supabase
      .from('tool_access')
      .select('*, employees(name, role, department)')
      .eq('tool_id', toolId)
      .order('granted_at', { ascending: false })
  }

  async function getMyToolAccess(employeeId) {
    return supabase
      .from('tool_access')
      .select('*, tools(name, category, access_type, status)')
      .eq('employee_id', employeeId)
  }

  async function getToolRequests(status = null) {
    let q = supabase
      .from('tool_requests')
      .select('*, employees!employee_id(name, role, department), tools(name)')
      .order('created_at', { ascending: false })
    if (status) q = q.eq('status', status)
    return q
  }

  async function getMyToolRequests(employeeId) {
    return supabase
      .from('tool_requests')
      .select('*, tools(name)')
      .eq('employee_id', employeeId)
      .order('created_at', { ascending: false })
  }

  /* ── Employees (Phase 2 — People management) ─────────────── */
  async function getAllEmployees() {
    return supabase
      .from('employees')
      .select('id, name, email, role, department, status, joining_date, manager_id, employees!manager_id(name)')
      .order('name')
  }

  /* ── Performance Data (Client Dashboard) ─────────────────── */
  async function getPerformanceData(clientId, platform, from, to) {
    return supabase
      .from('performance_data')
      .select('*')
      .eq('client_id', clientId)
      .eq('platform', platform)
      .eq('superseded', false)
      .gte('date', from)
      .lte('date', to)
      .order('date')
  }

  /* ── Client Dashboard ────────────────────────────────────── */
  async function getClientDashboard(clientId) {
    return supabase
      .from('clients')
      .select('*, client_entities(*), client_platforms(*), scope_of_work(*), account_manager:employees!am_id(id, name), status_updater:employees!client_status_updated_by(name)')
      .eq('id', clientId)
      .single()
  }

  async function updateClientStatus(clientId, status, updatedBy) {
    return supabase
      .from('clients')
      .update({
        client_status:            status,
        client_status_updated_by: updatedBy,
        client_status_updated_at: new Date().toISOString(),
      })
      .eq('id', clientId)
  }

  /* ── Master Folder Files (with uploader name + entity) ───── */
  async function getMasterFolderFiles(clientId, month, folderType) {
    let query = supabase
      .from('master_folder_files')
      .select('*, uploader:employees!uploaded_by(name), client_entities(entity_name)')
      .eq('client_id', clientId)
      .eq('month', month)
      .is('deleted_at', null)
      .order('uploaded_at', { ascending: false })
    if (folderType) query = query.eq('folder_type', folderType)
    return query
  }

  /* ── Notification Preferences ────────────────────────────── */
  async function getNotificationPreferences(employeeId) {
    return supabase
      .from('notification_preferences')
      .select('*')
      .eq('employee_id', employeeId)
  }

  async function upsertNotificationPreference(employeeId, module, eventType, enabled) {
    return supabase
      .from('notification_preferences')
      .upsert({ employee_id: employeeId, module, event_type: eventType, enabled })
  }

  /* ── Department Permissions (legacy — kept during transition) */
  async function getDepartmentPermissions(department) {
    return supabase
      .from('department_permissions')
      .select('*')
      .eq('department', department)
      .order('module')
  }

  async function saveDepartmentPermissions(rows) {
    return supabase
      .from('department_permissions')
      .upsert(rows, { onConflict: 'department,module' })
  }

  /* ── Access Matrix (new 6-tier feature-level permissions) ──── */
  async function getAccessMatrix(department) {
    // Returns all rows for a department: { module, feature, access_level }
    return supabase
      .from('access_matrix')
      .select('module, feature, access_level')
      .eq('department', department)
      .order('module')
      .order('feature')
  }

  async function getAllDeptAccessMatrix(department) {
    // Same as getAccessMatrix — explicit alias for the Access Control panel
    return supabase
      .from('access_matrix')
      .select('module, feature, access_level')
      .eq('department', department)
      .order('module')
      .order('feature')
  }

  async function saveAccessMatrix(rows) {
    // rows: [{ department, module, feature, access_level }]
    return supabase
      .from('access_matrix')
      .upsert(rows, { onConflict: 'department,module,feature' })
  }

  /* ── Departments (Phase 7 — dynamic registry) ────────────── */
  async function getDepartments() {
    return supabase.from('departments').select('*').order('name')
  }

  async function addDepartment(slug, name) {
    return supabase.from('departments').insert({ slug, name }).select().single()
  }

  async function deleteDepartment(id) {
    return supabase.from('departments').delete().eq('id', id)
  }

  /* ── Employees — full profile (Phase 7) ──────────────────── */
  async function getEmployeesFull() {
    return supabase
      .from('employees')
      .select(`
        id, employee_id, name, email, personal_email, phone_number,
        date_of_birth, role, department, designation, employment_type,
        work_location, profile_image_url,
        emergency_contact_name, emergency_contact_relationship, emergency_contact_phone,
        status, joining_date, probation_completed, probation_completed_date,
        manager_id, manager:employees!manager_id(id, name, designation)
      `)
      .order('name')
  }

  /* ── Employee creation (Phase 8 — no invite, sets password directly) ── */
  async function createEmployee(data) {
    const { data: { session } } = await supabase.auth.getSession()
    const res = await fetch(
      `${Config.SUPABASE_URL}/functions/v1/create-employee`,
      {
        method:  'POST',
        headers: {
          'Content-Type':  'application/json',
          'Authorization': `Bearer ${session?.access_token}`,
          'apikey':        Config.SUPABASE_ANON_KEY,
        },
        body: JSON.stringify(data),
      }
    )
    return res.json()
  }

  /* ── Own profile update (Phase 8 — profile completion wizard) ── */
  async function updateOwnProfile(id, data) {
    return supabase.from('employees').update(data).eq('id', id).select().single()
  }

  /* ── Avatar upload to Supabase Storage ──────────────────────── */
  async function uploadAvatar(employeeId, file) {
    const ext  = file.name.split('.').pop()
    const path = `${employeeId}.${ext}`
    const { error } = await supabase.storage
      .from('employee-avatars')
      .upload(path, file, { upsert: true })
    if (error) return { error }
    const { data } = supabase.storage
      .from('employee-avatars')
      .getPublicUrl(path)
    return { url: data.publicUrl }
  }

  /* ── Phase 9: Social Analytics ──────────────────────────────── */

  /**
   * Send parsed XLS data to the ingest-analytics Edge Function.
   * The function handles: auth check, date-range delete, bulk insert, audit log.
   * @param {object} payload { client_id, platform, metrics: [], posts: [] }
   */
  async function ingestAnalytics(payload) {
    const { data: { session } } = await supabase.auth.getSession()
    const res = await fetch(
      `${Config.SUPABASE_URL}/functions/v1/ingest-analytics`,
      {
        method:  'POST',
        headers: {
          'Content-Type':  'application/json',
          'Authorization': `Bearer ${session?.access_token}`,
          'apikey':        Config.SUPABASE_ANON_KEY,
        },
        body: JSON.stringify(payload),
      }
    )
    return res.json()
  }

  /**
   * Fetch daily metrics for a client+platform in a date window.
   * Returns rows ordered by date ASC.
   */
  async function getSocialMetrics(clientId, platform, dateFrom, dateTo) {
    let q = supabase
      .from('social_metrics_daily')
      .select('*')
      .eq('client_id', clientId)
      .eq('platform', platform.toLowerCase())
      .order('date', { ascending: true })
    if (dateFrom) q = q.gte('date', dateFrom)
    if (dateTo)   q = q.lte('date', dateTo)
    return q
  }

  /**
   * Fetch individual posts for a client+platform in a date window.
   * Returns rows ordered by engagement_rate DESC (best posts first).
   */
  async function getSocialPosts(clientId, platform, dateFrom, dateTo) {
    let q = supabase
      .from('social_posts')
      .select('*')
      .eq('client_id', clientId)
      .eq('platform', platform.toLowerCase())
      .order('engagement_rate', { ascending: false })
    if (dateFrom) q = q.gte('created_date', dateFrom)
    if (dateTo)   q = q.lte('created_date', dateTo)
    return q
  }

  /**
   * Fetch the upload history for a client+platform (last 10 uploads).
   */
  async function getAnalyticsUploadLog(clientId, platform) {
    return supabase
      .from('analytics_upload_log')
      .select('*, uploaded_by_emp:employees!uploaded_by(name)')
      .eq('client_id', clientId)
      .eq('platform', platform.toLowerCase())
      .order('uploaded_at', { ascending: false })
      .limit(10)
  }

  /** Daily new-follower rows for the selected date window. */
  async function getSocialFollowers(clientId, platform, dateFrom, dateTo) {
    let q = supabase
      .from('social_followers_daily')
      .select('*')
      .eq('client_id', clientId)
      .eq('platform', platform.toLowerCase())
      .order('date', { ascending: true })
    if (dateFrom) q = q.gte('date', dateFrom)
    if (dateTo)   q = q.lte('date', dateTo)
    return q
  }

  /** Daily visitor/page-view rows for the selected date window. */
  async function getSocialVisitors(clientId, platform, dateFrom, dateTo) {
    let q = supabase
      .from('social_visitors_daily')
      .select('*')
      .eq('client_id', clientId)
      .eq('platform', platform.toLowerCase())
      .order('date', { ascending: true })
    if (dateFrom) q = q.gte('date', dateFrom)
    if (dateTo)   q = q.lte('date', dateTo)
    return q
  }

  /**
   * Audience demographics snapshot for a client+platform+export_type.
   * Pass exportType = 'followers' or 'visitors'.
   * Optionally filter to a single dimension.
   */
  async function getSocialDemographics(clientId, platform, exportType, dimension = null) {
    let q = supabase
      .from('social_audience_demographics')
      .select('*')
      .eq('client_id', clientId)
      .eq('platform', platform.toLowerCase())
      .eq('export_type', exportType)
      .order('value', { ascending: false })
    if (dimension) q = q.eq('dimension', dimension)
    return q
  }

  /**
   * Upload the raw analytics XLS file to Google Drive via the upload-to-drive
   * edge function. Returns { drive_file_id, drive_url } on success.
   * folderType must be 'analytics_linkedin' or 'analytics_instagram'.
   */
  async function uploadAnalyticsToDrive(file, clientId, platform, month) {
    const { data: { session } } = await supabase.auth.getSession()
    const folderType = `analytics_${platform.toLowerCase()}`
    const form = new FormData()
    form.append('file',        file)
    form.append('client_id',   clientId)
    form.append('month',       month)
    form.append('folder_type', folderType)
    const res = await fetch(
      `${Config.SUPABASE_URL}/functions/v1/upload-to-drive`,
      {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${session?.access_token}`, 'apikey': Config.SUPABASE_ANON_KEY },
        body: form,
      }
    )
    return res.json()
  }

  /* ── Home dashboard data (Phase 8) ──────────────────────────── */
  async function getHomeLeaveData(employeeId, year) {
    const [creditsRes, requestsRes] = await Promise.all([
      supabase.from('leave_credits').select('credited_days').eq('employee_id', employeeId).eq('year', year),
      supabase.from('leave_requests').select('days, status, start_date, end_date, leave_types(name)')
        .eq('employee_id', employeeId)
        .in('status', ['approved','pending'])
        .order('start_date'),
    ])
    return {
      credits:  creditsRes.data  || [],
      requests: requestsRes.data || [],
    }
  }

  async function getUpcomingHolidays(limit = 3) {
    return supabase
      .from('company_holidays')
      .select('date, name')
      .gte('date', new Date().toISOString().split('T')[0])
      .order('date')
      .limit(limit)
  }

  async function getRecentAnnouncements(limit = 2) {
    return supabase
      .from('announcements')
      .select('id, title, body, created_at, employees!created_by(name)')
      .eq('status', 'published')
      .order('created_at', { ascending: false })
      .limit(limit)
  }

  async function getPendingApprovalsCount(approverId) {
    const [leaveRes, wfhRes] = await Promise.all([
      supabase.from('leave_requests').select('id', { count: 'exact', head: true })
        .eq('approver_id', approverId).eq('status', 'pending'),
      supabase.from('wfh_requests').select('id', { count: 'exact', head: true })
        .eq('approver_id', approverId).eq('status', 'pending'),
    ])
    return (leaveRes.count || 0) + (wfhRes.count || 0)
  }

  async function getWorkAnniversaries() {
    const today = new Date()
    const mm    = String(today.getMonth() + 1).padStart(2, '0')
    const dd    = String(today.getDate()).padStart(2, '0')
    return supabase
      .from('employees')
      .select('id, name, joining_date, designation, profile_image_url')
      .eq('status', 'active')
      .filter('joining_date', 'not.is', null)
      // match month-day pattern (MMDD portion of joining_date)
      .like('joining_date', `%-${mm}-${dd}`)
  }

  async function updateEmployeeFull(employeeId, data) {
    return supabase.from('employees').update(data).eq('id', employeeId)
  }

  /* ── Org Chart (Phase 7) ──────────────────────────────────── */
  async function getOrgChart() {
    return supabase.rpc('get_org_chart')
  }

  /* ── Leave Types (Phase 7) ────────────────────────────────── */
  async function getLeaveTypes(activeOnly = false) {
    let q = supabase.from('leave_types').select('*').order('name')
    if (activeOnly) q = q.eq('is_active', true)
    return q
  }

  async function createLeaveType(data) {
    return supabase.from('leave_types').insert(data).select().single()
  }

  async function updateLeaveType(id, data) {
    return supabase.from('leave_types').update(data).eq('id', id)
  }

  async function deleteLeaveType(id) {
    return supabase.from('leave_types').delete().eq('id', id)
  }

  /* ── Leave Credits (Phase 7) ──────────────────────────────── */
  async function getLeaveCredits(employeeId, year) {
    return supabase
      .from('leave_credits')
      .select('*, leave_types(name), credited_by_emp:employees!credited_by(name)')
      .eq('employee_id', employeeId)
      .eq('year', year)
      .order('created_at', { ascending: false })
  }

  async function getAllLeaveCredits(year) {
    return supabase
      .from('leave_credits')
      .select('*, employees!employee_id(name, employee_id, department), leave_types(name), credited_by_emp:employees!credited_by(name)')
      .eq('year', year)
      .order('created_at', { ascending: false })
  }

  async function addLeaveCredit(data) {
    return supabase.from('leave_credits').insert(data).select().single()
  }

  async function deleteLeaveCredit(id) {
    return supabase.from('leave_credits').delete().eq('id', id)
  }

  /* ── Leave Requests (Phase 7) ─────────────────────────────── */
  async function getMyLeaveRequests(employeeId) {
    return supabase
      .from('leave_requests')
      .select('*, leave_types(name), approver:employees!approver_id(name)')
      .eq('employee_id', employeeId)
      .order('created_at', { ascending: false })
  }

  async function getPendingLeaveApprovals(approverId) {
    // Returns requests where this manager is the approver (pending + cancellation_pending)
    // Also returns NULL-approver requests for HR
    return supabase
      .from('leave_requests')
      .select('*, leave_types(name), employee:employees!employee_id(id, name, department, profile_image_url)')
      .eq('approver_id', approverId)
      .in('status', ['pending', 'cancellation_pending'])
      .order('created_at', { ascending: true })
  }

  async function getHRLeaveQueue() {
    // Requests with no approver (top-level employees) — for HR
    return supabase
      .from('leave_requests')
      .select('*, leave_types(name), employee:employees!employee_id(id, name, department, profile_image_url)')
      .is('approver_id', null)
      .in('status', ['pending', 'cancellation_pending'])
      .order('created_at', { ascending: true })
  }

  async function getAllLeaveRequests(filters = {}) {
    let q = supabase
      .from('leave_requests')
      .select('*, leave_types(name), employee:employees!employee_id(id, name, department), approver:employees!approver_id(name)')
      .order('created_at', { ascending: false })
    if (filters.status) q = q.eq('status', filters.status)
    if (filters.employeeId) q = q.eq('employee_id', filters.employeeId)
    return q
  }

  async function createLeaveRequest(data) {
    return supabase.from('leave_requests').insert(data).select().single()
  }

  async function updateLeaveRequest(id, data) {
    return supabase.from('leave_requests').update(data).eq('id', id)
  }

  /* ── WFH Requests (Phase 7) ───────────────────────────────── */
  async function getMyWfhRequests(employeeId) {
    return supabase
      .from('wfh_requests')
      .select('*, approver:employees!approver_id(name)')
      .eq('employee_id', employeeId)
      .order('created_at', { ascending: false })
  }

  async function getPendingWfhApprovals(approverId) {
    return supabase
      .from('wfh_requests')
      .select('*, employee:employees!employee_id(id, name, department, profile_image_url)')
      .eq('approver_id', approverId)
      .in('status', ['pending', 'cancellation_pending'])
      .order('created_at', { ascending: true })
  }

  async function getHRWfhQueue() {
    return supabase
      .from('wfh_requests')
      .select('*, employee:employees!employee_id(id, name, department, profile_image_url)')
      .is('approver_id', null)
      .in('status', ['pending', 'cancellation_pending'])
      .order('created_at', { ascending: true })
  }

  async function getAllWfhRequests(filters = {}) {
    let q = supabase
      .from('wfh_requests')
      .select('*, employee:employees!employee_id(id, name, department), approver:employees!approver_id(name)')
      .order('created_at', { ascending: false })
    if (filters.status) q = q.eq('status', filters.status)
    return q
  }

  async function createWfhRequest(data) {
    return supabase.from('wfh_requests').insert(data).select().single()
  }

  async function updateWfhRequest(id, data) {
    return supabase.from('wfh_requests').update(data).eq('id', id)
  }

  /* ── WFH Quotas (Phase 7) ─────────────────────────────────── */
  async function getWfhQuotas(month, year) {
    // Plain select — employee names resolved on the frontend from _employees cache
    let q = supabase.from('wfh_quotas').select('*').order('scope')
    if (month) q = q.eq('month', month)
    if (year)  q = q.eq('year', year)
    return q
  }

  async function createWfhQuota(data) {
    // Use insert (not upsert) — partial unique indexes on wfh_quotas are not
    // recognised as conflict targets by PostgREST, causing fetch errors.
    return supabase.from('wfh_quotas').insert(data).select().single()
  }

  async function deleteWfhQuota(id) {
    return supabase.from('wfh_quotas').delete().eq('id', id)
  }

  /* ── Company Holidays (Phase 7) ───────────────────────────── */
  async function getCompanyHolidays(year) {
    let q = supabase.from('company_holidays').select('*').order('date')
    if (year) q = q.gte('date', `${year}-01-01`).lte('date', `${year}-12-31`)
    return q
  }

  async function addCompanyHoliday(data) {
    return supabase.from('company_holidays').insert(data).select().single()
  }

  async function deleteCompanyHoliday(id) {
    return supabase.from('company_holidays').delete().eq('id', id)
  }

  /* ── Company Events (Phase 7) ─────────────────────────────── */
  async function getCompanyEvents(year) {
    let q = supabase.from('company_events').select('*, created_by_emp:employees!created_by(name)').order('start_date')
    if (year) q = q.gte('start_date', `${year}-01-01`).lte('start_date', `${year}-12-31`)
    return q
  }

  async function createCompanyEvent(data) {
    return supabase.from('company_events').insert(data).select().single()
  }

  async function updateCompanyEvent(id, data) {
    return supabase.from('company_events').update(data).eq('id', id)
  }

  async function deleteCompanyEvent(id) {
    return supabase.from('company_events').delete().eq('id', id)
  }

  /* ── Announcements (Phase 7) ──────────────────────────────── */
  async function getAnnouncements() {
    return supabase
      .from('announcements')
      .select('*, author:employees!created_by(name, profile_image_url)')
      .order('created_at', { ascending: false })
  }

  async function createAnnouncement(data) {
    return supabase.from('announcements').insert(data).select().single()
  }

  async function updateAnnouncement(id, data) {
    return supabase.from('announcements').update(data).eq('id', id)
  }

  async function deleteAnnouncement(id) {
    return supabase.from('announcements').delete().eq('id', id)
  }

  async function getAnnouncementReactions(announcementId) {
    return supabase
      .from('announcement_reactions')
      .select('reaction, employee_id')
      .eq('announcement_id', announcementId)
  }

  async function addReaction(announcementId, employeeId, reaction) {
    return supabase
      .from('announcement_reactions')
      .insert({ announcement_id: announcementId, employee_id: employeeId, reaction })
  }

  async function removeReaction(announcementId, employeeId, reaction) {
    return supabase
      .from('announcement_reactions')
      .delete()
      .eq('announcement_id', announcementId)
      .eq('employee_id', employeeId)
      .eq('reaction', reaction)
  }

  /* ── Policy Categories (Phase 7) ──────────────────────────── */
  async function getPolicyCategories() {
    return supabase.from('policy_categories').select('*').order('name')
  }

  async function addPolicyCategory(name, createdBy) {
    return supabase.from('policy_categories').insert({ name, created_by: createdBy }).select().single()
  }

  async function deletePolicyCategory(id) {
    return supabase.from('policy_categories').delete().eq('id', id)
  }

  /* ── Policies (Phase 7) ───────────────────────────────────── */
  async function getPolicies(categoryId = null) {
    let q = supabase
      .from('policies')
      .select('*, category:policy_categories(name), author:employees!created_by(name)')
      .order('title')
    if (categoryId) q = q.eq('category_id', categoryId)
    return q
  }

  async function createPolicy(data) {
    return supabase.from('policies').insert(data).select().single()
  }

  async function updatePolicy(id, data) {
    return supabase.from('policies').update(data).eq('id', id)
  }

  async function deletePolicy(id) {
    return supabase.from('policies').delete().eq('id', id)
  }

  return {
    getClients, getClient, getClientByProjectCode,
    getEmployees, getEmployee, getTeamLeads, getAllEmployees,
    getTimesheetEntries, getTeamTimesheetEntries, upsertTimesheetEntry,
    insertMasterFolderFile, softDeleteMasterFolderFile,
    getMyReimbursements, getReimbursementInbox, getApprovedClaims,
    insertReimbursement, getMyPreApprovals,
    getAssets, getMyAssetRequests,
    getPendingApprovals, updateApproval,
    getTools, getToolAccess, getMyToolAccess, getToolRequests, getMyToolRequests,
    getUnreadNotifications, markNotificationRead, markAllNotificationsRead,
    getPerformanceData,
    getClientDashboard, updateClientStatus,
    getMasterFolderFiles,
    getNotificationPreferences, upsertNotificationPreference,
    getDepartmentPermissions, saveDepartmentPermissions,
    getAccessMatrix, getAllDeptAccessMatrix, saveAccessMatrix,
    // Phase 9 — Social Analytics
    ingestAnalytics, getSocialMetrics, getSocialPosts, getAnalyticsUploadLog,
    getSocialFollowers, getSocialVisitors, getSocialDemographics, uploadAnalyticsToDrive,
    // Phase 8
    createEmployee, updateOwnProfile, uploadAvatar,
    getHomeLeaveData, getUpcomingHolidays, getRecentAnnouncements,
    getPendingApprovalsCount, getWorkAnniversaries,
    // Phase 7
    getDepartments, addDepartment, deleteDepartment,
    getEmployeesFull, updateEmployeeFull,
    getOrgChart,
    getLeaveTypes, createLeaveType, updateLeaveType, deleteLeaveType,
    getLeaveCredits, getAllLeaveCredits, addLeaveCredit, deleteLeaveCredit,
    getMyLeaveRequests, getPendingLeaveApprovals, getHRLeaveQueue, getAllLeaveRequests,
    createLeaveRequest, updateLeaveRequest,
    getMyWfhRequests, getPendingWfhApprovals, getHRWfhQueue, getAllWfhRequests,
    createWfhRequest, updateWfhRequest,
    getWfhQuotas, createWfhQuota, deleteWfhQuota,
    getCompanyHolidays, addCompanyHoliday, deleteCompanyHoliday,
    getCompanyEvents, createCompanyEvent, updateCompanyEvent, deleteCompanyEvent,
    getAnnouncements, createAnnouncement, updateAnnouncement, deleteAnnouncement,
    getAnnouncementReactions, addReaction, removeReaction,
    getPolicyCategories, addPolicyCategory, deletePolicyCategory,
    getPolicies, createPolicy, updatePolicy, deletePolicy,
  }
})()
