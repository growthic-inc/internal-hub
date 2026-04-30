/* ============================================================
   ANNOUNCEMENTS — Phase 7
   Employee feed + HR create/edit/delete + emoji reactions
   ============================================================ */

const Announcements = (() => {

  /* ── State ─────────────────────────────────────────────────── */
  let _user            = null
  let _announcements   = []
  let _isHR            = false
  let _myReactions     = new Map()   // announcementId → Set of emoji
  let _reactionCounts  = new Map()   // announcementId → { emoji: count }

  // Form state
  let _editingId       = null
  let _pendingFile     = null        // File object awaiting upload
  let _existingFileUrl = null
  let _existingFileName = null

  const EMOJIS = ['👍', '🎉', '🌟', '❤️', '😂', '😭', '🔥']

  /* ── Helpers ────────────────────────────────────────────────── */
  function _relativeTime(dateStr) {
    const diff = Date.now() - new Date(dateStr).getTime()
    const mins = Math.floor(diff / 60000)
    if (mins < 1)  return 'Just now'
    if (mins < 60) return `${mins}m ago`
    const hrs = Math.floor(mins / 60)
    if (hrs < 24)  return `${hrs}h ago`
    const days = Math.floor(hrs / 24)
    if (days < 7)  return `${days}d ago`
    return Utils.formatDate(dateStr)
  }

  async function _uploadFile(file) {
    const { data: { session } } = await Config.supabase.auth.getSession()
    const form = new FormData()
    form.append('file', file)
    const res = await fetch(`${Config.SUPABASE_URL}/functions/v1/upload-announcement-file`, {
      method:  'POST',
      headers: { Authorization: `Bearer ${session.access_token}` },
      body:    form,
    })
    const payload = await res.json()
    if (!res.ok || !payload.driveUrl) throw new Error(payload.error || 'Upload failed')
    return payload.driveUrl
  }

  /* ── render ─────────────────────────────────────────────────── */
  function render(user) {
    _user = user
    _isHR = user.role === 'super_admin' || user.department === 'people_culture'

    return `
      <div class="page-inner">
        <div class="page-header">
          <div style="display:flex;align-items:center;gap:8px;">
            <h2 style="margin:0;font-size:18px;font-weight:700;color:var(--text);">Announcements</h2>
          </div>
          ${_isHR ? `
          <button class="btn btn-primary btn-sm" id="ann-new-btn">+ New Announcement</button>
          ` : ''}
        </div>
        <div id="ann-feed" class="page-loading">Loading announcements…</div>
      </div>`
  }

  /* ── init ───────────────────────────────────────────────────── */
  async function init(user) {
    _user = user
    _isHR = user.role === 'super_admin' || user.department === 'people_culture'

    if (_isHR) {
      document.getElementById('ann-new-btn')?.addEventListener('click', () => _openModal(null))
    }

    await _loadAnnouncements()
  }

  /* ── Data ───────────────────────────────────────────────────── */
  async function _loadAnnouncements() {
    const { data, error } = await API.getAnnouncements()
    if (error) { Utils.showToast('Failed to load announcements', 'error'); return }

    _announcements = (data || []).filter(a => _isHR || a.published)

    // Load reactions for all visible announcements in parallel
    _myReactions    = new Map()
    _reactionCounts = new Map()

    await Promise.all(_announcements.map(async a => {
      const { data: reactions } = await API.getAnnouncementReactions(a.id)
      if (!reactions) return

      const counts = {}
      const mine   = new Set()

      for (const r of reactions) {
        counts[r.reaction] = (counts[r.reaction] || 0) + 1
        if (r.employee_id === _user.id) mine.add(r.reaction)
      }

      _reactionCounts.set(a.id, counts)
      _myReactions.set(a.id, mine)
    }))

    _renderFeed()
  }

  /* ── Feed ───────────────────────────────────────────────────── */
  function _renderFeed() {
    const el = document.getElementById('ann-feed')
    if (!el) return

    if (!_announcements.length) {
      el.className = ''
      el.innerHTML = `<div class="ann-empty empty-state"><h3>No announcements yet</h3><p>Check back soon for updates from People &amp; Culture.</p></div>`
      return
    }

    el.className = ''
    el.innerHTML = `<div class="announcements-feed">${_announcements.map(_cardHTML).join('')}</div>`

    _bindFeedEvents()
  }

  function _cardHTML(a) {
    const authorName   = a.author?.name || 'People & Culture'
    const initials     = Utils.getInitials(authorName)
    const isDraft      = !a.published
    const counts       = _reactionCounts.get(a.id) || {}
    const mine         = _myReactions.get(a.id) || new Set()

    const reactionBtns = EMOJIS.map(emoji => {
      const count   = counts[emoji] || 0
      const active  = mine.has(emoji) ? ' ann-reaction-btn--active' : ''
      const label   = count > 0 ? `${emoji} ${count}` : emoji
      return `<button class="ann-reaction-btn${active}" data-ann-id="${a.id}" data-emoji="${emoji}" title="${emoji}">${label}</button>`
    }).join('')

    return `
      <div class="ann-card${isDraft ? ' ann-card--draft' : ''}" data-ann-id="${a.id}">
        <div class="ann-card-header">
          <div class="ann-author-avatar">${Utils.escapeHtml(initials)}</div>
          <div class="ann-meta">
            <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
              <span style="font-weight:600;font-size:13px;">${Utils.escapeHtml(authorName)}</span>
              <span style="font-size:12px;color:var(--text-muted);">People &amp; Culture</span>
              ${isDraft ? `<span class="ann-draft-badge">DRAFT</span>` : ''}
            </div>
            <div style="font-size:12px;color:var(--text-muted);margin-top:2px;">${_relativeTime(a.created_at)}</div>
          </div>
          ${_isHR ? `
          <div style="margin-left:auto;display:flex;gap:6px;flex-shrink:0;">
            <button class="btn btn-secondary btn-sm ann-edit-btn" data-ann-id="${a.id}">Edit</button>
            <button class="btn btn-sm ann-delete-btn" style="background:var(--danger,#E53E3E);color:#fff;border-color:var(--danger,#E53E3E);" data-ann-id="${a.id}">Delete</button>
          </div>
          ` : ''}
        </div>

        <div class="ann-title">${Utils.escapeHtml(a.title)}</div>

        <div class="ann-content">${a.content || ''}</div>

        ${a.file_url ? `
        <div class="ann-attachment">
          <a href="${Utils.escapeHtml(a.file_url)}" target="_blank" rel="noopener noreferrer" class="cd-doc-link">
            📎 ${a.file_name ? Utils.escapeHtml(a.file_name) : 'View Attachment'}
          </a>
        </div>
        ` : ''}

        <div class="ann-reactions">
          ${reactionBtns}
        </div>
      </div>`
  }

  /* ── Feed Event Binding ─────────────────────────────────────── */
  function _bindFeedEvents() {
    const feed = document.getElementById('ann-feed')
    if (!feed) return

    // Reaction buttons
    feed.querySelectorAll('.ann-reaction-btn').forEach(btn => {
      btn.addEventListener('click', () => _toggleReaction(btn.dataset.annId, btn.dataset.emoji))
    })

    if (_isHR) {
      feed.querySelectorAll('.ann-edit-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          const a = _announcements.find(x => x.id === btn.dataset.annId)
          if (a) _openModal(a)
        })
      })

      feed.querySelectorAll('.ann-delete-btn').forEach(btn => {
        btn.addEventListener('click', () => _deleteAnnouncement(btn.dataset.annId))
      })
    }
  }

  /* ── Reactions ──────────────────────────────────────────────── */
  async function _toggleReaction(announcementId, emoji) {
    const mine = _myReactions.get(announcementId) || new Set()

    try {
      if (mine.has(emoji)) {
        // Remove
        const { error } = await API.removeReaction(announcementId, _user.id, emoji)
        if (error) throw error
        mine.delete(emoji)
        const counts = _reactionCounts.get(announcementId) || {}
        counts[emoji] = Math.max(0, (counts[emoji] || 1) - 1)
        _reactionCounts.set(announcementId, counts)
      } else {
        // Add
        const { error } = await API.addReaction(announcementId, _user.id, emoji)
        if (error) throw error
        mine.add(emoji)
        const counts = _reactionCounts.get(announcementId) || {}
        counts[emoji] = (counts[emoji] || 0) + 1
        _reactionCounts.set(announcementId, counts)
      }
      _myReactions.set(announcementId, mine)
      _updateReactionBar(announcementId)
    } catch {
      Utils.showToast('Failed to update reaction', 'error')
    }
  }

  function _updateReactionBar(announcementId) {
    const card = document.querySelector(`.ann-card[data-ann-id="${announcementId}"]`)
    if (!card) return
    const bar    = card.querySelector('.ann-reactions')
    if (!bar) return
    const counts = _reactionCounts.get(announcementId) || {}
    const mine   = _myReactions.get(announcementId) || new Set()

    bar.innerHTML = EMOJIS.map(emoji => {
      const count  = counts[emoji] || 0
      const active = mine.has(emoji) ? ' ann-reaction-btn--active' : ''
      const label  = count > 0 ? `${emoji} ${count}` : emoji
      return `<button class="ann-reaction-btn${active}" data-ann-id="${announcementId}" data-emoji="${emoji}" title="${emoji}">${label}</button>`
    }).join('')

    bar.querySelectorAll('.ann-reaction-btn').forEach(btn => {
      btn.addEventListener('click', () => _toggleReaction(btn.dataset.annId, btn.dataset.emoji))
    })
  }

  /* ── Delete ─────────────────────────────────────────────────── */
  async function _deleteAnnouncement(id) {
    if (!confirm('Delete this announcement? This cannot be undone.')) return
    const { error } = await API.deleteAnnouncement(id)
    if (error) { Utils.showToast('Failed to delete announcement', 'error'); return }
    Utils.showToast('Announcement deleted', 'success')
    await _loadAnnouncements()
  }

  /* ── Create / Edit Modal ────────────────────────────────────── */
  function _openModal(announcement) {
    _editingId        = announcement?.id || null
    _pendingFile      = null
    _existingFileUrl  = announcement?.file_url  || null
    _existingFileName = announcement?.file_name || null

    const isEdit     = !!announcement
    const isPublished = isEdit ? !!announcement.published : true

    Utils.openModal(`
      <div class="modal-header">
        <h3 class="modal-title">${isEdit ? 'Edit Announcement' : 'New Announcement'}</h3>
        <button class="modal-close" onclick="Utils.closeModal()">
          <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>

      <div class="modal-body">
        <div id="ann-form-err" class="alert alert-danger" style="display:none;margin-bottom:16px;"></div>

        <div class="form-group">
          <label class="form-label">Title <span style="color:var(--danger)">*</span></label>
          <input class="form-input" id="ann-f-title" type="text" placeholder="Announcement title"
                 value="${Utils.escapeHtml(announcement?.title || '')}">
        </div>

        <div class="form-group">
          <label class="form-label">Content <span style="color:var(--danger)">*</span></label>
          <textarea class="form-input" id="ann-f-content" rows="6" placeholder="Write the announcement content…" style="resize:vertical;">${Utils.escapeHtml(announcement?.content || '')}</textarea>
          <span class="form-hint">Content will be displayed as plain text.</span>
        </div>

        <div class="form-group">
          <label class="form-label">File Attachment</label>
          <div id="ann-f-file-field"></div>
          <span class="form-hint">Any file type · max 20 MB</span>
        </div>

        <div class="form-group" style="margin-bottom:0;">
          <label style="display:flex;align-items:center;gap:8px;cursor:pointer;user-select:none;">
            <input type="checkbox" id="ann-f-published" style="width:16px;height:16px;cursor:pointer;" ${isPublished ? 'checked' : ''}>
            <span style="font-size:14px;font-weight:500;">Publish immediately</span>
          </label>
          <span class="form-hint" style="padding-left:24px;">Unchecked saves as draft — only HR can see drafts.</span>
        </div>
      </div>

      <div class="modal-footer">
        <button class="btn btn-secondary" onclick="Utils.closeModal()">Cancel</button>
        <button class="btn btn-primary" id="ann-f-save">${isEdit ? 'Save Changes' : 'Publish'}</button>
      </div>
    `, '')

    _renderFileField()

    document.getElementById('ann-f-save')?.addEventListener('click', _saveAnnouncement)
  }

  /* ── File Field ─────────────────────────────────────────────── */
  function _renderFileField() {
    const container = document.getElementById('ann-f-file-field')
    if (!container) return

    const ICON_FILE   = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="14" height="14"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>`
    const ICON_UPLOAD = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="14" height="14"><polyline points="16 16 12 12 8 16"/><line x1="12" y1="12" x2="12" y2="21"/><path d="M20.39 18.39A5 5 0 0 0 18 9h-1.26A8 8 0 1 0 3 16.3"/></svg>`

    if (_pendingFile) {
      container.innerHTML = `
        <div class="cd-file-chosen">
          <span class="cd-file-icon">${ICON_FILE}</span>
          <span class="cd-file-name">${Utils.escapeHtml(_pendingFile.name)}</span>
          <button type="button" class="cd-file-remove" id="ann-f-file-clear" title="Remove">×</button>
        </div>`
      container.querySelector('#ann-f-file-clear')?.addEventListener('click', () => {
        _pendingFile = null
        _renderFileField()
      })
    } else if (_existingFileUrl) {
      container.innerHTML = `
        <div class="cd-file-chosen">
          <span class="cd-file-icon">${ICON_FILE}</span>
          <span class="cd-file-name cd-file-name--existing">${Utils.escapeHtml(_existingFileName || 'Uploaded file')}</span>
          <a href="${Utils.escapeHtml(_existingFileUrl)}" target="_blank" rel="noopener noreferrer" class="cd-file-action">View</a>
          <span class="cd-file-sep">·</span>
          <label class="cd-file-action" style="cursor:pointer;">
            Replace<input type="file" id="ann-f-file-input" style="display:none;">
          </label>
          <button type="button" class="cd-file-remove" id="ann-f-file-clear" title="Remove">×</button>
        </div>`
      container.querySelector('#ann-f-file-clear')?.addEventListener('click', () => {
        _existingFileUrl  = null
        _existingFileName = null
        _renderFileField()
      })
      _bindFileInput(container)
    } else {
      container.innerHTML = `
        <label class="cd-file-pick-label">
          ${ICON_UPLOAD} Choose File
          <input type="file" id="ann-f-file-input" style="display:none;">
        </label>`
      _bindFileInput(container)
    }
  }

  function _bindFileInput(container) {
    const input = container.querySelector('#ann-f-file-input')
    if (!input) return
    input.addEventListener('change', e => {
      const f = e.target.files?.[0]
      if (!f) return
      if (f.size > 20 * 1024 * 1024) {
        Utils.showToast('File must be under 20 MB', 'error')
        return
      }
      _pendingFile = f
      _renderFileField()
    })
  }

  /* ── Save ───────────────────────────────────────────────────── */
  async function _saveAnnouncement() {
    const saveBtn = document.getElementById('ann-f-save')
    const errEl   = document.getElementById('ann-form-err')

    const title     = (document.getElementById('ann-f-title')?.value    || '').trim()
    const content   = (document.getElementById('ann-f-content')?.value  || '').trim()
    const published = document.getElementById('ann-f-published')?.checked ?? true

    errEl.style.display = 'none'

    if (!title) {
      errEl.textContent  = 'Title is required.'
      errEl.style.display = 'block'
      return
    }
    if (!content) {
      errEl.textContent  = 'Content is required.'
      errEl.style.display = 'block'
      return
    }

    saveBtn.disabled    = true
    saveBtn.textContent = 'Saving…'

    try {
      let fileUrl  = _existingFileUrl  || null
      let fileName = _existingFileName || null

      if (_pendingFile) {
        fileUrl  = await _uploadFile(_pendingFile)
        fileName = _pendingFile.name
      }

      const record = {
        title,
        content,
        published,
        file_url:  fileUrl,
        file_name: fileName,
      }

      if (_editingId) {
        const { error } = await API.updateAnnouncement(_editingId, record)
        if (error) throw error
      } else {
        const { error } = await API.createAnnouncement({ ...record, created_by: _user.id })
        if (error) throw error
      }

      Utils.closeModal()
      Utils.showToast(`Announcement ${_editingId ? 'updated' : 'created'} successfully`, 'success')
      await _loadAnnouncements()

    } catch (err) {
      errEl.textContent  = err.message || 'Something went wrong. Please try again.'
      errEl.style.display = 'block'
    } finally {
      if (saveBtn) {
        saveBtn.disabled    = false
        saveBtn.textContent = _editingId ? 'Save Changes' : 'Publish'
      }
    }
  }

  return { render, init }
})()
