# Phase 7 Build Plan — People, Leave Tracker, Announcements, Policies

## Step 0 — Run Migration First
Run `Documentation/phase7_migration.sql` in Supabase SQL Editor before any frontend work.

---

## New Files

| File | Purpose |
|---|---|
| `app/assets/js/pages/people.js` | People module (directory, profiles, org chart) |
| `app/assets/js/pages/leave-tracker.js` | Leave + WFH + calendar |
| `app/assets/js/pages/announcements.js` | Announcements feed + reactions |
| `app/assets/js/pages/policies.js` | Policy repository |
| `supabase/functions/upload-announcement-file/index.ts` | Drive upload for announcement attachments |
| `supabase/functions/upload-policy-file/index.ts` | Drive upload for policy files |

## Modified Files

| File | Change |
|---|---|
| `app/assets/js/app.js` | Add 4 new nav items, remove people route from access-control |
| `app/assets/js/api.js` | Add all new query functions |
| `app/assets/js/pages/access-control.js` | Remove employee directory (moves to people.js); keep access matrix panel |
| `app/assets/js/utils.js` | Add `EMPLOYMENT_TYPE_LABELS`, `WORK_LOCATION_LABELS`; pull departments dynamically |
| `app/assets/css/components.css` | Styles for all new modules |
| `app/index.html` | Register new page script tags |

---

## Build Order

### 1. DB Migration
Run phase7_migration.sql — all tables, RLS, seeds, employee_id backfill.

### 2. API Layer (api.js additions)
All new Supabase queries before any UI is built.

### 3. Edge Functions
- `upload-announcement-file` — Drive folder: `1taGMq1_OhhpV8OGtqgnmHPhB_q7wMwpt`
- `upload-policy-file` — Drive folder: `1FcWD--S7r6cyuMQsP7RFZoeHFsDtnD5j`
Both follow the identical pattern to `upload-client-doc`.

### 4. people.js
- Employee directory (searchable, filterable table)
- Employee profile modal (full fields, read-only for non-HR)
- Create/Edit employee form (HR only) — includes profile image upload to Supabase Storage
- Deactivate flow with direct-reports guard
- Org chart view (tree by reporting manager hierarchy, filterable by department)

### 5. leave-tracker.js
- Summary cards (remaining / taken / pending)
- Monthly calendar (colour-coded: approved leave / pending / WFH / holidays / events)
- Upcoming panel (next holidays + approved leaves)
- Apply Leave modal (type, start, end, reason; half-day toggle; sandwich-policy day count shown live)
- Apply WFH modal (dates, reason)
- Leave history list
- Manager view: Pending Approvals section (shown if employee has any direct reports)
- HR view: full team overview, leave credits panel, leave types manager, WFH quotas, holidays manager

### 6. announcements.js
- Feed (newest first, published only for employees; all incl. drafts for HR)
- Reactions bar (7 emoji; toggle on/off)
- HR: Create/Edit/Delete announcement form with optional Drive file attach

### 7. policies.js
- Category-grouped repository (all published policies)
- Search by title or category
- HR: Create/Edit/Delete/Publish policy with Drive file upload
- HR: Manage categories

### 8. access-control.js cleanup
- Remove employee directory section (now lives in people.js)
- Keep access matrix panel intact

---

## Key Architecture Notes

### Approval Routing Logic
When an employee submits a leave or WFH request:
```
if employee.manager_id IS NOT NULL:
    approver_id = employee.manager_id
else:
    approver_id = NULL  ← appears in HR's approval queue
```
The "Pending Approvals" tab is shown to any employee who:
- Has at least one other employee pointing to them as manager (`WHERE manager_id = me`), OR
- Is HR/super_admin (sees NULL-approver requests)

### Leave Balance Calculation (client-side)
```
balance = SUM(leave_credits.credited_days WHERE employee_id AND leave_type_id AND year)
        - SUM(leave_requests.days WHERE employee_id AND leave_type_id AND YEAR(start_date) AND status = 'approved')
```
If balance < 0: show in amber with a warning label — not blocked.

### Sandwich Policy Day Count
```
days = end_date - start_date + 1   // simple calendar days, no exclusions
```
Weekends and company holidays within the range are counted as leave days.
Half-day: `days = 0.5`, `is_half_day = true`.

### WFH Quota Resolution
```
quota = individual quota for (employee, month, year) if exists
      ELSE department quota for (employee.department, month, year) if exists
      ELSE unlimited (no cap set)
```

### Timesheet Integration
Approved leave days are NOT written to the timesheets table.
The timesheet UI reads from `leave_requests` (status='approved') and overlays
matching dates as greyed-out "On Leave" cells. No timesheet entry is created.

### Org Chart Data
Built from a recursive CTE on `employees.manager_id`. No separate hierarchy table needed.
```sql
WITH RECURSIVE org AS (
  SELECT id, name, designation, department, profile_image_url, manager_id, 0 AS depth
  FROM employees WHERE manager_id IS NULL AND status = 'active'
  UNION ALL
  SELECT e.id, e.name, e.designation, e.department, e.profile_image_url, e.manager_id, o.depth + 1
  FROM employees e JOIN org o ON e.manager_id = o.id WHERE e.status = 'active'
)
SELECT * FROM org ORDER BY depth, name;
```
This runs as a Supabase RPC function (`get_org_chart()`).

### Drive Folder IDs (as env vars)
| Variable | Value |
|---|---|
| `GOOGLE_DRIVE_EMPLOYEE_DOCS_FOLDER_ID` | `1mF_IJw-cSu2BJYbqjMBSuqI15gHlClZt` |
| `GOOGLE_DRIVE_ANNOUNCEMENTS_FOLDER_ID` | `1taGMq1_OhhpV8OGtqgnmHPhB_q7wMwpt` |
| `GOOGLE_DRIVE_POLICIES_FOLDER_ID` | `1FcWD--S7r6cyuMQsP7RFZoeHFsDtnD5j` |
