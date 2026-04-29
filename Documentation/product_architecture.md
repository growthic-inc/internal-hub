# Growthic Internal Hub — Product Architecture

**Version:** 1.0 — Working Draft
**Audience:** Internal Team

---

## Overview

The Growthic Internal Hub is built around two core entities and one connective key.

- **Client** — every module either originates from or connects back to a client
- **Employee** — every action in the system is performed by a person with a defined role
- **Project Code / Client ID** — on the frontend, clients are identified by a human-readable Project Code (e.g. CRYSTA, GLOBAL). On the backend, each client has a system-generated Client ID that is the actual key used for all database relationships. The two are permanently linked. One Client ID maps to exactly one Project Code.

These three things are the backbone. Everything else is built on top of them.

---

## Part 1 — Module Map and Connections

### The Three Layers

| BDE Layer | Delivery Layer | HR Layer |
|---|---|---|
| Client Onboarding | Client Dashboard | Leave Management |
| SOW Management | Timesheet* | Asset Management |
| Client Directory | Master Folders | Employee Directory |
| Client Lifecycle | | Notice Board / Policies |

> *Timesheet is universal — all roles use it.

Universal modules used by every role regardless of department: Timesheet, Reimbursements, Tools and Subscriptions, Notifications, Settings.

---

### How the Modules Connect

**Client Onboarding (BDE) is the starting point for everything.**

No module works until a client exists. When BDE creates a client, the following happens automatically across the system:

- Client appears in the Client Directory
- Client appears in the Timesheet dropdown for all team members
- Client folder structure is created in Master Folders
- Client Dashboard becomes available with the SOW as the baseline to measure against

**Project Code is the frontend label. Client ID is the backend key.**

Every timesheet entry, every file upload, every performance data upload, every reimbursement carries the Client ID at the database level. The team sees and uses the Project Code. The system works with the Client ID. This keeps data clean and human-friendly at the same time.

**Master Folders talks to the Client Dashboard.**

When a file is uploaded to the Reports folder for a client and month, the Client Dashboard SOW Progress section automatically marks that month's report as delivered. If nothing is uploaded, it shows Not Uploaded.

**Leave Management talks to Timesheet.**

When HR or a Team Lead approves a leave request, the timesheet for that day is automatically blocked. The employee cannot log hours on an approved leave day. Pending leave does not block anything.

**Client Directory is the source of truth for Client Dashboard.**

The dashboard pulls client name, project code, account manager, entities, and platforms from the directory. BDE owns and manages the directory. Every other role reads from it.

**Notifications wire across every approval flow.**

Every module that has an approval step fires a notification to the right person at the right step. Notifications are a shared service. They do not belong to any single module.

---

### Module Dependency Order

| Module | Depends On |
|---|---|
| Client Dashboard | Client Directory, SOW |
| Timesheet | Client Directory, Leave Management |
| Master Folders | Client Directory |
| Leave Management | Employee profiles (HR) |
| Asset Management | Employee profiles (HR) |
| Reimbursements | Employee profiles, Client Directory |
| Tools and Subscriptions | Employee profiles, Client Directory |
| Notifications | All approval flows across all modules |
| Settings | Employee profiles (HR) |

---

## Part 2 — Role Based Access Map

The system has six roles. Each role has a defined scope of what they can see and what they can do. Access is enforced at the backend. The frontend only reflects what the backend permits.

---

### Super Admin (Founder)

Full access to every module with no restrictions. Can override any action, see all data including commercial, and perform any operation across the system.

---

### Founder's Office

Senior oversight role with full view and edit access across the system. The only things they cannot do are approvals, which sit exclusively with HR and Team Leads.

| Module | Access |
|---|---|
| Client Dashboard | View and edit — all clients |
| Client Directory | View and edit — including commercial data |
| Timesheet | View and edit — all team members |
| Master Folders | View and edit — all clients |
| Client Onboarding and SOW | View and edit |
| HRMS | View and edit — notice board posting access |
| Reimbursements | View and edit |
| Asset Management | View and edit |
| Tools and Subscriptions | View and edit |
| Settings | Own profile only |

> No approval powers. Approval decisions sit with HR and Team Leads only.

---

### HR

| Module | Access |
|---|---|
| HRMS | Full — add employees, manage leave approvals, update policies, manage notice board |
| Asset Management | Full — approve requests, confirm returns, manage catalogue |
| Reimbursements | Final approval step, export for finance |
| Tools and Subscriptions | Full — approve or reject requests |
| Employee Directory | Full — add, edit, deactivate profiles |
| Timesheet | Own entries only |
| Client Dashboard | No access |
| Master Folders | No access |
| Client Directory | View only — no commercial data |
| Settings | Own profile only |

---

### BDE

| Module | Access |
|---|---|
| Client Directory | Full — create and manage clients, commercial data visible |
| Client Onboarding and SOW | Full — create clients, define SOW, assign AM and team |
| Client Lifecycle | Full — set Active, Paused, Inactive, Archived |
| Client Dashboard | View only |
| Timesheet | Own entries only |
| Master Folders | View only |
| HRMS | Own leave and profile only |
| Reimbursements | Submit own claims only |
| Tools and Subscriptions | Submit requests only |
| Settings | Own profile only |

---

### Team Lead

Part of the Delivery team at the execution level. Has the same day to day access as a Delivery person, plus approval powers for their direct reports on timesheets, leave, and reimbursements.

| Module | Access |
|---|---|
| Client Dashboard | Full for assigned clients — upload data, update health status, add notes |
| Timesheet | Own entries plus approve or reject direct reports' submissions |
| Master Folders | Full for assigned clients — upload and delete files (no 24-hour restriction) |
| Client Directory | View only — no commercial data |
| HRMS | Own leave plus approve or reject direct reports' leave and WFH requests |
| Reimbursements | Own claims plus first-step approval for direct reports |
| Asset Management | Submit own requests only |
| Tools and Subscriptions | Submit requests only |
| Settings | Own profile only |

---

### Delivery / Account Manager

| Module | Access |
|---|---|
| Client Dashboard | Assigned clients only — upload data, update health status, add notes |
| Timesheet | Own entries only |
| Master Folders | Assigned clients only — upload files, self-delete within 24 hours |
| Client Directory | View only — no commercial data |
| HRMS | Own leave and profile only |
| Reimbursements | Submit own claims only |
| Asset Management | Submit own requests only |
| Tools and Subscriptions | Submit requests only |
| Settings | Own profile only |

---

## Core Architecture Rules

- The client is the central entity. No module operates independently of a client.
- Project Code is the frontend identifier. Client ID is the backend key. They are permanently linked.
- Role-based access is enforced at the backend. The frontend reflects what the backend allows, it does not control it.
- Every approval flow triggers a notification. No action that requires a response from another person happens silently.
- HR is the gatekeeper of people. Only HR can add a new team member. Access begins with an email invite and the employee sets up their own profile from there.
- BDE is the gatekeeper of clients. No client can exist in the system without BDE creating them first.
- Timesheet and Reimbursements are universal. Every role in the system uses them regardless of department.
- Team Leads are Delivery team members with approval powers added on top. They are not a separate layer.
