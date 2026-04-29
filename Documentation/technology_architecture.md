# Growthic Internal Hub — Technology Architecture

**Version:** 2.0
**Audience:** Internal Team

---

## Changelog

| Version | Date | Change |
|---|---|---|
| 1.0 | Apr 2026 | Initial architecture — React + Vite frontend, Node.js + Express backend |
| 2.0 | Apr 2026 | Simplified to Path A — Vanilla JS frontend calling Supabase directly; Node.js backend removed; Supabase Edge Functions handle server-side logic |

---

## Overview

The system is built on a lean, no-build-process stack chosen for a team of 15–18 people and a solo builder. Every technology decision prioritizes simplicity, direct uploadability to Hostinger shared hosting, and low maintenance overhead. There is no compilation step, no local build server, and no separate backend process to manage.

| Layer | Technology |
|---|---|
| Frontend | Vanilla HTML + CSS + JavaScript |
| Backend Logic | Supabase Edge Functions |
| Database | Supabase (PostgreSQL) |
| Authentication | Supabase Auth (JS client) |
| File Storage | Google Drive (via Google Drive API) |
| Hosting | Hostinger Shared Hosting (public_html) |

---

## 1. Frontend

**Technology: Vanilla HTML + CSS + JavaScript**

The entire frontend is plain HTML, CSS, and JavaScript — no framework, no build step, no compilation required. Files are written and uploaded directly to Hostinger's `public_html` folder. What you see in the repository is exactly what runs in production.

### File structure

```
public_html/
├── index.html                  ← login page
├── app.html                    ← main app shell (post-login)
│
├── assets/
│   ├── js/
│   │   ├── config.js           ← Supabase URL + anon key
│   │   ├── auth.js             ← login, logout, session guard
│   │   ├── app.js              ← sidebar, router, role rendering
│   │   ├── api.js              ← all Supabase calls in one place
│   │   ├── utils.js            ← shared helpers
│   │   └── pages/
│   │       ├── client-directory.js
│   │       ├── client-dashboard.js
│   │       ├── timesheet.js
│   │       ├── master-folders.js
│   │       ├── tools.js
│   │       ├── assets.js
│   │       ├── reimbursements.js
│   │       ├── access-control.js
│   │       └── settings.js
│   │
│   ├── css/
│   │   ├── style.css           ← global styles + brand tokens
│   │   └── components.css      ← cards, tables, modals, badges
│   │
│   └── img/
│       └── logo.svg
│
└── Documentation/
```

### Brand tokens

All colors are defined as CSS variables in `style.css` and inherited by every component automatically.

| Token | Value | Usage |
|---|---|---|
| `--color-primary` | `#0F4799` | Pigment Blue — primary actions, active states, links |
| `--color-secondary` | `#45BBF0` | Picton Blue — highlights, hover states, badges |
| `--color-success` | `#1D9E75` | Positive indicators, approved status |
| `--color-warning` | `#F59E0B` | At Risk status, amber states |
| `--color-danger` | `#EF4444` | Off Track, rejected, errors |
| `--color-bg` | `#FFFFFF` | Page background |
| `--color-surface` | `#F8FAFC` | Card and panel backgrounds |
| `--color-text` | `#0F172A` | Primary text |
| `--color-muted` | `#64748B` | Secondary text, labels |
| `--font-base` | `Helvetica Neue, Helvetica, Arial, sans-serif` | All text |

### Role-based rendering

When a user logs in, Supabase Auth returns a session. The frontend fetches the user's role from the `employees` table using the Supabase JS client. This role is stored in a JavaScript module-level variable accessible across all page scripts. The sidebar renders only the routes the logged-in user's role is permitted to see. If a role cannot access a module, that navigation item does not appear.

This is UI-level control only. The actual data protection lives in Supabase Row Level Security policies — described in Section 3.

### Key frontend principles

- No sensitive logic lives on the frontend
- The Supabase anon key in `config.js` is safe to expose — it is a public key by design, and Supabase Row Level Security enforces all data access rules regardless
- The Supabase service role key is never used on the frontend under any circumstance
- All complex business logic (approval flows, file validation, notifications) runs in Supabase Edge Functions, not in browser JavaScript

---

## 2. Backend Logic

**Technology: Supabase Edge Functions**

There is no traditional backend server. Server-side logic runs as Supabase Edge Functions — small serverless functions hosted and managed by Supabase, called via HTTP from the frontend when needed.

