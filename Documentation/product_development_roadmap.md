# Growthic Internal Hub — Product Development Roadmap

---

## Overview

The roadmap is structured in five phases. Each phase builds on the previous one. Phase 0 sets the foundation that everything else depends on. Phases 1 through 4 roll out the actual modules in order of priority — Delivery first, then HR, then BDE, then shared services.

No phase goes live until the previous one is stable.

---

## Phase 0 — Foundation

**What this covers:** Everything that needs to exist before any module can be built. This is the invisible layer that the entire system runs on.

### What gets built

- Database schema setup in Supabase — employees, clients, project codes, roles, and their relationships
- Authentication system — invite-only flow, password setup, session management via Supabase Auth
- Role definitions — all six roles configured with their permission sets at the backend level
- Navigation shell — the sidebar, header, and routing structure that every module will slot into
- Notification infrastructure — the in-app alert system wired up and ready before modules start using it
- Project code logic — the connective tissue that links clients across all modules

### Why this comes first

Nothing else works without this. The client-project code relationship, role-based access enforcement, and the auth model are dependencies for every single module that follows.

### Who is involved

Development team only. No end-user facing output at this stage.

---

## Phase 1 — Delivery Layer

**What this covers:** The core of how the delivery team does their work every day. This is Priority 1 and the reason the system is being built.

### What gets built

- **Client Directory** — source of truth for all client information, project codes, account manager assignments, and platform mapping. Built first because every other Delivery module depends on clients existing in the system.
- **Client Dashboard** — performance tracking, metric cards, health status, SOW progress, charts, notes, and the data upload flow with validation and silent history logging.
- **Timesheet** — weekly logging, draft to submitted to approved flow, Team Lead approvals tab, leave blocking logic, 8-hour daily cap.
- **Master Folders** — client and month-based file storage, the three folder types (Approved Content, Creatives, Reports), 24-hour self-delete window, connection to the dashboard SOW progress indicator.

### Dependencies

Phase 0 must be complete. Clients need to exist in the directory before the dashboard or timesheet can function.

### Who uses it once live

Delivery team, Account Managers, Team Leads, Founder's Office, Super Admin.

---

## Phase 2 — HR Layer

**What this covers:** Everything related to managing the team as people — leaves, assets, policies, the employee directory, and the notice board.

### What gets built

- **HRMS** — leave management with calendar view, leave and WFH application flow, Team Lead and HR approval chain, policy documents tab, employee directory, notice board.
- **Asset Management** — asset catalogue, available and in-use states, request and return flows, condition reporting, HR confirmation step.
- **Employee Lifecycle flows** — role changes, manager reassignments, and exit handling including asset clearance before deactivation.

### Dependencies

Phase 1 must be stable. The leave approval flow connects to the timesheet blocking logic built in Phase 1.

### Who uses it once live

All team members (leave, directory, notice board), HR (approvals, lifecycle, policies), Team Leads (leave approvals).

---

## Phase 3 — BDE Layer

**What this covers:** The client onboarding flow that BDE owns. This is the entry point for every new client into the system.

### What gets built

- **Client Onboarding flow** — create client entry, add entities, define platforms, create SOW, assign Account Manager and team, client goes live across all modules.
- **SOW management** — scope definition per platform, editing by BDE, view-only access for Delivery and Founder's Office.
- **Client Lifecycle management** — Active, Paused, Inactive, and Archived states, controlled by BDE and Super Admin.
- **Commercial data layer** — pricing and revenue fields visible only to BDE and Founder's Office, hidden from Delivery.

### Dependencies

Phase 1 Client Directory must exist. BDE is building on top of the client data structure already set up.

### Note

During Phases 1 and 2, clients will be seeded manually into the system by the dev team or Super Admin. Phase 3 hands that control over to BDE properly.

### Who uses it once live

BDE, Super Admin, Founder's Office (view only on commercial data).

---

## Phase 4 — Shared Services and Polish

**What this covers:** The modules that every team member uses regardless of department, plus system-wide refinements based on what Phases 1 through 3 surfaced.

### What gets built

- **Reimbursements** — expense submission with receipt upload, duplicate detection, two-step approval flow (Team Lead then HR), HR export for finance.
- **Tools and Subscriptions** — tool catalogue, access request flow, HR approval, project code linking.
- **Notifications** — full wiring of in-app alerts across all approval flows from all phases.
- **Settings** — personal profile management, password change, notification preferences per module.
- **System-wide polish** — edge case handling, performance checks, UI consistency pass, mobile responsiveness review.

### Dependencies

All previous phases complete. Notifications in particular depend on every approval flow being live.

### Who uses it once live

All team members.

---

## Core Constraints Across All Phases

- No phase goes live until the previous one is tested and stable.
- Role-based access is enforced at the backend in every phase, not just the UI.
- Client seeding in Phases 1 and 2 is manual. Full BDE-controlled onboarding only happens after Phase 3.
- No timeline dates are attached to this roadmap until development effort is estimated per phase.
