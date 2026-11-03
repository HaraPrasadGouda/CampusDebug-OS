-- =====================================================================
-- CampusDebug OS — ROLLBACK of migration.sql
-- Removes the 8 tickets columns and the technicians table.
-- WARNING: assignment / resolved / closed history in those columns is lost.
-- Run backup_queries.sql (and save the output) first.
-- Safe to run more than once.
-- =====================================================================

-- Ticket statuses are LEFT ALONE. 'CLOSED' was already a value of
-- ticket_status_enum before this migration (checked on the live DB,
-- 4 Nov 2026), so a CLOSED ticket stays CLOSED after the rollback and the
-- old app still understands it. Nothing here rewrites any status.

DROP INDEX IF EXISTS public.idx_tickets_reminder_due;
DROP INDEX IF EXISTS public.idx_tickets_assigned_technician;

ALTER TABLE public.tickets DROP COLUMN IF EXISTS last_reminder_at;
ALTER TABLE public.tickets DROP COLUMN IF EXISTS not_fixed_count;
ALTER TABLE public.tickets DROP COLUMN IF EXISTS closed_by;
ALTER TABLE public.tickets DROP COLUMN IF EXISTS closed_at;
ALTER TABLE public.tickets DROP COLUMN IF EXISTS student_resolved_at;
ALTER TABLE public.tickets DROP COLUMN IF EXISTS assigned_at;
ALTER TABLE public.tickets DROP COLUMN IF EXISTS assigned_by;
ALTER TABLE public.tickets DROP COLUMN IF EXISTS assigned_technician_id;  -- drops its FK too

DROP INDEX IF EXISTS public.technicians_one_active_per_category;
DROP TABLE IF EXISTS public.technicians;

-- Note: the enum is not touched. 'CLOSED' existed before migration.sql
-- (its ADD VALUE step is a no-op on the live DB), so it must NOT be removed.