### What Edge Functions handle

- File upload validation (checking LinkedIn/Instagram export sheet names before accepting)
- Approval flow triggers (notifying the next approver when a step completes)
- Scheduled jobs (11 PM timesheet reminder, triggered via an external cron service calling the function)
- Google Drive API operations that require sensitive credentials (ownership transfers on employee exit)
- Any operation that requires the Supabase service role key (which cannot be on the frontend)

### What does not need an Edge Function

Most read and write operations go directly from the frontend to Supabase via the JS client. Creating a timesheet entry, fetching client data, submitting a reimbursement claim — all of these are standard database operations protected by Row Level Security and handled without an Edge Function.

Edge Functions are invoked only when the operation requires server-side credentials, external API calls with secret keys, or logic that must not be visible or modifiable from the browser.

### Scheduled notifications

Supabase Edge Functions do not self-schedule. For the 11 PM timesheet reminder, a free external cron service (cron-job.org) is configured to call a specific Edge Function endpoint every night at 11 PM. The function queries the database for employees who have not submitted their timesheet and writes a notification record for each one. No additional infrastructure is needed.

---

## 3. Database

**Technology: Supabase (PostgreSQL)**

All structured data lives in a PostgreSQL database managed through Supabase. The frontend queries and writes to this database directly using the Supabase JavaScript client library, loaded via CDN in each HTML page.

Supabase handles no file storage — that responsibility sits entirely with Google Drive.

### How the Supabase JS client is loaded

Each HTML page includes the Supabase client from the CDN:

```html
<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
```

`config.js` initializes the client once:

```js
const SUPABASE_URL = 'https://sagqqcctagolalfrezwg.supabase.co'
const SUPABASE_ANON_KEY = 'your-anon-key-here'
const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
```

All other JS files reference this `supabase` instance via `api.js`.

### Core Tables

| Table | Key Fields |
|---|---|
| employees | Employee ID, name, email, role, department, manager ID (self-referencing FK), joining date, status |
| clients | Client ID (PK), Project Code (unique), client name, category, status, created by, created at |
| client_entities | Entity ID, Client ID (FK), entity name |
| client_platforms | Platform ID, Client ID (FK), platform name |
| scope_of_work | SOW ID, Client ID (FK), platform, deliverable type, agreed monthly quantity |
| client_assignments | Employee ID (FK), Client ID (FK) |
| timesheets | Entry ID, Employee ID, Client ID, Project Code, task, date, hours, status, approved by, rejection comment |
| leaves | Leave ID, Employee ID, type, start date, end date, status, approved by, Team Lead ID |
| master_folder_files | File ID, Client ID, month, folder type, file name, Google Drive file ID, Google Drive URL, uploaded by, uploaded at, deleted at |
| performance_data | Record ID, Client ID, platform, date range, metrics, uploaded by, uploaded at, superseded flag |
| assets | Asset ID, name, type, status, assigned to (Employee ID) |
| reimbursements | Claim ID, Employee ID, Client ID, amount, expense type, date, Google Drive receipt URL, status, Team Lead ID |
| approvals | Approval ID, entity type, entity ID, level, status, approver ID, comment, created at, acted at |
| notifications | Notification ID, recipient Employee ID, type, message, module, record ID, read status, created at |

### Row Level Security (RLS)

RLS policies are set directly on every database table in Supabase. These policies enforce role-based access at the database level — not just the UI. Even if a user manipulated the frontend JavaScript, the database would refuse to return data their role is not permitted to see.

Examples:
- A Delivery team member can only read timesheet rows where `employee_id` matches their own user ID
- Commercial data columns in the clients table are only readable by rows where the requesting user's role is `bde` or `founders_office`
- A Team Lead can read timesheet rows where the employee's `manager_id` matches the Team Lead's user ID

RLS is the primary security layer for all data access.

### Key database principles

- Client ID is the primary key for all client-related joins
- Project Code is stored in the timesheets table for human readability but is never used as a foreign key
- Deleted files in Master Folders are soft-deleted — the `deleted_at` timestamp is set rather than physically removing the record
- Superseded performance data is flagged, not deleted, so the full upload history is always available
- The manager ID in the employees table is a self-referencing foreign key — the org structure lives in one table
- The approvals table is centralized across all modules (timesheet, leave, reimbursement, asset, tool)

---

## 4. File Storage

