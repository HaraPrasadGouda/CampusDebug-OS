-- =====================================================================
-- CampusDebug OS — Room cleaning checks: migration.sql
-- NOT RUN by anyone yet. Run backup_queries.sql first, then this file once
-- in the Supabase SQL Editor. Idempotent: running it twice changes nothing more.
-- Real blocks used by the app (data/campus_config.json hostelBlocks): Block A, Block B, Block C, Block D.
-- Requires the earlier technicians migration (technicians table + tickets lifecycle columns).
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. technicians.block — which hostel block a cleaner works in (NULL for everyone else)
-- ---------------------------------------------------------------------
ALTER TABLE public.technicians ADD COLUMN IF NOT EXISTS block text;

-- ---------------------------------------------------------------------
-- 2. One-active-per-category stays for every category EXCEPT Cleanliness.
--    Cleanliness: up to 2 active cleaners per block (index below + trigger).
-- ---------------------------------------------------------------------
DROP INDEX IF EXISTS public.technicians_one_active_per_category;
CREATE UNIQUE INDEX IF NOT EXISTS technicians_one_active_per_category
    ON public.technicians (category)
    WHERE active AND category <> 'Cleanliness';

CREATE INDEX IF NOT EXISTS technicians_cleaners_by_block
    ON public.technicians (block)
    WHERE active AND category = 'Cleanliness';

-- "Max 2 active cleaners per block" cannot be a plain unique index, so a small trigger enforces it.
CREATE OR REPLACE FUNCTION public.technicians_max_two_cleaners() RETURNS trigger AS $$
BEGIN
    IF NEW.active AND NEW.category = 'Cleanliness' AND NEW.block IS NOT NULL THEN
        IF (SELECT count(*) FROM public.technicians t
            WHERE t.active AND t.category = 'Cleanliness' AND t.block = NEW.block AND t.id <> NEW.id) >= 2 THEN
            RAISE EXCEPTION 'Block % already has 2 active cleaners', NEW.block;
        END IF;
    END IF;
    RETURN NEW;
END
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS technicians_max_two_cleaners_trg ON public.technicians;
CREATE TRIGGER technicians_max_two_cleaners_trg
    BEFORE INSERT OR UPDATE ON public.technicians
    FOR EACH ROW EXECUTE FUNCTION public.technicians_max_two_cleaners();

-- ---------------------------------------------------------------------
-- 3. Seed: 2 cleaners per block, FAKE phone numbers +919000000006 upward.
--    Replace them with real numbers later and put those in SMS_ALLOWLIST (.env).
--    The old single housekeeping supervisor (TECH-CLEAN-01, no block) is switched off so he does not
--    take a cleaner slot in every block; the row stays so old complaints still show his name.
-- ---------------------------------------------------------------------
UPDATE public.technicians SET active = false WHERE id = 'TECH-CLEAN-01' AND block IS NULL;

INSERT INTO public.technicians (id, full_name, role, category, phone_number, block) VALUES
    ('TECH-CLEAN-A1', 'Sanjay Pradhan',   'Cleaner', 'Cleanliness', '+919000000006', 'Block A'),
    ('TECH-CLEAN-A2', 'Kabita Behera',    'Cleaner', 'Cleanliness', '+919000000007', 'Block A'),
    ('TECH-CLEAN-B1', 'Dillip Jena',      'Cleaner', 'Cleanliness', '+919000000008', 'Block B'),
    ('TECH-CLEAN-B2', 'Sarita Nayak',     'Cleaner', 'Cleanliness', '+919000000009', 'Block B'),
    ('TECH-CLEAN-C1', 'Gitanjali Sahu',   'Cleaner', 'Cleanliness', '+919000000010', 'Block C'),
    ('TECH-CLEAN-C2', 'Raghunath Swain',  'Cleaner', 'Cleanliness', '+919000000011', 'Block C'),
    ('TECH-CLEAN-D1', 'Mamata Mohanty',   'Cleaner', 'Cleanliness', '+919000000012', 'Block D'),
    ('TECH-CLEAN-D2', 'Bijay Kumar Das',  'Cleaner', 'Cleanliness', '+919000000013', 'Block D')
ON CONFLICT (id) DO NOTHING;

-- ---------------------------------------------------------------------
-- 4. cleaning_schedules — per block: which weekdays (0 = Sunday ... 6 = Saturday) and the cleaning window.
--    No row for a block = the default (Sunday, 08:00-13:00). The student question opens at end_time
--    and stays open 8 hours (1 PM - 9 PM by default).
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.cleaning_schedules (
    block       text        PRIMARY KEY,
    weekdays    int[]       NOT NULL DEFAULT '{0}',
    start_time  time        NOT NULL DEFAULT '08:00',
    end_time    time        NOT NULL DEFAULT '13:00',
    active      boolean     NOT NULL DEFAULT true,
    updated_at  timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT cleaning_schedules_weekdays_check CHECK (weekdays <@ ARRAY[0,1,2,3,4,5,6] AND cardinality(weekdays) >= 1)
);

-- ---------------------------------------------------------------------
-- 5. cleaning_checks — one row per room per cleaning day.
--    answer / answered_by = the roommate whose answer counts for the whole room (the lock).
--    status is written when the window closes: cleaned | not_cleaned | no_reply | vacant.
--    ticket_id = the one Cleanliness complaint created for a not-cleaned room.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.cleaning_checks (
    id               uuid        PRIMARY KEY DEFAULT uuid_generate_v4(),
    block            text        NOT NULL,
    room             text        NOT NULL,
    check_date       date        NOT NULL,
    answered_by      text,                       -- roll number
    answered_by_name text,
    answered_by_id   uuid,                       -- profiles.id (the complaint is filed under this student)
    answer           text        CHECK (answer IN ('yes', 'no')),
    answered_at      timestamptz,
    locked           boolean     NOT NULL DEFAULT false,
    status           text        CHECK (status IN ('cleaned', 'not_cleaned', 'no_reply', 'vacant')),
    ticket_id        uuid        REFERENCES public.tickets(id) ON DELETE SET NULL,
    sms_sent_at      timestamptz,                -- the 7:30 AM cleaner SMS covered this room
    created_at       timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT cleaning_checks_one_per_room_day UNIQUE (block, room, check_date)
);
CREATE INDEX IF NOT EXISTS idx_cleaning_checks_block_date ON public.cleaning_checks (block, check_date DESC);

-- ---------------------------------------------------------------------
-- 6. RLS on, NO policies (same as technicians): only the server (service role) can read/write.
-- ---------------------------------------------------------------------
ALTER TABLE public.cleaning_schedules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cleaning_checks    ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.cleaning_schedules FROM anon, authenticated;
REVOKE ALL ON TABLE public.cleaning_checks    FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.cleaning_schedules TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.cleaning_checks    TO service_role;

-- No new tickets columns are needed: the complaint uses category 'Cleanliness' and the existing
-- assigned_technician_id / assigned_by / not_fixed_count / student_resolved_at columns.

-- ---------------------------------------------------------------------
-- 7. Check (read-only): 8 active cleaners, 2 per block; the two new tables exist
-- ---------------------------------------------------------------------
SELECT block, count(*) AS active_cleaners FROM public.technicians
WHERE category = 'Cleanliness' AND active GROUP BY block ORDER BY block;
SELECT to_regclass('public.cleaning_schedules') AS schedules, to_regclass('public.cleaning_checks') AS checks;
