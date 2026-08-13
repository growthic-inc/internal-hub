/* ============================================================
   POLICIES — HRMS admin console
   Relocated from /home — HR create/edit/delete, category
   management. Self-service browsing/viewing stays in Growthic
   One; this is the Tier 3 (HR/admin) half of the same module.
   ============================================================ */

const PoliciesModule = (() => {

  /* ── State ─────────────────────────────────────────────────── */
  let _user            = null
  let _categories      = []
  let _policies        = []
  let _isHR            = false
  let _activeCategory  = null   // null = All
  let _searchQuery     = ''

  // Form state
  let _editingPolicyId    = null
  let _pendingFile        = null
  let _existingFileUrl    = null
  let _existingFileName   = null

  /* ── Icons ──────────────────────────────────────────────────── */
  const ICON_FILE = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="14" height="14"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>`
  const ICON_EXT  = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="12" height="12"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>`
  const ICON_UPLOAD = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="14" height="14"><polyline points="16 16 12 12 8 16"/><line x1="12" y1="12" x2="12" y2="21"/><path d="M20.39 18.39A5 5 0 0 0 18 9h-1.26A8 8 0 1 0 3 16.3"/></svg>`
  const ICON_CLOSE = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" width="18" height="18"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`

  /* ── File upload helper ─────────────────────────────────────── */
  async function _uploadPolicyFile(file, categoryName) {
    const { data: { session } } = await Config.supabase.auth.getSession()
    const form = new FormData()
    form.append('file', file)
    form.append('category_name', categoryName)
    const res = await fetch(`${Config.SUPABASE_URL}/functions/v1/upload-policy-file`, {
      method:  'POST',
      headers: { Authorization: `Bearer ${session.access_token}` },
      body:    form,
    })
    const payload = await res.json()
    if (!res.ok || !payload.driveUrl) throw new Error(payload.error || 'Upload failed')
    return { driveUrl: payload.driveUrl, driveFileId: payload.driveFileId }
  }

  /* ── render ─────────────────────────────────────────────────── */
  function render(user) {
    _user = user
    _isHR = HRMSApp.hasAccess('policies', 'manage_policies', 'can_manage')

    return `
      <div class="page-inner">
        <div class="page-header">
          <h2 style="margin:0;font-size:18px;font-weight:700;color:var(--text);">Policies</h2>
          <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
            ${_isHR ? `
            <button class="btn btn-secondary btn-sm" id="pol-manage-cats-btn">Manage Categories</button>
            <button class="btn btn-primary btn-sm" id="pol-new-btn">+ New Policy</button>
            ` : ''}
          </div>
        </div>
        <div id="pol-main-layout" class="page-loading">Loading policies…</div>
      </div>`
  }

  /* ── init ───────────────────────────────────────────────────── */
  async function init(user) {
    _user = user
    _isHR = HRMSApp.hasAccess('policies', 'manage_policies', 'can_manage')
    _activeCategory = null
    _searchQuery    = ''

    if (_isHR) {
      document.getElementById('pol-new-btn')?.addEventListener('click', () => _openPolicyModal(null))
      document.getElementById('pol-manage-cats-btn')?.addEventListener('click', _openCategoriesModal)
    }

    await _loadData()
  }

  /* ── Data ───────────────────────────────────────────────────── */
  async function _loadData() {
    const [catResult, polResult] = await Promise.all([
      API.getPolicyCategories(),
      API.getPolicies(),
    ])

    if (catResult.error) { Utils.showToast('Failed to load categories', 'error'); return }
    if (polResult.error) { Utils.showToast('Failed to load policies', 'error'); return }

    _categories = catResult.data || []
    _policies   = (polResult.data || []).filter(p => _isHR || p.published)

    _renderLayout()
  }

  /* ── Layout ─────────────────────────────────────────────────── */
  function _renderLayout() {
    const el = document.getElementById('pol-main-layout')
    if (!el) return

    el.className = ''
    el.innerHTML = `
      <div class="policies-layout">
        <aside class="policies-sidebar" id="pol-sidebar">
          ${_sidebarHTML()}
        </aside>
        <div class="policies-main" id="pol-content">
          <div style="margin-bottom:16px;">
            <div class="search-wrap">
              <span class="search-icon">
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
              </span>
              <input class="form-input" id="pol-search" type="search" placeholder="Search policies…" value="${Utils.escapeHtml(_searchQuery)}">
            </div>
          </div>
          <div id="pol-list">${_policiesListHTML()}</div>
        </div>
      </div>`

    _bindLayoutEvents()
  }

  function _sidebarHTML() {
    const cats = [{ id: null, name: 'All' }, ..._categories]
    return cats.map(cat => {
      const active = _activeCategory === cat.id ? ' pol-cat-item--active' : ''
      return `<div class="pol-cat-item${active}" data-cat-id="${cat.id === null ? '__all__' : cat.id}">${Utils.escapeHtml(cat.name)}</div>`
    }).join('')
  }

  function _filteredPolicies() {
    const q = _searchQuery.toLowerCase()
    return _policies.filter(p => {
      if (_activeCategory !== null && p.category_id !== _activeCategory) return false
      if (q && !p.title.toLowerCase().includes(q)) return false
      return true
    })
  }

  function _policiesListHTML() {
    const list = _filteredPolicies()
    if (!list.length) {
      return `<div class="pol-empty empty-state"><h3>No policies found</h3><p>Try a different category or search term.</p></div>`
    }
    return list.map(_cardHTML).join('')
  }

  function _cardHTML(p) {
    const isDraft    = !p.published
    const catName    = p.category?.name || '—'
    const updatedAt  = Utils.formatDate(p.updated_at || p.created_at)

    return `
      <div class="pol-card${isDraft ? ' pol-card--draft' : ''}">
        <div style="flex:1;min-width:0;">
          <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:4px;">
            <span class="pol-card-title">${Utils.escapeHtml(p.title)}</span>
            ${isDraft ? `<span class="pol-draft-badge">DRAFT</span>` : ''}
          </div>
          <div class="pol-card-meta">
            <span>${Utils.escapeHtml(catName)}</span>
            <span style="color:var(--text-muted);">·</span>
            <span>Updated ${updatedAt}</span>
          </div>
        </div>
        <div class="pol-card-actions">
          ${p.file_url ? `
          <a href="${Utils.escapeHtml(p.file_url)}" target="_blank" rel="noopener noreferrer"
             class="btn btn-secondary btn-sm">
            ${ICON_FILE} View Document ${ICON_EXT}
          </a>
          ` : `<span style="font-size:12px;color:var(--text-muted);">No file</span>`}
          ${_isHR ? `
          <button class="btn btn-secondary btn-sm pol-edit-btn" data-pol-id="${p.id}">Edit</button>
          <button class="btn btn-sm pol-delete-btn" style="background:var(--danger,#E53E3E);color:#fff;border-color:var(--danger,#E53E3E);" data-pol-id="${p.id}">Delete</button>
          ` : ''}
        </div>
      </div>`
  }

  /* ── Bind Layout Events ─────────────────────────────────────── */
  function _bindLayoutEvents() {
    // Category sidebar
    document.querySelectorAll('.pol-cat-item').forEach(item => {
      item.addEventListener('click', () => {
        const raw = item.dataset.catId
        _activeCategory = raw === '__all__' ? null : raw
        document.querySelectorAll('.pol-cat-item').forEach(i => i.classList.remove('pol-cat-item--active'))
        item.classList.add('pol-cat-item--active')
        _rerenderList()
      })
    })

    // Search
    const searchEl = document.getElementById('pol-search')
    if (searchEl) {
      searchEl.addEventListener('input', Utils.debounce(e => {
        _searchQuery = e.target.value
        _rerenderList()
      }, 200))
    }

    // Edit / Delete (HR only)
    if (_isHR) {
      _bindCardActions()
    }
  }

  function _bindCardActions() {
    document.querySelectorAll('.pol-edit-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const p = _policies.find(x => x.id === btn.dataset.polId)
        if (p) _openPolicyModal(p)
      })
    })
    document.querySelectorAll('.pol-delete-btn').forEach(btn => {
      btn.addEventListener('click', () => _deletePolicy(btn.dataset.polId))
    })
  }

  function _rerenderList() {
    const listEl = document.getElementById('pol-list')
    if (!listEl) return
    listEl.innerHTML = _policiesListHTML()
    if (_isHR) _bindCardActions()
  }

  /* ── Delete Policy ──────────────────────────────────────────── */
  async function _deletePolicy(id) {
    if (!confirm('Delete this policy? This cannot be undone.')) return
    const { error } = await API.deletePolicy(id)
    if (error) { Utils.showToast('Failed to delete policy', 'error'); return }
    Utils.showToast('Policy deleted', 'success')
    await _loadData()
  }

  /* ── Create / Edit Policy Modal ─────────────────────────────── */
  function _openPolicyModal(policy) {
    _editingPolicyId  = policy?.id || null
    _pendingFile      = null
    _existingFileUrl  = policy?.file_url  || null
    _existingFileName = policy?.file_name || null

    const isEdit      = !!policy
    const isPublished = isEdit ? !!policy.published : false

    const catOptions = _categories.map(c =>
      `<option value="${c.id}" ${policy?.category_id === c.id ? 'selected' : ''}>${Utils.escapeHtml(c.name)}</option>`
    ).join('')

    Utils.openModal(`
      <div class="modal-header">
        <h3 class="modal-title">${isEdit ? 'Edit Policy' : 'New Policy'}</h3>
        <button class="modal-close" onclick="Utils.closeModal()">${ICON_CLOSE}</button>
      </div>

      <div class="modal-body">
        <div id="pol-form-err" class="alert alert-danger" style="display:none;margin-bottom:16px;"></div>

        <div class="form-group">
          <label class="form-label">Title <span style="color:var(--danger)">*</span></label>
          <input class="form-input" id="pol-f-title" type="text" placeholder="Policy title"
                 value="${Utils.escapeHtml(policy?.title || '')}">
        </div>

        <div class="form-group">
          <label class="form-label">Category <span style="color:var(--danger)">*</span></label>
          <select class="form-select" id="pol-f-cat">
            <option value="">— Select category —</option>
            ${catOptions}
          </select>
        </div>

        <div class="form-group">
          <label class="form-label">Policy Document</label>
          <div id="pol-f-file-field"></div>
          <span class="form-hint">PDF, DOC, DOCX · max 20 MB</span>
        </div>

        <div class="form-group" style="margin-bottom:0;">
          <label style="display:flex;align-items:center;gap:8px;cursor:pointer;user-select:none;">
            <input type="checkbox" id="pol-f-published" style="width:16px;height:16px;cursor:pointer;" ${isPublished ? 'checked' : ''}>
            <span style="font-size:14px;font-weight:500;">Published</span>
          </label>
          <span class="form-hint" style="padding-left:24px;">Unchecked saves as draft — only HR can see drafts.</span>
        </div>
      </div>

      <div class="modal-footer">
        <button class="btn btn-secondary" onclick="Utils.closeModal()">Cancel</button>
        <button class="btn btn-primary" id="pol-f-save">${isEdit ? 'Save Changes' : 'Create Policy'}</button>
      </div>
    `, '')

    _renderPolicyFileField()
    document.getElementById('pol-f-save')?.addEventListener('click', _savePolicy)
  }

  /* ── Policy File Field ──────────────────────────────────────── */
  function _renderPolicyFileField() {
    const container = document.getElementById('pol-f-file-field')
    if (!container) return

    if (_pendingFile) {
      container.innerHTML = `
        <div class="cd-file-chosen">
          <span class="cd-file-icon">${ICON_FILE}</span>
          <span class="cd-file-name">${Utils.escapeHtml(_pendingFile.name)}</span>
          <button type="button" class="cd-file-remove" id="pol-f-file-clear" title="Remove">×</button>
        </div>`
      container.querySelector('#pol-f-file-clear')?.addEventListener('click', () => {
        _pendingFile = null
        _renderPolicyFileField()
      })
    } else if (_existingFileUrl) {
      container.innerHTML = `
        <div class="cd-file-chosen">
          <span class="cd-file-icon">${ICON_FILE}</span>
          <span class="cd-file-name cd-file-name--existing">${Utils.escapeHtml(_existingFileName || 'Uploaded document')}</span>
          <a href="${Utils.escapeHtml(_existingFileUrl)}" target="_blank" rel="noopener noreferrer" class="cd-file-action">View</a>
          <span class="cd-file-sep">·</span>
          <label class="cd-file-action" style="cursor:pointer;">
            Replace<input type="file" id="pol-f-file-input" accept=".pdf,.doc,.docx" style="display:none;">
          </label>
          <button type="button" class="cd-file-remove" id="pol-f-file-clear" title="Remove">×</button>
        </div>`
      container.querySelector('#pol-f-file-clear')?.addEventListener('click', () => {
        _existingFileUrl  = null
        _existingFileName = null
        _renderPolicyFileField()
      })
      _bindPolicyFileInput(container)
    } else {
      container.innerHTML = `
        <label class="cd-file-pick-label">
          ${ICON_UPLOAD} Choose File
          <input type="file" id="pol-f-file-input" accept=".pdf,.doc,.docx" style="display:none;">
        </label>`
      _bindPolicyFileInput(container)
    }
  }

  function _bindPolicyFileInput(container) {
    const input = container.querySelector('#pol-f-file-input')
    if (!input) return
    input.addEventListener('change', e => {
      const f = e.target.files?.[0]
      if (!f) return
      if (f.size > 20 * 1024 * 1024) {
        Utils.showToast('File must be under 20 MB', 'error')
        return
      }
      _pendingFile = f
      _renderPolicyFileField()
    })
  }

  /* ── Save Policy ────────────────────────────────────────────── */
  async function _savePolicy() {
    const saveBtn   = document.getElementById('pol-f-save')
    const errEl     = document.getElementById('pol-form-err')

    const title     = (document.getElementById('pol-f-title')?.value || '').trim()
    const catId     = document.getElementById('pol-f-cat')?.value || ''
    const published = document.getElementById('pol-f-published')?.checked ?? false

    errEl.style.display = 'none'

    if (!title) {
      errEl.textContent  = 'Title is required.'
      errEl.style.display = 'block'
      return
    }
    if (!catId) {
      errEl.textContent  = 'Please select a category.'
      errEl.style.display = 'block'
      return
    }

    saveBtn.disabled    = true
    saveBtn.textContent = 'Saving…'

    try {
      let fileUrl  = _existingFileUrl  || null
      let fileName = _existingFileName || null
      let fileId   = null

      if (_pendingFile) {
        const cat = _categories.find(c => c.id === catId)
        const { driveUrl, driveFileId } = await _uploadPolicyFile(_pendingFile, cat?.name || catId)
        fileUrl  = driveUrl
        fileId   = driveFileId || null
        fileName = _pendingFile.name
      }

      const record = {
        title,
        category_id:   catId,
        published,
        file_url:      fileUrl,
        file_name:     fileName,
        drive_file_id: fileId,
        updated_at:    new Date().toISOString(),
      }

      if (_editingPolicyId) {
        const { error } = await API.updatePolicy(_editingPolicyId, record)
        if (error) throw error
      } else {
        const { error } = await API.createPolicy({ ...record, created_by: _user.id })
        if (error) throw error
      }

      Utils.closeModal()
      Utils.showToast(`Policy ${_editingPolicyId ? 'updated' : 'created'} successfully`, 'success')
      await _loadData()

    } catch (err) {
      errEl.textContent  = err.message || 'Something went wrong. Please try again.'
      errEl.style.display = 'block'
    } finally {
      if (saveBtn) {
        saveBtn.disabled    = false
        saveBtn.textContent = _editingPolicyId ? 'Save Changes' : 'Create Policy'
      }
    }
  }

  /* ── Manage Categories Modal ────────────────────────────────── */
  function _openCategoriesModal() {
    Utils.openModal(`
      <div class="modal-header">
        <h3 class="modal-title">Manage Categories</h3>
        <button class="modal-close" onclick="Utils.closeModal()">${ICON_CLOSE}</button>
      </div>

      <div class="modal-body">
        <div id="pol-cats-list" style="margin-bottom:20px;">${_categoriesListHTML()}</div>

        <div style="border-top:1px solid var(--border);padding-top:16px;">
          <label class="form-label" style="margin-bottom:8px;display:block;">Add New Category</label>
          <div style="display:flex;gap:8px;">
            <input class="form-input" id="pol-new-cat-input" type="text" placeholder="Category name" style="flex:1;">
            <button class="btn btn-primary" id="pol-add-cat-btn">Add</button>
          </div>
          <div id="pol-cat-err" class="alert alert-danger" style="display:none;margin-top:8px;"></div>
        </div>
      </div>

      <div class="modal-footer">
        <button class="btn btn-secondary" onclick="Utils.closeModal()">Done</button>
      </div>
    `, '')

    _bindCategoryModalEvents()
  }

  function _categoriesListHTML() {
    if (!_categories.length) {
      return `<p style="font-size:13px;color:var(--text-muted);">No categories yet.</p>`
    }

    return `<div style="display:flex;flex-direction:column;gap:6px;">` +
      _categories.map(cat => {
        const inUse = _policies.some(p => p.category_id === cat.id)
        return `
          <div style="display:flex;align-items:center;justify-content:space-between;padding:8px 12px;background:var(--bg-muted,var(--surface));border:1px solid var(--border);border-radius:6px;">
            <span style="font-size:14px;">${Utils.escapeHtml(cat.name)}</span>
            ${!inUse
              ? `<button class="btn btn-sm pol-del-cat-btn" style="background:transparent;color:var(--danger,#E53E3E);border:1px solid var(--danger,#E53E3E);padding:2px 10px;font-size:12px;" data-cat-id="${cat.id}">Delete</button>`
              : `<span style="font-size:12px;color:var(--text-muted);">In use</span>`
            }
          </div>`
      }).join('') +
    `</div>`
  }

  function _bindCategoryModalEvents() {
    // Delete category buttons
    document.querySelectorAll('.pol-del-cat-btn').forEach(btn => {
      btn.addEventListener('click', () => _deleteCategory(btn.dataset.catId))
    })

    // Add category
    const addBtn   = document.getElementById('pol-add-cat-btn')
    const catInput = document.getElementById('pol-new-cat-input')
    const catErr   = document.getElementById('pol-cat-err')

    addBtn?.addEventListener('click', async () => {
      const name = (catInput?.value || '').trim()
      catErr.style.display = 'none'

      if (!name) {
        catErr.textContent  = 'Category name is required.'
        catErr.style.display = 'block'
        return
      }

      const duplicate = _categories.find(c => c.name.toLowerCase() === name.toLowerCase())
      if (duplicate) {
        catErr.textContent  = 'A category with that name already exists.'
        catErr.style.display = 'block'
        return
      }

      addBtn.disabled    = true
      addBtn.textContent = 'Adding…'

      try {
        const { data, error } = await API.addPolicyCategory(name, _user.id)
        if (error) throw error

        _categories.push(data)
        // Also reload policies list in background so category filter updates
        API.getPolicies().then(r => {
          _policies = ((r.data || []).filter(p => _isHR || p.published))
        })

        if (catInput) catInput.value = ''
        _refreshCatsModal()

      } catch (err) {
        catErr.textContent  = err.message || 'Failed to add category.'
        catErr.style.display = 'block'
      } finally {
        addBtn.disabled    = false
        addBtn.textContent = 'Add'
      }
    })

    catInput?.addEventListener('keydown', e => {
      if (e.key === 'Enter') addBtn?.click()
    })
  }

  async function _deleteCategory(id) {
    if (!confirm('Delete this category? Only categories with no policies can be deleted.')) return

    const inUse = _policies.some(p => p.category_id === id)
    if (inUse) {
      Utils.showToast('Cannot delete a category that has policies assigned to it.', 'error')
      return
    }

    const { error } = await API.deletePolicyCategory(id)
    if (error) { Utils.showToast('Failed to delete category', 'error'); return }

    _categories = _categories.filter(c => c.id !== id)
    if (_activeCategory === id) _activeCategory = null
    _refreshCatsModal()
  }

  function _refreshCatsModal() {
    const listEl = document.getElementById('pol-cats-list')
    if (!listEl) return
    listEl.innerHTML = _categoriesListHTML()
    _bindCategoryModalEvents()

    // Re-render sidebar in background
    const sidebarEl = document.getElementById('pol-sidebar')
    if (sidebarEl) sidebarEl.innerHTML = _sidebarHTML()
    document.querySelectorAll('.pol-cat-item').forEach(item => {
      item.addEventListener('click', () => {
        const raw = item.dataset.catId
        _activeCategory = raw === '__all__' ? null : raw
        document.querySelectorAll('.pol-cat-item').forEach(i => i.classList.remove('pol-cat-item--active'))
        item.classList.add('pol-cat-item--active')
        _rerenderList()
      })
    })
  }

  return { render, init }
})()

ModuleRegistry.register({
  key:       'policies',
  routeId:   'policies',
  label:     'Policies & Documents',
  order:     20,
  icon:      `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line><polyline points="10 9 9 9 8 9"></polyline></svg>`,
  getModule: () => PoliciesModule,
  // Nav visibility: show the tab to anyone with at least view-level access
  // to manage_policies (e.g. Business Development's view_only grant) —
  // the module itself still hides Edit/Delete/New unless they clear the
  // higher can_manage bar. super_admin bypasses via HRMSApp.hasAccess.
  access:    (user) => HRMSApp.hasAccess('policies', 'manage_policies', 'view_only'),
  features:  {
    manage_policies: 'Manage Policies (HR)',
  },
})
