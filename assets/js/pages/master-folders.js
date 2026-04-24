/* ============================================================
   CLIENT REPOSITORY — Phase 3
   Level 1: Three clickable folder cards per client/month.
   Level 2: File table with View / Download / Delete actions.
   Upload via Edge Function → Google Drive.
   ============================================================ */

const MasterFolders = (() => {

  const FOLDER_TYPES = [
    { value: 'approved_content', label: 'Content' },
    { value: 'creatives',        label: 'Creatives' },
    { value: 'reports',          label: 'Reports' },
  ]

  const CAN_FORCE_DELETE = ['super_admin', 'team_lead']

  let _user           = null
  let _clients        = []
  let _selectedClient = null
  let _selectedMonth  = _currentMonthValue()
  let _activeFolder   = null   // null = Level 1, string = folder type (Level 2)

  /* ── render ──────────────────────────────────────────────── */
  function render(user) {
    return `
      <div class="page-inner" style="max-width:1200px;">
        <div class="repo-toolbar">
          <div class="repo-filters">
            <!-- Client dropdown -->
            <div class="custom-select-wrap" id="client-select-wrap">
              <button class="custom-select-btn" id="client-select-btn">
                <span id="client-select-label">Select Client</span>
                <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>
              </button>
              <div class="custom-select-dropdown" id="client-select-dropdown" style="display:none;min-width:260px;">
                <input class="custom-select-search" id="client-search-input" placeholder="Search client…" autocomplete="off" />
                <div class="custom-select-list" id="client-select-list"></div>
              </div>
            </div>

            <!-- Entity dropdown (conditional) -->
            <select class="form-select" id="entity-select" style="display:none;min-width:160px;height:38px;"></select>

            <!-- Month dropdown -->
            <select class="form-select" id="month-select" style="min-width:160px;height:38px;">
              ${_buildMonthOptions()}
            </select>
          </div>

          <button class="btn btn--primary" id="upload-file-btn" style="display:none;">
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="17 8 12 3 7 8"></polyline><line x1="12" y1="3" x2="12" y2="15"></line></svg>
            Upload File
          </button>
        </div>

        <div id="repo-content">
          <div class="empty-state-full">
            <svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="var(--border)" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path></svg>
            <p>Select a client and month to view files</p>
          </div>
        </div>
      </div>
    `
  }

  /* ── init ────────────────────────────────────────────────── */
  async function init(user) {
    _user = user
    _selectedClient = null
    _activeFolder   = null

    const { data } = await API.getClients()
    _clients = data || []

    _bindClientDropdown()
    _bindMonthSelect()
    document.getElementById('upload-file-btn')?.addEventListener('click', _openUploadModal)
  }

  /* ── Client dropdown ─────────────────────────────────────── */
  function _bindClientDropdown() {
    const btn      = document.getElementById('client-select-btn')
    const dropdown = document.getElementById('client-select-dropdown')
    const search   = document.getElementById('client-search-input')
    const list     = document.getElementById('client-select-list')

    _renderClientList(_clients)

    btn.addEventListener('click', e => {
      e.stopPropagation()
      const open = dropdown.style.display !== 'none'
      dropdown.style.display = open ? 'none' : 'block'
      if (!open) { search.value = ''; _renderClientList(_clients); search.focus() }
    })

    search.addEventListener('input', () => {
      const q = search.value.toLowerCase()
      _renderClientList(_clients.filter(c => c.client_name.toLowerCase().includes(q)))
    })

    document.addEventListener('click', e => {
      if (!document.getElementById('client-select-wrap')?.contains(e.target)) {
        if (dropdown) dropdown.style.display = 'none'
      }
    })

    function _renderClientList(clients) {
      list.innerHTML = clients.length
        ? clients.map(c => `
            <div class="custom-select-item" data-id="${c.id}" data-name="${Utils.escapeHtml(c.client_name)}">
              <span>${Utils.escapeHtml(c.client_name)}</span>
              <span class="text-muted text-sm">${c.project_code}</span>
            </div>`).join('')
        : '<div class="custom-select-empty">No clients found</div>'

      list.querySelectorAll('.custom-select-item').forEach(item => {
        item.addEventListener('click', async () => {
          dropdown.style.display = 'none'
          document.getElementById('client-select-label').textContent = item.dataset.name

          const { data: full } = await API.getClient(item.dataset.id)
          _selectedClient = full ? { ..._clients.find(c => c.id === item.dataset.id), ...full } : _clients.find(c => c.id === item.dataset.id)
          _activeFolder   = null

          const entities    = _selectedClient.client_entities || []
          const entitySel   = document.getElementById('entity-select')
          if (entities.length > 1) {
            entitySel.innerHTML = entities.map(e =>
              `<option value="${e.id}">${Utils.escapeHtml(e.entity_name)}</option>`
            ).join('')
            entitySel.style.display = 'block'
          } else {
            entitySel.style.display = 'none'
          }

          document.getElementById('upload-file-btn').style.display = 'flex'
          _loadLevel1()
        })
      })
    }
  }

  function _bindMonthSelect() {
    const entitySel = document.getElementById('entity-select')
    document.getElementById('month-select')?.addEventListener('change', e => {
      _selectedMonth = e.target.value
      _activeFolder  = null
      if (_selectedClient) _loadLevel1()
    })
    entitySel?.addEventListener('change', () => {
      _activeFolder = null
      if (_selectedClient) _loadLevel1()
    })
  }

  function _selectedEntityId() {
    const el = document.getElementById('entity-select')
    return el && el.style.display !== 'none' ? (el.value || null) : null
  }

  /* ══════════════════════════════════════════════════════════
     LEVEL 1 — Folder cards
  ══════════════════════════════════════════════════════════ */
  async function _loadLevel1() {
    const content = document.getElementById('repo-content')
    content.innerHTML = '<p class="loading-text">Loading…</p>'

    const results = await Promise.all(
      FOLDER_TYPES.map(ft => API.getMasterFolderFiles(_selectedClient.id, _selectedMonth, ft.value))
    )
    console.log('[Repo] getMasterFolderFiles results:', results.map((r, i) => ({ folder: FOLDER_TYPES[i].value, count: r.data?.length, error: r.error?.message })))

    const monthLabel = _formatMonthDisplay(_selectedMonth)

    content.innerHTML = `
      <div class="folder-cards-grid">
        ${FOLDER_TYPES.map((ft, i) => {
          const files = results[i].data || []
          return _renderFolderCard(ft, files, monthLabel)
        }).join('')}
      </div>
    `

    FOLDER_TYPES.forEach((ft, i) => {
      const card  = content.querySelectorAll('.folder-card')[i]
      const files = results[i].data || []
      card.addEventListener('click', () => _loadLevel2(ft, files))
    })
  }

  function _renderFolderCard(folderType, files, monthLabel) {
    return `
      <div class="folder-card">
        <div class="folder-card-header">
          <div class="folder-card-icon">
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path></svg>
          </div>
          <div>
            <div class="folder-card-title">${folderType.label}</div>
            <div class="folder-card-count">
              ${files.length > 0 ? `${files.length} file${files.length !== 1 ? 's' : ''} in ${monthLabel}` : '0 files'}
            </div>
          </div>
          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-left:auto;flex-shrink:0;"><polyline points="9 18 15 12 9 6"></polyline></svg>
        </div>
        <div class="folder-card-body">
          ${files.length === 0
            ? '<p class="folder-empty">No files uploaded yet</p>'
            : files.slice(0, 3).map(f => `
                <div class="file-row" style="cursor:default;" onclick="event.stopPropagation()">
                  <div class="file-row-icon">${_fileIcon(f.file_type)}</div>
                  <div class="file-row-info">
                    <span class="file-row-name" style="cursor:default;color:var(--text);">${Utils.escapeHtml(Utils.truncate(f.file_name, 40))}</span>
                    <div class="file-row-meta">${Utils.formatDate(f.uploaded_at)}</div>
                  </div>
                </div>`).join('')
          }
          ${files.length > 3 ? `<p class="text-muted text-sm" style="padding:6px 0 0;">+${files.length - 3} more — click to view all</p>` : ''}
        </div>
      </div>
    `
  }

  /* ══════════════════════════════════════════════════════════
     LEVEL 2 — File table
  ══════════════════════════════════════════════════════════ */
  async function _loadLevel2(folderType, cachedFiles) {
    _activeFolder = folderType.value
    const content = document.getElementById('repo-content')

    const { data } = await API.getMasterFolderFiles(_selectedClient.id, _selectedMonth, folderType.value)
    const files = data || cachedFiles

    content.innerHTML = `
      <button class="folder-view-back" id="folder-back-btn">
        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"></polyline></svg>
        Back to folders
      </button>
      <div class="folder-view-title">
        <div class="folder-card-icon" style="width:32px;height:32px;">
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path></svg>
        </div>
        ${folderType.label}
        <span class="badge badge--muted" style="font-weight:500;">${_formatMonthDisplay(_selectedMonth)}</span>
      </div>

      <div class="section-card">
        <div class="section-card-body" style="padding:0;">
          ${files.length === 0 ? `
            <div class="empty-state-full" style="min-height:160px;">
              <p>No files uploaded in this folder yet</p>
            </div>
          ` : `
            <table class="data-table">
              <thead><tr>
                <th>File Name</th>
                <th>Type</th>
                <th>Uploaded By</th>
                <th>Date & Time</th>
                <th>Actions</th>
              </tr></thead>
              <tbody>
                ${files.map(f => _renderFileRow(f)).join('')}
              </tbody>
            </table>
          `}
        </div>
      </div>
    `

    document.getElementById('folder-back-btn')?.addEventListener('click', () => {
      _activeFolder = null
      _loadLevel1()
    })

    _bindLevel2Actions(files)
  }

  function _renderFileRow(file) {
    const isOwner    = file.uploaded_by === _user.id
    const hoursSince = (Date.now() - new Date(file.uploaded_at).getTime()) / 36e5
    const within24   = hoursSince < 24
    const canDelete  = (isOwner && within24) || CAN_FORCE_DELETE.includes(_user.role)

    return `
      <tr>
        <td>
          <div style="display:flex;align-items:center;gap:8px;">
            <span style="font-size:16px;flex-shrink:0;">${_fileIcon(file.file_type)}</span>
            <span style="font-weight:500;">${Utils.escapeHtml(file.file_name)}</span>
          </div>
        </td>
        <td><span class="badge badge--muted">${_fileTypeLabel(file.file_type)}</span></td>
        <td>${Utils.escapeHtml(file.employees?.name || '—')}</td>
        <td style="white-space:nowrap;">${_formatDateTime(file.uploaded_at)}</td>
        <td>
          <div style="display:flex;align-items:center;gap:6px;">
            <a href="${Utils.escapeHtml(file.drive_url)}" target="_blank" class="btn btn--xs btn--secondary">View</a>
            <a href="${Utils.escapeHtml(file.drive_url)}" target="_blank" download class="btn btn--xs btn--secondary">Download</a>
            ${canDelete ? `<button class="btn btn--xs btn--danger" data-delete-id="${file.id}" data-delete-name="${Utils.escapeHtml(file.file_name)}">Delete</button>` : ''}
          </div>
        </td>
      </tr>
    `
  }

  function _bindLevel2Actions(files) {
    document.querySelectorAll('[data-delete-id]').forEach(btn => {
      btn.addEventListener('click', () => _confirmDelete(btn.dataset.deleteId, btn.dataset.deleteName))
    })
  }

  function _confirmDelete(fileId, fileName) {
    Utils.openModal(`
      <div class="modal-header">
        <h3 class="modal-title">Delete File</h3>
        <button class="modal-close" onclick="Utils.closeModal()">
          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
        </button>
      </div>
      <div class="modal-body">
        <p>Delete <strong>${Utils.escapeHtml(fileName)}</strong>?</p>
        <p class="form-hint mt-2">This sets a deletion timestamp. Team Leads and Super Admins can still see deleted files in the audit log.</p>
      </div>
      <div class="modal-footer">
        <button class="btn btn-ghost" onclick="Utils.closeModal()">Cancel</button>
        <button class="btn btn-danger" id="confirm-delete-btn">Delete</button>
      </div>
    `)

    document.getElementById('confirm-delete-btn').addEventListener('click', async () => {
      const btn = document.getElementById('confirm-delete-btn')
      btn.disabled = true
      btn.textContent = 'Deleting…'

      const { error } = await API.softDeleteMasterFolderFile(fileId, _user.id)
      if (error) {
        Utils.showToast('Delete failed: ' + error.message, 'error')
        btn.disabled = false
        btn.textContent = 'Delete'
        return
      }

      Utils.closeModal()
      Utils.showToast('File deleted.', 'success')
      const ft = FOLDER_TYPES.find(f => f.value === _activeFolder)
      if (ft) _loadLevel2(ft, [])
    })
  }

  /* ── Upload Modal ────────────────────────────────────────── */
  function _openUploadModal() {
    if (!_selectedClient) { Utils.showToast('Select a client first.', 'error'); return }

    const entities    = _selectedClient.client_entities || []
    const hasEntities = entities.length > 1
    const folderOpts  = FOLDER_TYPES.map(ft =>
      `<option value="${ft.value}"${_activeFolder === ft.value ? ' selected' : ''}>${ft.label}</option>`
    ).join('')

    Utils.openModal(`
      <div class="modal-header">
        <h3 class="modal-title">Upload File</h3>
        <button class="modal-close" onclick="Utils.closeModal()">
          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
        </button>
      </div>
      <div class="modal-body">
        <div class="form-row">
          <div class="form-group">
            <label class="form-label">Client</label>
            <input class="form-input" type="text" value="${Utils.escapeHtml(_selectedClient.client_name)}" disabled />
          </div>
          <div class="form-group">
            <label class="form-label">Project Code</label>
            <input class="form-input" type="text" value="${Utils.escapeHtml(_selectedClient.project_code)}" disabled />
          </div>
        </div>
        ${hasEntities ? `
          <div class="form-group">
            <label class="form-label">Entity <span class="required">*</span></label>
            <select class="form-select" id="upload-entity">
              <option value="">— Select entity —</option>
              ${entities.map(e => `<option value="${e.id}">${Utils.escapeHtml(e.entity_name)}</option>`).join('')}
            </select>
          </div>` : ''}
        <div class="form-row">
          <div class="form-group">
            <label class="form-label">Folder</label>
            <select class="form-select" id="upload-folder-type">${folderOpts}</select>
          </div>
          <div class="form-group">
            <label class="form-label">Month</label>
            <select class="form-select" id="upload-month">${_buildMonthOptions()}</select>
          </div>
        </div>
        <div class="form-group">
          <label class="form-label">File <span class="required">*</span></label>
          <div class="drag-drop-zone" id="modal-drop-zone">
            <input type="file" id="upload-file-input" />
            <div class="drag-drop-icon">📁</div>
            <div class="drag-drop-label">Drop file here or <span>browse</span></div>
            <div class="drag-drop-hint">Max 25 MB</div>
            <div class="drag-drop-file-name" id="upload-file-name" style="display:none;"></div>
          </div>
        </div>
        <div id="upload-progress" style="display:none;margin-top:8px;">
          <div class="progress-bar"><div class="progress-fill" id="upload-fill" style="width:0%;transition:width 0.4s;"></div></div>
          <p class="form-hint" id="upload-status" style="margin-top:6px;">Uploading…</p>
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-ghost" onclick="Utils.closeModal()">Cancel</button>
        <button class="btn btn-primary" id="do-upload-btn">Upload</button>
      </div>
    `)

    const fileInput = document.getElementById('upload-file-input')
    fileInput?.addEventListener('change', e => {
      const f = e.target.files?.[0]
      const nameEl = document.getElementById('upload-file-name')
      if (f && nameEl) { nameEl.textContent = f.name; nameEl.style.display = 'block' }
    })

    document.getElementById('do-upload-btn')?.addEventListener('click', _doUpload)
  }

  async function _doUpload() {
    const fileInput  = document.getElementById('upload-file-input')
    const folderType = document.getElementById('upload-folder-type').value
    const monthSel   = document.getElementById('upload-month').value
    const entityEl   = document.getElementById('upload-entity')
    const entityId   = entityEl ? (entityEl.value || null) : null
    const file       = fileInput?.files?.[0]

    const entities = _selectedClient.client_entities || []
    if (entities.length > 1 && !entityId) { Utils.showToast('Please select an entity.', 'error'); return }
    if (!file)                             { Utils.showToast('Please select a file.', 'error'); return }
    if (file.size > 25 * 1024 * 1024)     { Utils.showToast('File exceeds 25 MB limit.', 'error'); return }

    const uploadBtn = document.getElementById('do-upload-btn')
    const progress  = document.getElementById('upload-progress')
    const fill      = document.getElementById('upload-fill')
    const statusTxt = document.getElementById('upload-status')

    uploadBtn.disabled     = true
    uploadBtn.textContent  = 'Uploading…'
    progress.style.display = 'block'
    fill.style.width       = '20%'
    statusTxt.textContent  = 'Sending to Google Drive…'

    const { data: { session } } = await Config.supabase.auth.getSession()
    const formData = new FormData()
    formData.append('file',        file)
    formData.append('client_id',   _selectedClient.id)
    formData.append('entity_id',   entityId || '')
    formData.append('month',       monthSel)
    formData.append('folder_type', folderType)

    fill.style.width = '55%'

    let res, result
    try {
      res    = await fetch(`${Config.SUPABASE_URL}/functions/v1/upload-to-drive`, {
        method: 'POST', headers: { Authorization: `Bearer ${session.access_token}` }, body: formData,
      })
      result = await res.json()
    } catch (err) {
      Utils.showToast('Network error: ' + err.message, 'error')
      uploadBtn.disabled = false; uploadBtn.textContent = 'Upload'; progress.style.display = 'none'
      return
    }

    fill.style.width = '100%'

    if (!res.ok || result.error) {
      const msg = result.error || result.msg || result.message || `HTTP ${res.status}`
      Utils.showToast('Upload failed: ' + msg, 'error')
      uploadBtn.disabled = false; uploadBtn.textContent = 'Upload'; progress.style.display = 'none'
      return
    }

    Utils.closeModal()
    Utils.showToast('File uploaded successfully.', 'success')
    _selectedMonth = monthSel
    _activeFolder  = null
    _loadLevel1()
  }

  /* ── Helpers ─────────────────────────────────────────────── */
  function _currentMonthValue() {
    const n = new Date()
    return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}`
  }

  function _buildMonthOptions() {
    const opts = []
    const now  = new Date()
    for (let i = 0; i < 12; i++) {
      const d   = new Date(now.getFullYear(), now.getMonth() - i, 1)
      const val = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
      const lbl = d.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })
      opts.push(`<option value="${val}"${i === 0 ? ' selected' : ''}>${lbl}</option>`)
    }
    return opts.join('')
  }

  function _formatMonthDisplay(yyyyMm) {
    const [y, m] = yyyyMm.split('-')
    return new Date(parseInt(y), parseInt(m) - 1, 1)
      .toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })
  }

  function _formatDateTime(ts) {
    if (!ts) return '—'
    const d = new Date(ts)
    return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
      + ' ' + d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })
  }

  function _fileIcon(mimeType) {
    if (!mimeType) return '📄'
    if (mimeType.startsWith('image/'))                                        return '🖼️'
    if (mimeType === 'application/pdf')                                       return '📕'
    if (mimeType.includes('spreadsheet') || mimeType.includes('excel'))      return '📊'
    if (mimeType.includes('presentation') || mimeType.includes('powerpoint'))return '📊'
    if (mimeType.includes('document') || mimeType.includes('word'))           return '📝'
    return '📄'
  }

  function _fileTypeLabel(mimeType) {
    if (!mimeType) return 'File'
    if (mimeType.startsWith('image/'))         return mimeType.split('/')[1].toUpperCase()
    if (mimeType === 'application/pdf')        return 'PDF'
    if (mimeType.includes('spreadsheet'))      return 'Excel'
    if (mimeType.includes('presentation'))     return 'PPT'
    if (mimeType.includes('document'))         return 'Word'
    return 'File'
  }

  return { render, init }
})()