**Technology: Google Drive (via Google Drive API)**

All files uploaded through the system are stored in Google Drive. Supabase stores only the file metadata (name, Drive file ID, URL, uploaded by, uploaded at).

The two storage models remain unchanged from the original architecture:

### Model A — Delivery Team (Shared Drive)

Files go into a shared Google Drive folder owned by `contact@thegrowthic.com`. Structure:

```
contact@thegrowthic.com's Drive
  /Master Folders
    /[client-name]
      /[year]
        /[month]
          /approved-content
          /creatives
          /reports
```

### Model B — Other Functions

Non-delivery files (reimbursement receipts, HR documents) are uploaded to the individual user's own Google Drive.

### Google OAuth

Users connect their Google account via OAuth from within the app. The OAuth token is stored securely and used for all subsequent uploads from that user.

### Sensitive Drive operations

Operations that require the service account credentials (ownership transfer on employee exit) run as Supabase Edge Functions, not from the browser.

---

## 5. Authentication

**Technology: Supabase Auth**

### How a new employee gets access

1. HR creates an employee profile in the system
2. A Supabase Edge Function is triggered that calls the Supabase Admin API to generate an invite link for that email
3. Supabase sends the invite email automatically
4. The employee clicks the link, sets their password, and lands on the app
5. On every subsequent login, Supabase Auth issues a session token
6. The frontend uses this session to fetch the user's role from the `employees` table
7. The role governs what the sidebar shows and what RLS policies allow

### Session management

Sessions are managed by the Supabase JS client automatically — tokens are refreshed without any manual handling. When a user logs out or HR deactivates their account, the session is invalidated.

---

## 6. Data Flow

How a typical request moves through the system:

```
User action on frontend
        |
        v
JavaScript in the browser calls Supabase JS client
(session token included automatically)
        |
        v
Supabase Auth verifies the session token
        |
        v
Row Level Security policy checks user role and data ownership
        |
        v
Query runs and returns only permitted data
        |
        v
If action triggers complex logic (approval, file op, notification):
frontend calls a Supabase Edge Function via HTTP
        |
        v
Edge Function runs server-side logic with secure credentials
        |
        v
Result returned to frontend — UI updates
```

---

## 7. Hosting and Deployment

**Hosting: Hostinger Shared Hosting**

The entire frontend is a set of static files uploaded to Hostinger's `public_html` folder. No build step. No compilation. Edit a file, upload it, done.

### Deployment process

1. Make changes to files locally (or directly in the repository)
2. Upload changed files to `public_html` via Hostinger's File Manager or FTP
3. Changes are live immediately

### Environment separation

| Environment | Purpose |
|---|---|
| Development | Files edited and tested locally using a browser + a local server (VS Code Live Server extension). Connects to the Supabase dev project. |
| Production | Files in Hostinger `public_html`. Connects to the Supabase production project. |

The only difference between environments is the Supabase URL and anon key in `config.js`. A `config.dev.js` and `config.prod.js` can be maintained, with the active one renamed to `config.js` before upload.

No development or test activity ever touches the production Supabase project.

---

## 8. Key Technical Rules

- The Supabase anon key in `config.js` is intentionally public — it is safe to expose. Supabase Row Level Security is what protects the data, not key secrecy.
- The Supabase service role key is never placed in any frontend file under any circumstance. It lives only in Supabase Edge Function environment variables.
- All complex or sensitive server-side operations run as Supabase Edge Functions.
- All file storage goes through Google Drive. Supabase stores only metadata.
- The Delivery team's Master Folder files go into the shared Drive owned by `contact@thegrowthic.com`. All other functions upload to their own Drives.
- When a team member is deactivated, Google Drive file ownership transfer is handled by a Supabase Edge Function using a service account — not from the browser.
- Role-based access is enforced at the database level through Supabase RLS policies. The sidebar and UI reflect the role, but RLS is the actual enforcement layer.
- File deletions are soft deletes. No file or performance data record is ever permanently removed from the database.
- Every Supabase query runs with the logged-in user's session. Anonymous or unauthenticated queries are blocked by RLS.
- Development and production environments use separate Supabase projects. Test data never touches production.
- The org structure lives in the employees table as a self-referencing foreign key. There is no separate org chart table.
- The approvals table is centralized. All approval flows across all modules route through it.
- Client ID is the backend key. Project Code is the frontend label. They are permanently linked but serve different purposes.
