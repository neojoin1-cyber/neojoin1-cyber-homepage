-- Explicitly expose only the private service role to the promotion control tables.
-- Browser roles remain revoked and all access continues through the Edge Function.

grant select, insert, update, delete on table public.promo_items to service_role;
grant select, insert, update, delete on table public.promo_jobs to service_role;
grant select, insert, update, delete on table public.promo_activity to service_role;
grant select, insert, update, delete on table public.promo_workers to service_role;
grant usage, select on sequence public.promo_activity_id_seq to service_role;
