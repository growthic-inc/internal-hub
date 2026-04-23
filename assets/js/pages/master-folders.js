/* ============================================================
   CLIENT REPOSITORY — Phase 3
   Three fixed folder cards per client per month.
   Files uploaded via Edge Function → Google Drive.
   ============================================================ */

const MasterFolders = (() => {

  const FOLDER_TYPES = [
    { value: 'approved_content', label: 'Content' },
    { value: 'creatives',        label: 'Creatives' },
    { value: 'reports',          label: 'Reports' },
  ]

  // Roles that can delete any file after the 24-hour window
  const CAN_FORCE_DELETE = ['super_admin', 'team_lead']

  let _user           = null
  let _clients        = []
  let _selectedClient = null
  let _selectedMonth  = _currentMonthValue()

  /* ── render ──────────────────────────────────────────────── */
  function render(user) {
    const months = _buildMonthOptions()
    return `
      <div class="page-inner">
        <div class="page-toolbar repo-toolbar">
          <div class="repo-filters">
            <div class="custom-select-wrap" id="client-select-wrap">
              <button class="custom-select-btn" id="client-select-btn">
                <span id="client-select-label">Select Client</span>
                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>
              </button>
              <div class="custom-select-dropdown" id="client-select-dropdown" style="display:none;">
                <input type="text" class="custom-select-search" id="client-search-input" placeholder="Search client…" autocomplete="off" />
                <div class="custom-select-list" id="client-select-list"></div>
              </div>
            </div>
            <select class="form-select" id="month-select">
              ${months}
            </select>
          </div>
          <button class="btn btn--primary" id="upload-file-btn" style="display:none;">
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right:6px;"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="17 8 12 3 7 8"></polyline><line x1="12" y1="3" x2="12" y2="15"></line></svg>
            Upload File
          </button>
        </div>
        <div id="repo-content" class="mt-4">
          <div class="empty-state-full">
            <p>Please select a client to view folders</p>
          </div>
        </div>
      </div>
    `
  }

  /* ── init ────────────────────────────────────────────────── */
  async function init(user) {
    _user = user
    _selectedClient = null

    const { data } = await API.getClients()
    _clients = data || []

    _bindClientDropdown()
    _bindMonthSelect()
    document.getElementById('upload-file-btn')?.addEventListener('click', _openUploadModal)
  }

  /* ── Custom searchable client dropdown ───────────────────── */
  function _bindClientDropdown() {
    const btn      = document.getElementById('client-select-btn')
    const dropdown = document.getElementById('client-select-dropdown')
    const search   = document.getElementById('client-search-input')
    const list     = document.getElementById('client-select-list')

    _renderClientList(_clients)

    btn.addEventListener('click', e => {
      e.stopPropagation()
      const isOpen = dropdown.style.display !== 'none'
      dropdown.style.display = isOpen ? 'none' : 'block'
      if (!isOpen) { search.value = ''; _renderClientList(_clients); search.focus() }
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
            <div class="custom-select-item" data-client-id="${c.id}" data-client-name="${Utils.escapeHtml(c.client_name)}">
              <span>${Utils.escapeHtml(c.client_name)}</span>
              <span class="text-muted text-sm">${c.project_code}</span>
            </div>
          `).join('')
        : '<div class="custom-select-empty">No clients found</div>'

      list.querySelectorAll('.custom-select-item').forEach(item => {
        item.addEventListener('click', () => {
          const id = item.dataset.clientId
          _selectedClient = _clients.find(c => c.id === id)
          document.getElementById('client-select-label').textContent = item.dataset.clientName
          dropdown.style.display = 'none'
          document.getElementById('upload-file-btn').style.display = 'flex'
          _loadFolders()
        })
      })
    }
  }

  function _bindMonthSelect() {
    document.getElementById('month-select')?.addEventListener('change', e => {
      _selectedMonth = e.target.value
      if (_selectedClient) _loadFolders()
    })
  }

  /* ── Folder view ─────────────────────────────────────────── */
  async function _loadFolders() {
    const content = document.getElementById('repo-content')
    if (!content || !_selectedClient) return
    content.innerHTML = '<p class="loading-text">Loading folders…</p>'

    // Fetch full client record to get entities
    const { data: clientFull } = await API.getClient(_selectedClient.id)
    if (clientFull) _selectedClient = { ..._selectedClient, ...clientFull }

    const results = await Promise.all(
      FOLDER_TYPES.map(ft => API.getMasterFolderFiles(_selectedClient.id, _selectedMonth, ft.value))
    )

    content.innerHTML = `
      <div class="folder-cards-grid">
        ${FOLDER_TYPES.map((ft, i) => {
          const files = results[i].data || []
          return _renderFolderCard(ft, files)
        }).join('')}
      </div>
    `

    _bindDeleteButtons()
  }

  function _renderFolderCard(folderType, files) {
    return `
      <div class="folder-card">
        <div class="folder-card-header">
          <div class="folder-card-icon">
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path></svg>
          </div>
          <div>
            <h3 class="folder-card-title">${folderType.label}</h3>
            <p class="folder-card-count">${files.length} file${files.length !== 1 ? 's' : ''}</p>
          </div>
        </div>
        <div class="folder-card-body">
          ${files.length === 0
            ? '<p class="folder-empty">No files uploaded yet</p>'
            : files.map(f => _renderFileRow(f)).join('')
          }
        </div>
      </div>
    `
  }

  function _renderFileRow(file) {
    const isOwner    = file.uploaded_by === _user.id
    const hoursSince = (Date.now() - new Date(file.uploaded_at).getTime()) / 36e5
    const canDelete  = (isOwner && hoursSince < 24) || CAN_FORCE_DELETE.includes(_user.role)

    return `
      <div class="file-row">
        <div class="file-row-icon">${_fileIcon(file.file_type)}</div>
        <div class="file-row-info">
          <a href="${Utils.escapeHtml(file.drive_url)}" target="_blank" class="file-row-name link">
            ${Utils.escapeHtml(file.file_name)}
          </a>
          <div class="file-row-meta">
            ${Utils.escapeHtml(file.employees?.name || '—')} · ${Utils.formatDate(file.uploaded_at)}
            ${file.entity_id ? ` · ${Utils.escapeHtml(file.client_entities?.entity_name || '')}` : ''}
          </div>
        </div>
        ${canDelete ? `
          <button class="btn btn--xs btn--ghost file-delete-btn"
            data-file-id="${file.id}"
            data-file-name="${Utils.escapeHtml(file.file_name)}"
            title="Delete file">
            <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"></path></svg>
          </button>
        ` : ''}
      </div>
    `
  }

  function _fileIcon(mimeType) {
    if (!mimeType) return '📄'
    if (mimeType.startsWith('image/'))                            return '🖼️'
    if (mimeType === 'application/pdf')                           return '📕'
    if (mimeType.includes('spreadsheet') || mimeType.includes('excel'))       return '📊'
    if (mimeType.includes('presentation') || mimeType.includes('powerpoint')) return '📊'
    if (mimeType.includes('document') || mimeType.includes('word'))           return '📝'
    return '📄'
  }

  function _bindDeleteButtons() {
    document.querySelectorAll('.file-delete-btn').forEach(btn => {
      btn.addEventListener('click', () => _confirmDelete(btn.dataset.fileId, btn.dataset.fileName))
    })
  }

  function _confirmDelete(fileId, fileName) {
    Utils.openModal(`
      <div class="modal-header"><h3>Delete File</h3></div>
      <div class="modal-body">
        <p>Delete <strong>${Utils.escapeHtml(fileName)}</strong>?</p>
        <p class="form-hint mt-2">The file record will be soft-deleted. This cannot be undone by regular employees after 24 hours.</p>
      </div>
      <div class="modal-footer">
        <button class="btn btn--ghost" onclick="Utils.closeModal()">Cancel</button>
        <button class="btn btn--danger" id="confirm-delete-file-btn">Delete</button>
      </div>
    `)

    document.getElementById('confirm-delete-file-btn').addEventListener('click', async () => {
      const btn = document.getElementById('confirm-delete-file-btn')
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
      _loadFolders()
    })
  }

  /* ── Upload Modal ────────────────────────────────────────── */
  function _openUploadModal() {
    if (!_selectedClient) { Utils.showToast('Select a client first.', 'error'); return }

    const entities    = _selectedClient.client_entities || []
    const hasEntities = entities.length > 0
    const folderOpts  = FOLDER_TYPES.map(ft =>
      `<option value="${ft.value}">${ft.label}</option>`
    ).join('')

    Utils.openModal(`
      <div class="modal-header"><h3>Upload File</h3></div>
      <div class="modal-body">
        <div class="form-group">
          <label>Client</label>
          <input type="text" value="${Utils.escapeHtml(_selectedClient.client_name)}" disabled class="form-input" />
        </div>
        <div class="form-row">
          <div class="form-group">
            <label>Project Code</label>
            <input type="text" value="${Utils.escapeHtml(_selectedClient.project_code)}" disabled class="form-input" />
          </div>
          <div class="form-group">
            <label>Month</label>
            <input type="text" value="${_formatMonthDisplay(_selectedMonth)}" disabled class="form-input" />
          </div>
        </div>
        ${hasEntities ? `
          <div class="form-group">
            <label>Entity <span class="required">*</span></label>
            <select id="upload-entity" class="form-select">
              <option value="">— Select entity —</option>
              ${entities.map(e => `<option value="${e.id}">${Utils.escapeHtml(e.entity_name)}</option>`).join('')}
            </select>
          </div>
        ` : ''}
        <div class="form-group">
          <label>Folder</label>
          <select id="upload-folder-type" class="form-select">${folderOpts}</select>
        </div>
        <div class="form-group">
          <label>File <span class="required">*</span></label>
          <input type="file" id="upload-file-input" class="form-input" />
          <p class="form-hint">Max file size: 25 MB</p>
        </div>
        <div id="upload-progress" style="display:none;margin-top:12px;">
          <div class="progress-bar"><div class="progress-fill" id="upload-progress-fill" style="width:0%"></div></div>
          <p class="form-hint" id="upload-status-text" style="margin-top:6px;">Uploading…</p>
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn btn--ghost" onclick="Utils.closeModal()">Cancel</button>
        <button class="btn btn--primary" id="do-upload-btn">Upload</button>
      </div>
    `)

    document.getElementById('do-upload-btn').addEventListener('click', _doUpload)
  }

  async function _doUpload() {
    const fileInput  = document.getElementById('upload-file-input')
    const folderType = document.getElementById('upload-folder-type').value
    const entityEl   = document.getElementById('upload-entity')
    const entityId   = entityEl ? entityEl.value || null : null
    const file       = fileInput?.files?.[0]

    const hasEntities = (_selectedClient.client_entities || []).length > 0
    if (hasEntities && !entityId) {
      Utils.showToast('Please select an entity.', 'error')
      return
    }
    if (!file) {
      Utils.showToast('Please select a file.', 'error')
      return
    }
    if (file.size > 25 * 1024 * 1024) {
      Utils.showToast('File exceeds the 25 MB limit.', 'error')
      return
    }

    const uploadBtn = document.getElementById('do-upload-btn')
    const progress  = document.getElementById('upload-progress')
    const fill      = document.getElementById('upload-progress-fill')
    const statusTxt = document.getElementById('upload-status-text')

    uploadBtn.disabled = true
    uploadBtn.textContent = 'Uploading…'
    progress.style.display = 'block'
    fill.style.width = '20%'
    statusTxt.textContent = 'Sending to Google Drive…'

    const { data: { session } } = await Config.supabase.auth.getSession()

    const formData = new FormData()
    formData.append('file',        file)
    formData.append('client_id',   _selectedClient.id)
    formData.append('entity_id',   entityId || '')
    formData.append('month',       _selectedMonth)
    formData.append('folder_type', folderType)

    fill.style.width = '55%'

    let res, result
    try {
      res    = await fetch(`${Config.SUPABASE_URL}/functions/v1/upload-to-drive`, {
        method:  'POST',
        headers: { Authorization: `Bearer ${session.access_token}` },
        body:    formData,
      })
      result = await res.json()
    } catch (err) {
      Utils.showToast('Network error: ' + err.message, 'error')
      uploadBtn.disabled = false
      uploadBtn.textContent = 'Upload'
      progress.style.display = 'none'
      return
    }

    fill.style.width = '100%'

    if (!res.ok || result.error) {
      Utils.showToast('Upload failed: ' + (result.error || 'Unknown error'), 'error')
      uploadBtn.disabled = false
      uploadBtn.textContent = 'Upload'
      progress.style.display = 'none'
      return
    }

    Utils.closeModal()
    Utils.showToast('File uploaded successfully.', 'success')
    _loadFolders()
  }

  /* ── Helpers ─────────────────────────────────────────────── */
  function _currentMonthValue() {
    const now = new Date()
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
  }

  function _buildMonthOptions() {
    const opts = []
    const now  = new Date()
    for (let i = 0; i < 12; i++) {
      const d     = new Date(now.getFullYear(), now.getMonth() - i, 1)
      const value = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
      const label = d.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })
      opts.push(`<option value="${value}"${i === 0 ? ' selected' : ''}>${label}</option>`)
    }
    return opts.join('')
  }

  function _formatMonthDisplay(yyyyMm) {
    const [y, m] = yyyyMm.split('-')
    return new Date(parseInt(y), parseInt(m) - 1, 1)
      .toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })
  }

  return { render, init }
})()
