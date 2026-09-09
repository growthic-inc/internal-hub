-- Leave/WFH/Client-Visit cancellations now route to People & Culture instead of
-- the original manager. approver_id stays as the historical record of who
-- approved the original request; cancellation_actor_id separately records
-- which P&C member processed the cancellation itself.
alter table leave_requests
  add column if not exists cancellation_actor_id uuid references employees(id);

alter table wfh_requests
  add column if not exists cancellation_actor_id uuid references employees(id);

alter table client_visit_requests
  add column if not exists cancellation_actor_id uuid references employees(id);
