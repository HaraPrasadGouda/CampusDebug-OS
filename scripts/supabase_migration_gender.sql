-- ============================================================
-- ROOM ALLOCATION MIGRATION — gender column on profiles
-- Run this ONCE in the Supabase SQL Editor (Dashboard → SQL).
-- Safe to re-run (IF NOT EXISTS). Existing rows get NULL gender
-- until the next student CSV upload (gender is compulsory there)
-- or an admin update.
-- ============================================================

ALTER TABLE public.profiles
    ADD COLUMN IF NOT EXISTS gender TEXT;

-- Allowed values are enforced in the app layer ('Male' | 'Female' | 'Other')
-- so wardens/admins can correct typos without a DB constraint fight.
COMMENT ON COLUMN public.profiles.gender IS 'Male / Female / Other — set from the student CSV (compulsory column); drives hostel block eligibility (Boys/Girls blocks).';
