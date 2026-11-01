-- ============================================================
-- CampusDebug OS — STEP 1 MIGRATION: courses / sections / teacher specialization
-- Run ONCE in the Supabase dashboard SQL editor (paste whole file, Run).
-- Safe to re-run: every write is guarded (IF NOT EXISTS / WHERE ... IS NULL).
--
-- RESULT after this script (all deterministic, derived from existing data):
--   BTech        : 5 branches x 7 sections x 50 students = 1750
--   MTech (CSE)  : 2 sections  x 50 students            = 100
--   B.Sc (Physical Sciences) : 2 sections x 50 students = 100
--   B.Sc Nursing : 1 section  x 50 students             = 50
--   TOTAL        : 35 sections, exactly 2000 students
--   Day-scholars : the original 10 (2201106001-010) stay + 140 more
--                  (every 14th student by roll order) = 150 total,
--                  spread every ~14 rolls across the whole campus.
--   NEW COLUMNS  : course TEXT, section TEXT, subject_specialization TEXT
--                  (specialization stays NULL here — filled in Step 2).
-- ============================================================

-- 1. New columns ---------------------------------------------
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS course TEXT;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS section TEXT;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS subject_specialization TEXT;

-- 2. Carve the non-BTech students (deterministic: every 8th
--    student of each source branch in roll_number order => exactly
--    50 per source dept; the 350 remaining per branch = 7 x 50).
WITH ordered AS (
  SELECT id, department,
         ROW_NUMBER() OVER (PARTITION BY department ORDER BY roll_number) AS rn_d
  FROM profiles
  WHERE role = 'STUDENT'
)
UPDATE profiles p
SET course = CASE
    WHEN p.department IN ('Computer Science & Engineering', 'Data Science & AI') THEN 'MTech'
    WHEN p.department IN ('Electronics & Telecommunication', 'Electrical Engineering') THEN 'B.Sc'
    WHEN p.department = 'Mechanical Engineering' THEN 'B.Sc Nursing'
  END
FROM ordered o
WHERE p.id = o.id
  AND p.role = 'STUDENT'
  AND p.course IS NULL
  AND o.department IN ('Computer Science & Engineering', 'Data Science & AI',
                       'Electronics & Telecommunication', 'Electrical Engineering',
                       'Mechanical Engineering')
  AND ((o.rn_d - 1) % 8) = 0;

-- 3. Branch labels for the new courses (department stays truthful)
UPDATE profiles SET department = 'Computer Science & Engineering'
WHERE role = 'STUDENT' AND course = 'MTech';           -- MTech is an MTech-CSE course

UPDATE profiles SET department = 'Physical Sciences'
WHERE role = 'STUDENT' AND course = 'B.Sc';            -- B.Sc Physical Sciences

UPDATE profiles SET department = 'Nursing'
WHERE role = 'STUDENT' AND course = 'B.Sc Nursing';    -- B.Sc Nursing

-- 4. Everyone still without a course value is BTech -----------
UPDATE profiles SET course = 'BTech'
WHERE role = 'STUDENT' AND course IS NULL;

-- 5. Assign section letters per (course, department) group ----
--    BTech  : A..G (7 sections x 50)
--    MTech  : A,B  (2 sections x 50)
--    B.Sc   : A,B  (2 sections x 50)
--    Nursing: A    (1 section x 50)
WITH grp AS (
  SELECT id,
         ROW_NUMBER() OVER (PARTITION BY course, department ORDER BY roll_number) AS rn_g
  FROM profiles
  WHERE role = 'STUDENT'
)
UPDATE profiles p
SET section = CASE
    WHEN p.course = 'BTech'             THEN chr((((g.rn_g - 1) % 7) + 65)::int)
    WHEN p.course = 'MTech'             THEN chr((((g.rn_g - 1) % 2) + 65)::int)
    WHEN p.course = 'B.Sc'              THEN chr((((g.rn_g - 1) % 2) + 65)::int)
    ELSE 'A'                            -- B.Sc Nursing — single section
  END
FROM grp g
WHERE p.id = g.id
  AND p.role = 'STUDENT'
  AND p.section IS NULL;

-- 6. Day-scholar expansion: keep the original 10 untouched; make
--    every 14th remaining student (by campus-wide roll order)
--    a day-scholar => exactly 140 more, spread across courses,
--    branches and sections. Block/room cleared, as day-scholars
--    have no hostel allocation (matches the original 10).
WITH ord AS (
  SELECT id,
         ROW_NUMBER() OVER (ORDER BY roll_number) AS rn
  FROM profiles
  WHERE role = 'STUDENT'
)
UPDATE profiles p
SET resident_type = 'dayscholar',
    hostel_block = NULL,
    room_number = NULL
FROM ord o
WHERE p.id = o.id
  AND p.role = 'STUDENT'
  AND p.resident_type = 'hosteller'
  AND (o.rn % 14) = 0
  AND o.rn <= 1960;   -- rn=14,28,...,1960 => exactly 140 students

-- ============================================================
-- DONE. Expected end state (the assistant's verification script
-- checks exactly these numbers):
--   course counts        : BTech 1750 / MTech 100 / B.Sc 100 / B.Sc Nursing 50
--   BTech per branch     : 350 -> sections A..G, 50 each
--   MTech (CSE)          : 100 -> A,B, 50 each
--   B.Sc (Physical Sciences): 100 -> A,B, 50 each
--   B.Sc Nursing         : 50 -> A
--   dayscholar total     : 150 (original 10 + 140 new), no block/room
--   all subject_specialization values : NULL until Step 2
-- ============================================================
