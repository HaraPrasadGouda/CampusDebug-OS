-- =====================================================================
-- CampusDebug OS — ROLLBACK of the room-cleaning migration.sql
-- WARNING: deletes all cleaning answers/results and the block cleaners.
-- Complaints already created from cleaning checks stay in tickets (their ticket_id link is dropped with the table).
-- Run backup_queries.sql (and save the output) first. Safe to run more than once.
-- =====================================================================

DROP TABLE IF EXISTS public.cleaning_checks;
DROP TABLE IF EXISTS public.cleaning_schedules;

-- Tickets assigned to a block cleaner must be handed back before the cleaner rows go (FK on tickets.assigned_technician_id).
UPDATE public.tickets SET assigned_technician_id = 'TECH-CLEAN-01'
WHERE assigned_technician_id IN (SELECT id FROM public.technicians WHERE category = 'Cleanliness' AND block IS NOT NULL)
  AND EXISTS (SELECT 1 FROM public.technicians WHERE id = 'TECH-CLEAN-01');

DROP TRIGGER IF EXISTS technicians_max_two_cleaners_trg ON public.technicians;
DROP FUNCTION IF EXISTS public.technicians_max_two_cleaners();

DELETE FROM public.technicians WHERE category = 'Cleanliness' AND block IS NOT NULL
  AND id IN ('TECH-CLEAN-A1','TECH-CLEAN-A2','TECH-CLEAN-B1','TECH-CLEAN-B2','TECH-CLEAN-C1','TECH-CLEAN-C2','TECH-CLEAN-D1','TECH-CLEAN-D2');

-- Bring back the single housekeeping supervisor, then the original one-active-per-category rule.
UPDATE public.technicians SET active = true WHERE id = 'TECH-CLEAN-01';
DROP INDEX IF EXISTS public.technicians_cleaners_by_block;
DROP INDEX IF EXISTS public.technicians_one_active_per_category;
CREATE UNIQUE INDEX IF NOT EXISTS technicians_one_active_per_category
    ON public.technicians (category)
    WHERE active;

ALTER TABLE public.technicians DROP COLUMN IF EXISTS block;
