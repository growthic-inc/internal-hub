/* ============================================================
   SETTINGS — Available to all roles
   ============================================================ */

const Settings = (() => {

  const ICON = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path></svg>`

  function render(user) {
    return `
      <div class="page-inner" style="max-width:640px;">
        <div class="page-header">
          <h2>Settings</h2>
        </div>

        <div class="card" style="margin-bottom:16px;">
          <div class="card-header">
            <span class="card-title">Profile</span>
          </div>
          <div style="display:flex; align-items:center; gap:16px; margin-bottom:20px;">
            <div style="width:56px;height:56px;border-radius:50%;background:var(--primary);display:flex;align-items:center;justify-content:center;font-size:18px;font-weight:700;color:#fff;flex-shrink:0;">
              ${Utils.getInitials(user.name)}
            </div>
            <div>
              <div style="font-size:16px;font-weight:600;color:var(--text);">${Utils.escapeHtml(user.name)}</div>
              <div style="font-size:13px;color:var(--text-muted);margin-top:2px;">${Utils.getRoleLabel(user.role)} &middot; ${Utils.escapeHtml(user.department || 'Growthic')}</div>
            </div>
          </div>
          <div class="form-group">
            <label class="form-label">Full name</label>
            <input class="form-input" type="text" value="${Utils.escapeHtml(user.name)}" disabled>
          </div>
          <div class="form-group" style="margin-bottom:0;">
            <label class="form-label">Email address</label>
            <input class="form-input" type="email" value="${Utils.escapeHtml(user.email)}" disabled>
            <span class="form-hint">Contact your admin to update your name or email.</span>
          </div>
        </div>

        <div class="card" style="margin-bottom:16px;">
          <div class="card-header">
            <span class="card-title">Security</span>
          </div>
          <div class="form-group" style="margin-bottom:0;">
            <label class="form-label">Password</label>
            <div style="display:flex; gap:10px; align-items:center;">
              <input class="form-input" type="password" value="••••••••••" disabled style="max-width:200px;">
              <button class="btn btn-secondary btn-sm" id="change-pw-btn">Change password</button>
            </div>
          </div>
        </div>

        <div class="card">
          <div class="card-header">
            <span class="card-title">Notifications</span>
            <span class="card-muted" style="font-size:12px;">Coming in Phase 4</span>
          </div>
          <p style="font-size:13px;color:var(--text-muted);">Notification preferences will be configurable once all modules are live.</p>
        </div>
      </div>
    `
  }

  function init(user) {
    const btn = document.getElementById('change-pw-btn')
    if (!btn) return
    btn.addEventListener('click', () => {
      Utils.openModal(`
        <div class="modal-header">
          <span class="modal-title">Change Password</span>
          <button class="modal-close" onclick="Utils.closeModal()">
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
          </button>
        </div>
        <div class="modal-body">
          <div id="pw-error" class="alert alert-danger" style="display:none;"></div>
          <div id="pw-success" class="alert alert-success" style="display:none;"></div>
          <div class="form-group">
            <label class="form-label">New password</label>
            <input class="form-input" type="password" id="new-pw" placeholder="Minimum 8 characters">
          </div>
          <div class="form-group" style="margin-bottom:0;">
            <label class="form-label">Confirm new password</label>
            <input class="form-input" type="password" id="confirm-pw" placeholder="Re-enter new password">
          </div>
        </div>
        <div class="modal-footer">
          <button class="btn btn-secondary" onclick="Utils.closeModal()">Cancel</button>
          <button class="btn btn-primary" id="save-pw-btn">Update password</button>
        </div>
      `)

      document.getElementById('save-pw-btn').addEventListener('click', async () => {
        const newPw    = document.getElementById('new-pw').value
        const confirmPw = document.getElementById('confirm-pw').value
        const errEl    = document.getElementById('pw-error')
        const successEl = document.getElementById('pw-success')

        errEl.style.display = 'none'
        successEl.style.display = 'none'

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

        const saveBtn = document.getElementById('save-pw-btn')
        saveBtn.disabled = true
        saveBtn.textContent = 'Saving…'

        const { error } = await Config.supabase.auth.updateUser({ password: newPw })
        if (error) {
          errEl.textContent = error.message
          errEl.style.display = 'block'
          saveBtn.disabled = false
          saveBtn.textContent = 'Update password'
        } else {
          successEl.textContent = 'Password updated successfully.'
          successEl.style.display = 'block'
          document.getElementById('new-pw').value = ''
          document.getElementById('confirm-pw').value = ''
          saveBtn.textContent = 'Done'
          setTimeout(() => Utils.closeModal(), 1500)
        }
      })
    })
  }

  return { render, init }
})()
