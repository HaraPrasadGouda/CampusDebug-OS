-- ============================================================
-- CAMPUS CONFIG — optional Supabase mirror (Step 5.5)
-- The campus profile (branches, rooms, labs, subjects, teacher pools,
-- weekly cap, hostel blocks) lives as ONE JSONB document. The server
-- stores it in data/campus_config.json by default and MIRRORS it here
-- when this table exists — run this in the Supabase SQL editor once.
-- If the table has a row (id = 1), the server prefers it on boot.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.campus_config (
    id          INTEGER PRIMARY KEY DEFAULT 1,
    config      JSONB NOT NULL,
    updated_by  TEXT,
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Only ADMINs may read/write the campus profile through the API.
ALTER TABLE public.campus_config ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "campus_config service only" ON public.campus_config;
-- No client policies on purpose: reads/writes happen exclusively with the
-- service-role key inside server.js (clients never touch this table).
