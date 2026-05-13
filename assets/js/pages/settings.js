/* ============================================================
   SETTINGS — Available to all roles
   Profile, Security, Notification Preferences
   ============================================================ */

const Settings = (() => {

  const NOTIFICATION_MODULES = [
    {
      id: 'timesheet',
      label: 'Timesheet',
      events: [
        { id: 'submission_received', label: 'Submission received' },
        { id: 'approved',            label: 'Timesheet approved' },
        { id: 'rejected',            label: 'Timesheet rejected' },
      ],
    },
    {
      id: 'leave',
      label: 'Leave',
      events: [
        { id: 'request_received', label: 'Leave request received' },
        { id: 'approved',         label: 'Leave approved' },
        { id: 'rejected',         label: 'Leave rejected' },
      ],
    },
    {
      id: 'wfh',
      label: 'Work From Home',
      events: [
        { id: 'request_received', label: 'WFH request received' },
        { id: 'approved',         label: 'WFH approved' },
        { id: 'rejected',         label: 'WFH rejected' },
      ],
    },
    {
      id: 'reimbursements',
      label: 'Reimbursements',
      events: [
        { id: 'pre_approval_status', label: 'Pre-approval status update' },
        { id: 'claim_status',        label: 'Claim status update' },
        { id: 'mark_as_paid',        label: 'Marked as paid' },
      ],
    },
    {
      id: 'assets',
      label: 'Asset Management',
      events: [
        { id: 'request_received',  label: 'Asset request received' },
        { id: 'approved',          label: 'Asset request approved' },
        { id: 'assigned',          label: 'Asset assigned to you' },
        { id: 'return_confirmed',  label: 'Asset return confirmed' },
      ],
    },
    {
      id: 'tools',
      label: 'Tools & Subscriptions',
      events: [
        { id: 'request_received', label: 'Tool request received' },
        { id: 'approved',         label: 'Tool request approved' },
        { id: 'access_given',     label: 'Tool access granted' },
      ],
    },
    {
      id: 'people',
      label: 'People',
      events: [
        { id: 'invite_received', label: 'Invite received' },
        { id: 'role_changed',    label: 'Role changed' },
      ],
    },
  ]

  let _user  = null
  let _prefs = {}   // { "module:event_type": boolean }

  /* ── render ──────────────────────────────────────────────── */
  function render(user) {
    return `
      <div class="page-inner settings-inner">

        <!-- Profile -->
        <div class="section-card mb-4">
          <div class="section-card-header"><h3>Profile</h3></div>
          <div class="section-card-body">
            <div class="settings-profile-row">
              <div class="settings-avatar">${user.profile_image_url ? `<img src="${Utils.escapeHtml(user.profile_image_url)}" alt="" style="width:100%;height:100%;object-fit:cover;border-radius:50%;">` : Utils.getInitials(user.name)}</div>
              <div>
                <div class="settings-name">${Utils.escapeHtml(user.name)}</div>
                <div class="settings-role">${Utils.getRoleLabel(user.role)} &middot; ${Utils.escapeHtml(user.department || 'Growthic')}</div>
              </div>
            </div>
            <div class="form-row mt-3">
              <div class="form-group">
                <label>Full Name</label>
                <input type="text" class="form-input" value="${Utils.escapeHtml(user.name)}" disabled />
              </div>
              <div class="form-group">
                <label>Email Address</label>
                <input type="email" class="form-input" value="${Utils.escapeHtml(user.email)}" disabled />
              </div>
            </div>
            <p class="form-hint">Contact your admin to update your name or email.</p>
          </div>
        </div>

        <!-- Security -->
        <div class="section-card mb-4">
          <div class="section-card-header"><h3>Security</h3></div>
          <div class="section-card-body">
            <div class="settings-pw-row">
              <div>
                <div class="settings-pw-label">Password</div>
                <div class="settings-pw-hint">Last changed: unknown</div>
              </div>
              <button class="btn btn--secondary" id="change-pw-btn">Change Password</button>
            </div>
          </div>
        </div>

        <!-- KYC Documents -->
        <div class="section-card mb-4">
          <div class="section-card-header">
            <h3>KYC Documents</h3>
            <span class="text-muted text-sm">Stored securely — visible only to HR</span>
          </div>
          <div class="section-card-body" id="kyc-section-body">
            <p class="loading-text">Loading…</p>
          </div>
        </div>

        <!-- Notification Preferences -->
        <div class="section-card mb-4">
          <div class="section-card-header">
            <h3>Notification Preferences</h3>
            <span class="text-muted text-sm">Control which in-app notifications you receive</span>
          </div>
          <div class="section-card-body" id="notif-prefs-body">
            <p class="loading-text">Loading preferences…</p>
          </div>
        </div>

        <!-- ClickUp Integration -->
        <div class="section-card">
          <div class="section-card-header">
            <h3>Integrations</h3>
          </div>
          <div class="section-card-body" id="settings-integrations-body">
            <p class="loading-text">Loading…</p>
          </div>
        </div>

      </div>
    `
  }

  /* ── init ────────────────────────────────────────────────── */
  async function init(user) {
    _user = user
    _bindChangePassword()
    _loadKyc()
    _loadNotifPrefs()
    _loadIntegrations()
  }

  /* ── Change Password ─────────────────────────────────────── */
  function _bindChangePassword() {
    document.getElementById('change-pw-btn')?.addEventListener('click', () => {
      Utils.openModal(`
        <div class="modal-header"><h3>Change Password</h3></div>
        <div class="modal-body">
          <div id="pw-error"   class="alert alert--danger"  style="display:none;"></div>
          <div id="pw-success" class="alert alert--success" style="display:none;"></div>
          <div class="form-group">
            <label>New Password</label>
            <input type="password" id="new-pw" class="form-input" placeholder="Minimum 8 characters" />
          </div>
          <div class="form-group">
            <label>Confirm New Password</label>
            <input type="password" id="confirm-pw" class="form-input" placeholder="Re-enter new password" />
          </div>
        </div>
        <div class="modal-footer">
          <button class="btn btn--ghost" onclick="Utils.closeModal()">Cancel</button>
          <button class="btn btn--primary" id="save-pw-btn">Update Password</button>
        </div>
      `)

      document.getElementById('save-pw-btn').addEventListener('click', async () => {
        const newPw     = document.getElementById('new-pw').value
        const confirmPw = document.getElementById('confirm-pw').value
        const errEl     = document.getElementById('pw-error')
        const okEl      = document.getElementById('pw-success')

        errEl.style.display = 'none'
        okEl.style.display  = 'none'

        if (newPw.length < 8) {
          errEl.textContent = 'Password must be at least 8 characters.'
          errEl.style.display = 'block'
          return
        }
        if (newPw !== confirmPw) {
          errEl.textContent = 'Passwords do not match.'
          errEl.style.display = 'block'
          return
        }

        const btn = document.getElementById('save-pw-btn')
        btn.disabled = true
        btn.textContent = 'Saving…'

        const { error } = await Config.supabase.auth.updateUser({ password: newPw })
        if (error) {
          errEl.textContent = error.message
          errEl.style.display = 'block'
          btn.disabled = false
          btn.textContent = 'Update Password'
        } else {
          okEl.textContent = 'Password updated successfully.'
          okEl.style.display = 'block'
          document.getElementById('new-pw').value     = ''
          document.getElementById('confirm-pw').value = ''
          btn.textContent = 'Done'
          setTimeout(() => Utils.closeModal(), 1500)
        }
      })
    })
  }

  /* ── KYC Documents ─────────────────────────────────────── */

  const KYC_DOCS = [
    { key: 'aadhar',         label: 'Aadhaar Card',  icon: '🪪', required: true  },
    { key: 'pan',            label: 'PAN Card',       icon: '🏷️', required: true  },
    { key: 'passport',       label: 'Passport',       icon: '📘', required: false },
    { key: 'passport_photo', label: 'Passport Photo', icon: '🖼️', required: false },
  ]

  async function _loadKyc() {
    const body = document.getElementById('kyc-section-body')
    if (!body) return

    const { data: kyc } = await API.getEmployeeKyc(_user.id)

    const submittedNote = kyc?.kyc_submitted_at
      ? `<p style="font-size:12px;color:var(--success);margin:0 0 16px;">✓ KYC submitted on ${Utils.formatDate(kyc.kyc_submitted_at)}</p>`
      : `<p style="font-size:12px;color:var(--text-muted);margin:0 0 16px;">Upload your documents below to complete KYC verification.</p>`

    const slots = KYC_DOCS.map(doc => {
      const url = kyc?.[`kyc_${doc.key}_url`]
      return `
        <div class="kyc-settings-slot" data-doc="${doc.key}"
             style="display:flex;align-items:center;gap:12px;padding:12px 0;
                    border-bottom:1px solid var(--border-light);">
          <span style="font-size:20px;flex-shrink:0;">${doc.icon}</span>
          <div style="flex:1;min-width:0;">
            <div style="font-size:13px;font-weight:600;color:var(--text);">
              ${doc.label}
              ${!doc.required ? '<span style="font-size:11px;font-weight:400;color:var(--text-muted);"> (optional)</span>' : ''}
            </div>
            <div style="margin-top:2px;">
              ${url
                ? `<a href="${Utils.escapeHtml(url)}" target="_blank" rel="noopener noreferrer"
                      style="font-size:12px;color:var(--primary);text-decoration:none;">
                     View uploaded file ↗
                   </a>`
                : `<span style="font-size:12px;color:var(--text-muted);">Not uploaded yet</span>`}
            </div>
          </div>
          <div style="display:flex;flex-direction:column;align-items:flex-end;gap:4px;flex-shrink:0;">
            <label class="btn btn--ghost btn--sm"
                   style="cursor:pointer;margin:0;display:inline-flex;align-items:center;gap:6px;">
              ${url
                ? `<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>
                   Replace`
                : `<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="16 16 12 12 8 16"/><line x1="12" y1="12" x2="12" y2="21"/><path d="M20.39 18.39A5 5 0 0 0 18 9h-1.26A8 8 0 1 0 3 16.3"/></svg>
                   Upload`}
              <input type="file" class="kyc-file-input" data-doc="${doc.key}"
                     accept=".pdf,.jpg,.jpeg,.png" style="display:none;">
            </label>
            <span class="kyc-slot-msg" style="display:none;font-size:11px;"></span>
          </div>
        </div>`
    }).join('')

    body.innerHTML = submittedNote + `<div style="margin:-4px 0;">${slots}</div>`
    _bindKycUploads()
  }

  function _bindKycUploads() {
    document.querySelectorAll('.kyc-file-input').forEach(input => {
      input.addEventListener('change', async function () {
        const file   = this.files?.[0]
        const docKey = this.dataset.doc
        if (!file) return

        const slot  = this.closest('.kyc-settings-slot')
        const label = slot?.querySelector('label.btn')
        const msg   = slot?.querySelector('.kyc-slot-msg')

        // Lock UI while uploading
        if (label) { label.style.opacity = '0.5'; label.style.pointerEvents = 'none' }
        if (msg)   { msg.textContent = 'Uploading…'; msg.style.color = 'var(--text-muted)'; msg.style.display = 'block' }

        const res = await API.uploadKycDocument(file, _user.id, _user.name, docKey)

        if (res?.drive_url) {
          await API.updateEmployeeFull(_user.id, {
            [`kyc_${docKey}_url`]: res.drive_url,
            kyc_submitted_at: new Date().toISOString(),
          })
          // Reload to show updated link + button
          _loadKyc()
        } else {
          if (label) { label.style.opacity = ''; label.style.pointerEvents = '' }
          if (msg)   { msg.textContent = 'Upload failed. Please try again.'; msg.style.color = 'var(--danger)' }
        }
      })
    })
  }

  /* ── Notification Preferences ────────────────────────────── */
  async function _loadNotifPrefs() {
    const body = document.getElementById('notif-prefs-body')
    if (!body) return

    const { data } = await API.getNotificationPreferences(_user.id)
    _prefs = {}
    ;(data || []).forEach(row => {
      _prefs[`${row.module}:${row.event_type}`] = row.enabled
    })

    body.innerHTML = NOTIFICATION_MODULES.map(mod => `
      <div class="notif-module">
        <div class="notif-module-header">
          <strong>${mod.label}</strong>
        </div>
        <div class="notif-module-events">
          ${mod.events.map(ev => {
            const key     = `${mod.id}:${ev.id}`
            const enabled = _prefs[key] !== false   // default true
            return `
              <label class="notif-toggle-row">
                <span class="notif-toggle-label">${ev.label}</span>
                <label class="toggle">
                  <input type="checkbox" class="notif-checkbox"
                    data-module="${mod.id}" data-event="${ev.id}"
                    ${enabled ? 'checked' : ''} />
                  <span class="toggle-slider"></span>
                </label>
              </label>
            `
          }).join('')}
        </div>
      </div>
    `).join('<div class="notif-divider"></div>')

    body.querySelectorAll('.notif-checkbox').forEach(cb => {
      cb.addEventListener('change', () => _saveNotifPref(cb.dataset.module, cb.dataset.event, cb.checked))
    })
  }

  async function _saveNotifPref(module, eventType, enabled) {
    _prefs[`${module}:${eventType}`] = enabled
    const { error } = await API.upsertNotificationPreference(_user.id, module, eventType, enabled)
    if (error) Utils.showToast('Failed to save preference.', 'error')
  }

  /* ── Integrations ────────────────────────────────────────── */
  function _loadIntegrations() {
    const body = document.getElementById('settings-integrations-body')
    if (!body) return
    _renderClickUpRow(body)
  }

  function _renderClickUpRow(body) {
    const connected = !!_user.clickup_user_id
    body.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:space-between;gap:16px;padding:4px 0;">
        <div style="display:flex;align-items:center;gap:14px;">
          <div style="width:36px;height:36px;border-radius:8px;background:#7B68EE;display:flex;align-items:center;justify-content:center;flex-shrink:0;">
            <svg width="20" height="20" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M4.5 20.5L8.9 17c1.3 1.6 2.7 2.3 4.3 2.3 1.6 0 3-.7 4.3-2.3l4.4 3.5C19.6 23.5 16.9 25 13.2 25c-3.7 0-6.4-1.5-8.7-4.5z" fill="white"/>
              <path d="M4.5 11.8l4.4 3.4c1.2-1.5 2.6-2.2 4.3-2.2 1.7 0 3.1.7 4.3 2.2l4.4-3.4C19.5 8.5 16.7 7 13.2 7 9.7 7 6.9 8.5 4.5 11.8z" fill="white" opacity=".7"/>
            </svg>
          </div>
          <div>
            <div style="font-size:14px;font-weight:600;">ClickUp</div>
            <div style="font-size:12px;color:var(--text-muted);">
              ${connected
                ? `<span style="color:var(--success);">✓ Connected</span> — your tasks sync with Growthic`
                : 'Connect your account to view and manage tasks'}
            </div>
          </div>
        </div>
        <div>
          ${connected
            ? `<button class="btn btn--ghost btn--sm" id="cu-disconnect-btn" style="color:var(--danger);">Disconnect</button>`
            : `<button class="btn btn--primary btn--sm" id="cu-connect-btn">Connect ClickUp</button>`}
        </div>
      </div>
    `

    if (connected) {
      document.getElementById('cu-disconnect-btn')?.addEventListener('click', _disconnectClickUp)
    } else {
      document.getElementById('cu-connect-btn')?.addEventListener('click', _connectClickUp)
    }
  }

  async function _connectClickUp() {
    const btn = document.getElementById('cu-connect-btn')
    if (btn) { btn.disabled = true; btn.textContent = 'Connecting…' }
    try {
      const { client_id } = await ClickUpAPI.getClientId()
      const redirectUri = encodeURIComponent(window.location.origin + '/home')
      window.location.href =
        `https://app.clickup.com/api?client_id=${client_id}&redirect_uri=${redirectUri}`
    } catch (e) {
      console.error('[ClickUp connect]', e)
      Utils.showToast('ClickUp: ' + (e.message || 'Unknown error'), 'error')
      if (btn) { btn.disabled = false; btn.textContent = 'Connect' }
    }
  }

  async function _disconnectClickUp() {
    const btn = document.getElementById('cu-disconnect-btn')
    if (!btn) return
    btn.disabled    = true
    btn.textContent = 'Disconnecting…'
    try {
      await ClickUpAPI.disconnect()
      _user.clickup_user_id = null
      const body = document.getElementById('settings-integrations-body')
      if (body) _renderClickUpRow(body)
      Utils.showToast('ClickUp disconnected.', 'success')
    } catch (e) {
      btn.disabled    = false
      btn.textContent = 'Disconnect'
      Utils.showToast('Failed to disconnect. Please try again.', 'error')
    }
  }

  return { render, init }
})()
