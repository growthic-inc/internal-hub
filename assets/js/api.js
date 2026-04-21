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
      .select('id, client_name, project_code, category, status, created_at, client_entities(id, entity_name), client_platforms(id, platform_name)')
      .order('client_name')
    if (!includeArchived) query = query.neq('status', 'archived')
    return query
  }

  async function getClient(clientId) {
    return supabase
      .from('clients')
      .select('*, client_entities(*), client_platforms(*), scope_of_work(*)')
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
  }

  async function getTeamTimesheetEntries(from, to) {
    // RLS policy on timesheets filters to the team lead's reports automatically.
    return supabase
      .from('timesheets')
      .select('*, employees(name), clients(client_name, project_code)')
      .gte('date', from)
      .lte('date', to)
      .in('status', ['submitted', 'approved', 'rejected'])
      .order('date', { ascending: false })
  }

  async function upsertTimesheetEntry(entry) {
    return supabase.from('timesheets').upsert(entry).select().single()
  }

  /* ── Master Folders ───────────────────────────────────────── */
  async function getMasterFolderFiles(clientId, month, folderType) {
    let query = supabase
      .from('master_folder_files')
      .select('*')
      .eq('client_id', clientId)
      .eq('month', month)
      .is('deleted_at', null)
      .order('uploaded_at', { ascending: false })
    if (folderType) query = query.eq('folder_type', folderType)
    return query
  }

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

  return {
    getClients, getClient, getClientByProjectCode,
    getEmployees, getEmployee, getTeamLeads,
    getTimesheetEntries, getTeamTimesheetEntries, upsertTimesheetEntry,
    getMasterFolderFiles, insertMasterFolderFile, softDeleteMasterFolderFile,
    getReimbursements, getAllReimbursements, insertReimbursement,
    getAssets, getMyAssetRequests,
    getPendingApprovals, updateApproval,
    getUnreadNotifications, markNotificationRead, markAllNotificationsRead,
    getPerformanceData,
  }
})()
