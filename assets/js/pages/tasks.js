/* ============================================================
   TASKS — ClickUp Integration
   Full task management backed by the ClickUp API.
   List view + Board view, task detail drawer, comments.
   ============================================================ */

const Tasks = (() => {

  /* ── State ──────────────────────────────────────────────── */
  let _user          = null
  let _workspaceId   = null
  let _members       = []          // all workspace members
  let _spaces        = []          // top-level spaces
  let _spaceTree     = {}          // spaceId → { folders:[], lists:[] }
  let _expandedSpaces  = new Set()
  let _expandedFolders = new Set()
  let _myTasksMode   = true
  let _activeListId  = null
  let _activeListName= ''
  let _listStatuses  = []          // status configs for active list
  let _tasks         = []
  let _taskPage      = 0
  let _hasMoreTasks  = false
  let _activeView    = 'list'      // 'list' | 'board'
  let _syncing          = false
  let _syncCooldown     = false
  let _cooldownSecs     = 0       // remaining seconds shown on the sync button
  let _cooldownInterval = null    // setInterval handle for countdown
  let _detailTaskId  = null
  let _detailTask    = null
  let _detailComments= []

  /* ── Priority map ───────────────────────────────────────── */
  const PRIORITY = {
    1: { label: 'Urgent', color: '#f50000' },
    2: { label: 'High',   color: '#ffcc00' },
    3: { label: 'Normal', color: '#6fddff' },
    4: { label: 'Low',    color: '#d8d8d8' },
  }

  /* ── render ─────────────────────────────────────────────── */
  function render() {
    return `<div class="page-inner" id="tasks-root" style="padding:0;height:calc(100vh - 60px);overflow:hidden;"></div>`
  }

  /* ── init ───────────────────────────────────────────────── */
  async function init(user) {
    _user = user
    const root = document.getElementById('tasks-root')
    if (!root) return

    if (!_user.clickup_user_id) {
      _renderNotConnected(root)
      return
    }

    root.innerHTML = `<div class="page-loading">Loading workspace…</div>`
    try {
      await _bootstrapWorkspace()
      _renderShell(root)
      await _loadMyTasks()
    } catch (e) {
      if (e.message === 'not_connected') {
        _renderNotConnected(root)
      } else {
        root.innerHTML = `<div class="empty-state-full"><p style="color:var(--danger);">Failed to load ClickUp workspace.<br><small>${Utils.escapeHtml(e.message)}</small></p></div>`
      }
    }
  }

  /* ── Not connected prompt ───────────────────────────────── */
  function _renderNotConnected(root) {
    root.innerHTML = `
      <div class="empty-state-full" style="gap:16px;">
        <div style="width:56px;height:56px;border-radius:14px;background:#7B68EE;display:flex;align-items:center;justify-content:center;">
          <svg width="28" height="28" viewBox="0 0 32 32" fill="none"><path d="M4.5 20.5L8.9 17c1.3 1.6 2.7 2.3 4.3 2.3 1.6 0 3-.7 4.3-2.3l4.4 3.5C19.6 23.5 16.9 25 13.2 25c-3.7 0-6.4-1.5-8.7-4.5z" fill="white"/><path d="M4.5 11.8l4.4 3.4c1.2-1.5 2.6-2.2 4.3-2.2 1.7 0 3.1.7 4.3 2.2l4.4-3.4C19.5 8.5 16.7 7 13.2 7 9.7 7 6.9 8.5 4.5 11.8z" fill="white" opacity=".7"/></svg>
        </div>
        <div style="text-align:center;">
          <h3 style="font-size:17px;font-weight:700;margin:0 0 6px;">Connect ClickUp</h3>
          <p style="font-size:14px;color:var(--text-muted);margin:0 0 20px;max-width:340px;">Link your ClickUp account to view and manage all your tasks without leaving Growthic.</p>
          <button class="btn btn--primary" id="tasks-connect-btn">Connect ClickUp →</button>
          <p style="font-size:12px;color:var(--text-muted);margin-top:10px;">Or go to <strong>Settings → Integrations</strong></p>
        </div>
      </div>
    `
    document.getElementById('tasks-connect-btn')?.addEventListener('click', async () => {
      try {
        const { client_id } = await ClickUpAPI.getClientId()
        const redirectUri = encodeURIComponent(
          (window.location.origin + window.location.pathname).replace(/\/$/, '') || window.location.origin
        )
        window.location.href = `https://app.clickup.com/api?client_id=${client_id}&redirect_uri=${redirectUri}`
      } catch (e) {
        console.error('[ClickUp connect]', e)
        Utils.showToast('ClickUp: ' + (e.message || 'Unknown error'), 'error')
      }
    })
  }

  /* ── Bootstrap: get workspace + members + spaces ────────── */
  async function _bootstrapWorkspace() {
    const teamsData = await ClickUpAPI.getTeams()
    if (!teamsData.teams?.length) throw new Error('No ClickUp workspace found.')
    const team   = teamsData.teams[0]
    _workspaceId = team.id

    // Members come back in the /team response — no separate API call needed.
    _members = (team.members || []).map(m => m.user || m)

    const spacesData = await ClickUpAPI.getSpaces(_workspaceId)
    _spaces = spacesData.spaces || []
  }

  /* ── Shell layout ───────────────────────────────────────── */
  function _renderShell(root) {
    root.innerHTML = `
      <div class="cu-layout">
        <!-- Left sidebar -->
        <aside class="cu-sidebar" id="cu-sidebar">
          <div class="cu-sidebar-inner">
            <div class="cu-nav-item cu-nav-item--active" id="cu-nav-my-tasks" style="cursor:pointer;">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
              My Tasks
            </div>
            <div class="cu-sidebar-spaces" id="cu-sidebar-spaces">
              ${_renderSidebarSpaces()}
            </div>
          </div>
        </aside>

        <!-- Main content -->
        <div class="cu-content" id="cu-main">
          <div class="page-loading">Loading tasks…</div>
        </div>
      </div>

      <!-- Task detail drawer (hidden until task clicked) -->
      <div class="cu-drawer" id="cu-drawer">
        <div id="cu-drawer-content"></div>
      </div>
      <div class="cu-drawer-overlay" id="cu-drawer-overlay" style="display:none;"></div>
    `
    _bindSidebar()
  }

  /* ── Sidebar spaces tree ────────────────────────────────── */
  function _renderSidebarSpaces() {
    return _spaces.map(space => `
      <div class="cu-space-group" data-space-id="${space.id}">
        <div class="cu-space-header" data-space-id="${space.id}" style="cursor:pointer;">
          <svg class="cu-chevron ${_expandedSpaces.has(space.id) ? 'cu-chevron--open' : ''}"
               width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"
               stroke-linecap="round" stroke-linejoin="round">
            <polyline points="9 18 15 12 9 6"/>
          </svg>
          <span class="cu-space-dot" style="background:${space.color || '#7B68EE'};"></span>
          <span class="cu-space-name">${Utils.escapeHtml(space.name)}</span>
        </div>
        <div class="cu-space-children ${_expandedSpaces.has(space.id) ? '' : 'cu-hidden'}" id="cu-space-children-${space.id}">
          <div class="cu-loading-children" style="padding:6px 0 6px 28px;font-size:12px;color:var(--text-muted);">Loading…</div>
        </div>
      </div>
    `).join('')
  }

  function _bindSidebar() {
    // My Tasks
    document.getElementById('cu-nav-my-tasks')?.addEventListener('click', async () => {
      _myTasksMode = true
      _activeListId = null
      document.querySelectorAll('.cu-nav-item--active').forEach(el => el.classList.remove('cu-nav-item--active'))
      document.getElementById('cu-nav-my-tasks')?.classList.add('cu-nav-item--active')
      document.querySelectorAll('.cu-list-item--active').forEach(el => el.classList.remove('cu-list-item--active'))
      await _loadMyTasks()
    })

    // Space expand/collapse
    document.querySelectorAll('.cu-space-header').forEach(hdr => {
      hdr.addEventListener('click', () => _toggleSpace(hdr.dataset.spaceId))
    })
  }

  async function _toggleSpace(spaceId) {
    const chevron  = document.querySelector(`.cu-space-header[data-space-id="${spaceId}"] .cu-chevron`)
    const children = document.getElementById(`cu-space-children-${spaceId}`)
    if (!children) return

    if (_expandedSpaces.has(spaceId)) {
      _expandedSpaces.delete(spaceId)
      children.classList.add('cu-hidden')
      chevron?.classList.remove('cu-chevron--open')
      return
    }

    _expandedSpaces.add(spaceId)
    children.classList.remove('cu-hidden')
    chevron?.classList.add('cu-chevron--open')

    // Lazy-load if not already fetched
    if (_spaceTree[spaceId]) {
      _renderSpaceChildren(spaceId)
      return
    }

    children.innerHTML = `<div style="padding:6px 0 6px 28px;font-size:12px;color:var(--text-muted);">Loading…</div>`
    try {
      const [foldersData, listsData] = await Promise.all([
        ClickUpAPI.getFolders(spaceId),
        ClickUpAPI.getSpaceLists(spaceId),
      ])
      _spaceTree[spaceId] = {
        folders: foldersData.folders || [],
        lists:   listsData.lists    || [],
      }
      _renderSpaceChildren(spaceId)
    } catch (e) {
      children.innerHTML = `<div style="padding:6px 28px;font-size:12px;color:var(--danger);">Failed to load</div>`
    }
  }

  function _renderSpaceChildren(spaceId) {
    const children = document.getElementById(`cu-space-children-${spaceId}`)
    if (!children) return
    const { folders, lists } = _spaceTree[spaceId]

    const folderHtml = folders.map(folder => `
      <div class="cu-folder-group">
        <div class="cu-folder-header" data-folder-id="${folder.id}" style="cursor:pointer;">
          <svg class="cu-chevron ${_expandedFolders.has(folder.id) ? 'cu-chevron--open' : ''}"
               width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"
               stroke-linecap="round" stroke-linejoin="round">
            <polyline points="9 18 15 12 9 6"/>
          </svg>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
               stroke-linecap="round" stroke-linejoin="round" style="opacity:.6;">
            <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
          </svg>
          <span>${Utils.escapeHtml(folder.name)}</span>
        </div>
        <div class="cu-folder-children ${_expandedFolders.has(folder.id) ? '' : 'cu-hidden'}" id="cu-folder-children-${folder.id}">
          ${(folder.lists || []).map(l => _listItemHtml(l)).join('')}
        </div>
      </div>
    `).join('')

    const listHtml = lists.map(l => _listItemHtml(l)).join('')
    children.innerHTML = folderHtml + listHtml

    // Bind folder toggles
    children.querySelectorAll('.cu-folder-header').forEach(hdr => {
      hdr.addEventListener('click', () => _toggleFolder(hdr.dataset.folderId, spaceId))
    })

    // Bind list clicks
    children.querySelectorAll('.cu-list-item').forEach(item => {
      item.addEventListener('click', () => _selectList(item.dataset.listId, item.dataset.listName))
    })
  }

  function _listItemHtml(list) {
    return `
      <div class="cu-list-item${_activeListId === list.id ? ' cu-list-item--active' : ''}"
           data-list-id="${list.id}" data-list-name="${Utils.escapeHtml(list.name)}"
           style="cursor:pointer;">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
             stroke-linecap="round" stroke-linejoin="round" style="opacity:.5;">
          <line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/>
          <line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/>
          <line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/>
        </svg>
        <span>${Utils.escapeHtml(list.name)}</span>
        ${list.task_count ? `<span class="cu-list-count">${list.task_count}</span>` : ''}
      </div>
    `
  }

  function _toggleFolder(folderId, spaceId) {
    const children = document.getElementById(`cu-folder-children-${folderId}`)
    const chevron  = document.querySelector(`.cu-folder-header[data-folder-id="${folderId}"] .cu-chevron`)
    if (!children) return

    if (_expandedFolders.has(folderId)) {
      _expandedFolders.delete(folderId)
      children.classList.add('cu-hidden')
      chevron?.classList.remove('cu-chevron--open')
    } else {
      _expandedFolders.add(folderId)
      children.classList.remove('cu-hidden')
      chevron?.classList.add('cu-chevron--open')

      // If folder lists weren't embedded, fetch them
      const space = _spaceTree[spaceId]
      const folder = space?.folders?.find(f => f.id === folderId)
      if (folder && !folder._listsLoaded) {
        // They were embedded in the getFolders response — nothing to do
        // If not present, fetch separately (edge case)
      }

      // Bind list item clicks inside this folder
      children.querySelectorAll('.cu-list-item').forEach(item => {
        item.addEventListener('click', () => _selectList(item.dataset.listId, item.dataset.listName))
      })
    }
  }

  /* ── Select a list and load its tasks ───────────────────── */
  async function _selectList(listId, listName) {
    _myTasksMode    = false
    _activeListId   = listId
    _activeListName = listName
    _taskPage       = 0
    _hasMoreTasks   = false

    // Update sidebar active state
    document.querySelectorAll('.cu-list-item--active').forEach(el => el.classList.remove('cu-list-item--active'))
    document.querySelectorAll(`.cu-list-item[data-list-id="${listId}"]`).forEach(el => el.classList.add('cu-list-item--active'))
    document.getElementById('cu-nav-my-tasks')?.classList.remove('cu-nav-item--active')

    // Close any open drawer
    _closeDrawer()

    const main = document.getElementById('cu-main')
    if (main) main.innerHTML = `<div class="page-loading">Loading tasks…</div>`

    try {
      const [tasksData, listData] = await Promise.all([
        ClickUpAPI.getTasks(listId, 0),
        ClickUpAPI.getList(listId),
      ])
      _tasks        = tasksData.tasks || []
      _listStatuses = listData.statuses || []
      _hasMoreTasks = tasksData.last_page === false
      _renderTaskContent()
    } catch (e) {
      if (document.getElementById('cu-main'))
        document.getElementById('cu-main').innerHTML =
          `<div class="empty-state-full"><p style="color:var(--danger);">${Utils.escapeHtml(e.message)}</p></div>`
    }
  }

  /* ── Load My Tasks ───────────────────────────────────────── */
  async function _loadMyTasks() {
    _myTasksMode  = true
    _activeListId = null
    _taskPage     = 0
    _hasMoreTasks = false
    const main = document.getElementById('cu-main')
    if (main) main.innerHTML = `<div class="page-loading">Loading your tasks…</div>`
    _closeDrawer()

    try {
      const data = await ClickUpAPI.getMyTasks(_workspaceId, _user.clickup_user_id, 0)
      _tasks        = data.tasks || []
      _hasMoreTasks = data.last_page === false
      _renderTaskContent()
    } catch (e) {
      if (document.getElementById('cu-main'))
        document.getElementById('cu-main').innerHTML =
          `<div class="empty-state-full"><p style="color:var(--danger);">${Utils.escapeHtml(e.message)}</p></div>`
    }
  }

  /* ── Sync (refresh) ─────────────────────────────────────── */
  async function _sync() {
    if (_syncCooldown || _syncing) return
    _syncing = true
    _syncCooldown = true

    const btn = document.getElementById('cu-sync-btn')
    if (btn) { btn.disabled = true; btn.textContent = 'Syncing…' }

    try {
      if (_myTasksMode) {
        const data = await ClickUpAPI.getMyTasks(_workspaceId, _user.clickup_user_id, 0)
        _tasks = data.tasks || []
        _hasMoreTasks = data.last_page === false
      } else if (_activeListId) {
        const data = await ClickUpAPI.getTasks(_activeListId, 0)
        _tasks = data.tasks || []
        _hasMoreTasks = data.last_page === false
      }
      _taskPage = 0

      // Invalidate space tree so next expand re-fetches fresh data
      _spaceTree = {}
      _expandedSpaces.clear()
      _expandedFolders.clear()
      const spacesEl = document.getElementById('cu-sidebar-spaces')
      if (spacesEl) {
        spacesEl.innerHTML = _renderSidebarSpaces()
        spacesEl.querySelectorAll('.cu-space-header').forEach(hdr => {
          hdr.addEventListener('click', () => _toggleSpace(hdr.dataset.spaceId))
        })
      }

      _renderTaskRows()
    } catch(e) {
      Utils.showToast('Sync failed: ' + e.message, 'error')
    } finally {
      _syncing = false
      _startCooldownTimer()
    }
  }

  /* ── Countdown timer shown on the sync button ────────────── */
  function _startCooldownTimer() {
    // Clear any existing timer (safety)
    if (_cooldownInterval) clearInterval(_cooldownInterval)

    const TOTAL = 45
    _cooldownSecs = TOTAL

    const _tick = () => {
      _cooldownSecs--
      // Use getElementById each tick — the button may have been re-rendered
      // when the user switched lists mid-cooldown
      const b = document.getElementById('cu-sync-btn')
      if (_cooldownSecs <= 0) {
        clearInterval(_cooldownInterval)
        _cooldownInterval = null
        _syncCooldown     = false
        _cooldownSecs     = 0
        if (b) { b.disabled = false; b.textContent = '↻ Sync' }
      } else {
        if (b) b.textContent = `↻ Sync (${_cooldownSecs}s)`
      }
    }

    // Update the button immediately to show first count
    const b = document.getElementById('cu-sync-btn')
    if (b) { b.disabled = true; b.textContent = `↻ Sync (${TOTAL}s)` }

    _cooldownInterval = setInterval(_tick, 1000)
  }

  /* ── Render task content area ───────────────────────────── */
  function _renderTaskContent() {
    const main = document.getElementById('cu-main')
    if (!main) return

    const title = _myTasksMode ? 'My Tasks' : Utils.escapeHtml(_activeListName)
    const canCreate = !_myTasksMode && _activeListId

    main.innerHTML = `
      <div class="cu-content-header">
        <div style="display:flex;align-items:center;gap:8px;">
          <button class="cu-sidebar-toggle" id="cu-sidebar-toggle" title="Toggle sidebar">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg>
          </button>
          <h2 style="font-size:16px;font-weight:700;margin:0;">${title}</h2>
          <span style="font-size:12px;color:var(--text-muted);">${_tasks.length} task${_tasks.length !== 1 ? 's' : ''}</span>
        </div>
        <div style="display:flex;align-items:center;gap:8px;">
          ${canCreate ? `<button class="btn btn--primary btn--sm" id="cu-create-btn">+ Add Task</button>` : ''}
          <button class="btn btn--ghost btn--sm" id="cu-sync-btn"
            ${_syncCooldown ? 'disabled' : ''}>
            ${_syncCooldown ? `↻ Sync (${_cooldownSecs}s)` : '↻ Sync'}
          </button>
          <div class="cu-view-toggle">
            <button class="cu-view-btn${_activeView === 'list'  ? ' cu-view-btn--active' : ''}" data-view="list"  title="List view">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>
            </button>
            <button class="cu-view-btn${_activeView === 'board' ? ' cu-view-btn--active' : ''}" data-view="board" title="Board view">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/></svg>
            </button>
          </div>
        </div>
      </div>
      <div id="cu-task-rows"></div>
    `

    document.getElementById('cu-sync-btn')?.addEventListener('click', _sync)
    document.getElementById('cu-create-btn')?.addEventListener('click', _openCreateModal)
    document.getElementById('cu-sidebar-toggle')?.addEventListener('click', () => {
      document.getElementById('cu-sidebar')?.classList.toggle('cu-sidebar--collapsed')
    })

    document.querySelectorAll('.cu-view-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        _activeView = btn.dataset.view
        document.querySelectorAll('.cu-view-btn').forEach(b => b.classList.remove('cu-view-btn--active'))
        btn.classList.add('cu-view-btn--active')
        _renderTaskRows()
      })
    })

    _renderTaskRows()
  }

  function _renderTaskRows() {
    const container = document.getElementById('cu-task-rows')
    if (!container) return

    if (!_tasks.length) {
      container.innerHTML = `<div class="empty-state-full" style="padding:60px 0;"><p style="color:var(--text-muted);">No tasks found.</p></div>`
      return
    }

    container.innerHTML = _activeView === 'board' ? _buildBoardView() : _buildListView()
    _bindTaskClicks()

    if (_hasMoreTasks) {
      const footer = document.createElement('div')
      footer.style.cssText = 'text-align:center;padding:16px 0 24px;'
      footer.innerHTML = `<button class="btn btn--ghost btn--sm" id="cu-load-more-btn">Load more tasks…</button>`
      container.appendChild(footer)
      document.getElementById('cu-load-more-btn')?.addEventListener('click', _loadMoreTasks)
    }
  }

  async function _loadMoreTasks() {
    const btn = document.getElementById('cu-load-more-btn')
    if (btn) { btn.disabled = true; btn.textContent = 'Loading…' }
    const nextPage = _taskPage + 1
    try {
      let data
      if (_myTasksMode) {
        data = await ClickUpAPI.getMyTasks(_workspaceId, _user.clickup_user_id, nextPage)
      } else {
        data = await ClickUpAPI.getTasks(_activeListId, nextPage)
      }
      _taskPage     = nextPage
      _tasks        = [..._tasks, ...(data.tasks || [])]
      _hasMoreTasks = data.last_page === false
      _renderTaskRows()
    } catch (e) {
      Utils.showToast('Failed to load more tasks.', 'error')
      if (btn) { btn.disabled = false; btn.textContent = 'Load more tasks…' }
    }
  }

  /* ══════════════════════════════════════════════════════════
     LIST VIEW
  ══════════════════════════════════════════════════════════ */
  function _buildListView() {
    const rows = _tasks.map(t => {
      const assignees     = (t.assignees || []).slice(0, 3)
      const extraAssign   = (t.assignees || []).length - 3
      const dueDate       = t.due_date ? _formatDate(Number(t.due_date)) : null
      const priority      = PRIORITY[t.priority?.priority || t.priority] || null
      const status        = t.status || {}
      const sc            = status.color || '#9d9d9d'
      const isOverdue     = t.due_date && Number(t.due_date) < Date.now() && status.type !== 'closed'
      const isClosed      = status.type === 'closed'

      return `
        <div class="cu-task-row" data-task-id="${t.id}">
          <div class="cu-tr-status">
            <span class="cu-status-pill" style="background:${sc}26;color:${sc};border-color:${sc}55;">
              ${Utils.escapeHtml((status.status || '—').toUpperCase())}
            </span>
          </div>
          <div class="cu-tr-name${isClosed ? ' cu-tr-name--closed' : ''}">
            <span class="cu-tr-title">${Utils.escapeHtml(t.name)}</span>
            ${t.subtasks?.length ? `<span class="cu-subtask-badge">↳ ${t.subtasks.length}</span>` : ''}
          </div>
          ${_myTasksMode ? `
            <div class="cu-tr-list">
              <span>${Utils.escapeHtml(t.list?.name || t.space?.name || '')}</span>
            </div>` : ''}
          <div class="cu-tr-assignees">
            ${assignees.map(a => _avatarSmall(a)).join('')}
            ${extraAssign > 0 ? `<span class="cu-avatar-more">+${extraAssign}</span>` : ''}
          </div>
          <div class="cu-tr-due${isOverdue ? ' cu-overdue' : ''}">
            ${dueDate ? `
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0;opacity:.6;"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
              <span>${dueDate}</span>` : `<span style="opacity:.3;">—</span>`}
          </div>
          <div class="cu-tr-priority">
            ${priority
              ? `<svg width="13" height="13" viewBox="0 0 24 24" fill="${priority.color}" title="${priority.label}"><path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><line x1="4" y1="22" x2="4" y2="15" stroke="${priority.color}" stroke-width="2" stroke-linecap="round"/></svg>`
              : `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" style="opacity:.2;" title="No priority"><path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><line x1="4" y1="22" x2="4" y2="15" stroke-width="2"/></svg>`}
          </div>
        </div>
      `
    }).join('')

    return `
      <div class="cu-list-view">
        <div class="cu-list-header">
          <div class="cu-lh-status">Status</div>
          <div class="cu-lh-name">Name</div>
          ${_myTasksMode ? `<div class="cu-lh-list">List</div>` : ''}
          <div class="cu-lh-assignees">Assignees</div>
          <div class="cu-lh-due">Due date</div>
          <div class="cu-lh-priority">Priority</div>
        </div>
        ${rows}
      </div>
    `
  }

  /* ══════════════════════════════════════════════════════════
     BOARD VIEW
  ══════════════════════════════════════════════════════════ */
  function _buildBoardView() {
    const statuses = _listStatuses.length
      ? _listStatuses
      : [...new Map(_tasks.map(t => [t.status?.status, t.status])).values()].filter(Boolean)

    const columns = statuses.map(s => {
      const sc       = s.color || '#aaaaaa'
      const colTasks = _tasks.filter(t =>
        (t.status?.status || '').toLowerCase() === (s.status || '').toLowerCase()
      )

      const cards = colTasks.map(t => {
        const assignees = (t.assignees || []).slice(0, 3)
        const dueDate   = t.due_date ? _formatDate(Number(t.due_date)) : null
        const priority  = PRIORITY[t.priority?.priority || t.priority] || null
        const isOverdue = t.due_date && Number(t.due_date) < Date.now() && s.type !== 'closed'

        return `
          <div class="cu-board-card" data-task-id="${t.id}">
            <div class="cu-card-top">
              <div class="cu-card-name">${Utils.escapeHtml(t.name)}</div>
              ${priority ? `<svg class="cu-card-priority" width="12" height="12" viewBox="0 0 24 24" fill="${priority.color}" title="${priority.label}"><path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><line x1="4" y1="22" x2="4" y2="15" stroke="${priority.color}" stroke-width="2" stroke-linecap="round"/></svg>` : ''}
            </div>
            ${t.list?.name && _myTasksMode ? `<div class="cu-card-list-label">${Utils.escapeHtml(t.list.name)}</div>` : ''}
            <div class="cu-card-footer">
              <div class="cu-card-assignees">${assignees.map(a => _avatarSmall(a)).join('')}</div>
              <div style="display:flex;align-items:center;gap:5px;">
                ${t.subtasks?.length ? `<span class="cu-subtask-badge">↳ ${t.subtasks.length}</span>` : ''}
                ${dueDate ? `<span class="cu-card-due${isOverdue ? ' cu-overdue' : ''}">${dueDate}</span>` : ''}
              </div>
            </div>
          </div>
        `
      }).join('')

      return `
        <div class="cu-board-col" style="--col-color:${sc};">
          <div class="cu-board-col-header">
            <span class="cu-col-dot" style="background:${sc};"></span>
            <span class="cu-col-name">${Utils.escapeHtml((s.status || '—').toUpperCase())}</span>
            <span class="cu-col-count">${colTasks.length}</span>
          </div>
          <div class="cu-board-col-body">
            ${cards || `<div class="cu-col-empty">No tasks</div>`}
          </div>
        </div>
      `
    }).join('')

    return `<div class="cu-board">${columns}</div>`
  }

  /* ── Bind task clicks (list + board) ────────────────────── */
  function _bindTaskClicks() {
    document.querySelectorAll('.cu-task-row, .cu-board-card').forEach(el => {
      el.addEventListener('click', () => _openDrawer(el.dataset.taskId))
    })
  }

  /* ══════════════════════════════════════════════════════════
     TASK DETAIL DRAWER
  ══════════════════════════════════════════════════════════ */

  // Named handler so it can be removed on close
  function _onEscKey(e) {
    if (e.key !== 'Escape') return
    const tag = document.activeElement?.tagName
    // If user is typing in a field: blur it first, let them press Escape
    // a second time to close the drawer (standard two-step UX)
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') {
      document.activeElement.blur()
      return
    }
    _closeDrawer()
  }

  async function _openDrawer(taskId) {
    _detailTaskId = taskId
    const drawer  = document.getElementById('cu-drawer')
    const overlay = document.getElementById('cu-drawer-overlay')
    const content = document.getElementById('cu-drawer-content')
    if (!drawer || !content) return

    content.innerHTML = `<div class="page-loading" style="padding:40px;">Loading…</div>`
    drawer.classList.add('cu-drawer--open')
    if (overlay) overlay.style.display = 'block'

    // Bind overlay click and Escape key to close
    overlay?.addEventListener('click', _closeDrawer, { once: true })
    document.addEventListener('keydown', _onEscKey)

    try {
      const [taskData, commentsData] = await Promise.all([
        ClickUpAPI.getTask(taskId),
        ClickUpAPI.getComments(taskId),
      ])
      _detailTask     = taskData
      _detailComments = commentsData.comments || []
      _renderDrawerContent()
    } catch (e) {
      content.innerHTML = `<div style="padding:20px;color:var(--danger);">Failed to load task.</div>`
    }
  }

  function _closeDrawer() {
    const drawer  = document.getElementById('cu-drawer')
    const overlay = document.getElementById('cu-drawer-overlay')
    drawer?.classList.remove('cu-drawer--open')
    if (overlay) overlay.style.display = 'none'
    document.removeEventListener('keydown', _onEscKey)
    _detailTaskId = null
    _detailTask   = null
  }

  function _renderDrawerContent() {
    const content = document.getElementById('cu-drawer-content')
    if (!content || !_detailTask) return
    const t = _detailTask

    const status   = t.status   || {}
    const priority = PRIORITY[t.priority?.priority || t.priority] || null
    const dueDate  = t.due_date ? _formatDate(Number(t.due_date)) : null

    // Build status options from list statuses or derive from task
    const statusOptions = _listStatuses.length
      ? _listStatuses
      : [status]

    const subtasksHtml = (t.subtasks || []).map(s => `
      <div class="cu-subtask-row" data-subtask-id="${s.id}">
        <button class="cu-subtask-check${s.status?.type === 'closed' ? ' cu-subtask-check--done' : ''}"
                data-task-id="${s.id}" data-done="${s.status?.type === 'closed'}">
          ${s.status?.type === 'closed'
            ? `<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg>`
            : ''}
        </button>
        <span style="font-size:13px;${s.status?.type === 'closed' ? 'text-decoration:line-through;color:var(--text-muted);' : ''}">${Utils.escapeHtml(s.name)}</span>
        <a href="https://app.clickup.com/t/${s.id}" target="_blank" rel="noopener" class="cu-open-link" title="Open in ClickUp">↗</a>
      </div>
    `).join('')

    const commentsHtml = _detailComments.map(c => {
      const text = c.comment_text || (c.comment || []).map((b) => b.text || '').join('')
      const user = c.user || {}
      const date = c.date ? _formatDate(Number(c.date)) : ''
      return `
        <div class="cu-comment">
          <div class="cu-comment-avatar">${user.profilePicture
            ? `<img src="${Utils.escapeHtml(user.profilePicture)}" alt="">`
            : Utils.getInitials(user.username || '?')}</div>
          <div style="flex:1;min-width:0;">
            <div style="display:flex;align-items:center;gap:8px;margin-bottom:3px;">
              <span style="font-size:13px;font-weight:600;">${Utils.escapeHtml(user.username || '?')}</span>
              <span style="font-size:11px;color:var(--text-muted);">${date}</span>
            </div>
            <div style="font-size:13px;white-space:pre-wrap;word-break:break-word;">${Utils.escapeHtml(text)}</div>
          </div>
        </div>
      `
    }).join('')

    const attachments = t.attachments || []

    content.innerHTML = `
      <div class="cu-drawer-header">
        <input class="cu-task-name-input" id="cu-task-name-input"
               value="${Utils.escapeHtml(t.name)}"
               placeholder="Task name…"
               autocomplete="off">
        <div style="display:flex;align-items:center;gap:6px;flex-shrink:0;">
          <a href="https://app.clickup.com/t/${t.id}" target="_blank" rel="noopener" class="btn btn--ghost btn--sm">↗ ClickUp</a>
          <button class="btn-icon" id="cu-delete-btn" title="Delete task" style="color:var(--danger);">
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>
          </button>
          <button class="modal-close" id="cu-drawer-close">
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>
      </div>

      <div class="cu-drawer-body">

        <!-- Meta grid -->
        <div class="cu-meta-grid">
          <div class="cu-meta-row">
            <span class="cu-meta-label">Status</span>
            <div class="cu-status-dd" id="cu-status-dd">
              <button class="cu-status-dd-btn" id="cu-status-dd-btn" type="button">
                <span class="cu-status-dot" style="background:${status.color || '#ccc'};"></span>
                <span id="cu-status-dd-label">${Utils.escapeHtml(status.status || '—')}</span>
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" style="margin-left:auto;opacity:.5;flex-shrink:0;"><polyline points="6 9 12 15 18 9"/></svg>
              </button>
              <div class="cu-status-dd-menu" id="cu-status-dd-menu">
                ${statusOptions.map(s => `
                  <div class="cu-status-dd-item${s.status === status.status ? ' cu-status-dd-item--active' : ''}"
                       data-status="${Utils.escapeHtml(s.status)}"
                       data-color="${Utils.escapeHtml(s.color || '#ccc')}">
                    <span class="cu-status-dot" style="background:${s.color || '#ccc'};"></span>
                    ${Utils.escapeHtml(s.status || '—')}
                  </div>
                `).join('')}
              </div>
            </div>
          </div>
          <div class="cu-meta-row">
            <span class="cu-meta-label">Priority</span>
            <select class="cu-meta-select" id="cu-priority-select">
              <option value="">No priority</option>
              ${Object.entries(PRIORITY).map(([v, p]) => `
                <option value="${v}" ${(t.priority?.priority || t.priority) == v ? 'selected' : ''}>${p.label}</option>
              `).join('')}
            </select>
          </div>
          <div class="cu-meta-row">
            <span class="cu-meta-label">Due Date</span>
            <input type="date" class="cu-meta-input" id="cu-due-date"
              value="${t.due_date ? new Date(Number(t.due_date)).toISOString().slice(0,10) : ''}">
          </div>
          <div class="cu-meta-row" style="align-items:flex-start;">
            <span class="cu-meta-label" style="padding-top:4px;">Assignees</span>
            <div id="cu-assignees-wrap">
              ${_renderAssigneeEditor(t.assignees || [])}
            </div>
          </div>
        </div>

        <!-- Description -->
        <div class="cu-section">
          <div class="cu-section-title">Description</div>
          <textarea class="cu-desc-textarea" id="cu-task-desc"
                    placeholder="Add a description…"
                    rows="3">${Utils.escapeHtml(t.description || '')}</textarea>
        </div>

        <!-- Attachments (read-only) -->
        ${attachments.length ? `
          <div class="cu-section">
            <div class="cu-section-title">
              Attachments
              <span style="font-size:11px;color:var(--text-muted);margin-left:4px;">${attachments.length}</span>
            </div>
            ${attachments.map(a => `
              <a href="${Utils.escapeHtml(a.url)}" target="_blank" rel="noopener" class="cu-attachment">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0;opacity:.6;"><path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/><polyline points="14 2 14 8 20 8"/></svg>
                <span>${Utils.escapeHtml(a.title || a.filename || 'Attachment')}</span>
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="margin-left:auto;flex-shrink:0;opacity:.5;"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
              </a>
            `).join('')}
          </div>
        ` : ''}

        <!-- Subtasks -->
        <div class="cu-section">
          <div class="cu-section-title">
            Subtasks
            <span style="font-size:11px;color:var(--text-muted);margin-left:4px;">${(t.subtasks || []).length}</span>
            <button class="btn btn--xs btn--ghost" id="cu-add-subtask-btn" style="margin-left:auto;font-size:11px;">+ Add</button>
          </div>
          <div id="cu-subtasks-list">
            ${subtasksHtml || `<div style="font-size:12px;color:var(--text-muted);padding:4px 0;">No subtasks</div>`}
          </div>
          <div id="cu-add-subtask-form" style="display:none;margin-top:8px;">
            <div style="display:flex;gap:6px;">
              <input type="text" class="form-input" id="cu-subtask-input" placeholder="Subtask name…" style="flex:1;font-size:13px;height:34px;">
              <button class="btn btn--primary btn--sm" id="cu-subtask-save">Add</button>
            </div>
          </div>
        </div>

        <!-- Comments -->
        <div class="cu-section">
          <div class="cu-section-title">Comments <span style="font-size:11px;color:var(--text-muted);margin-left:4px;">${_detailComments.length}</span></div>
          <div id="cu-comments-list">
            ${commentsHtml || `<div style="font-size:12px;color:var(--text-muted);padding:4px 0;">No comments yet.</div>`}
          </div>
          <div style="margin-top:12px;display:flex;gap:8px;align-items:flex-start;">
            <textarea class="form-input" id="cu-comment-input" rows="2"
              placeholder="Add a comment…"
              style="flex:1;resize:vertical;font-size:13px;"></textarea>
            <button class="btn btn--primary btn--sm" id="cu-comment-send" style="margin-top:1px;">Send</button>
          </div>
        </div>

      </div>
    `

    _bindDrawerActions(t)
  }

  function _renderAssigneeEditor(assignees) {
    const chips = assignees.map(a => `
      <span class="cu-assignee-chip">
        ${_avatarSmall(a)}
        <span style="font-size:12px;">${Utils.escapeHtml(a.username || a.email || '?')}</span>
        <button class="cu-assignee-remove" data-user-id="${a.id}" title="Remove">×</button>
      </span>
    `).join('')

    const addBtn = `
      <button class="cu-assignee-add" id="cu-add-assignee-btn" title="Add assignee">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
      </button>
    `
    return `<div class="cu-assignees-row">${chips}${addBtn}</div>`
  }

  function _bindDrawerActions(task) {
    // Close on X
    document.getElementById('cu-drawer-close')?.addEventListener('click', _closeDrawer)

    // ── Task name inline edit ────────────────────────────────
    const nameInput = document.getElementById('cu-task-name-input')
    if (nameInput) {
      const _saveName = async () => {
        const newName = nameInput.value.trim()
        if (!newName || newName === _detailTask.name) return
        try {
          await ClickUpAPI.updateTask(task.id, { name: newName })
          _detailTask.name = newName
          const listTask = _tasks.find(t => t.id === task.id)
          if (listTask) listTask.name = newName
          _renderTaskRows()
          Utils.showToast('Task renamed.', 'success')
        } catch (err) {
          nameInput.value = _detailTask.name
          Utils.showToast('Failed to rename task.', 'error')
        }
      }
      nameInput.addEventListener('blur', _saveName)
      nameInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter')  { e.preventDefault(); nameInput.blur() }
        if (e.key === 'Escape') { nameInput.value = _detailTask.name; nameInput.blur() }
      })
    }

    // ── Description inline edit ──────────────────────────────
    const descArea = document.getElementById('cu-task-desc')
    if (descArea) {
      // Auto-grow height as user types
      const _resize = () => { descArea.style.height = 'auto'; descArea.style.height = descArea.scrollHeight + 'px' }
      descArea.addEventListener('input', _resize)
      _resize()

      descArea.addEventListener('blur', async () => {
        const newDesc = descArea.value.trim()
        if (newDesc === (_detailTask.description || '').trim()) return
        try {
          await ClickUpAPI.updateTask(task.id, { description: newDesc })
          _detailTask.description = newDesc
          Utils.showToast('Description saved.', 'success')
        } catch (err) {
          descArea.value = _detailTask.description || ''
          Utils.showToast('Failed to save description.', 'error')
        }
      })
    }

    // ── Delete task ──────────────────────────────────────────
    document.getElementById('cu-delete-btn')?.addEventListener('click', () => {
      Utils.openModal(`
        <div class="modal-header">
          <h3 class="modal-title">Delete Task</h3>
          <button class="modal-close" onclick="Utils.closeModal()">
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>
        <div class="modal-body">
          <p style="font-size:14px;margin:0 0 6px;">Delete <strong>${Utils.escapeHtml(task.name)}</strong>?</p>
          <p style="font-size:12px;color:var(--text-muted);margin:0;">This permanently deletes the task in ClickUp and cannot be undone.</p>
        </div>
        <div class="modal-footer">
          <button class="btn btn--ghost" onclick="Utils.closeModal()">Cancel</button>
          <button class="btn btn--danger" id="cu-delete-confirm">Delete</button>
        </div>
      `)
      document.getElementById('cu-delete-confirm')?.addEventListener('click', async () => {
        try {
          await ClickUpAPI.deleteTask(task.id)
          _tasks = _tasks.filter(t => t.id !== task.id)
          Utils.closeModal()
          _closeDrawer()
          _renderTaskRows()
          Utils.showToast('Task deleted.', 'success')
        } catch (err) { Utils.showToast('Failed to delete task.', 'error') }
      })
    })

    // ── Custom status dropdown ───────────────────────────────
    const ddBtn  = document.getElementById('cu-status-dd-btn')
    const ddMenu = document.getElementById('cu-status-dd-menu')
    if (ddBtn && ddMenu) {
      ddBtn.addEventListener('click', (e) => {
        e.stopPropagation()
        const isOpen = ddMenu.classList.toggle('cu-status-dd-menu--open')
        if (isOpen) {
          // Close on next outside click
          const _outside = (ev) => {
            if (!document.getElementById('cu-status-dd')?.contains(ev.target)) {
              ddMenu.classList.remove('cu-status-dd-menu--open')
              document.removeEventListener('click', _outside)
            }
          }
          setTimeout(() => document.addEventListener('click', _outside), 0)
        }
      })

      ddMenu.querySelectorAll('.cu-status-dd-item').forEach(item => {
        item.addEventListener('click', async () => {
          const newStatus = item.dataset.status
          const newColor  = item.dataset.color
          ddMenu.classList.remove('cu-status-dd-menu--open')

          // Optimistic UI update
          const label = document.getElementById('cu-status-dd-label')
          const dot   = ddBtn.querySelector('.cu-status-dot')
          if (label) label.textContent = newStatus
          if (dot)   dot.style.background = newColor
          ddMenu.querySelectorAll('.cu-status-dd-item').forEach(i => i.classList.remove('cu-status-dd-item--active'))
          item.classList.add('cu-status-dd-item--active')

          try {
            await ClickUpAPI.updateTask(task.id, { status: newStatus })
            const listTask = _tasks.find(t => t.id === task.id)
            if (listTask) listTask.status = { status: newStatus, color: newColor }
            _detailTask.status = { status: newStatus, color: newColor, type: item.dataset.type || '' }
            _renderTaskRows()
            Utils.showToast('Status updated.', 'success')
          } catch (err) { Utils.showToast('Failed to update status.', 'error') }
        })
      })
    }

    // Priority change
    document.getElementById('cu-priority-select')?.addEventListener('change', async (e) => {
      try {
        await ClickUpAPI.updateTask(task.id, { priority: e.target.value ? Number(e.target.value) : null })
        Utils.showToast('Priority updated.', 'success')
      } catch (err) { Utils.showToast('Failed to update priority.', 'error') }
    })

    // Due date change
    document.getElementById('cu-due-date')?.addEventListener('change', async (e) => {
      try {
        const ts = e.target.value ? new Date(e.target.value).getTime() : null
        await ClickUpAPI.updateTask(task.id, { due_date: ts })
        Utils.showToast('Due date updated.', 'success')
      } catch (err) { Utils.showToast('Failed to update due date.', 'error') }
    })

    // Subtask toggle (complete/incomplete)
    document.querySelectorAll('.cu-subtask-check').forEach(btn => {
      btn.addEventListener('click', async () => {
        const isDone = btn.dataset.done === 'true'
        // To reopen: use the first non-closed status from the list; fall back to
        // 'open' which ClickUp accepts as a generic alias on most workspaces.
        const reopenStatus = _listStatuses.find(s => s.type !== 'closed')?.status || 'open'
        const newStatus = isDone ? reopenStatus : 'complete'
        try {
          await ClickUpAPI.updateSubtask(btn.dataset.taskId, { status: newStatus })
          // Reload task detail
          const [taskData, commentsData] = await Promise.all([
            ClickUpAPI.getTask(_detailTaskId),
            ClickUpAPI.getComments(_detailTaskId),
          ])
          _detailTask     = taskData
          _detailComments = commentsData.comments || []
          _renderDrawerContent()
        } catch (err) { Utils.showToast('Failed to update subtask.', 'error') }
      })
    })

    // Add subtask
    document.getElementById('cu-add-subtask-btn')?.addEventListener('click', () => {
      const form = document.getElementById('cu-add-subtask-form')
      if (form) { form.style.display = form.style.display === 'none' ? 'block' : 'none' }
      document.getElementById('cu-subtask-input')?.focus()
    })

    document.getElementById('cu-subtask-save')?.addEventListener('click', async () => {
      const input = document.getElementById('cu-subtask-input')
      const name  = input?.value.trim()
      if (!name) return
      try {
        const listId = task.list?.id || _activeListId
        if (!listId) { Utils.showToast('Cannot add subtask — list ID unknown.', 'error'); return }
        await ClickUpAPI.createSubtask(task.id, listId, { name })
        // Reload
        _detailTask = await ClickUpAPI.getTask(_detailTaskId)
        _renderDrawerContent()
      } catch (err) { Utils.showToast('Failed to add subtask.', 'error') }
    })

    // Remove assignee
    document.querySelectorAll('.cu-assignee-remove').forEach(btn => {
      btn.addEventListener('click', async () => {
        const userId = Number(btn.dataset.userId)
        try {
          await ClickUpAPI.updateTask(task.id, { assignees: { rem: [userId] } })
          // Update shared state then full re-render so no stale listeners stack up
          _detailTask.assignees = (_detailTask.assignees || []).filter(a => a.id !== userId)
          _renderDrawerContent()
        } catch (err) { Utils.showToast('Failed to remove assignee.', 'error') }
      })
    })

    // Add assignee
    document.getElementById('cu-add-assignee-btn')?.addEventListener('click', () => {
      _openAssigneePicker(task)
    })

    // Send comment
    document.getElementById('cu-comment-send')?.addEventListener('click', async () => {
      const input   = document.getElementById('cu-comment-input')
      const text    = input?.value.trim()
      if (!text) return
      const btn = document.getElementById('cu-comment-send')
      btn.disabled    = true
      btn.textContent = 'Sending…'
      try {
        await ClickUpAPI.createComment(task.id, text)
        input.value = ''
        // Reload comments
        const commentsData  = await ClickUpAPI.getComments(task.id)
        _detailComments = commentsData.comments || []
        _renderDrawerContent()
      } catch (err) {
        Utils.showToast('Failed to send comment.', 'error')
        btn.disabled    = false
        btn.textContent = 'Send'
      }
    })
  }

  /* ── Assignee picker ─────────────────────────────────────── */
  function _openAssigneePicker(task) {
    const current = new Set((task.assignees || []).map(a => a.id))
    const options = _members
      .filter(m => !current.has(m.id))
      .map(m => `
        <div class="cu-member-row" data-user-id="${m.id}" data-username="${Utils.escapeHtml(m.username || '')}" style="cursor:pointer;display:flex;align-items:center;gap:8px;padding:8px 12px;border-radius:6px;">
          ${_avatarSmall(m)}
          <span style="font-size:13px;">${Utils.escapeHtml(m.username || m.email || '?')}</span>
        </div>
      `).join('')

    Utils.openModal(`
      <div class="modal-header">
        <h3 class="modal-title">Add Assignee</h3>
        <button class="modal-close" onclick="Utils.closeModal()">
          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>
      <div class="modal-body" style="padding:0;max-height:300px;overflow-y:auto;">
        ${options || `<div style="padding:16px;color:var(--text-muted);font-size:13px;">All workspace members already assigned.</div>`}
      </div>
    `)

    document.querySelectorAll('.cu-member-row').forEach(row => {
      row.addEventListener('click', async () => {
        const userId = Number(row.dataset.userId)
        Utils.closeModal()
        try {
          await ClickUpAPI.updateTask(task.id, { assignees: { add: [userId] } })
          const member = _members.find(m => m.id === userId)
          if (member) _detailTask.assignees = [...(_detailTask.assignees || []), member]
          _renderDrawerContent()
        } catch (err) { Utils.showToast('Failed to add assignee.', 'error') }
      })
    })
  }

  /* ══════════════════════════════════════════════════════════
     CREATE TASK MODAL
  ══════════════════════════════════════════════════════════ */
  function _openCreateModal() {
    if (!_activeListId) return

    const memberOptions = _members.map(m => `
      <option value="${m.id}">${Utils.escapeHtml(m.username || m.email || '?')}</option>
    `).join('')

    Utils.openModal(`
      <div class="modal-header">
        <h3 class="modal-title">Add Task — ${Utils.escapeHtml(_activeListName)}</h3>
        <button class="modal-close" onclick="Utils.closeModal()">
          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>
      <div class="modal-body">
        <div class="form-group">
          <label class="form-label">Task Name <span style="color:var(--danger);">*</span></label>
          <input class="form-input" id="cu-new-name" placeholder="What needs to be done?" autofocus>
        </div>
        <div class="form-row">
          <div class="form-group">
            <label class="form-label">Assignee</label>
            <select class="form-input" id="cu-new-assignee">
              <option value="">Unassigned</option>
              ${memberOptions}
            </select>
          </div>
          <div class="form-group">
            <label class="form-label">Priority</label>
            <select class="form-input" id="cu-new-priority">
              <option value="">No priority</option>
              ${Object.entries(PRIORITY).map(([v, p]) => `<option value="${v}">${p.label}</option>`).join('')}
            </select>
          </div>
        </div>
        <div class="form-group">
          <label class="form-label">Due Date</label>
          <input type="date" class="form-input" id="cu-new-due">
        </div>
        <div class="form-group">
          <label class="form-label">Description</label>
          <textarea class="form-input" id="cu-new-desc" rows="3" placeholder="Optional description…" style="resize:vertical;"></textarea>
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn btn--ghost" onclick="Utils.closeModal()">Cancel</button>
        <button class="btn btn--primary" id="cu-create-save">Create Task</button>
      </div>
    `)

    document.getElementById('cu-create-save')?.addEventListener('click', async () => {
      const name     = document.getElementById('cu-new-name')?.value.trim()
      const assignee = document.getElementById('cu-new-assignee')?.value
      const priority = document.getElementById('cu-new-priority')?.value
      const dueRaw   = document.getElementById('cu-new-due')?.value
      const desc     = document.getElementById('cu-new-desc')?.value.trim()

      if (!name) {
        Utils.showToast('Task name is required.', 'error')
        return
      }

      const btn = document.getElementById('cu-create-save')
      btn.disabled    = true
      btn.textContent = 'Creating…'

      const payload = {
        name,
        ...(desc     ? { description: desc }                           : {}),
        ...(assignee ? { assignees: [Number(assignee)] }               : {}),
        ...(priority ? { priority: Number(priority) }                  : {}),
        ...(dueRaw   ? { due_date: new Date(dueRaw).getTime(), due_date_time: false } : {}),
      }

      try {
        const newTask = await ClickUpAPI.createTask(_activeListId, payload)
        _tasks.unshift(newTask)
        _renderTaskRows()
        Utils.closeModal()
        Utils.showToast('Task created.', 'success')
      } catch (err) {
        btn.disabled    = false
        btn.textContent = 'Create Task'
        Utils.showToast('Failed to create task: ' + err.message, 'error')
      }
    })
  }

  /* ── Helpers ─────────────────────────────────────────────── */
  function _avatarSmall(user) {
    if (!user) return ''
    const initials = Utils.getInitials(user.username || user.email || '?')
    return user.profilePicture
      ? `<img src="${Utils.escapeHtml(user.profilePicture)}" class="cu-avatar-sm" alt="${Utils.escapeHtml(user.username || '')}" title="${Utils.escapeHtml(user.username || '')}">`
      : `<span class="cu-avatar-sm cu-avatar-sm--initials" title="${Utils.escapeHtml(user.username || '')}">${initials}</span>`
  }

  function _formatDate(ms) {
    if (!ms || isNaN(ms)) return '—'
    return new Date(ms).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
  }

  return { render, init }
})()

/* ── Module registry ─────────────────────────────────────── */
ModuleRegistry.register({
  key:       'tasks',
  routeId:   'tasks',
  label:     'Tasks',
  order:     3,
  icon:      `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 11 12 14 22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>`,
  getModule: () => Tasks,
})
