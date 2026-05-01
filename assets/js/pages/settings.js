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

        <!-- Notification Preferences -->
        <div class="section-card">
          <div class="section-card-header">
            <h3>Notification Preferences</h3>
            <span class="text-muted text-sm">Control which in-app notifications you receive</span>
          </div>
          <div class="section-card-body" id="notif-prefs-body">
            <p class="loading-text">Loading preferences…</p>
          </div>
        </div>

      </div>
    `
  }

  /* ── init ────────────────────────────────────────────────── */
  async function init(user) {
    _user = user
    _bindChangePassword()
    _loadNotifPrefs()
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

  return { render, init }
})()
