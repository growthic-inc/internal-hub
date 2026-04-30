# Growthic One — Engineering Logic

**Living document. Updated with every phase.**

This document captures the reasoning behind how Growthic One is built — the decisions made at every fork, the patterns chosen and why, and the logic that connects the system together. It is not a description of what was built (see `product_description.md` for that) or a list of what changed (see `Changelog.md` for that). It is an explanation of how and why.

---

## Table of Contents

1. [Stack Philosophy](#1-stack-philosophy)
2. [Frontend Architecture](#2-frontend-architecture)
3. [Module Pattern](#3-module-pattern)
4. [SPA Router](#4-spa-router)
5. [Access Control System](#5-access-control-system)
6. [Identity and Authentication Model](#6-identity-and-authentication-model)
7. [Database Design Principles](#7-database-design-principles)
8. [Edge Functions — What Goes Server-Side](#8-edge-functions--what-goes-server-side)
9. [Google Drive Integration](#9-google-drive-integration)
10. [HR Engine — Phase 7 Decisions](#10-hr-engine--phase-7-decisions)
11. [Naming Conventions](#11-naming-conventions)
12. [CSS Architecture](#12-css-architecture)
13. [Phase Build Order — Why This Sequence](#13-phase-build-order--why-this-sequence)
14. [Decision Log](#14-decision-log)

---

## 1. Stack Philosophy

The stack was chosen to match the builder, the team, and the hosting environment — not to demonstrate technical sophistication.

**Vanilla JS, no build step.**
This is a 15–18 person company. The system is built by one person. Every technology that requires a compilation step, a local build server, or a CI/CD pipeline to deploy is a maintenance burden that has no return. Vanilla HTML, CSS, and JavaScript can be edited in any text editor, uploaded via FTP, and are live immediately. The cost of that simplicity is zero.

**Supabase over a custom backend.**
There is no Express server, no API layer, no Docker container. The frontend talks directly to Supabase using the JS client. Supabase handles auth, real-time subscriptions, storage metadata, and PostgreSQL with Row Level Security. The only "backend" that exists is Supabase Edge Functions for the handful of operations that genuinely require server-side execution.

**Google Drive over S3 or Supabase Storage.**
The company already uses Google Drive. Files uploaded through the system live in the same Drive the team uses day-to-day. When the system doesn't exist, people can still access their files. There is no proprietary file storage silo that would create lock-in or require migration.

**The fundamental rule: every technology decision must be explainable in one sentence to a non-technical founder.**

---

## 2. Frontend Architecture

### The single HTML shell

The entire application lives inside one HTML file: `app/home/index.html`. There is no routing between HTML pages. Everything — every module, every view — is rendered into the `#page-content` div by JavaScript. This is a classic Single Page Application (SPA), but built without a framework.

This means:
- One authentication check on load, not on every page
- The sidebar, header, and chrome are persistent — they do not re-render on navigation
- All JavaScript files are loaded once and stay in memory

### Script loading order matters

The HTML file loads scripts in a specific order. This order is a dependency chain:

```
config.js       → sets up the Supabase client
utils.js        → pure helpers, no dependencies
auth.js         → depends on Supabase client from config.js
api.js          → depends on Supabase client; exports API object
[page modules]  → each depends on API, Utils; loaded before app.js
app.js          → loaded last; calls all page modules by reference
```

`app.js` must be last because it references every page module (`People`, `LeaveTracker`, `Announcements`, etc.) by their global variable names. If a page module hasn't loaded yet, `app.js` would reference `undefined`.

### Why no module bundler

A bundler (Webpack, Vite, esbuild) would solve the ordering problem automatically through import statements. The decision not to use one is intentional: bundlers add a build step, a `node_modules` folder, a `package.json` to maintain, and a local dev server requirement. The tradeoff of managing script order manually is much lower than managing a build pipeline.

---

## 3. Module Pattern

Every page module follows the same structure:

```js
const ModuleName = (() => {
  // Private state
  let _user = null
  let _data = []

  // Render: returns HTML string synchronously
  function render(user) {
    _user = user
    return `<div class="page-inner">...</div>`
  }

  // Init: called after render(), attaches events and fetches data
  async function init(user) {
    _user = user
    await _loadData()
    _bindEvents()
  }

  return { render, init }
})()
```

**Why IIFE (Immediately Invoked Function Expression)?**
Each module is a closure. Everything inside the IIFE is private to that module — state, helper functions, cached data. Nothing leaks into the global scope except the single exported object (`ModuleName`). This is the JavaScript equivalent of a class with private fields, without requiring any build step or transpilation.

**Why `render` returns HTML instead of writing to the DOM directly?**
`app.js` does: `content.innerHTML = pageModule.render(currentUser)`. The page module has no knowledge of where in the DOM it will be placed. Separating HTML generation from DOM insertion means the module is portable and testable.

**Why two functions — `render` and `init` — instead of one?**
The shell needs the HTML in the DOM before event listeners can be attached (you cannot call `addEventListener` on an element that doesn't exist yet). The pattern guarantees: render first (puts HTML in DOM), then init (attaches listeners and fetches async data).

**`init` is optional.**
Modules that are purely static or read-only may not need an `init`. `app.js` checks `if (pageModule.init) pageModule.init(currentUser)` before calling it.

---

## 4. SPA Router

Routing uses the URL hash (`#route-id`). Navigation is handled by `window.addEventListener('hashchange', router)`.

```
URL: /app/home/index.html#leave-tracker
Hash: leave-tracker
NAV item match → module: () => LeaveTracker
```

**Why hash routing instead of History API?**
Hash routing works on Hostinger shared hosting with zero configuration. History API (`/app/leave-tracker`) requires server-side URL rewriting (an `.htaccess` rule pointing all paths to `index.html`). That's fragile on shared hosting. Hash routing is simpler and more portable.

**The default route is dynamic.**
When the app loads with no hash, `_getDefaultRoute()` returns the first module the current user has access to. For a Super Admin that is always Client Dashboard. For an employee whose department has no access to Client Dashboard, it might be Timesheet or People. No route is hardcoded as "the default."

**Access is checked at route load time.**
When a user navigates to a hash directly (e.g., pasting `#client-dashboard` in the URL), the router checks `_canViewModule(navItem)`. If the user does not have access, they are silently redirected to their default accessible route. There is no error page for direct URL access — unauthorized routes just don't work.

---

## 5. Access Control System

### Two layers: matrix + RLS

Access is enforced in two places:

1. **Frontend access matrix** — controls what the UI shows and what actions are presented
2. **Supabase Row Level Security** — controls what data the database actually returns, regardless of what the frontend does

These two layers are independent. The matrix can be circumvented by a determined user with browser dev tools — RLS cannot. The matrix is a UX layer. RLS is the security layer.

### The access matrix

The `access_matrix` table stores rows with the shape:
```
(department, module, feature, access_level)
```

Access levels form an ordered hierarchy:
```
no_access → view_only → can_upload → can_edit → can_manage → can_approve
    0            1           2           3           4             5
```

`App.hasAccess(module, feature, minLevel)` takes a module key, a feature key, and a minimum required level. It returns `true` if the logged-in user's department has that level or higher for that feature.

**Why department-level, not individual-level?**
Individual access control means HR has to manage a permission row for every person. Department-level means HR configures it once and everyone in that department inherits it. Edge cases (one person in a department needs different access) are handled by changing that person's department, not by adding a permission override system.

**Why a numeric hierarchy instead of boolean flags?**
A boolean `can_view` / `can_edit` system requires two columns per feature. With a hierarchy, one value encodes both. `can_manage` implies `can_edit` implies `view_only` — you do not need to check multiple flags.

### Super Admin bypass

```js
if (_matrix === null) return true  // super_admin bypass
```

When `currentUser.role === 'super_admin'`, `_matrix` is set to `null` (not an empty object). Every `hasAccess` check short-circuits to `true`. This is intentional — the super admin should never be blocked by the access matrix, even if no matrix rows exist.

**Why null and not an empty object?**
An empty object `{}` and a missing key both return `false` in `hasAccess`. If `_matrix` were `{}` for super admins, every check would return `false` and the super admin would see nothing. Using `null` as a sentinel for "full access" removes any ambiguity.

### Sidebar visibility

A module appears in the sidebar if the user's department has any feature in that module with access > `no_access`. The check does not look for a specific feature — it asks: "does this department have any presence in this module at all?" This means HR can configure partial access to a module (e.g., view-only on client dashboard) and the module still appears.

One exception: `access-control` has a `visibilityFeature` override that requires specifically `manage_access >= can_manage`. This nav item should only appear for departments explicitly granted control-panel access, not just any presence in `people_hrms`.

---

## 6. Identity and Authentication Model

### Email is the identity key, not `auth.uid`

Throughout the system, users are identified by their email address, not by Supabase's `auth.uid`. RLS policies are written as:

```sql
EXISTS (
  SELECT 1 FROM public.employees
  WHERE email = (auth.jwt() ->> 'email')
  AND ...
)
```

**Why email and not `auth.uid`?**
The `employees` table was the first table built. At that point, there was no guaranteed 1:1 link between `auth.uid` and an `employees.id`. Email is the field that exists in both `auth.users` and `employees`. Using email as the bridge means the two systems stay in sync as long as the email matches — and email is always present in the JWT.

The tradeoff: if someone's email changes, their auth identity and their employee record must be updated together. For a company of 15 people, this is an acceptable operational risk.

### Invite-only access

No one can self-register. The flow is:

1. HR creates an employee record in the `employees` table
2. HR triggers the `invite-employee` Edge Function
3. The Edge Function calls the Supabase Admin API with the service role key to generate a magic link
4. Supabase sends the invite email
5. Employee sets their password and gets access

This means the Supabase Auth user database and the `employees` table are always in sync — you cannot have an Auth user without an employee record, and the employee record always comes first.

### Sessions

Supabase JS client handles session management automatically — token refresh, persistence in localStorage. The app calls `Auth.requireAuth()` on load, which checks for an active session and redirects to the login page if none exists. There is no custom session handling.

---

## 7. Database Design Principles

### Client ID vs Project Code

Every client has two identifiers:

- **Client ID** — UUID, primary key, used for all foreign keys in the database
- **Project Code** — human-readable string (e.g., `CRYSTA`, `GLOBAL`), used in the UI

The database always uses Client ID. The UI always shows Project Code. The two are permanently linked. Project Code is stored alongside Client ID in transactional tables (timesheets, reimbursements) purely for human readability — so a report exported from the database is legible without a join.

### Self-referencing foreign key for org structure

The entire org hierarchy lives in one field: `employees.manager_id` references `employees.id`. There is no separate org chart table, no hierarchy table, no adjacency list table. The tree is computed on-demand using a recursive CTE (`get_org_chart()` RPC).

This means: changing the org structure is a single `UPDATE` on one row. There is nothing to keep in sync.

### Soft deletes everywhere

Nothing is ever permanently deleted:
- Files in Master Folders set `deleted_at` (soft delete)
- Performance data uploads are flagged `superseded = true`, not removed
- Leave requests that are cancelled retain their record with `status = 'cancelled'`

Why: audit trail. For a company managing client deliverables and employee leave, the ability to ask "what happened and when" is always worth the storage cost.

### Centralized approvals table

There is a single `approvals` table that handles approval steps for every module — timesheets, reimbursements, assets, tools. Each row references `entity_type` and `entity_id` to point back to the originating record.

Why not separate approval tables per module? Because the approval flow logic (notify → approve/reject → notify again) is identical across all modules. Centralizing it means one place to query "what do I need to approve today?" regardless of module.

### Dynamic departments (no CHECK constraints)

Departments are stored as slugs in `employees.department` (e.g., `people_culture`, `content_strategy`). The valid slug list lives in a `departments` table, not in a PostgreSQL `CHECK` constraint.

**Why not CHECK constraint?**
A `CHECK` constraint on `employees.department` requires a migration to add or rename a department. A `departments` table allows HR to add a department at runtime without touching the schema. The tradeoff is that a typo in a department slug would not be caught at the DB level — but for a 15-person company configured by HR through a UI, this is an acceptable tradeoff.

---

## 8. Edge Functions — What Goes Server-Side

The rule is simple: **an operation goes into an Edge Function if and only if it requires one or more of:**

1. The Supabase service role key (bypasses RLS — can never be in the browser)
2. A Google Service Account private key (signs JWTs for Drive API — can never be in the browser)
3. An external API call that requires a secret credential
4. Logic that must be guaranteed to run (cannot be skipped by browser manipulation)

Everything else stays in the browser. Creating records, updating status, reading data with RLS — all of that goes directly from the frontend to Supabase via the JS client.

### Current Edge Functions

| Function | Why server-side |
|---|---|
| `invite-employee` | Uses Supabase service role key to call Admin API and generate invite links |
| `upload-client-doc` | Uses Google Service Account key to upload to Drive and set permissions |
| `upload-receipt` | Same — Drive upload with service account |
| `upload-to-drive` | Generic Drive upload wrapper with service account |
| `upload-announcement-file` | Drive upload; announcements folder path uses service account |
| `upload-policy-file` | Drive upload; returns both `driveUrl` and `driveFileId` |

### The Drive upload pattern

All Drive Edge Functions follow the same shape:

```
1. Validate JWT from request → extract email → verify employee exists
2. Parse multipart form data (file + metadata)
3. Build folder path for this file type
4. Call findOrCreateFolder() recursively for each path segment
5. Upload file bytes to the leaf folder
6. Set public read permission on the file
7. Transform URL from /file/d/{id}/view to shareable form
8. Return { driveUrl, driveFileId }
```

The folder structure is created lazily — if a folder for `2026/04-April` does not exist yet, it is created on the first upload for that month. There is no folder pre-provisioning step.

---

## 9. Google Drive Integration

### Why Google Drive and not Supabase Storage

Supabase Storage would be simpler to wire up — it's the same platform. The decision to use Drive instead comes down to one thing: the company already runs on Drive. Files uploaded through the hub should be accessible outside the hub without needing to log into a new system. If the hub goes down, files are still on Drive.

### Service account, not OAuth

All Drive uploads use a Google Service Account — a non-human Google identity with its own credentials. The service account owns the folder structure and can write to it without any user interaction.

The alternative (user OAuth) would require every employee to authorize their Google account in the app and then upload files to their own Drive. That would scatter client deliverables across 15 different personal Drives — the opposite of what Master Folders is supposed to be.

The service account owns one root Drive folder. All company files go under that root. The company controls everything, not individual employees.

### Folder structure as data

The path of a file encodes its metadata:

```
Master Folders / [client-name] / [year] / [month] / [folder-type] / filename
Announcements  / [year] / [month-name] / filename
Policies       / [category-name] / filename
```

This means the folder structure is self-documenting in Drive. An HR person browsing Drive directly can find a policy document without knowing anything about the database.

### URL transformation

Google Drive returns a URL of the form:
```
https://drive.google.com/file/d/{fileId}/view
```

This URL is stored in the database and used directly in the UI as a "View" link. No transformation is needed for the frontend — the `/view` URL is publicly accessible for files with the `anyone with link can view` permission set.

---

## 10. HR Engine — Phase 7 Decisions

### Approval routing: manager_id, not role

When an employee applies for leave, the `approver_id` on the leave request is set to their `manager_id` at submission time. The manager reviews their queue via `getPendingLeaveApprovals(approverId)`.

If `manager_id` is `null` (e.g., the CEO, or someone not yet assigned a manager), `approver_id` is also `null`. The HR team sees all `null`-approver requests via `getHRLeaveQueue()`.

**Why snapshot the approver at submission, not derive it dynamically?**
If a manager changes mid-approval, the approval should still go to whoever was the manager when the request was submitted. Storing `approver_id` as a snapshot at submission time preserves this. A dynamic lookup (`WHERE manager_id = ?`) would silently re-route requests to a new manager who never knew the request existed.

### Leave balances: credit model

Leave balances are not stored as a number. They are computed:

```
balance = SUM(credits.days) - SUM(approved_leave_requests.days)
```

`leave_credits` rows are the positive side — HR manually credits days at the start of each year (or on joining). Approved leaves are the debit side, computed from `leave_requests`.

**Why not a stored balance column?**
A stored balance goes stale whenever a request is retroactively cancelled, modified, or a historical credit is corrected. A computed balance is always accurate because it is derived from the source records, not maintained separately.

### Sandwich policy

The leave day count includes all calendar days in the range:

```js
days = Math.round((endDate - startDate) / 86400000) + 1
```

If the period spans a weekend (Saturday, Sunday), those days count. If it spans a public holiday, those days count. This is the sandwich policy: taking leave around a weekend means the weekend days are consumed too.

The rationale is operational simplicity. Excluding weekends would require maintaining a work-week calendar and applying it per-employee (some roles work weekends). Calendar days removes that complexity entirely.

### Timesheet integration: overlay, not write

When a leave is approved, the system does **not** create blocked timesheet entries. Instead, the timesheet UI queries `leave_requests` independently and overlays the approved days visually (greyed-out cells).

**Why overlay instead of writing to timesheets?**
Writing to timesheets means every approved leave creates a timesheet row. That row would need to be cleaned up if the leave is cancelled. It would appear in timesheet approval queues (confusingly). It would inflate hour totals. The leave record and the timesheet record would need to stay in sync forever.

Overlay keeps the two systems independent. Leave is leave. Timesheets are timesheets. The UI bridges them at render time.

### Manager detection: relationship, not role

The Leave Tracker determines if a user is a manager by checking:

```js
const _isManager = _employees.some(e => e.manager_id === _user.id)
```

If any active employee has this user as their `manager_id`, they are a manager. The system does not check the access matrix for a special "team lead" role or a "can_approve" flag.

**Why relationship-based?**
The access matrix controls what features a department can use. But whether someone has direct reports is a fact about the org structure, not about department-level permissions. Decoupling these means an employee in the content team who manages interns automatically gets the approval queue without HR needing to grant them a special permission.

### WFH quotas: partial indexes instead of UNIQUE NULLS NOT DISTINCT

`wfh_quotas` can be either department-wide (when `employee_id` is NULL) or individual (when `department` is NULL). The uniqueness constraint needs to be applied differently for each scope. Rather than `UNIQUE NULLS NOT DISTINCT` (a PostgreSQL 15+ feature), two partial indexes are used:

```sql
CREATE UNIQUE INDEX wfh_quota_dept_uidx ON wfh_quotas (department, month, year) WHERE department IS NOT NULL;
CREATE UNIQUE INDEX wfh_quota_emp_uidx  ON wfh_quotas (employee_id, month, year) WHERE employee_id IS NOT NULL;
```

This is more portable across PostgreSQL versions and semantically clearer — each index documents exactly what constraint it enforces.

---

## 11. Naming Conventions

### Employee IDs: GRW-001

Every employee gets an auto-generated ID in the format `GRW-{3-digit-padded-sequence}`. This is generated by a PostgreSQL trigger on `INSERT` to the `employees` table using a `SEQUENCE`.

**Why**: Human-readable IDs are easier to reference in HR conversations ("GRW-007 is on leave") than UUIDs. The padded sequence (`001`, not `1`) keeps them lexicographically sortable.

### Module names in JS: match the IIFE export

The exported IIFE name matches what `app.js` references in the `NAV` array:

| File | IIFE export name | NAV reference |
|---|---|---|
| `people.js` | `const People = ...` | `module: () => People` |
| `leave-tracker.js` | `const LeaveTracker = ...` | `module: () => LeaveTracker` |
| `announcements.js` | `const Announcements = ...` | `module: () => Announcements` |
| `policies.js` | `const PoliciesModule = ...` | `module: () => PoliciesModule` |

`PoliciesModule` is the only exception — named with the `Module` suffix to avoid a potential conflict with a native JS `policies` keyword or future browser API. When in doubt, a more specific name wins.

### Database tables: snake_case plural

All tables: `employees`, `leave_requests`, `leave_types`, `wfh_quotas`, `announcements`, `policy_documents`, `policy_categories`, `departments`, `leave_credits`.

No table names collide with PostgreSQL reserved words. `leaves` (the English word) was avoided in favour of `leave_requests` to prevent confusion with the SQL `LEAVE` keyword.

### Access matrix module keys: snake_case, descriptive

`client_dashboard`, `client_repository`, `timesheet`, `people_hrms`, `leave_tracker`, `announcements`, `policies`. These are the strings that live in the `access_matrix` table's `module` column and in `app.js`'s `ROUTE_MODULE` map. They must match exactly.

### CSS class prefixes: module-scoped

Each module owns a prefix for its component classes:

| Prefix | Module |
|---|---|
| `.ann-` | Announcements |
| `.lt-` | Leave Tracker |
| `.pol-` | Policies |
| `.people-` | People / HR |
| `.org-` | Org chart nodes |

Global components (cards, tables, buttons, modals) live in `components.css` without a module prefix. Module-specific components are appended to the same file but clearly sectioned with a comment block.

---

## 12. CSS Architecture

### Two files, one responsibility each

**`style.css`** — global design tokens, layout, typography. Everything that defines what the product looks and feels like. This file should never need to change unless the brand changes.

**`components.css`** — every reusable UI component. Cards, tables, modals, drawers, badges, toasts, buttons, form fields. New module components are appended here in clearly commented sections.

### CSS custom properties as the single source of truth

All colors, spacing scale, border radii, and font sizes are defined as CSS custom properties at `:root`. No magic numbers anywhere in the codebase. When a color needs to change across the app, one line changes in `style.css`.

### Brand tokens

| Token | Hex | Use |
|---|---|---|
| `--color-primary` | `#0F4799` | Primary actions, active states, links |
| `--color-secondary` | `#45BBF0` | Highlights, hover states |
| `--color-success` | `#1D9E75` | Approved, positive indicators |
| `--color-warning` | `#F59E0B` | At risk, pending |
| `--color-danger` | `#EF4444` | Rejected, errors, off-track |
| `--color-surface` | `#F8FAFC` | Card and panel backgrounds |
| `--color-text-muted` | `#64748B` | Labels, secondary text |

### No JavaScript-in-CSS, no CSS-in-JS

Styles live in CSS files. Components render HTML strings with class names. The classes get styled in CSS. Inline styles are only used for dynamic values that CSS cannot compute from a class alone (e.g., a progress bar width set from a JS variable). The boundary is respected across the entire codebase.

---

## 13. Phase Build Order — Why This Sequence

### Foundation (Phase 0)

Auth, session management, the Supabase project, the `employees` table, and the nav shell. Nothing else is possible without these. Every module needs a logged-in user; the nav shell is where every module lives.

### Delivery Layer (Phases 1–2)

Client Dashboard, Timesheet, Master Folders, Client Directory. Built first because the delivery team is the largest group of daily users and their work generates the most data. Client Directory was built before Client Dashboard because the dashboard has no meaning without clients.

### Shared Services (Phases 3–4)

Reimbursements, Tools & Subscriptions, Assets, Notifications, Settings. These are universal — every employee uses them. They were built after the delivery layer because they depend on clients (for project code linking) and employees (for the request/approval relationship) already existing.

### Access Control Matrix (Phase 5)

The permission system was built after the modules it controls. This is the right order: you cannot design an access matrix before you know what modules and features exist. The matrix was designed by auditing all modules already built and listing their features.

### HR Layer (Phases 6–7)

The full HR engine — People directory, Leave Tracker, Announcements, Policies — came after everything else because it is the most self-contained layer. The HR modules do not depend on client data. They depend only on the `employees` table, which was the very first thing built.

---

## 14. Decision Log

Specific decisions made at forks in the design. Recorded so the reasoning does not get lost.

---

### 2026-04 — Vanilla JS over React / Vue

**Decision**: No JavaScript framework.

**Reason**: One builder, no team to onboard to a framework, hosting on shared hosting that does not support Node.js. The build-time and maintenance overhead of a framework exceeds the benefit at this scale.

**Tradeoff**: No component reactivity out of the box. State changes require manually re-rendering sections of the page. This is managed by convention: each module keeps its own state and calls `_render()` functions when state changes.

---

### 2026-04 — Email as identity bridge (not auth.uid)

**Decision**: RLS policies use `auth.jwt() ->> 'email'` to identify the logged-in user, not `auth.uid()`.

**Reason**: The `employees` table was created before deciding how to link it to Supabase Auth. Email is the guaranteed shared field. Switching to `auth.uid` would require adding and populating an `auth_id` column across the schema.

**Tradeoff**: Email changes require updating both auth and employees records. Acceptable risk for a company where email changes rarely if ever.

---

### 2026-04 — Hash routing over History API

**Decision**: Navigation uses `window.location.hash` (`#route-id`), not `history.pushState`.

**Reason**: Hostinger shared hosting does not have a straightforward `.htaccess` rewrite configuration for SPAs. Hash routing works without any server configuration.

**Tradeoff**: URLs look like `index.html#leave-tracker` rather than `/leave-tracker`. No SEO impact — the app is internal and behind authentication.

---

### 2026-04 — Centralized approvals table

**Decision**: One `approvals` table for all approval flows across all modules.

**Reason**: The approval logic (submit → notify → approve/reject → notify) is identical for timesheets, reimbursements, assets, and tools. Centralizing it means one query can return everything a user needs to action today, regardless of module.

**Tradeoff**: Queries against `approvals` always require knowing `entity_type` to join back to the originating record. Slightly more complex JOINs.

---

### 2026-04 — Leave balance via credit model (not stored number)

**Decision**: Leave balance is computed as `SUM(credits) - SUM(approved_days)`, not stored as a balance column.

**Reason**: A stored balance column goes out of sync when leaves are retroactively cancelled, credit corrections are made, or historical records are adjusted. A computed balance is always consistent with the underlying data.

**Tradeoff**: Balance queries require aggregations instead of a single field read. Acceptable at this scale.

---

### 2026-04 — Timesheet/leave integration: overlay, not write

**Decision**: Approved leaves do not write rows to the `timesheets` table. The timesheet UI queries `leave_requests` and overlays approved days visually.

**Reason**: Writing to timesheets on leave approval creates tight coupling — every leave cancellation would need to find and delete the corresponding timesheet rows. It also confuses timesheet approval queues (managers would see leave-generated rows in their approval queue).

**Tradeoff**: The timesheet UI must query two tables instead of one. The overlay logic lives entirely in the frontend.

---

### 2026-04 — Dynamic departments table (not CHECK constraint)

**Decision**: Valid department slugs are stored in a `departments` table. The `employees.department` column has no CHECK constraint.

**Reason**: A CHECK constraint requires a schema migration to add or rename a department. A table allows HR to manage departments at runtime through the UI.

**Tradeoff**: Invalid slugs are not caught at the DB level. Mitigated by the People module always selecting from the `departments` table when rendering department dropdowns.

---

### 2026-04 — Partial indexes over UNIQUE NULLS NOT DISTINCT for WFH quotas

**Decision**: Two partial unique indexes instead of `UNIQUE NULLS NOT DISTINCT`.

**Reason**: `UNIQUE NULLS NOT DISTINCT` requires PostgreSQL 15+. The Supabase project version may not support it. Partial indexes are universally supported and more semantically explicit — each index documents exactly its scope (department-wide vs individual).

**Tradeoff**: Two indexes instead of one. No material performance impact at this table size.

---

### 2026-04 — PoliciesModule naming (not Policies)

**Decision**: The policies IIFE is exported as `PoliciesModule`, not `Policies`.

**Reason**: `Policies` is generic enough to conflict with a future browser API or an existing variable name somewhere in scope. The `Module` suffix makes the intent unambiguous.

**Tradeoff**: Slight inconsistency with other module names. All other modules use their plain name (`People`, `LeaveTracker`, `Announcements`).

---

*Growthic (Apinzo Technologies) — Internal Engineering Document*
*Started: April 2026 — Updated continuously with each phase*
