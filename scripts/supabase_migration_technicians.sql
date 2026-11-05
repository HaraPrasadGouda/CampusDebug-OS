-- =====================================================================
-- CampusDebug OS — technicians table + complaint lifecycle columns
-- File: migration.sql            (run AFTER backup_queries.sql)
-- Safe to run more than once: every statement is IF NOT EXISTS /
-- ON CONFLICT DO NOTHING / guarded by a catalog check.
-- Paste the whole file into Supabase → SQL Editor → Run.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. TECHNICIANS (hostel maintenance staff — they never log in, so they
--    are NOT in public.profiles, whose id is tied to auth.users)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.technicians (
    id            text PRIMARY KEY,                       -- e.g. TECH-PLUMB-01
    full_name     text        NOT NULL,
    role          text        NOT NULL,                   -- e.g. 'Plumber'
    category      text        NOT NULL,
    phone_number  text        NOT NULL,
    active        boolean     NOT NULL DEFAULT true,
    created_at    timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT technicians_category_check CHECK (
        category IN ('Plumbing', 'Wi-Fi / LAN', 'Electrical', 'Furniture', 'Cleanliness')
    )
);

-- One ACTIVE technician per category. (A partial unique index rather than a
-- plain UNIQUE(category): to replace someone you set the old row
-- active = false and insert the new person; the old row stays so past
-- complaints still show who was assigned.)
CREATE UNIQUE INDEX IF NOT EXISTS technicians_one_active_per_category
    ON public.technicians (category)
    WHERE active;

-- Seed: 5 technicians, FAKE phone numbers (+91 90000 0000x). Replace them with
-- real numbers later, and put those numbers in SMS_ALLOWLIST in .env.
INSERT INTO public.technicians (id, full_name, role, category, phone_number) VALUES
    ('TECH-PLUMB-01', 'Ramesh Sahoo',  'Plumber',                 'Plumbing',    '+919000000001'),
    ('TECH-NET-01',   'Bikash Nayak',  'Network Technician',      'Wi-Fi / LAN', '+919000000002'),
    ('TECH-ELEC-01',  'Sunil Behera',  'Electrician',             'Electrical',  '+919000000003'),
    ('TECH-FURN-01',  'Pradeep Rout',  'Carpenter',               'Furniture',   '+919000000004'),
    ('TECH-CLEAN-01', 'Santosh Das',   'Housekeeping Supervisor', 'Cleanliness', '+919000000005')
ON CONFLICT (id) DO NOTHING;

-- RLS: on, with NO policies. Browsers (anon / authenticated keys) can't read
-- or change this table at all; only the server, which uses the
-- service-role key (service_role bypasses RLS), can. Same pattern the
-- server already relies on for tickets/profiles.
ALTER TABLE public.technicians ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.technicians FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.technicians TO service_role;

-- ---------------------------------------------------------------------
-- 2. TICKETS — assignment + lifecycle columns
--    (tickets has no updated_at trigger on the live DB, so the server sets
--     updated_at = now() itself on every assign / resolve / not-fixed / close)
-- ---------------------------------------------------------------------
ALTER TABLE public.tickets ADD COLUMN IF NOT EXISTS assigned_technician_id text
    REFERENCES public.technicians(id);                    -- deactivate a technician, don't delete
ALTER TABLE public.tickets ADD COLUMN IF NOT EXISTS assigned_by          text;            -- 'AUTO' or the warden's name
ALTER TABLE public.tickets ADD COLUMN IF NOT EXISTS assigned_at          timestamptz;
ALTER TABLE public.tickets ADD COLUMN IF NOT EXISTS student_resolved_at  timestamptz;     -- student tapped "Resolved"
ALTER TABLE public.tickets ADD COLUMN IF NOT EXISTS closed_at            timestamptz;     -- warden closed
ALTER TABLE public.tickets ADD COLUMN IF NOT EXISTS closed_by            text;            -- warden's name
ALTER TABLE public.tickets ADD COLUMN IF NOT EXISTS not_fixed_count      integer NOT NULL DEFAULT 0;
ALTER TABLE public.tickets ADD COLUMN IF NOT EXISTS last_reminder_at     timestamptz;     -- 24h "was it fixed?" reminder

CREATE INDEX IF NOT EXISTS idx_tickets_assigned_technician
    ON public.tickets (assigned_technician_id);
-- Small index for the 24h reminder sweep (open + not yet student-resolved).
CREATE INDEX IF NOT EXISTS idx_tickets_reminder_due
    ON public.tickets (assigned_at)
    WHERE student_resolved_at IS NULL AND closed_at IS NULL;

-- ---------------------------------------------------------------------
-- 3. tickets.status must accept 'CLOSED'
--    The original schema (scripts/supabase_migration.sql) made status a
--    ticket_status_enum with PENDING / ASSIGNED / RESOLVED / ESCALATED_TO_DEAN,
--    so a warden "Close" could not be saved. Add CLOSED only if status really
--    is that enum and the value is missing. On the live DB (checked 4 Nov
--    2026) CLOSED is already there, so this block does nothing; it is kept
--    so the file also works on a fresh copy of the old schema.
-- ---------------------------------------------------------------------
DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'tickets'
          AND column_name = 'status' AND udt_name = 'ticket_status_enum'
    ) AND NOT EXISTS (
        SELECT 1
        FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
        WHERE t.typname = 'ticket_status_enum' AND e.enumlabel = 'CLOSED'
    ) THEN
        ALTER TYPE public.ticket_status_enum ADD VALUE 'CLOSED';
    END IF;
END
$$;

-- ---------------------------------------------------------------------
-- 4. Check (read-only) — should show 5 technicians and the 8 new columns
-- ---------------------------------------------------------------------
SELECT id, full_name, role, category, phone_number, active FROM public.technicians ORDER BY id;
SELECT column_name, data_type, column_default
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'tickets'
  AND column_name IN ('assigned_technician_id','assigned_by','assigned_at','student_resolved_at',
                      'closed_at','closed_by','not_fixed_count','last_reminder_at')
ORDER BY column_name;
