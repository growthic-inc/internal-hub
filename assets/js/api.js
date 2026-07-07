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
      .select('id, client_name, project_code, category, status, created_at, am_id, overview, client_domain, client_contacts, account_manager:employees!am_id(name, profile_image_url), client_entities(id, entity_name), client_platforms(id, platform_name)')
      .order('client_name')
    if (!includeArchived) query = query.neq('status', 'archived')
    return query
  }

  async function getClient(clientId) {
    const result = await supabase
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
    // PostgREST returns duplicate entity rows when an entity has multiple
    // platforms or services (one row per combination). Deduplicate by ID here
    // so every consumer gets clean data without per-module workarounds.
    if (result.data?.client_entities) {
      const seen = new Set()
      result.data.client_entities = result.data.client_entities.filter(e => {
        if (seen.has(e.id)) return false
        seen.add(e.id)
        return true
      })
    }
    return result
  }

  async function getClientByProjectCode(projectCode) {
    return supabase
      .from('clients')
      .select('id, client_name, project_code, category, status')
      .eq('project_code', projectCode)
      .single()
  }

  async function updateEntityProfileType(entityId, profileType) {
    return supabase
      .from('client_entities')
      .update({ profile_type: profileType })
      .eq('id', entityId)
  }

  /* ── Client Team Members ──────────────────────────────────── */
  async function getClientTeam(clientId) {
    return supabase
      .from('client_team_members')
      .select('id, employee_id, employees!employee_id(id, name, profile_image_url, designation)')
      .eq('client_id', clientId)
      .order('created_at')
  }

  async function setClientTeam(clientId, employeeIds, addedBy) {
    await supabase.from('client_team_members').delete().eq('client_id', clientId)
    if (!employeeIds.length) return { error: null }
    return supabase.from('client_team_members').insert(
      employeeIds.map(eid => ({ client_id: clientId, employee_id: eid, added_by: addedBy }))
    )
  }

  /* ── Client Brand Books ───────────────────────────────────── */
  async function getBrandBooks(clientId) {
    return supabase
      .from('client_brand_books')
      .select('id, name, drive_url, file_name, created_at, employees!uploaded_by(name)')
      .eq('client_id', clientId)
      .order('created_at')
  }

  async function saveBrandBook(clientId, name, driveUrl, fileName, uploadedBy) {
    return supabase.from('client_brand_books').insert({
      client_id: clientId, name, drive_url: driveUrl, file_name: fileName, uploaded_by: uploadedBy,
    }).select().single()
  }

  async function deleteBrandBook(id) {
    return supabase.from('client_brand_books').delete().eq('id', id)
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
      .select('*, clients(client_name, project_code), entity:client_entities!entity_id(id, entity_name), internal_project:internal_projects(id, project_code, name), internal_entity:internal_project_entities(id, entity_name)')
      .eq('employee_id', employeeId)
      .gte('date', from)
      .lte('date', to)
      .order('date')
      .order('created_at')
  }

  async function getDirectReports(managerId) {
    return supabase
      .from('employees')
      .select('id, name, department, profile_image_url')
      .eq('manager_id', managerId)
      .eq('status', 'active')
      .order('name')
  }

  // Returns every employee in the full reporting subtree beneath managerId
  // (direct reports + their reports + all the way down).
  async function getAllSubordinates(managerId) {
    return supabase.rpc('get_all_subordinates', { root_manager_id: managerId })
  }

  async function getTeamTimesheetEntries(from, to, empId = null, reporteeIds = null, excludeSelfId = null, includeAllStatuses = false) {
    // reporteeIds: array of employee IDs that are direct reports of the current manager.
    // excludeSelfId: always exclude the viewer's own entries — no self-approval allowed.
    let q = supabase
      .from('timesheets')
      .select('*, employees!employee_id(id, name, profile_image_url, department), clients!client_id(client_name, project_code), internal_project:internal_projects(id, project_code, name), internal_entity:internal_project_entities(id, entity_name)')
      .gte('date', from)
      .lte('date', to)
      .order('date', { ascending: false })
    if (!includeAllStatuses)        q = q.in('status', ['submitted', 'approved', 'rejected'])
    if (empId)                      q = q.eq('employee_id', empId)
    if (reporteeIds?.length)        q = q.in('employee_id', reporteeIds)
    if (excludeSelfId)              q = q.neq('employee_id', excludeSelfId)
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
      .select('*, employees!assigned_to(name)')
      .order('name')
  }

  async function createAsset(data) {
    return supabase.from('assets').insert(data).select().single()
  }

  async function updateAsset(id, data) {
    return supabase.from('assets').update(data).eq('id', id)
  }

  async function deleteAsset(id) {
    return supabase.from('assets').delete().eq('id', id)
  }

  async function getAssetHistory(assetId) {
    return supabase
      .from('asset_history')
      .select(`
        *,
        to_emp:employees!to_employee_id(name),
        from_emp:employees!from_employee_id(name),
        performed_by_emp:employees!performed_by(name)
      `)
      .eq('asset_id', assetId)
      .order('created_at', { ascending: false })
  }

  async function addAssetHistory(data) {
    return supabase.from('asset_history').insert(data)
  }

  async function getAllAssetRepairs() {
    return supabase
      .from('asset_repairs')
      .select('*, reported_by_emp:employees!reported_by(name)')
      .order('created_at', { ascending: false })
  }

  async function getAssetRepairsForAsset(assetId) {
    return supabase
      .from('asset_repairs')
      .select('*, reported_by_emp:employees!reported_by(name)')
      .eq('asset_id', assetId)
      .order('created_at', { ascending: false })
  }

  async function createAssetRepair(data) {
    return supabase.from('asset_repairs').insert(data)
  }

  async function updateAssetRepair(id, data) {
    return supabase.from('asset_repairs').update(data).eq('id', id)
  }

  async function getAssetTypes() {
    return supabase.from('asset_types').select('*').order('is_default', { ascending: false }).order('name')
  }

  async function createAssetType(name) {
    return supabase.from('asset_types').insert({ name }).select().single()
  }

  async function deleteAssetType(id) {
    return supabase.from('asset_types').delete().eq('id', id)
  }

  async function updateAssetType(id, name) {
    return supabase.from('asset_types').update({ name }).eq('id', id).select().single()
  }

  async function getAssetLocations() {
    return supabase.from('asset_locations').select('*').order('name')
  }

  async function createAssetLocation(name) {
    return supabase.from('asset_locations').insert({ name }).select().single()
  }

  async function updateAssetLocation(id, name) {
    return supabase.from('asset_locations').update({ name }).eq('id', id)
  }

  async function deleteAssetLocation(id) {
    return supabase.from('asset_locations').delete().eq('id', id)
  }

  async function getMyAssetRepairs(employeeId) {
    return supabase
      .from('asset_repairs')
      .select('*, reported_by_emp:employees!reported_by(name)')
      .eq('reported_by', employeeId)
      .order('created_at', { ascending: false })
  }

  async function uploadAssetPhoto(file, assetId, context, assetCategory = '', assetName = '') {
    const { data: { session } } = await supabase.auth.getSession()
    const form = new FormData()
    form.append('file',           file)
    form.append('asset_id',       assetId)
    form.append('context',        context)
    form.append('folder_type',    'asset_photos')
    form.append('asset_category', assetCategory)
    form.append('asset_name',     assetName)
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

  /* ── Asset Requests (two-stage approval) ─────────────────── */

  const ASSET_REQUEST_SELECT = `
    *,
    asset:assets(id, name, type, serial_number),
    requester:employees!requested_by(id, name, department),
    manager:employees!manager_id(id, name),
    hr_actor:employees!hr_acted_by(id, name)
  `

  async function createAssetRequest(data) {
    return supabase.from('asset_requests').insert(data).select().single()
  }

  // Requests submitted by this employee
  async function getMySubmittedAssetRequests(employeeId) {
    return supabase
      .from('asset_requests')
      .select(ASSET_REQUEST_SELECT)
      .eq('requested_by', employeeId)
      .order('created_at', { ascending: false })
  }

  // Requests waiting for this manager's approval
  async function getPendingManagerAssetRequests(managerId) {
    return supabase
      .from('asset_requests')
      .select(ASSET_REQUEST_SELECT)
      .eq('manager_id', managerId)
      .eq('status', 'pending_manager')
      .order('created_at', { ascending: false })
  }

  // Requests pending HR approval (stage 2) — for HR view
  async function getPendingHRAssetRequests() {
    return supabase
      .from('asset_requests')
      .select(ASSET_REQUEST_SELECT)
      .eq('status', 'pending_hr')
      .order('created_at', { ascending: false })
  }

  // Full log — all requests for HR/admin
  async function getAllAssetRequests() {
    return supabase
      .from('asset_requests')
      .select(ASSET_REQUEST_SELECT)
      .order('created_at', { ascending: false })
  }

  async function updateAssetRequest(id, data) {
    return supabase.from('asset_requests').update(data).eq('id', id).select().single()
  }

  /* ── Asset Return Requests ───────────────────────────────── */

  const ASSET_RETURN_REQUEST_SELECT = `
    *,
    asset:assets(id, name, type),
    returned_by_emp:employees!returned_by(id, name, department),
    hr_actor:employees!hr_acted_by(id, name)
  `

  async function createAssetReturnRequest(data) {
    return supabase.from('asset_return_requests').insert(data).select(ASSET_RETURN_REQUEST_SELECT).single()
  }

  async function getAllAssetReturnRequests() {
    return supabase
      .from('asset_return_requests')
      .select(ASSET_RETURN_REQUEST_SELECT)
      .order('created_at', { ascending: false })
  }

  async function getMyReturnRequests(employeeId) {
    return supabase
      .from('asset_return_requests')
      .select(ASSET_RETURN_REQUEST_SELECT)
      .eq('returned_by', employeeId)
      .order('created_at', { ascending: false })
  }

  async function updateAssetReturnRequest(id, data) {
    return supabase.from('asset_return_requests').update(data).eq('id', id)
  }

  async function getMyAssetRequests(employeeId) {
    return supabase
      .from('asset_requests')
      .select(ASSET_REQUEST_SELECT)
      .eq('requested_by', employeeId)
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

  async function createNotification({ recipient_employee_id, type, message, module, record_id = null }) {
    const result = await supabase.from('notifications').insert({
      recipient_employee_id, type, message, module, record_id,
    })

    // Fire push notification — non-blocking, best-effort
    ;(async () => {
      try {
        const { data: { session } } = await Config.supabase.auth.getSession()
        if (!session) { console.warn('[Push] no session, skipping push'); return }
        const res  = await fetch(`${Config.SUPABASE_URL}/functions/v1/send-push`, {
          method:  'POST',
          headers: {
            'Content-Type':  'application/json',
            'Authorization': `Bearer ${session.access_token}`,
            'apikey':        Config.SUPABASE_ANON_KEY,
          },
          body: JSON.stringify({
            employee_id: recipient_employee_id,
            title:       _pushTitle(type, module),
            body:        message,
            url:         _pushUrl(module),
          }),
        })
        const json = await res.json().catch(() => ({}))
        console.log(`[Push] send-push → ${res.status}`, json)
      } catch (err) {
        console.warn('[Push] send-push error:', err)
      }
    })()

    return result
  }

  function _pushTitle(type, module) {
    const mod  = {
      leave_tracker:  'Leave & WFH',
      reimbursements: 'Reimbursements',
      assets:         'Assets',
      tools:          'Tools',
      people:         'People',
      timesheet:      'Timesheet',
      announcements:  'Announcements',
      badges:         'Badges',
    }[module] || 'Growthic One'
    const kind = {
      approval:   '✓ Approved',
      rejection:  '✗ Rejected',
      submission: 'New submission',
      info:       'Update',
    }[type] || 'Update'
    return `${mod} — ${kind}`
  }

  function _pushUrl(module) {
    return {
      leave_tracker:  '/home#leave-tracker',
      reimbursements: '/home#reimbursements',
      assets:         '/home#assets',
      tools:          '/home#tools',
      timesheet:      '/home#timesheet',
      announcements:  '/home#announcements',
      badges:         '/home#people',
      people:         '/home#people',
    }[module] || '/home'
  }

  async function savePushSubscription({ employee_id, endpoint, p256dh, auth }) {
    // Save via the send-push edge function (service role key) to avoid
    // the RLS "permission denied for table users" issue with direct client writes.
    try {
      const { data: { session } } = await Config.supabase.auth.getSession()
      const res = await fetch(`${Config.SUPABASE_URL}/functions/v1/send-push`, {
        method:  'POST',
        headers: {
          'Content-Type':  'application/json',
          'Authorization': `Bearer ${session?.access_token || Config.SUPABASE_ANON_KEY}`,
          'apikey':        Config.SUPABASE_ANON_KEY,
        },
        body: JSON.stringify({ action: 'save', employee_id, endpoint, p256dh, auth }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) return { error: { message: json.error || 'save failed' } }
      return { data: json, error: null }
    } catch (err) {
      return { error: { message: String(err) } }
    }
  }

  async function getRecentNotifications(employeeId, limit = 25) {
    return supabase
      .from('notifications')
      .select('*')
      .eq('recipient_employee_id', employeeId)
      .order('created_at', { ascending: false })
      .limit(limit)
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
      .select('*, submitter:employees!employee_id(name, role, department), clients(client_name, project_code)')
      .eq('status', 'pending')
      .order('created_at', { ascending: true })
    if (type) q = q.eq('type', type)
    return q
  }

  async function getAllReimbursementsAdmin() {
    return supabase
      .from('reimbursements')
      .select('*, submitter:employees!employee_id(name, role, department), clients(client_name, project_code), approver:employees!approved_by(name)')
      .order('created_at', { ascending: false })
  }

  // `systemKey` is the immutable department system_key (e.g. 'people_culture',
  // 'finance') — NOT the editable slug — so this survives renames.
  async function getEmployeesByDepartment(systemKey) {
    return supabase
      .from('employees')
      .select('id, name, departments!inner(system_key)')
      .eq('departments.system_key', systemKey)
      .eq('status', 'active')
  }

  async function getEmployeesByRole(role) {
    return supabase
      .from('employees')
      .select('id, name')
      .eq('role', role)
      .eq('status', 'active')
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
      .select('id, name, email, role, department, status, joining_date, date_of_birth, manager_id, employees!manager_id(name)')
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
    const result = await supabase
      .from('clients')
      .select('*, client_entities(*), client_platforms(*), scope_of_work(*), account_manager:employees!am_id(id, name), status_updater:employees!client_status_updated_by(name)')
      .eq('id', clientId)
      .single()
    // Deduplicate client_entities by entity_name — guards against DB duplicates
    // that can accumulate if a prior edit's delete silently failed (RLS etc.)
    if (result.data?.client_entities) {
      const seen = new Set()
      result.data.client_entities = result.data.client_entities.filter(e => {
        if (seen.has(e.entity_name)) return false
        seen.add(e.entity_name)
        return true
      })
    }
    return result
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
  async function getAccessMatrix(departmentId) {
    // Returns all rows for a department, keyed by the immutable department_id
    // (rename-proof): { module, feature, access_level }
    return supabase
      .from('access_matrix')
      .select('module, feature, access_level')
      .eq('department_id', departmentId)
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
    // Delete-then-insert so stale rows (renamed/removed features) are
    // cleaned up on every save. Upsert is unreliable without a guaranteed
    // unique DB constraint; this approach requires none.
    if (!rows.length) return { error: null }
    const dept = rows[0].department
    const { error: delErr } = await supabase
      .from('access_matrix')
      .delete()
      .eq('department', dept)
    if (delErr) return { error: delErr }
    return supabase.from('access_matrix').insert(rows)
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

  // Atomic create: inserts the department and seeds the access matrix
  // with no_access for every (module, feature). Slug is generated
  // server-side from the name. Returns the new department row.
  async function createDepartmentRpc(name) {
    return supabase.rpc('create_department', { p_name: name })
  }

  // Atomic rename: updates name, regenerates slug, cascades the slug
  // to employees + access_matrix. system_key is preserved.
  async function renameDepartmentRpc(id, name) {
    return supabase.rpc('rename_department', { p_id: id, p_name: name })
  }

  /* ── Employees — full profile (Phase 7) ──────────────────── */
  async function getEmployeesFull() {
    return supabase
      .from('employees')
      .select(`
        id, employee_id, name, email, personal_email, phone_number,
        date_of_birth, role, department, designation, employment_type,
        work_location, profile_image_url, linkedin_url, bio_id,
        address, permanent_address,
        current_address_house_no, current_address_building, current_address_street,
        current_address_landmark, current_address_city, current_address_state,
        current_address_pincode, current_address_type,
        permanent_address_house_no, permanent_address_building, permanent_address_street,
        permanent_address_landmark, permanent_address_city, permanent_address_state,
        permanent_address_pincode, permanent_address_type,
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
    const json = await res.json().catch(() => ({}))
    // Normalise error so callers always get { error: { message: '...' } }
    if (!res.ok) {
      const raw = json?.error
      const msg = typeof raw === 'string'
        ? raw
        : (raw?.message || json?.message || `Request failed (HTTP ${res.status})`)
      return { error: { message: msg } }
    }
    return json
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
  async function getSocialMetrics(clientId, platform, dateFrom, dateTo, entityId = null) {
    let q = supabase
      .from('social_metrics_daily')
      .select('*')
      .eq('client_id', clientId)
      .eq('platform', platform.toLowerCase())
      .order('date', { ascending: true })
    if (entityId) q = q.eq('entity_id', entityId)
    if (dateFrom) q = q.gte('date', dateFrom)
    if (dateTo)   q = q.lte('date', dateTo)
    return q
  }

  /**
   * Fetch individual posts for a client+platform in a date window.
   * Returns rows ordered by engagement_rate DESC (best posts first).
   */
  async function getSocialPosts(clientId, platform, dateFrom, dateTo, entityId = null) {
    let q = supabase
      .from('social_posts')
      .select('*')
      .eq('client_id', clientId)
      .eq('platform', platform.toLowerCase())
      .order('engagement_rate', { ascending: false })
    if (entityId) q = q.eq('entity_id', entityId)
    if (dateFrom) q = q.gte('created_date', dateFrom)
    if (dateTo)   q = q.lte('created_date', dateTo)
    return q
  }

  /**
   * Fetch the upload history for a client+platform (last 10 uploads).
   */
  async function getAnalyticsUploadLog(clientId, platform, entityId = null) {
    let q = supabase
      .from('analytics_upload_log')
      .select('*, uploaded_by_emp:employees!uploaded_by(name)')
      .eq('client_id', clientId)
      .eq('platform', platform.toLowerCase())
      .order('uploaded_at', { ascending: false })
      .limit(10)
    if (entityId) q = q.eq('entity_id', entityId)
    return q
  }

  /** Daily new-follower rows for the selected date window. */
  async function getSocialFollowers(clientId, platform, dateFrom, dateTo, entityId = null) {
    let q = supabase
      .from('social_followers_daily')
      .select('*')
      .eq('client_id', clientId)
      .eq('platform', platform.toLowerCase())
      .order('date', { ascending: true })
    if (entityId) q = q.eq('entity_id', entityId)
    if (dateFrom) q = q.gte('date', dateFrom)
    if (dateTo)   q = q.lte('date', dateTo)
    return q
  }

  /** Daily visitor/page-view rows for the selected date window. */
  async function getSocialVisitors(clientId, platform, dateFrom, dateTo, entityId = null) {
    let q = supabase
      .from('social_visitors_daily')
      .select('*')
      .eq('client_id', clientId)
      .eq('platform', platform.toLowerCase())
      .order('date', { ascending: true })
    if (entityId) q = q.eq('entity_id', entityId)
    if (dateFrom) q = q.gte('date', dateFrom)
    if (dateTo)   q = q.lte('date', dateTo)
    return q
  }

  /**
   * Audience demographics snapshot for a client+platform+export_type.
   * Pass exportType = 'followers' or 'visitors'.
   * Optionally filter to a single dimension.
   */
  async function getSocialDemographics(clientId, platform, exportType, dimension = null, entityId = null) {
    let q = supabase
      .from('social_audience_demographics')
      .select('*')
      .eq('client_id', clientId)
      .eq('platform', platform.toLowerCase())
      .eq('export_type', exportType)
      .order('value', { ascending: false })
    if (entityId)  q = q.eq('entity_id', entityId)
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

  /**
   * Upload a KYC document for an employee to Google Drive.
   * Creates a subfolder per employee inside the root KYC folder
   * (Employee Database: 1mF_IJw-cSu2BJYbqjMBSuqI15gHlClZt).
   * Requires the edge function to have KYC_ROOT_FOLDER_ID configured.
   */
  async function uploadKycDocument(file, employeeId, employeeName, docType) {
    const { data: { session } } = await supabase.auth.getSession()
    const form = new FormData()
    form.append('file',          file)
    form.append('employee_id',   employeeId)
    form.append('employee_name', employeeName)
    form.append('doc_type',      docType)
    const res = await fetch(
      `${Config.SUPABASE_URL}/functions/v1/upload-kyc-document`,
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
      .select('id, title, content, image_urls, created_at, employees!created_by(name)')
      .eq('published', true)
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

  async function getWhoIsOutToday() {
    const today = new Date().toISOString().split('T')[0]
    return supabase
      .from('leave_requests')
      .select('employees!employee_id(id, name, profile_image_url, designation, department)')
      .eq('status', 'approved')
      .lte('start_date', today)
      .gte('end_date', today)
  }

  async function getWhoIsWfhToday() {
    const today = new Date().toISOString().split('T')[0]
    return supabase
      .from('wfh_requests')
      .select('employees!employee_id(id, name, profile_image_url, designation, department)')
      .eq('status', 'approved')
      .lte('start_date', today)
      .gte('end_date', today)
  }

  async function getPendingTimesheetApprovalsCount(employeeId) {
    const res = await supabase
      .from('timesheets')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'submitted')
      .neq('employee_id', employeeId)
    return res.count || 0
  }

  async function getBirthdayEmployees() {
    // Returns all active employees — used for both birthday AND anniversary computation
    return supabase
      .from('employees')
      .select('id, name, date_of_birth, joining_date, profile_image_url, designation')
      .eq('status', 'active')
  }

  async function getUpcomingEventsData(days = 30) {
    const today   = new Date()
    const fromISO = today.toISOString().split('T')[0]
    const toISO   = new Date(today.getTime() + days * 86400000).toISOString().split('T')[0]
    const [holRes, evtRes] = await Promise.all([
      supabase.from('company_holidays').select('id, name, date')
        .gte('date', fromISO).lte('date', toISO).order('date'),
      supabase.from('company_events').select('id, title, start_date')
        .gte('start_date', fromISO).lte('start_date', toISO).order('start_date'),
    ])
    return {
      data: { holidays: holRes.data || [], events: evtRes.data || [] },
      error: holRes.error || evtRes.error,
    }
  }

  async function updateEmployeeFull(employeeId, data) {
    return supabase.from('employees').update(data).eq('id', employeeId)
  }

  // Records that the employee has read and agreed to company policies.
  // Sets policy_acknowledged_at to the current timestamp; unlocks all modules.
  async function acknowledgePolicy(employeeId) {
    return supabase
      .from('employees')
      .update({ policy_acknowledged_at: new Date().toISOString() })
      .eq('id', employeeId)
  }

  /* Returns KYC document URLs for one employee — HR / super_admin only. */
  async function getEmployeeKyc(employeeId) {
    return supabase
      .from('employees')
      .select('kyc_aadhar_url, kyc_pan_url, kyc_passport_url, kyc_passport_photo_url, kyc_submitted_at')
      .eq('id', employeeId)
      .single()
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

  async function updateLeaveCredit(id, data) {
    return supabase.from('leave_credits').update(data).eq('id', id)
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

  async function getApprovalHistoryLeave(approverId) {
    // All leave requests this manager has already acted on (approved / rejected)
    return supabase
      .from('leave_requests')
      .select('*, leave_types(name), employee:employees!employee_id(id, name, department, profile_image_url)')
      .eq('approver_id', approverId)
      .in('status', ['approved', 'rejected', 'cancelled'])
      .order('acted_at', { ascending: false })
      .limit(100)
  }

  async function getApprovalHistoryWfh(approverId) {
    // All WFH requests this manager has already acted on (approved / rejected)
    return supabase
      .from('wfh_requests')
      .select('*, employee:employees!employee_id(id, name, department, profile_image_url)')
      .eq('approver_id', approverId)
      .in('status', ['approved', 'rejected', 'cancelled'])
      .order('acted_at', { ascending: false })
      .limit(100)
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
      .select('*, leave_types(name), employee:employees!employee_id(id, name, department, designation, profile_image_url), approver:employees!approver_id(name)')
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

  // Returns all approved leave + WFH + client-visit records for an employee.
  // Used by the Timesheet & Attendance modules to overlay status on days.
  async function getApprovedLeaveForEmployee(employeeId) {
    const [leaveRes, wfhRes, cvRes] = await Promise.all([
      supabase.from('leave_requests')
        .select('start_date, end_date, is_half_day, half_day_period, status, leave_types(name)')
        .eq('employee_id', employeeId)
        .in('status', ['approved', 'pending']),
      supabase.from('wfh_requests')
        .select('start_date, end_date')
        .eq('employee_id', employeeId)
        .eq('status', 'approved'),
      supabase.from('client_visit_requests')
        .select('id, start_date, end_date, duration_type, reason, clients(client_name), entity:client_entities!entity_id(id, entity_name)')
        .eq('employee_id', employeeId)
        .eq('status', 'approved'),
    ])
    return {
      leaves: leaveRes.data || [],
      wfhs: wfhRes.data || [],
      clientVisits: cvRes.data || [],
    }
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
      .select('*, employee:employees!employee_id(id, name, department, designation, profile_image_url), approver:employees!approver_id(name)')
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

  /* ── Client Visit Requests (mirrors WFH) ──────────────────── */
  const CV_SEL = '*, clients(client_name, project_code), entity:client_entities!entity_id(id, entity_name)'

  async function getMyClientVisits(employeeId) {
    return supabase
      .from('client_visit_requests')
      .select(`${CV_SEL}, approver:employees!approver_id(name)`)
      .eq('employee_id', employeeId)
      .order('created_at', { ascending: false })
  }

  async function getPendingClientVisitApprovals(approverId) {
    return supabase
      .from('client_visit_requests')
      .select(`${CV_SEL}, employee:employees!employee_id(id, name, department, profile_image_url)`)
      .eq('approver_id', approverId)
      .in('status', ['pending', 'cancellation_pending'])
      .order('created_at', { ascending: true })
  }

  async function getHRClientVisitQueue() {
    return supabase
      .from('client_visit_requests')
      .select(`${CV_SEL}, employee:employees!employee_id(id, name, department, profile_image_url)`)
      .is('approver_id', null)
      .in('status', ['pending', 'cancellation_pending'])
      .order('created_at', { ascending: true })
  }

  async function getApprovalHistoryClientVisit(approverId) {
    return supabase
      .from('client_visit_requests')
      .select(`${CV_SEL}, employee:employees!employee_id(id, name, department, profile_image_url)`)
      .eq('approver_id', approverId)
      .in('status', ['approved', 'rejected', 'cancelled'])
      .order('acted_at', { ascending: false })
      .limit(100)
  }

  async function getAllClientVisits(filters = {}) {
    let q = supabase
      .from('client_visit_requests')
      .select(`${CV_SEL}, employee:employees!employee_id(id, name, department, designation, profile_image_url), approver:employees!approver_id(name)`)
      .order('created_at', { ascending: false })
    if (filters.status) q = q.eq('status', filters.status)
    return q
  }

  async function createClientVisit(data) {
    return supabase.from('client_visit_requests').insert(data).select().single()
  }

  async function updateClientVisit(id, data) {
    return supabase.from('client_visit_requests').update(data).eq('id', id)
  }

  // Conflict check: returns any leave / WFH / client-visit requests for this
  // employee that overlap [startISO, endISO] and aren't dead (rejected/cancelled).
  // The caller applies period-aware logic (full-day vs first/second half).
  async function getAttendanceConflicts(employeeId, startISO, endISO) {
    const live = ['pending', 'approved', 'cancellation_pending']
    const [lr, wfh, cv] = await Promise.all([
      supabase.from('leave_requests')
        .select('id, start_date, end_date, is_half_day, half_day_period, status, leave_types(name)')
        .eq('employee_id', employeeId).in('status', live)
        .lte('start_date', endISO).gte('end_date', startISO),
      supabase.from('wfh_requests')
        .select('id, start_date, end_date, status')
        .eq('employee_id', employeeId).in('status', live)
        .lte('start_date', endISO).gte('end_date', startISO),
      supabase.from('client_visit_requests')
        .select('id, start_date, end_date, duration_type, status, clients(client_name)')
        .eq('employee_id', employeeId).in('status', live)
        .lte('start_date', endISO).gte('end_date', startISO),
    ])
    return { leaves: lr.data || [], wfhs: wfh.data || [], clientVisits: cv.data || [] }
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

  /* ── App Settings ────────────────────────────────────────── */
  async function getAppSettings(module) {
    let q = supabase.from('app_settings').select('key, value, label, module')
    if (module) q = q.eq('module', module)
    return q
  }

  async function upsertAppSetting(key, value, module, label, updatedBy) {
    return supabase.from('app_settings').upsert({
      key, value, module, label,
      updated_by: updatedBy,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'key' })
  }

  /* ── Announcements (Phase 7) ──────────────────────────────── */
  async function getAnnouncements() {
    return supabase
      .from('announcements')
      .select('*, author:employees!created_by(name, profile_image_url, department)')
      .order('created_at', { ascending: false })
  }

  async function uploadAnnouncementImage(file) {
    const ext  = (file.name.split('.').pop() || 'jpg').toLowerCase()
    const path = `public/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`
    const { error } = await Config.supabase.storage
      .from('announcement-images')
      .upload(path, file, { cacheControl: '31536000', upsert: false })
    if (error) throw new Error(error.message)
    const { data: { publicUrl } } = Config.supabase.storage
      .from('announcement-images')
      .getPublicUrl(path)
    return publicUrl
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

  /* ── Badges ───────────────────────────────────────────────── */

  /** All active badges from the catalogue */
  async function getBadges() {
    return supabase
      .from('badges')
      .select('*')
      .eq('active', true)
      .order('sort_order')
  }

  /** All badges awarded to a specific employee (with badge details + awarder name) */
  async function getEmployeeBadges(employeeId) {
    return supabase
      .from('employee_badges')
      .select('*, badge:badges(*), awarder:employees!awarded_by(name)')
      .eq('employee_id', employeeId)
      .order('awarded_at', { ascending: false })
  }

  /**
   * Award a badge. Returns the inserted row with badge details.
   * Duplicate tenure/recognition badges are prevented by the DB unique constraint.
   * Birthday badge (re-awarded yearly) must be handled by caller:
   * delete the old row first, then call this.
   */
  async function awardBadge({ employee_id, badge_id, awarded_by = null, note = null }) {
    return supabase
      .from('employee_badges')
      .insert({ employee_id, badge_id, awarded_by, note })
      .select('*, badge:badges(*)')
      .single()
  }

  /** Remove a specific employee_badges row (used for yearly birthday re-award) */
  async function revokeEmployeeBadge(employeeBadgeId) {
    return supabase
      .from('employee_badges')
      .delete()
      .eq('id', employeeBadgeId)
  }

  /** Recent badge awards across the whole team — for the home spotlight */
  async function getRecentBadgeAwards(limit = 8) {
    return supabase
      .from('employee_badges')
      .select('*, badge:badges(*), employee:employees!employee_id(id, name, profile_image_url, designation), awarder:employees!awarded_by(name)')
      .order('awarded_at', { ascending: false })
      .limit(limit)
  }

  /** All employee badge awards (summarised) — for the HRMS directory badge column */
  async function getAllEmployeeBadgeSummary() {
    return supabase
      .from('employee_badges')
      .select('employee_id, badge:badges(name, icon, colour, category, sort_order)')
      .order('awarded_at', { ascending: false })
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

  // ── Project Codes ─────────────────────────────────────────
  async function getInternalProjects() {
    return Config.supabase
      .from('internal_projects')
      .select('*, internal_project_entities(id, entity_name, sort_order)')
      .order('sort_order', { ascending: true })
  }

  async function createInternalProject({ name, project_code, category, description, entities = [] }) {
    const { data: { session } } = await Config.supabase.auth.getSession()
    const userId = session?.user?.id
    const code = project_code.toUpperCase()

    // Check if an inactive project with this code already exists — reactivate it
    const { data: existing } = await Config.supabase
      .from('internal_projects')
      .select('id, status')
      .eq('project_code', code)
      .single()

    if (existing) {
      if (existing.status === 'inactive') {
        // Reactivate and update with new details
        const { error } = await Config.supabase
          .from('internal_projects')
          .update({ name, category: category || 'internal', description: description || null, status: 'active', updated_at: new Date().toISOString() })
          .eq('id', existing.id)
        if (error) return { data: null, error }
        // Replace entities
        await Config.supabase.from('internal_project_entities').delete().eq('internal_project_id', existing.id)
        if (entities.length) {
          await Config.supabase.from('internal_project_entities').insert(
            entities.map((e, i) => ({ internal_project_id: existing.id, entity_name: e, sort_order: i + 1 }))
          )
        }
        return { data: { id: existing.id }, error: null, reactivated: true }
      }
      // Active project with this code already exists
      return { data: null, error: new Error(`Project code "${code}" is already in use by an active project.`) }
    }

    const { data, error } = await Config.supabase
      .from('internal_projects')
      .insert({ name, project_code: code, category: category || 'internal', description: description || null, created_by: userId })
      .select('id')
      .single()
    if (error || !data) return { data: null, error: error || new Error('Insert failed') }
    if (entities.length) {
      await Config.supabase.from('internal_project_entities').insert(
        entities.map((e, i) => ({ internal_project_id: data.id, entity_name: e, sort_order: i + 1 }))
      )
    }
    return { data, error: null }
  }

  async function updateInternalProject(id, { name, project_code, category, description, entities }) {
    const updates = { updated_at: new Date().toISOString() }
    if (name         !== undefined) updates.name         = name
    if (project_code !== undefined) updates.project_code = project_code.toUpperCase()
    if (category     !== undefined) updates.category     = category || 'internal'
    if (description  !== undefined) updates.description  = description || null
    const { error } = await Config.supabase.from('internal_projects').update(updates).eq('id', id)
    if (!error && entities !== undefined) {
      await Config.supabase.from('internal_project_entities').delete().eq('internal_project_id', id)
      if (entities.length) {
        await Config.supabase.from('internal_project_entities').insert(
          entities.map((e, i) => ({ internal_project_id: id, entity_name: e, sort_order: i + 1 }))
        )
      }
    }
    return { error }
  }

  async function setInternalProjectStatus(id, status) {
    return Config.supabase
      .from('internal_projects')
      .update({ status, updated_at: new Date().toISOString() })
      .eq('id', id)
  }

  async function updateClientProjectDetails(clientId, { project_description, category, client_domain, client_contacts }) {
    const updates = {}
    if (project_description !== undefined) updates.project_description = project_description || null
    if (category            !== undefined) updates.category            = category || null
    if (client_domain       !== undefined) updates.client_domain       = client_domain || null
    if (client_contacts     !== undefined) updates.client_contacts     = client_contacts  // array or []
    return Config.supabase.from('clients').update(updates).eq('id', clientId)
  }

  // Sets clients.status (active / inactive / paused / archived) — distinct from
  // updateClientStatus which manages the CRM health field.
  // After the DB update succeeds, fire-and-forget a Drive folder move so the
  // client's folders stay in sync with the new status category.
  async function setClientStatus(clientId, status) {
    // Fetch current status so we know which folder to move from
    const { data: current } = await Config.supabase
      .from('clients')
      .select('client_name, status')
      .eq('id', clientId)
      .single()

    const result = await Config.supabase.from('clients').update({ status }).eq('id', clientId)
    if (result.error) return result

    // Fire-and-forget Drive folder move (don't block UI on Drive latency)
    if (current?.client_name && current?.status && current.status !== status) {
      const { data: { session } } = await Config.supabase.auth.getSession()
      fetch(
        `${Config.SUPABASE_URL}/functions/v1/move-client-folder`,
        {
          method:  'POST',
          headers: {
            'Content-Type':  'application/json',
            'Authorization': `Bearer ${session?.access_token}`,
            'apikey':        Config.SUPABASE_ANON_KEY,
          },
          body: JSON.stringify({
            client_name: current.client_name,
            old_status:  current.status,
            new_status:  status,
          }),
        }
      ).catch(() => {/* Drive move failure is non-fatal */})
    }

    return result
  }

  async function getDeptUtilizationAvg(department, monthStart, monthEnd) {
    return supabase.rpc('get_dept_utilization_avg', {
      p_department:  department,
      p_month_start: monthStart,
      p_month_end:   monthEnd,
    })
  }

  // ── Phase 10: Attendance ─────────────────────────────────

  async function getEmployeeAttendance(employeeId, from, to) {
    return supabase.from('employee_attendance')
      .select('*')
      .eq('employee_id', employeeId)
      .gte('date', from)
      .lte('date', to)
      .order('date')
  }

  async function upsertAttendanceRecords(records) {
    // Cross-user bulk write goes through a SECURITY DEFINER RPC so it bypasses
    // the restrictive per-row SELECT policy while keeping read privacy intact.
    return supabase.rpc('upsert_employee_attendance', { p_records: records })
  }

  async function getAttendanceUploadLog() {
    return supabase.from('attendance_upload_log')
      .select('*, uploader:employees!uploaded_by(name)')
      .order('uploaded_at', { ascending: false })
      .limit(20)
  }

  async function insertAttendanceUploadLog(data) {
    return supabase.from('attendance_upload_log').insert(data).select().single()
  }

  async function getEmployeesWithBioId() {
    return supabase.from('employees')
      .select('id, name, bio_id')
      .not('bio_id', 'is', null)
      .eq('status', 'active')
  }

  return {
    getClients, getClient, getClientByProjectCode, updateEntityProfileType,
    getClientTeam, setClientTeam,
    getBrandBooks, saveBrandBook, deleteBrandBook,
    getEmployees, getEmployee, getTeamLeads, getAllEmployees,
    getTimesheetEntries, getTeamTimesheetEntries, getDirectReports, getAllSubordinates, upsertTimesheetEntry,
    insertMasterFolderFile, softDeleteMasterFolderFile,
    getMyReimbursements, getReimbursementInbox, getAllReimbursementsAdmin, getApprovedClaims,
    insertReimbursement, getMyPreApprovals, getEmployeesByDepartment, getEmployeesByRole,
    getAssets, createAsset, updateAsset, deleteAsset,
    getAssetHistory, addAssetHistory,
    getAllAssetRepairs, getAssetRepairsForAsset, createAssetRepair, updateAssetRepair,
    getAssetTypes, createAssetType, updateAssetType, deleteAssetType, getMyAssetRepairs,
    getAssetLocations, createAssetLocation, updateAssetLocation, deleteAssetLocation,
    uploadAssetPhoto, uploadKycDocument,
    getMyAssetRequests, createAssetRequest, getMySubmittedAssetRequests,
    getPendingManagerAssetRequests, getPendingHRAssetRequests, getAllAssetRequests,
    updateAssetRequest,
    createAssetReturnRequest, getAllAssetReturnRequests, getMyReturnRequests, updateAssetReturnRequest,
    getPendingApprovals, updateApproval,
    getTools, getToolAccess, getMyToolAccess, getToolRequests, getMyToolRequests,
    getUnreadNotifications, markNotificationRead, markAllNotificationsRead,
    createNotification, getRecentNotifications, savePushSubscription,
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
    getHomeLeaveData, getUpcomingHolidays, getUpcomingEventsData, getRecentAnnouncements,
    getPendingApprovalsCount, getWorkAnniversaries,
    getWhoIsOutToday, getWhoIsWfhToday, getPendingTimesheetApprovalsCount, getBirthdayEmployees,
    // Phase 7
    getDepartments, addDepartment, deleteDepartment,
    createDepartmentRpc, renameDepartmentRpc,
    getEmployeesFull, updateEmployeeFull, acknowledgePolicy, getEmployeeKyc,
    getOrgChart,
    getLeaveTypes, createLeaveType, updateLeaveType, deleteLeaveType,
    getLeaveCredits, getAllLeaveCredits, addLeaveCredit, deleteLeaveCredit,
    getMyLeaveRequests, getPendingLeaveApprovals, getHRLeaveQueue, getAllLeaveRequests,
    getApprovalHistoryLeave, getApprovalHistoryWfh,
    createLeaveRequest, updateLeaveRequest,
    getMyWfhRequests, getPendingWfhApprovals, getHRWfhQueue, getAllWfhRequests, getApprovedLeaveForEmployee,
    createWfhRequest, updateWfhRequest,
    getMyClientVisits, getPendingClientVisitApprovals, getHRClientVisitQueue,
    getApprovalHistoryClientVisit, getAllClientVisits, createClientVisit, updateClientVisit,
    getAttendanceConflicts,
    getWfhQuotas, createWfhQuota, deleteWfhQuota,
    getCompanyHolidays, addCompanyHoliday, deleteCompanyHoliday,
    getCompanyEvents, createCompanyEvent, updateCompanyEvent, deleteCompanyEvent,
    getAnnouncements, createAnnouncement, updateAnnouncement, deleteAnnouncement,
    uploadAnnouncementImage,
    getAnnouncementReactions, addReaction, removeReaction,
    getBadges, getEmployeeBadges, awardBadge, revokeEmployeeBadge,
    getRecentBadgeAwards, getAllEmployeeBadgeSummary,
    getPolicyCategories, addPolicyCategory, deletePolicyCategory,
    getPolicies, createPolicy, updatePolicy, deletePolicy,
    getInternalProjects, createInternalProject, updateInternalProject, setInternalProjectStatus, updateClientProjectDetails, setClientStatus,
    getDeptUtilizationAvg,
    // Phase 10 — Attendance
    getEmployeeAttendance, upsertAttendanceRecords,
    getAttendanceUploadLog, insertAttendanceUploadLog,
    getEmployeesWithBioId,
    // App Settings
    getAppSettings, upsertAppSetting,
    // Leave Credits
    updateLeaveCredit,
  }
})()
