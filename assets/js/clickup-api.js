/* ============================================================
   GROWTHIC ONE — ClickUp API Helper
   All ClickUp calls proxy through the Supabase Edge Function
   so the OAuth token never touches the browser.
   ============================================================ */

const ClickUpAPI = (() => {
  const _fn = () => `${Config.SUPABASE_URL}/functions/v1/clickup`

  /* ── Core caller ─────────────────────────────────────────── */
  async function _call(params) {
    const session = await Auth.getSession()
    if (!session) throw new Error('Not authenticated')

    const res = await fetch(_fn(), {
      method:  'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': `Bearer ${session.access_token}`,
        'apikey':        Config.SUPABASE_ANON_KEY,
      },
      body: JSON.stringify(params),
    })

    const data = await res.json()
    if (!res.ok) throw new Error(data.error || `ClickUp error ${res.status}`)
    return data
  }

  /* ── Auth ────────────────────────────────────────────────── */
  const getClientId  = ()      => _call({ action: 'get_client_id' })
  const exchangeCode = (code)  => _call({ action: 'oauth_exchange', code })
  const disconnect   = ()      => _call({ action: 'disconnect' })

  /* ── Raw proxy ───────────────────────────────────────────── */
  const api = (method, path, payload = null) =>
    _call({ action: 'api', method, path, ...(payload ? { payload } : {}) })

  /* ── Workspace ───────────────────────────────────────────── */
  const getTeams        = ()           => api('GET',  'team')
  const getMembers      = (teamId)     => api('GET',  `team/${teamId}/member`)

  /* ── Spaces / Folders / Lists ────────────────────────────── */
  const getSpaces       = (teamId)     => api('GET',  `team/${teamId}/space?archived=false`)
  const getFolders      = (spaceId)    => api('GET',  `space/${spaceId}/folder?archived=false`)
  const getSpaceLists   = (spaceId)    => api('GET',  `space/${spaceId}/list?archived=false`)
  const getFolderLists  = (folderId)   => api('GET',  `folder/${folderId}/list?archived=false`)
  const getList         = (listId)     => api('GET',  `list/${listId}`)

  /* ── Tasks ───────────────────────────────────────────────── */
  const getTasks = (listId, page = 0) =>
    api('GET', `list/${listId}/task?include_closed=false&subtasks=true&page=${page}`)

  const getMyTasks = (teamId, cuUserId, page = 0) =>
    api('GET', `team/${teamId}/task?assignees[]=${cuUserId}&include_closed=false&order_by=due_date&reverse=true&page=${page}`)

  const getTask         = (taskId)     => api('GET',  `task/${taskId}`)
  const createTask      = (listId, d)  => api('POST', `list/${listId}/task`, d)
  const updateTask      = (taskId, d)  => api('PUT',  `task/${taskId}`, d)
  const deleteTask      = (taskId)     => api('DELETE', `task/${taskId}`)

  /* ── Subtasks ────────────────────────────────────────────── */
  const createSubtask   = (parentId, listId, d) =>
    api('POST', `list/${listId}/task`, { ...d, parent: parentId })
  const updateSubtask   = (taskId, d)  => api('PUT',  `task/${taskId}`, d)

  /* ── Comments ────────────────────────────────────────────── */
  const getComments     = (taskId)     => api('GET',  `task/${taskId}/comment`)
  const createComment   = (taskId, text) =>
    api('POST', `task/${taskId}/comment`, { comment_text: text })

  /* ── Attachments ─────────────────────────────────────────── */
  // Attachments use multipart/form-data — handled separately via direct
  // ClickUp upload after fetching the token via a dedicated action.
  // For now attachments are read-only (fetched as part of task detail).

  return {
    getClientId, exchangeCode, disconnect,
    api,
    getTeams, getMembers,
    getSpaces, getFolders, getSpaceLists, getFolderLists, getList,
    getTasks, getMyTasks, getTask, createTask, updateTask, deleteTask,
    createSubtask, updateSubtask,
    getComments, createComment,
  }
})()
