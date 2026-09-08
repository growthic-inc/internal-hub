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
  let _editingId        = null
  let _pendingFile      = null        // File object awaiting upload
  let _existingFileUrl  = null
  let _existingFileName = null
  // Image state: array of { type:'existing', url } or { type:'pending', file, preview }
  let _images           = []
  const MAX_IMAGES      = 4
  const MAX_IMG_BYTES   = 2 * 1024 * 1024   // 2 MB

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
    _isHR = App.hasAccess('announcements', 'post_announcement', 'can_manage')

    const avatarHtml = user.profile_image_url
      ? `<img src="${Utils.escapeHtml(user.profile_image_url)}" alt="" style="width:100%;height:100%;object-fit:cover;border-radius:50%;">`
      : `<span style="font-size:12px;font-weight:700;">${Utils.escapeHtml(Utils.getInitials(user.name || ''))}</span>`

    return `
      <div class="page-inner">
        <div class="ann-feed-header">
          <div>
            <h2 class="ann-feed-title">What's Happening at Growthic!</h2>
          </div>
          ${_isHR ? `<button class="btn btn-primary btn-sm" id="ann-new-btn" style="display:none;">+ New Post</button>` : ''}
        </div>
        <div class="ann-feed-wrap">
          ${_isHR ? `
            <div class="ann-compose-bar">
              <div class="ann-post-avatar" style="width:40px;height:40px;font-size:13px;">${avatarHtml}</div>
              <button class="ann-compose-prompt" id="ann-compose-btn">Share an update with the team…</button>
              <button class="ann-compose-post-btn" id="ann-compose-post-btn" onclick="">
                <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
                Post
              </button>
            </div>
          ` : ''}
          <div id="ann-feed" class="page-loading">Loading…</div>
        </div>
      </div>`
  }

  /* ── init ───────────────────────────────────────────────────── */
  async function init(user) {
    _user = user
    _isHR = App.hasAccess('announcements', 'post_announcement', 'can_manage')

    if (_isHR) {
      document.getElementById('ann-compose-btn')?.addEventListener('click', () => _openModal(null))
      document.getElementById('ann-compose-post-btn')?.addEventListener('click', () => _openModal(null))
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
      el.innerHTML = `
        <div class="ann-empty-state">
          <div style="font-size:48px;margin-bottom:12px;">📭</div>
          <div style="font-size:16px;font-weight:700;color:var(--text);margin-bottom:6px;">Nothing here yet</div>
          <div style="font-size:14px;color:var(--text-muted);">Updates from the team will appear here.</div>
        </div>`
      return
    }

    el.className = ''
    el.innerHTML = `<div class="announcements-feed">${_announcements.map(_postHTML).join('')}</div>`
    _bindFeedEvents()
  }

  function _postHTML(a, idx) {
    const authorName = a.author?.name || 'People & Culture'
    const authorImg  = a.author?.profile_image_url || null
    const authorDept = a.author?.department ? Utils.getDeptLabel(a.author.department) : 'People & Culture'
    const isDraft    = !a.published
    const counts     = _reactionCounts.get(a.id) || {}
    const mine       = _myReactions.get(a.id) || new Set()

    const avatarHtml = authorImg
      ? `<img src="${Utils.escapeHtml(authorImg)}" alt="" style="width:100%;height:100%;object-fit:cover;border-radius:50%;">`
      : Utils.escapeHtml(Utils.getInitials(authorName))

    // Reaction summary line
    const totalReactions = Object.values(counts).reduce((s, c) => s + c, 0)
    const reactedEmojis  = EMOJIS.filter(e => counts[e] > 0).slice(0, 3).join('')
    const summary = totalReactions > 0
      ? `<div class="ann-react-summary">${reactedEmojis} <span>${totalReactions} reaction${totalReactions !== 1 ? 's' : ''}</span></div>`
      : ''

    const pills = EMOJIS.map(emoji => {
      const count  = counts[emoji] || 0
      const active = mine.has(emoji) ? ' ann-react-pill--active' : ''
      return `<button class="ann-react-pill${active}" data-ann-id="${a.id}" data-emoji="${emoji}" title="${emoji}">
        <span class="ann-react-emoji">${emoji}</span>${count > 0 ? `<span class="ann-react-count">${count}</span>` : ''}
      </button>`
    }).join('')

    return `
      <div class="ann-post${isDraft ? ' ann-post--draft' : ''}" data-ann-id="${a.id}" style="animation-delay:${(idx || 0) * 0.06}s;">
        <div class="ann-post-header">
          <div class="ann-post-avatar">${avatarHtml}</div>
          <div style="flex:1;min-width:0;">
            <div class="ann-post-author">
              ${Utils.escapeHtml(authorName)}
              ${isDraft ? `<span class="ann-draft-badge">Draft</span>` : ''}
            </div>
            <div class="ann-post-time">${_relativeTime(a.created_at)}</div>
          </div>
          ${_isHR ? `
            <div style="display:flex;gap:2px;flex-shrink:0;">
              <button class="ann-action-btn ann-edit-btn" data-ann-id="${a.id}" title="Edit">
                <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
              </button>
              <button class="ann-action-btn ann-action-btn--danger ann-delete-btn" data-ann-id="${a.id}" title="Delete">
                <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/></svg>
              </button>
            </div>
          ` : ''}
        </div>

        <div class="ann-post-body">
          <h3 class="ann-post-title">${Utils.escapeHtml(a.title)}</h3>
          <div class="ann-post-content">${a.content || ''}</div>
          ${a.image_urls?.length ? (() => {
            const n = Math.min(a.image_urls.length, 4)
            const imgs = a.image_urls.slice(0, n).map(url =>
              `<img src="${Utils.escapeHtml(url)}" alt="" class="ann-image-thumb" loading="lazy">`
            ).join('')
            return `<div class="ann-image-grid ann-image-grid--${n}">${imgs}</div>`
          })() : ''}
          ${a.file_url ? `
            <div class="ann-attachment">
              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg>
              <a href="${Utils.escapeHtml(a.file_url)}" target="_blank" rel="noopener noreferrer">${a.file_name ? Utils.escapeHtml(a.file_name) : 'View Attachment'}</a>
            </div>` : ''}
        </div>

        <div class="ann-post-footer">
          ${summary}
          ${pills}
        </div>
      </div>`
  }

  /* ── Lightbox ───────────────────────────────────────────────── */
  function _openLightbox(urls, startIdx) {
    let current = startIdx || 0
    const total  = urls.length

    const ARROW_PREV = `<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>`
    const ARROW_NEXT = `<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>`

    const overlay = document.createElement('div')
    overlay.className = 'ann-lightbox'
    overlay.innerHTML = `
      <div class="ann-lightbox-backdrop"></div>
      <button class="ann-lightbox-nav ann-lightbox-prev" aria-label="Previous">${ARROW_PREV}</button>
      <div class="ann-lightbox-content">
        <img src="" class="ann-lightbox-img" alt="">
        <div class="ann-lightbox-counter"></div>
      </div>
      <button class="ann-lightbox-nav ann-lightbox-next" aria-label="Next">${ARROW_NEXT}</button>
      <button class="ann-lightbox-close" aria-label="Close">
        <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
      </button>`
    document.body.appendChild(overlay)

    const imgEl     = overlay.querySelector('.ann-lightbox-img')
    const counter   = overlay.querySelector('.ann-lightbox-counter')
    const btnPrev   = overlay.querySelector('.ann-lightbox-prev')
    const btnNext   = overlay.querySelector('.ann-lightbox-next')

    function show(idx) {
      current = (idx + total) % total
      imgEl.src = urls[current]
      counter.textContent = total > 1 ? `${current + 1} / ${total}` : ''
      btnPrev.style.display = total > 1 ? '' : 'none'
      btnNext.style.display = total > 1 ? '' : 'none'
    }

    const close = () => { overlay.classList.add('ann-lightbox--out'); setTimeout(() => overlay.remove(), 200); document.removeEventListener('keydown', onKey) }
    const onKey = e => {
      if (e.key === 'Escape')       close()
      if (e.key === 'ArrowLeft')    show(current - 1)
      if (e.key === 'ArrowRight')   show(current + 1)
    }

    overlay.querySelector('.ann-lightbox-backdrop').addEventListener('click', close)
    overlay.querySelector('.ann-lightbox-close').addEventListener('click', close)
    btnPrev.addEventListener('click', () => show(current - 1))
    btnNext.addEventListener('click', () => show(current + 1))
    document.addEventListener('keydown', onKey)

    show(current)
    requestAnimationFrame(() => overlay.classList.add('ann-lightbox--in'))
  }

  /* ── Feed Event Binding ─────────────────────────────────────── */
  function _bindFeedEvents() {
    const feed = document.getElementById('ann-feed')
    if (!feed) return

    // Image lightbox — group by post
    feed.querySelectorAll('.ann-image-grid').forEach(grid => {
      const imgs = [...grid.querySelectorAll('.ann-image-thumb')]
      const urls = imgs.map(i => i.src)
      imgs.forEach((img, idx) => {
        img.addEventListener('click', () => _openLightbox(urls, idx))
      })
    })

    // Reaction pills — bounce on click
    feed.querySelectorAll('.ann-react-pill').forEach(btn => {
      btn.addEventListener('click', () => {
        btn.classList.add('ann-react-pill--bounce')
        btn.addEventListener('animationend', () => btn.classList.remove('ann-react-pill--bounce'), { once: true })
        _toggleReaction(btn.dataset.annId, btn.dataset.emoji)
      })
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
    const post = document.querySelector(`.ann-post[data-ann-id="${announcementId}"]`)
    if (!post) return
    const footer = post.querySelector('.ann-post-footer')
    if (!footer) return

    const counts         = _reactionCounts.get(announcementId) || {}
    const mine           = _myReactions.get(announcementId) || new Set()
    const totalReactions = Object.values(counts).reduce((s, c) => s + c, 0)
    const reactedEmojis  = EMOJIS.filter(e => counts[e] > 0).slice(0, 4).join(' ')

    const summary = totalReactions > 0
      ? `<div class="ann-react-summary">${reactedEmojis} &nbsp;${totalReactions} reaction${totalReactions !== 1 ? 's' : ''}</div>`
      : ''

    const pills = EMOJIS.map(emoji => {
      const count  = counts[emoji] || 0
      const active = mine.has(emoji) ? ' ann-react-pill--active' : ''
      return `<button class="ann-react-pill${active}" data-ann-id="${announcementId}" data-emoji="${emoji}" title="${emoji}">
        <span>${emoji}</span>${count > 0 ? `<span class="ann-react-count">${count}</span>` : ''}
      </button>`
    }).join('')

    footer.innerHTML = summary + pills

    footer.querySelectorAll('.ann-react-pill').forEach(btn => {
      btn.addEventListener('click', () => {
        btn.classList.add('ann-react-pill--bounce')
        btn.addEventListener('animationend', () => btn.classList.remove('ann-react-pill--bounce'), { once: true })
        _toggleReaction(btn.dataset.annId, btn.dataset.emoji)
      })
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
    // Initialise image slots from existing saved URLs
    _images = (announcement?.image_urls || []).map(url => ({ type: 'existing', url }))

    const isEdit      = !!announcement
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
          <textarea class="form-input" id="ann-f-content" rows="5" placeholder="Write the announcement…" style="resize:vertical;">${Utils.escapeHtml(announcement?.content || '')}</textarea>
        </div>

        <div class="form-group">
          <label class="form-label">Images <span style="color:var(--text-muted);font-weight:400;">(up to 4 · max 2 MB each)</span></label>
          <div id="ann-img-picker"></div>
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

    _renderImagePicker()
    _renderFileField()
    document.getElementById('ann-f-save')?.addEventListener('click', _saveAnnouncement)
  }

  /* ── Image Picker ────────────────────────────────────────────── */
  function _renderImagePicker() {
    const container = document.getElementById('ann-img-picker')
    if (!container) return

    const slots = []

    // Filled slots
    _images.forEach((img, idx) => {
      const src = img.type === 'existing' ? img.url : img.preview
      slots.push(`
        <div class="ann-img-slot ann-img-slot--filled">
          <img src="${Utils.escapeHtml(src)}" alt="Image ${idx + 1}" class="ann-img-slot-thumb">
          <button type="button" class="ann-img-slot-remove" data-idx="${idx}" title="Remove">×</button>
        </div>`)
    })

    // Add slot (only if under limit)
    if (_images.length < MAX_IMAGES) {
      slots.push(`
        <label class="ann-img-slot ann-img-slot--add" title="Add image">
          <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="12" y1="8" x2="12" y2="16"/><line x1="8" y1="12" x2="16" y2="12"/></svg>
          <input type="file" id="ann-img-input" accept="image/jpeg,image/png,image/gif,image/webp" style="display:none;">
        </label>`)
    }

    container.innerHTML = `<div class="ann-img-picker-grid">${slots.join('')}</div>`

    // Remove buttons
    container.querySelectorAll('.ann-img-slot-remove').forEach(btn => {
      btn.addEventListener('click', () => {
        const idx = parseInt(btn.dataset.idx, 10)
        if (_images[idx]?.type === 'pending') URL.revokeObjectURL(_images[idx].preview)
        _images.splice(idx, 1)
        _renderImagePicker()
      })
    })

    // File input
    const input = container.querySelector('#ann-img-input')
    if (input) {
      input.addEventListener('change', e => {
        const file = e.target.files?.[0]
        if (!file) return
        if (file.size > MAX_IMG_BYTES) {
          Utils.showToast('Image must be under 2 MB', 'error')
          return
        }
        if (_images.length >= MAX_IMAGES) return
        const preview = URL.createObjectURL(file)
        _images.push({ type: 'pending', file, preview })
        _renderImagePicker()
      })
    }
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

      // Upload pending images to Supabase Storage; collect all URLs
      const existingUrls = _images.filter(i => i.type === 'existing').map(i => i.url)
      const pendingImages = _images.filter(i => i.type === 'pending')

      const newUrls = await Promise.all(
        pendingImages.map(async img => {
          const url = await API.uploadAnnouncementImage(img.file)
          // Fire-and-forget Drive backup — doesn't block save
          _uploadFile(img.file).catch(() => {})
          return url
        })
      )

      const imageUrls = [...existingUrls, ...newUrls]

      const record = {
        title,
        content,
        published,
        file_url:   fileUrl,
        file_name:  fileName,
        image_urls: imageUrls.length > 0 ? imageUrls : null,
      }

      if (_editingId) {
        const { error } = await API.updateAnnouncement(_editingId, record)
        if (error) throw error
      } else {
        const { data: annData, error } = await API.createAnnouncement({ ...record, created_by: _user.id })
        if (error) throw error

        // Notify all active employees (except author)
        const { data: employees } = await API.getEmployees(true)
        if (employees?.length) {
          const targets = employees.filter(e => e.id !== _user.id)
          if (targets.length) {
            Promise.all(targets.map(e => API.createNotification({
              recipient_employee_id: e.id,
              type: 'info',
              message: `New announcement: "${title}"`,
              module: 'announcements',
              record_id: annData?.id || null,
              notify_email: true,
            })))
          }
        }
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

ModuleRegistry.register({
  key:       'announcements',
  routeId:   'announcements',
  label:     'Announcements',
  order:     0,
  universal: true,
  icon:      `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 11l19-9-9 19-2-8-8-2z"></path></svg>`,
  getModule: () => Announcements,
  features:  {
    view_announcements:   'View Announcements',
    react_announcements:  'React to Announcements',
    post_announcement:    'Post Announcements (HR)',
    manage_announcements: 'Manage All Announcements',
  },
})
