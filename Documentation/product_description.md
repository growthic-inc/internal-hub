# Growthic Internal Hub — Product Description

## Overview

Growthic Internal Hub is a centralised internal web application built for Growthic (Apinzo Technologies), a content marketing agency. It replaces scattered Google Sheets, personal Drive folders, WhatsApp threads, and standalone Google Forms with a single structured system where all workflows connect through two core entities: the **client** and the **employee**.

Every module in the system is linked by a **project code** — a unique identifier assigned to each client at onboarding. This project code acts as the connective thread across timesheets, reimbursements, tool requests, asset management, and client folders.

The system is built for the Delivery team first (P1), followed by HR (P2) and BDE/Sales (P3).

---

## Core Design Principles

- **Client-centric**: Every workflow anchors to a client or employee record
- **Project code as the spine**: All requests, logs, and uploads reference a project code
- **Action-driven**: Every screen has a clear primary action — not just a report
- **Role-aware**: Each user sees only what is relevant to their role
- **Dynamic**: All data updates based on filters — client, entity, platform, date range

---

## Technology Stack (Intended)

- Frontend: Web application (white background, Helvetica font, primary color #2563EB blue, positive indicators #1D9E75 green)
- Data input: File upload (LinkedIn/Instagram CSV/Excel exports) + manual form entries
- Storage: Structured database with client and employee as core objects
- Integrations: Google Drive (Master Folders), Zoho Books (Finance), ClickUp (task reference)

---

## User Roles

| Role | Description |
|---|---|
| Super Admin | Full system access including locked records and system settings |
| Founder's Office | Full access across all modules; oversight and approvals |
| Team Lead | Approves timesheets and reimbursements for their team; full delivery access |
| BDE | Owns client directory, SOW, agreements, and commercial data |
| Delivery Team Member | Logs work, uploads content, raises requests for assigned clients |
| HR | Manages employee records, assets, leaves, hiring, and reimbursement approvals |

---

## Modules

### 1. Client Dashboard

**Purpose**: Performance and delivery control center for each client.

**Who uses it**: Account Managers (input), Team Leads and Founder's Office (view).

**Key features**:
- Filter bar: client dropdown, entity dropdown (visible only for multi-entity clients), platform (LinkedIn/Instagram), project code (auto-filled, read-only), date range (Last 7, 30, 90 days, Custom)
- Upload Data button: opens modal to upload LinkedIn or Instagram Excel/CSV export; system validates file structure automatically; maps columns to internal fields
- Client Status card: compact, max 320px wide, manual update by TL or above; options are On Track (green), At Risk (amber), Off Track (red); shows last updated by name and timestamp
- Six KPI cards: Likes, Engagements, Impressions, Followers Gained, Search and Discovery, Engagement Rate (shown as percentage to 2 decimal places)
- Performance Trend: line graph with multi-select metric toggle; x-axis adapts to selected date range
- Weekly Publishing Activity: bar chart grouped by week based on uploaded data only; no planned vs delivered logic
- SOW Progress: two rows only — Posts (delivered vs planned) and Monthly Reports (uploaded vs expected); progress bar per row; report check pulls from Master Folders
- Top Performing Content: table showing post preview, platform, engagement, impressions for top 3 posts in selected range
- Notes: Wins, Blockers, Observations tabs with text area and timestamp

**Data sources**:
- Uploaded LinkedIn/Instagram export files (KPIs, trend, top posts, weekly activity)
- SOW definition entered by BDE at client onboarding (planned posts)
- Master Folders Reports section (monthly report completion check)
- Manual input by TL (client status)

**LinkedIn file column mapping**:

| LinkedIn export column | Dashboard field |
|---|---|
| ENGAGEMENT sheet → Impressions | Daily Impressions |
| ENGAGEMENT sheet → Engagements | Daily Engagements |
| DISCOVERY sheet → Impressions | Total Impressions |
| DISCOVERY sheet → Members reached | Search and Discovery |
| FOLLOWERS sheet → New followers | Daily Followers Gained |
| TOP POSTS → Post publish date | Post Date |
| TOP POSTS → Engagements | Post Engagements |
| TOP POSTS → Impressions | Post Impressions |

**Engagement Rate calculation**: Total Engagements / Total Impressions × 100

**File validation rule**: System checks for sheets named DISCOVERY, ENGAGEMENT, TOP POSTS, FOLLOWERS. If any of these four are missing, the upload is rejected with an error message.

**Re-upload rule**: New upload for the same client, entity, platform, and period replaces the previous data.

---

### 2. Timesheet

**Purpose**: Log daily work effort linked to client and project code with a two-step approval flow.

**Who uses it**: All employees (log), Team Leads (approve).

**Key features**:
- Two tabs: My Timesheet (all employees) and Approvals (Team Leads only)
- Weekly grid: Task Description, Client, Project Code, Date, Hours, Status columns
- Status flow: Draft → Submitted → Approved / Rejected
- Rejected entries can be edited and resubmitted
- Approved entries are locked and cannot be edited (Super Admin override only)
- Daily totals auto-calculated and shown in blue
- Right summary panel: total hours, approved hours, pending hours, missing days flagged in red
- Approvals tab: TL sees team entries, can approve or reject with a comment
- Notification: if timesheet not submitted by 11 PM, email and in-app notification sent to Team Lead

---

### 3. Master Folders

**Purpose**: Centralised repository for final client deliverables organised by client and month.

**Structure**: Client → Month → Folder Type (Approved Content / Creatives / Reports)

**Who uses it**: All delivery team members (view and download), Account Managers (upload), Team Leads and above (delete/replace).

**Key features**:
- Filters: Client dropdown, Month dropdown
- Three folder cards per client per month: Approved Content, Creatives, Reports
- Each card shows file count and last updated date
- Clicking a folder opens a file list: File Name, Type, Uploaded By, Date, Preview icon, Download icon
- Preview opens a PDF or image viewer modal in-app
- Upload modal: Client, Month, Folder Type, drag and drop area, Title, Description
- Folder structure auto-created when a new client is onboarded by BDE
- Report existence in this folder feeds directly into SOW Progress on the Client Dashboard
- Version control supported

---

### 4. Client Directory

**Purpose**: Central reference for all active clients. Read-only for the delivery team.

**Who uses it**: BDE (create and edit), Delivery team (read), Founder's Office (full including commercial data).

**Active clients**:
- Crystal Crop Protection (entities: Crystal Crop Protection, Ankur Aggarwal) — project code: CRYSTA
- Global Dental Aids (entities: STIM, GDA, Viren Khullar, Vineet Khullar) — project code: GLOBAL
- Dhoomimal Gallery — project code: DHOOMI
- Fareeha Amber Ansari — project code: FAREEHA
- Franchise India Knowledge Services — project code: ACTION
- Indranil Mukherjee — project code: INDRA

**Key features**:
- Search by client name, project code, or account manager
- Client cards in a 3-column grid: name, category badge (Shark/Dolphin/Turtle/Snail), platform icons, project code, AM name
- Clicking a card opens a right-side drawer
- Drawer contents: entity pill tabs for multi-entity clients, Category, Platforms, Assigned Team Members, SOW Summary, Brand Guidelines (View File button), Overview paragraph
- Commercial data (pricing, revenue) hidden from delivery team view
- Primary action: View Files — opens Master Folders with client filter pre-applied
- BDE defines and populates SOW at onboarding; this feeds the SOW Progress section on the Client Dashboard

---

### 5. Tools and Subscriptions

**Purpose**: Manage tool access, track active subscriptions, and handle tool requests.

**Who uses it**: All employees (request), HR and Founder's Office (approve), Super Admin (add/remove tools).

**Current tools tracked**:
- Canva Pro — Creative Team
- Adobe Creative Cloud — Creative Team
- Claude AI — All Teams
- ChatGPT Plus — Content Team
- Gemini Pro — Content Team

**Key features**:
- Available Tools grid: tool name, purpose, teams using, access status
- If user has access: blue Open button
- If user does not have access: blue Request Access button
- Clicking a tool card expands a detail panel showing current users, linked clients, usage notes
- My Requests table: Tool, Reason, Project Code, Status, Date Raised
- Two request types: Request Access (existing tool) and Request New Tool (new purchase)
- Both open a modal: Tool Name, Reason, Project Code (multi-select), Client (auto-filled), Duration, Submit
- On submission: notification sent to HR and Founder's Office for approval
- Status flow: Pending → Approved / Rejected
- On approval: access granted and tool linked to the user's record

---

### 6. Asset Management

**Purpose**: Track company physical assets and manage employee requests.

**Who uses it**: All employees (request), HR (approve and manage inventory).

**Key features**:
- Top summary cards acting as filters: Total Assets, Available, In Use, Overdue
- Clicking a summary card filters the inventory table
- Inventory table: Asset Name, Type, Status (Available/In Use/Pending), Assigned To, Project Code, Assigned Date
- Each row is clickable and opens an Asset Detail panel: full asset info, assigned user, duration, action button
- If available: blue Request button
- If in use: View Details or Request Later option
- Request form: Asset Name (pre-filled), Employee Name (pre-filled), Department, Project Code dropdown, Reason textarea, Duration dropdown
- On submission: HR notified; asset status changes to Pending
- On HR approval: asset marked as In Use and linked to employee record
- My Requests section below table shows status of past requests
- Asset return: HR marks asset as returned and updates inventory

---

### 7. Reimbursements

**Purpose**: Employee expense claims with a two-step approval flow, replacing the standalone Google Form.

**Who uses it**: All employees (submit), Team Leads (first approval), HR (final approval), Founder's Office (full view).

**Key features**:
- My Claims table: Expense Type, Amount, Project Code, Client, TL Approval, HR Approval, Date, Status
- Each row clickable to open a detail view: full expense info, receipt preview, comment thread
- TL and HR approval columns show green Approved or amber Pending
- Submit Claim form: Expense Type (Cab/Food/Printing/Internet/Other), Amount with Rs symbol, Date picker, Project Code dropdown, Client auto-filled from project code, Team Lead dropdown, Description textarea, Receipt upload (paperclip)
- Approval flow: Submit → TL notified → TL approves → HR notified → HR approves → Finance export
- Finance export: HR can export all approved claims as a clean file for payroll/finance processing
- Project code links each claim to a specific client for cost tracking

---

### 8. Access Control

**Purpose**: Admin-level audit view showing which team or individual has access to which tool or account.

**Who uses it**: Super Admin (full control), Admin (view only). Not visible to standard employees.

**Key features**:
- Matrix table: rows are teams or individuals, columns are tools and social media accounts
- Green tick if access exists; empty gray cell if not
- Super Admin can click any cell to toggle access; confirmation modal before saving
- Add Account or Tool button to add new columns to the matrix
- Search bar to filter by team name or tool name

---

### 9. Settings

**Purpose**: Personal account and notification management.

**Sections**:
- Profile: edit name, role, department, profile photo
- Security: change password, view active sessions
- Notifications: toggle per event type — timesheet reminder, approval updates, reimbursement status, asset request updates

---

## Data Dependency Map

This section defines the master data fields, where they originate, which modules reference them, and what updates automatically when a field changes. This is the blueprint for backend sync across all modules.

### Master Data Fields

#### Client Record
**Lives in**: Client Directory
**Created by**: BDE at onboarding (currently seeded manually for existing clients)

| Field | Referenced in | Auto-updates when changed |
|---|---|---|
| Client Name | Client Dashboard, Master Folders, Timesheets, Reimbursements, Tools, Assets | All dropdowns and filters referencing this client |
| Project Code | Client Dashboard, Timesheets, Reimbursements, Tools, Assets | All project code dropdowns across every module |
| Entity | Client Dashboard filter, Client Directory drawer | Entity dropdown on Client Dashboard |
| Platform | Client Dashboard filter, Client Directory drawer | Platform filter on Client Dashboard |
| SOW (planned posts per month) | Client Dashboard SOW Progress | SOW Progress bar recalculates immediately |
| Assigned AM | Client Directory drawer, Client Dashboard | AM name shown on client card and dashboard |
| Category (Shark/Dolphin/Turtle/Snail) | Client Directory card | Category badge updates across directory |
| Brand Guidelines file | Client Directory drawer | View File button points to updated file |
| Agreement start and end date | BDE module, Founder dashboard (future) | Renewal alerts recalculate |
| Commercial data (pricing, revenue) | BDE module, Founder's Office view only | Hidden from all other roles automatically |

#### Employee Record
**Lives in**: HR module (P2)
**Created by**: HR at onboarding

| Field | Referenced in | Auto-updates when changed |
|---|---|---|
| Employee Name | Timesheets, Reimbursements, Asset Management, Tools | All employee name fields across modules |
| Role and Department | Permissions layer, Access Control | Access rights recalculate based on role |
| Team Lead assigned | Reimbursements (TL dropdown), Timesheet approvals | TL field auto-fills in all request forms |
| Project codes assigned | Timesheet dropdown, Reimbursement dropdown | Only assigned project codes appear in dropdowns |
| Asset assigned | Asset Management | Asset status updates to In Use |

#### Project Code
**Lives in**: Client Directory (created by BDE)
**The single connective key across all modules**

| When project code is selected in... | It auto-fills... |
|---|---|
| Timesheet | Client name |
| Reimbursements | Client name, Team Lead |
| Tool request | Client name |
| Asset request | Client name |
| Master Folders upload | Client name, folder destination |
| Client Dashboard filter | Entity options, platform options |

#### Performance Data
**Lives in**: Uploaded file store (per client, entity, platform, period)
**Uploaded by**: Account Manager

| Field | Referenced in | Auto-updates when changed |
|---|---|---|
| Post count (from TOP POSTS sheet) | Client Dashboard SOW Progress (delivered posts) | SOW Progress bar recalculates |
| Daily impressions and engagements | Client Dashboard KPI cards, Performance Trend graph | All charts and cards refresh |
| Top posts data | Client Dashboard Top Performing Content table | Table refreshes with new top 3 |
| Follower data | Client Dashboard Followers Gained KPI card | Card value updates |
| Re-upload for same period | Replaces previous data entirely | All dependent sections refresh |

#### Monthly Report File
**Lives in**: Master Folders → Reports section
**Uploaded by**: Account Manager or content team

| Field | Referenced in | Auto-updates when changed |
|---|---|---|
| Report file existence for a given client and month | Client Dashboard SOW Progress (Monthly Reports row) | Shows 1/1 and 100% if file exists; shows Not Uploaded and 0/1 if missing |

### What Never Auto-Updates (Manual Only)

| Field | Why it is manual |
|---|---|
| Client Status (On Track, At Risk, Off Track) | Based on human judgment, not system data |
| SOW definition (planned posts) | Set once by BDE at onboarding; changes only on contract revision |
| Notes (Wins, Blockers, Observations) | Qualitative input from AM or TL |
| Asset return | HR physically confirms and marks returned |
| Timesheet approval | TL reviews and decides; not automatic |
| Reimbursement approval | Two-step human approval flow |

### Cascade Rules

1. If a **project code is updated**, all existing timesheet entries, reimbursements, tool requests, and asset requests linked to the old code must be migrated to the new code. This is a Super Admin action only.
2. If a **client is archived** (churned), their project code is locked, no new entries can be created against it, but all historical data remains accessible in read-only mode.
3. If an **employee's Team Lead is changed**, the new TL becomes the approver for all future submissions. Pending approvals already in queue remain with the previous TL until resolved.
4. If an **SOW is updated**, the SOW Progress calculation on the Client Dashboard updates immediately for the current month. Historical months retain the old planned number.
5. If a **report is deleted** from Master Folders, the SOW Progress Monthly Reports row reverts to Not Uploaded automatically.

---

## Cross-Department Permissions Summary

| Module | BDE | HR | Delivery | Team Lead | Founder's Office | Super Admin |
|---|---|---|---|---|---|---|
| Client Dashboard | No access | No access | View + input (own clients) | Full | Full | Full |
| Client Directory | Full + commercial | No access | Read (no commercial) | Read | Full | Full |
| Master Folders | No access | No access | Upload + view (own) | Full | Full | Full |
| Timesheet | Own entries | Own + view all | Own entries | Own + approve team | Full | Full + override |
| Tools and Subs | Request | Approve | Request | Request + view | Full | Full |
| Asset Management | Request | Full + inventory | Request + view | Request | Full | Full |
| Reimbursements | Submit | Final approval | Submit | Submit + first approval | Full | Full |
| Access Control | No access | No access | No access | No access | View | Full |

---

## Notification Rules

| Trigger | Who gets notified |
|---|---|
| Timesheet not submitted by 11 PM | Team Lead |
| Timesheet submitted | Team Lead (for approval) |
| Timesheet rejected | Employee |
| Reimbursement submitted | Team Lead |
| Reimbursement approved by TL | HR |
| Reimbursement approved or rejected | Employee |
| Asset request submitted | HR |
| Asset request approved or rejected | Employee |
| Tool request submitted | HR and Founder's Office |
| Tool request approved or rejected | Employee |
| Client status updated | Founder's Office |

---

## Key System Rules

1. Project code is created by BDE at client onboarding and cannot be changed after creation except by Super Admin
2. Folder structure in Master Folders is auto-created when a client is added to the Client Directory
3. Timesheet entries are locked after TL approval; only Super Admin can unlock
4. Re-uploading performance data for the same client, entity, platform, and period replaces previous data
5. SOW Progress on the Client Dashboard is always calculated against the current calendar month regardless of the date range filter
6. Commercial data in the Client Directory (pricing, contract value, revenue) is visible only to BDE and Founder's Office
7. Engagement Rate is always system-calculated as Total Engagements / Total Impressions × 100; it is never a manual input
8. LinkedIn file upload is validated against four required sheet names: DISCOVERY, ENGAGEMENT, TOP POSTS, FOLLOWERS; missing sheets trigger a rejection error
9. Archived clients are read-only; no new timesheets, reimbursements, or uploads can be created against them
10. If a report file is deleted from Master Folders, the SOW Progress monthly report row reverts to Not Uploaded automatically

---

## Build Sequence

| Priority | Department | Status | Rationale |
|---|---|---|---|
| P1 | Delivery Team | In design — Figma mockups in progress | Operational core; most employees use it daily |
| P2 | HR | Pending | High volume of internal requests; independent of BDE |
| P3 | BDE / Sales | Pending | Current clients seeded manually; needed before next new client onboards |
| Future | Finance dashboard, Founder dashboard, Access Control | Scoped, not started | Dependent on P1, P2, P3 data being live |

---

## Changelog

| Version | Date | Change | Reason |
|---|---|---|---|
| v1.0 | Apr 2026 | Initial product description created covering all 9 modules | First draft based on full department-wise problem statement mapping |
| v1.0 | Apr 2026 | Access Control moved from Delivery module to HR phase | Access Control is an admin function; belongs with HR not delivery |
| v1.0 | Apr 2026 | Client Directory renamed from Employee Directory | Employee Directory was a misnomer; content describes clients not employees |
| v1.0 | Apr 2026 | Reimbursements moved from standalone Google Form to hub module | Consolidation into hub for cleaner sync with project codes and approvals |
| v1.0 | Apr 2026 | Build sequence confirmed as P1 Delivery, P2 HR, P3 BDE | Current clients will be manually seeded; BDE module not needed until new client onboards |
| v1.0 | Apr 2026 | LinkedIn file column mapping defined | Based on actual LinkedIn analytics export file reviewed during scoping |
| v1.0 | Apr 2026 | Data Dependency Map section added | Developer needs explicit sync rules to avoid building modules in isolation |
| v1.0 | Apr 2026 | Cascade rules added for project code updates, client archiving, TL changes, SOW updates, report deletion | Covers edge cases that would otherwise cause data inconsistency |

---

*Growthic (Apinzo Technologies) — Internal Document — Not for external distribution*
*Version 1.0 — April 2026*
