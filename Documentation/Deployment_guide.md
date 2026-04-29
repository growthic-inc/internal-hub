# Growthic One — Deployment Guide

Last updated: 2026-04-21 | Version: 0.2.0

---

## Overview

Growthic One is a Vanilla JS SPA hosted on **Vercel** (frontend) with **Supabase** as the backend (database + auth + storage + edge functions).

- Frontend: `app/` directory → deployed to Vercel
- Database: Supabase Postgres with RLS
- Auth: Supabase Auth (email invite flow)
- Edge Functions: Supabase Edge Functions (Deno)

---

## 1. Supabase Project Setup

### 1.1 Create Project
1. Go to [supabase.com](https://supabase.com) → New Project
2. Note your **Project URL** and **Anon Key** from Settings → API

### 1.2 Database Setup (First Deploy)
Run in Supabase SQL Editor **in order**:

1. `Documentation/database_setup.sql` — creates all tables, RLS policies, seed data
2. `Documentation/phase2_migration.sql` — adds `finance` role, new reimbursements schema, tools tables

> If re-running on a fresh project, run `database_setup.sql` first only. Run `phase2_migration.sql` only once after.

### 1.3 Authentication Configuration
1. Supabase Dashboard → **Authentication → URL Configuration**
   - **Site URL**: `https://your-vercel-domain.vercel.app`
   - **Redirect URLs**: Add `https://your-vercel-domain.vercel.app/`
2. Authentication → Email Templates — customise invite email as needed

### 1.4 First Super Admin
After running the SQL, manually insert your first super admin:

```sql
-- Get your Auth UUID first from Authentication → Users tab
INSERT INTO public.employees (id, name, email, role, department, status)
VALUES (
  'YOUR-AUTH-UUID-HERE',
  'Your Name',
  'your@email.com',
  'super_admin',
  'Management',
  'active'
);
```

---

## 2. Edge Function Deployment (invite-employee)

The invite flow requires the `invite-employee` Supabase Edge Function.

### 2.1 Prerequisites
```bash
npm install -g supabase
```

### 2.2 Login & Link Project
```bash
supabase login
supabase link --project-ref YOUR_PROJECT_REF
```
(Project ref is the string in your Supabase URL: `https://XXXXX.supabase.co`)

### 2.3 Set Secrets
```bash
supabase secrets set SUPABASE_URL=https://XXXXX.supabase.co
supabase secrets set SUPABASE_ANON_KEY=your_anon_key
supabase secrets set SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
supabase secrets set SITE_URL=https://your-vercel-domain.vercel.app

# For Client Repository (Google Drive upload)
supabase secrets set GOOGLE_SERVICE_ACCOUNT_JSON='{"type":"service_account","project_id":"...","private_key":"...","client_email":"..."}'
supabase secrets set GOOGLE_DRIVE_ROOT_FOLDER_ID=your_shared_drive_folder_id
```

> **NEVER** put `SERVICE_ROLE_KEY` or `GOOGLE_SERVICE_ACCOUNT_JSON` in frontend code. They only live as Supabase secrets.

### Google Drive Setup (for Client Repository)
1. Create a **Google Cloud project** at console.cloud.google.com
2. Enable the **Google Drive API**
3. Create a **Service Account** → generate a JSON key
4. Share the target Drive folder (`contact@thegrowthic.com`'s shared Drive root) with the service account email as **Editor**
5. Copy the shared folder's ID from the Drive URL: `drive.google.com/drive/folders/FOLDER_ID_HERE`
6. Set both secrets above (`GOOGLE_SERVICE_ACCOUNT_JSON` and `GOOGLE_DRIVE_ROOT_FOLDER_ID`)

### 2.4 Deploy Functions
```bash
supabase functions deploy invite-employee
supabase functions deploy upload-to-drive
```

### 2.5 Verify
After deployment, the function endpoint is:
```
https://XXXXX.supabase.co/functions/v1/invite-employee
```

---

## 3. Vercel Deployment

### 3.1 First-Time Setup
1. Push repo to GitHub
2. Go to [vercel.com](https://vercel.com) → New Project → Import from GitHub
3. **Root Directory**: set to `app`
4. Framework Preset: **Other**
5. Deploy

### 3.2 vercel.json
The `app/vercel.json` must contain:
```json
{
  "cleanUrls": true,
  "trailingSlash": false
}
```

### 3.3 Environment Variables
No environment variables needed on Vercel — the Supabase URL and Anon Key live in `app/assets/js/config.js` (anon key is safe to be public; RLS is the security layer).

### 3.4 Subsequent Deploys
Push to `main` branch — Vercel auto-deploys.

---

## 4. config.js Setup

`app/assets/js/config.js` must exist and contain:

```js
const Config = (() => {
  const SUPABASE_URL  = 'https://XXXXX.supabase.co'
  const SUPABASE_ANON_KEY = 'your_anon_key_here'

  const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY)

  return { SUPABASE_URL, SUPABASE_ANON_KEY, supabase }
})()
```

> This file is in `.gitignore`. Create it manually on each environment.

---

## 5. Onboarding a New Employee

1. HR or Super Admin goes to **People** page → **Invite** tab
2. Fills in: name, email, role, department, manager, joining date
3. Clicks **Send Invite**
   - Edge Function creates employee record + sends Supabase Auth invite email
4. Employee receives invite email → clicks link → sets password → logged in with correct role

---

## 6. Troubleshooting

| Problem | Likely Cause | Fix |
|---|---|---|
| Invite email points to localhost | Supabase Site URL not updated | Update in Auth → URL Configuration |
| Login redirects back to login page | No employee record for the auth user | Manually insert into `employees` table |
| `get_my_role` function error | Function created before `employees` table | Re-run `database_setup.sql` in order |
| Edge Function returns 403 | Caller is not `hr` or `super_admin` | Check employee record's role column |
| Edge Function returns 409 | Email already in employees table | Use a different email or check existing record |

---

## 7. File Structure Reference

```
internal-hub/
├── app/                          ← Vercel root
│   ├── index.html                ← Login + invite set-password page
│   ├── home.html                 ← Main SPA shell
│   ├── vercel.json
│   └── assets/
│       ├── css/
│       │   └── styles.css
│       └── js/
│           ├── config.js         ← Supabase credentials (gitignored)
│           ├── auth.js
│           ├── app.js            ← Router + sidebar
│           ├── api.js            ← All Supabase queries
│           ├── utils.js          ← Shared helpers
│           └── pages/
│               ├── client-dashboard.js
│               ├── client-directory.js
│               ├── master-folders.js
│               ├── timesheet.js
│               ├── reimbursements.js
│               ├── assets.js
│               ├── tools.js
│               ├── access-control.js
│               └── settings.js
├── supabase/
│   └── functions/
│       └── invite-employee/
│           └── index.ts
└── Documentation/
    ├── database_setup.sql
    ├── phase2_migration.sql
    ├── Deployment_guide.md       ← This file
    └── Changelog.md
```
