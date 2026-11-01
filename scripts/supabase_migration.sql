-- ==============================================================================
-- CAMPUSDEBUG OS: ENTERPRISE SUPABASE POSTGRESQL MIGRATION SCHEMA
-- ==============================================================================
-- Revision: 2026.10-production-v2
-- Description: Production-ready DDL schema, optimized indexes, robust Row Level
--              Security (RLS) policies, and high-performance PL/pgSQL bulk seed script
--              for 2,000 students across 4 hostel blocks.
-- ==============================================================================

-- 1. EXTENSIONS
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- 2. ENUM TYPES
DO $$ BEGIN
    CREATE TYPE user_role_enum AS ENUM ('STUDENT', 'WARDEN', 'GUARD', 'ADMIN', 'DEAN');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE pass_type_enum AS ENUM ('DAY', 'OVERNIGHT');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE gate_pass_status_enum AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'EXPIRED', 'USED');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE urgency_level_enum AS ENUM ('CRITICAL', 'HIGH', 'MEDIUM', 'LOW');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE ticket_status_enum AS ENUM ('PENDING', 'ASSIGNED', 'RESOLVED', 'ESCALATED_TO_DEAN');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE incident_status_enum AS ENUM ('OPEN', 'RESOLVED');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE meal_type_enum AS ENUM ('LUNCH', 'DINNER');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE meal_rsvp_status_enum AS ENUM ('OPTED_OUT', 'ATTENDING');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE doc_type_enum AS ENUM ('BONAFIDE', 'NOC', 'ID_REISSUE');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE doc_request_status_enum AS ENUM ('PENDING', 'PROCESSING', 'READY_FOR_PICKUP');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- ==============================================================================
-- 3. CORE TABLES DEFINITION
-- ==============================================================================

-- 3.1 PROFILES TABLE (Extensions to Supabase auth.users)
CREATE TABLE IF NOT EXISTS public.profiles (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    roll_number VARCHAR(64) UNIQUE NOT NULL,
    full_name VARCHAR(255) NOT NULL,
    role user_role_enum NOT NULL DEFAULT 'STUDENT',
    phone_number VARCHAR(32),
    hostel_block VARCHAR(64),
    room_number VARCHAR(32),
    department VARCHAR(128) DEFAULT 'Computer Science & Engineering',
    attendance_percentage NUMERIC(5, 2) NOT NULL DEFAULT 86.40 CHECK (attendance_percentage >= 0 AND attendance_percentage <= 100),
    fee_due_balance NUMERIC(10, 2) NOT NULL DEFAULT 3200.00 CHECK (fee_due_balance >= 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT TIMEZONE('utc', NOW()),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT TIMEZONE('utc', NOW())
);

-- 3.2 MASTER INCIDENTS TABLE (Grouped AI/Operational Maintenance Clusters)
CREATE TABLE IF NOT EXISTS public.master_incidents (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    cluster_code VARCHAR(64) UNIQUE NOT NULL,
    category VARCHAR(64) NOT NULL,
    hostel_block VARCHAR(64) NOT NULL,
    floor_number VARCHAR(32) NOT NULL,
    status incident_status_enum NOT NULL DEFAULT 'OPEN',
    ticket_count INT NOT NULL DEFAULT 1 CHECK (ticket_count >= 0),
    resolved_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT TIMEZONE('utc', NOW()),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT TIMEZONE('utc', NOW())
);

-- 3.3 TICKETS TABLE (Student Maintenance Complaints & Cascading Issues)
CREATE TABLE IF NOT EXISTS public.tickets (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    student_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    master_incident_id UUID REFERENCES public.master_incidents(id) ON DELETE SET NULL,
    raw_text TEXT NOT NULL,
    category VARCHAR(64) NOT NULL,
    location VARCHAR(255) NOT NULL,
    urgency urgency_level_enum NOT NULL DEFAULT 'MEDIUM',
    sla_hours INT NOT NULL DEFAULT 4 CHECK (sla_hours > 0),
    status ticket_status_enum NOT NULL DEFAULT 'PENDING',
    created_at TIMESTAMPTZ NOT NULL DEFAULT TIMEZONE('utc', NOW()),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT TIMEZONE('utc', NOW())
);

-- 3.4 GATE PASSES TABLE (Cryptographically signed offline QR verification)
CREATE TABLE IF NOT EXISTS public.gate_passes (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    student_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    pass_type pass_type_enum NOT NULL DEFAULT 'DAY',
    destination VARCHAR(255) NOT NULL,
    reason TEXT NOT NULL,
    valid_until TIMESTAMPTZ NOT NULL,
    status gate_pass_status_enum NOT NULL DEFAULT 'PENDING',
    hmac_signature TEXT,
    approved_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    verified_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT TIMEZONE('utc', NOW()),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT TIMEZONE('utc', NOW())
);

-- 3.5 MEAL RSVPS TABLE (Zero-Waste Hostel Kitchen Meal Forecasting)
CREATE TABLE IF NOT EXISTS public.meal_rsvps (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    student_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    meal_date DATE NOT NULL,
    meal_type meal_type_enum NOT NULL,
    status meal_rsvp_status_enum NOT NULL DEFAULT 'ATTENDING',
    created_at TIMESTAMPTZ NOT NULL DEFAULT TIMEZONE('utc', NOW()),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT TIMEZONE('utc', NOW()),
    CONSTRAINT uq_student_meal_date UNIQUE (student_id, meal_date, meal_type)
);

-- 3.6 DOCUMENT REQUESTS TABLE (Academic Certificate & Bonafide Desk)
CREATE TABLE IF NOT EXISTS public.document_requests (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    student_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    doc_type doc_type_enum NOT NULL DEFAULT 'BONAFIDE',
    status doc_request_status_enum NOT NULL DEFAULT 'PENDING',
    remarks TEXT,
    ready_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT TIMEZONE('utc', NOW()),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT TIMEZONE('utc', NOW())
);

-- ==============================================
-- 4. HIGH-PERFORMANCE B-TREE & COMPOSITE INDEXES
-- ==============================================

-- Profiles lookups
CREATE INDEX IF NOT EXISTS idx_profiles_roll_number ON public.profiles(roll_number);
CREATE INDEX IF NOT EXISTS idx_profiles_role ON public.profiles(role);
CREATE INDEX IF NOT EXISTS idx_profiles_hostel_block ON public.profiles(hostel_block);

-- Optimized Tickets index (Status, Created_At) + foreign keys
CREATE INDEX IF NOT EXISTS idx_tickets_status_created_at ON public.tickets(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_tickets_student_id ON public.tickets(student_id);
CREATE INDEX IF NOT EXISTS idx_tickets_master_incident ON public.tickets(master_incident_id);

-- Optimized Gate Passes index (Student_id, Status) + Validity
CREATE INDEX IF NOT EXISTS idx_gate_passes_student_status ON public.gate_passes(student_id, status);
CREATE INDEX IF NOT EXISTS idx_gate_passes_valid_until ON public.gate_passes(valid_until);

-- Meal RSVPs query optimization (Date, Meal Type for bulk kitchen forecasting)
CREATE INDEX IF NOT EXISTS idx_meal_rsvps_date_meal_status ON public.meal_rsvps(meal_date, meal_type, status);
CREATE INDEX IF NOT EXISTS idx_meal_rsvps_student ON public.meal_rsvps(student_id);

-- Document Requests index (Status, Created_At)
CREATE INDEX IF NOT EXISTS idx_doc_requests_student_status ON public.document_requests(student_id, status);

-- Master Incidents index
CREATE INDEX IF NOT EXISTS idx_master_incidents_status_block ON public.master_incidents(status, hostel_block);

-- ==============================================================================
-- 5. AUTOMATIC TIMESTAMP TRIGGER
-- ==============================================================================
CREATE OR REPLACE FUNCTION public.handle_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = TIMEZONE('utc', NOW());
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_profiles_updated_at ON public.profiles;
CREATE TRIGGER trg_profiles_updated_at BEFORE UPDATE ON public.profiles
    FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

DROP TRIGGER IF EXISTS trg_tickets_updated_at ON public.tickets;
CREATE TRIGGER trg_tickets_updated_at BEFORE UPDATE ON public.tickets
    FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

DROP TRIGGER IF EXISTS trg_gate_passes_updated_at ON public.gate_passes;
CREATE TRIGGER trg_gate_passes_updated_at BEFORE UPDATE ON public.gate_passes
    FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

DROP TRIGGER IF EXISTS trg_meal_rsvps_updated_at ON public.meal_rsvps;
CREATE TRIGGER trg_meal_rsvps_updated_at BEFORE UPDATE ON public.meal_rsvps
    FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

DROP TRIGGER IF EXISTS trg_document_requests_updated_at ON public.document_requests;
CREATE TRIGGER trg_document_requests_updated_at BEFORE UPDATE ON public.document_requests
    FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

DROP TRIGGER IF EXISTS trg_master_incidents_updated_at ON public.master_incidents;
CREATE TRIGGER trg_master_incidents_updated_at BEFORE UPDATE ON public.master_incidents
    FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- ==============================================================================
-- 6. ROW LEVEL SECURITY (RLS) & ACCESS CONTROL POLICIES
-- ==============================================================================
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.master_incidents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tickets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.gate_passes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.meal_rsvps ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.document_requests ENABLE ROW LEVEL SECURITY;

-- Helper security functions
CREATE OR REPLACE FUNCTION public.current_user_role()
RETURNS user_role_enum AS $$
    SELECT role FROM public.profiles WHERE id = auth.uid();
$$ LANGUAGE sql STABLE SECURITY DEFINER;

-- 6.1 PROFILES POLICIES
DROP POLICY IF EXISTS "Profiles: Users view their own profile" ON public.profiles;
CREATE POLICY "Profiles: Users view their own profile"
    ON public.profiles FOR SELECT
    USING (
        auth.uid() = id OR 
        public.current_user_role() IN ('WARDEN', 'GUARD', 'ADMIN', 'DEAN')
    );

DROP POLICY IF EXISTS "Profiles: Users can update their own phone" ON public.profiles;
CREATE POLICY "Profiles: Users can update their own phone"
    ON public.profiles FOR UPDATE
    USING (auth.uid() = id)
    WITH CHECK (auth.uid() = id);

DROP POLICY IF EXISTS "Profiles: Admins manage all profiles" ON public.profiles;
CREATE POLICY "Profiles: Admins manage all profiles"
    ON public.profiles FOR ALL
    USING (public.current_user_role() IN ('ADMIN', 'DEAN'));

-- 6.2 TICKETS POLICIES
DROP POLICY IF EXISTS "Tickets: Students view their own, Staff views all" ON public.tickets;
CREATE POLICY "Tickets: Students view their own, Staff views all"
    ON public.tickets FOR SELECT
    USING (
        student_id = auth.uid() OR
        public.current_user_role() IN ('WARDEN', 'ADMIN', 'DEAN')
    );

DROP POLICY IF EXISTS "Tickets: Students can insert their own tickets" ON public.tickets;
CREATE POLICY "Tickets: Students can insert their own tickets"
    ON public.tickets FOR INSERT
    WITH CHECK (
        student_id = auth.uid() OR
        public.current_user_role() IN ('ADMIN', 'WARDEN')
    );

DROP POLICY IF EXISTS "Tickets: Staff can update ticket statuses" ON public.tickets;
CREATE POLICY "Tickets: Staff can update ticket statuses"
    ON public.tickets FOR UPDATE
    USING (public.current_user_role() IN ('WARDEN', 'ADMIN', 'DEAN'));

-- 6.3 MASTER INCIDENTS POLICIES
DROP POLICY IF EXISTS "Master Incidents: Read-only for authenticated campus users" ON public.master_incidents;
CREATE POLICY "Master Incidents: Read-only for authenticated campus users"
    ON public.master_incidents FOR SELECT
    USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "Master Incidents: Wardens & Admins can manage incidents" ON public.master_incidents;
CREATE POLICY "Master Incidents: Wardens & Admins can manage incidents"
    ON public.master_incidents FOR ALL
    USING (public.current_user_role() IN ('WARDEN', 'ADMIN', 'DEAN'));

-- 6.4 GATE PASSES POLICIES
DROP POLICY IF EXISTS "GatePasses: Students view own, Guard/Warden/Admin view all" ON public.gate_passes;
CREATE POLICY "GatePasses: Students view own, Guard/Warden/Admin view all"
    ON public.gate_passes FOR SELECT
    USING (
        student_id = auth.uid() OR
        public.current_user_role() IN ('WARDEN', 'GUARD', 'ADMIN', 'DEAN')
    );

DROP POLICY IF EXISTS "GatePasses: Students can request gate pass" ON public.gate_passes;
CREATE POLICY "GatePasses: Students can request gate pass"
    ON public.gate_passes FOR INSERT
    WITH CHECK (student_id = auth.uid());

DROP POLICY IF EXISTS "GatePasses: Wardens approve, Guards scan/verify" ON public.gate_passes;
CREATE POLICY "GatePasses: Wardens approve, Guards scan/verify"
    ON public.gate_passes FOR UPDATE
    USING (
        public.current_user_role() IN ('WARDEN', 'GUARD', 'ADMIN', 'DEAN')
    );

-- 6.5 MEAL RSVPS POLICIES
DROP POLICY IF EXISTS "MealRSVP: Students manage own, Staff views for kitchen plates" ON public.meal_rsvps;
CREATE POLICY "MealRSVP: Students manage own, Staff views for kitchen plates"
    ON public.meal_rsvps FOR SELECT
    USING (
        student_id = auth.uid() OR
        public.current_user_role() IN ('WARDEN', 'ADMIN', 'DEAN')
    );

DROP POLICY IF EXISTS "MealRSVP: Students insert/update own RSVP" ON public.meal_rsvps;
CREATE POLICY "MealRSVP: Students insert/update own RSVP"
    ON public.meal_rsvps FOR ALL
    USING (student_id = auth.uid())
    WITH CHECK (student_id = auth.uid());

-- 6.6 DOCUMENT REQUESTS POLICIES
DROP POLICY IF EXISTS "DocRequests: Students view own, Admins view all" ON public.document_requests;
CREATE POLICY "DocRequests: Students view own, Admins view all"
    ON public.document_requests FOR SELECT
    USING (
        student_id = auth.uid() OR
        public.current_user_role() IN ('ADMIN', 'DEAN')
    );

DROP POLICY IF EXISTS "DocRequests: Students can submit document requests" ON public.document_requests;
CREATE POLICY "DocRequests: Students can submit document requests"
    ON public.document_requests FOR INSERT
    WITH CHECK (student_id = auth.uid());

DROP POLICY IF EXISTS "DocRequests: Admins process documents" ON public.document_requests;
CREATE POLICY "DocRequests: Admins process documents"
    ON public.document_requests FOR UPDATE
    USING (public.current_user_role() IN ('ADMIN', 'DEAN'));

-- ==============================================================================
-- 7. REUSABLE PL/PGSQL SEED FUNCTION (2,000 STUDENTS ACROSS 4 HOSTEL BLOCKS)
-- ==============================================================================

CREATE OR REPLACE FUNCTION public.seed_campusdebug_production_data()
RETURNS jsonb AS $$
DECLARE
    v_total_students INT := 2000;
    v_hostel_blocks TEXT[] := ARRAY['Block A', 'Block B', 'Block C', 'Block D'];
    v_departments TEXT[] := ARRAY[
        'Computer Science & Engineering',
        'Data Science & AI',
        'Electronics & Telecommunication',
        'Mechanical Engineering',
        'Electrical Engineering'
    ];
    v_first_names TEXT[] := ARRAY['Aarav', 'Vivaan', 'Aditya', 'Vihaan', 'Arjun', 'Sai', 'Reyansh', 'Ayaan', 'Krishna', 'Ishaan', 'Shaurya', 'Atharv', 'Advik', 'Pranav', 'Advaith', 'Aaryan', 'Dhruv', 'Kabir', 'Ritvik', 'Darsh', 'Ananya', 'Diya', 'Gauri', 'Isha', 'Kavya', 'Khushi', 'Anushka', 'Meera', 'Riya', 'Pooja', 'Sneha', 'Shreya', 'Tanvi', 'Vandana', 'Debasish', 'Arvind'];
    v_last_names TEXT[] := ARRAY['Sharma', 'Verma', 'Patel', 'Sahoo', 'Mohanty', 'Nayak', 'Mishra', 'Das', 'Behera', 'Rath', 'Tripathy', 'Panda', 'Swain', 'Jena', 'Pradhan', 'Ghosh', 'Chatterjee', 'Sen', 'Banerjee', 'Rao', 'Reddy'];
    
    v_admin_id UUID;
    v_warden_id UUID;
    v_guard_id UUID;
    v_dean_id UUID;

    v_student_id UUID;
    v_student_name TEXT;
    v_roll TEXT;
    v_block TEXT;
    v_room TEXT;
    v_dept TEXT;
    v_attendance NUMERIC(5,2);
    v_fee_balance NUMERIC(10,2);
    v_today DATE := CURRENT_DATE;
    v_incident_id UUID;
    v_counter INT := 0;
BEGIN
    RAISE NOTICE 'Starting production migration seed for CampusDebug OS...';

    -- 7.1 Seed Core Staff Users into auth.users (if not exists)
    v_admin_id := 'a0000000-0000-0000-0000-000000000001'::UUID;
    v_warden_id := 'a0000000-0000-0000-0000-000000000002'::UUID;
    v_guard_id := 'a0000000-0000-0000-0000-000000000003'::UUID;
    v_dean_id := 'a0000000-0000-0000-0000-000000000004'::UUID;

    -- Upsert Auth Mock Users (for local development & Supabase preview)
    INSERT INTO auth.users (id, email, raw_user_meta_data, role, aud)
    VALUES 
        (v_admin_id, 'admin@bput.ac.in', '{"full_name": "System Administrator"}', 'authenticated', 'authenticated'),
        (v_warden_id, 'warden@bput.ac.in', '{"full_name": "Dr. S. K. Mohanty"}', 'authenticated', 'authenticated'),
        (v_guard_id, 'guard@bput.ac.in', '{"full_name": "Officer R. K. Behera"}', 'authenticated', 'authenticated'),
        (v_dean_id, 'dean@bput.ac.in', '{"full_name": "Prof. A. K. Patnaik (Dean Student Affairs)"}', 'authenticated', 'authenticated')
    ON CONFLICT (id) DO NOTHING;

    -- Staff Profiles
    INSERT INTO public.profiles (id, roll_number, full_name, role, phone_number, hostel_block, room_number, department, attendance_percentage, fee_due_balance)
    VALUES
        (v_admin_id, 'ADM-001', 'System Administrator', 'ADMIN', '+91 94370 11001', 'Admin Block', 'Room 101', 'IT Cell', 100.0, 0.0),
        (v_warden_id, 'WDN-001', 'Dr. S. K. Mohanty', 'WARDEN', '+91 94370 22002', 'Block B', 'Warden Qtr 01', 'Hostel Administration', 98.0, 0.0),
        (v_guard_id, 'GRD-001', 'Officer R. K. Behera', 'GUARD', '+91 94370 33003', 'Main Gate', 'Post 01', 'Campus Security', 100.0, 0.0),
        (v_dean_id, 'DEN-001', 'Prof. A. K. Patnaik', 'DEAN', '+91 94370 44004', 'Executive Block', 'Dean Office', 'Dean Student Affairs', 99.5, 0.0)
    ON CONFLICT (id) DO UPDATE SET
        full_name = EXCLUDED.full_name,
        role = EXCLUDED.role;

    -- 7.2 Seed Master Incidents (Hostel Clusters)
    INSERT INTO public.master_incidents (id, cluster_code, category, hostel_block, floor_number, status, ticket_count)
    VALUES
        ('c0000000-0000-0000-0000-000000000001'::UUID, 'MC-ELEC-B3', 'Electrical', 'Block B', '3rd Floor', 'OPEN', 6),
        ('c0000000-0000-0000-0000-000000000002'::UUID, 'MC-PLUMB-A1', 'Plumbing', 'Block A', '1st Floor', 'OPEN', 4),
        ('c0000000-0000-0000-0000-000000000003'::UUID, 'MC-WIFI-C2', 'Network', 'Block C', '2nd Floor', 'RESOLVED', 8)
    ON CONFLICT (cluster_code) DO NOTHING;

    -- 7.3 Seed 2,000 Students in Bulk
    FOR i IN 1..v_total_students LOOP
        -- Deterministic UUID generation
        v_student_id := ('10000000-0000-0000-0000-' || LPAD(i::TEXT, 12, '0'))::UUID;
        v_roll := (2201106000 + i)::TEXT;
        v_student_name := v_first_names[1 + (i % array_length(v_first_names, 1))] || ' ' || 
                          v_last_names[1 + (i % array_length(v_last_names, 1))];
        v_block := v_hostel_blocks[1 + (i % 4)];
        v_room := (100 + (i % 300))::TEXT;
        v_dept := v_departments[1 + (i % array_length(v_departments, 1))];
        v_attendance := ROUND(70.0 + ((i * 13) % 29)::NUMERIC + ((i % 10) * 0.1), 1);
        v_fee_balance := CASE WHEN (i % 3 = 0) THEN ROUND(1200 + ((i * 17) % 4000)::NUMERIC, 0) ELSE 0 END;

        -- Create Auth record
        INSERT INTO auth.users (id, email, raw_user_meta_data, role, aud)
        VALUES (
            v_student_id, 
            'student.' || v_roll || '@bput.ac.in', 
            jsonb_build_object('full_name', v_student_name, 'roll_number', v_roll), 
            'authenticated', 
            'authenticated'
        ) ON CONFLICT (id) DO NOTHING;

        -- Create Profile
        INSERT INTO public.profiles (
            id, roll_number, full_name, role, phone_number, hostel_block, 
            room_number, department, attendance_percentage, fee_due_balance
        ) VALUES (
            v_student_id, v_roll, v_student_name, 'STUDENT', 
            '+91 9' || LPAD((700000000 + i)::TEXT, 9, '0'), 
            v_block, v_room, v_dept, v_attendance, v_fee_balance
        ) ON CONFLICT (id) DO UPDATE SET
            attendance_percentage = EXCLUDED.attendance_percentage,
            fee_due_balance = EXCLUDED.fee_due_balance;

        -- Seed Active Gate Pass for ~15% of students
        IF (i % 7 = 0) THEN
            INSERT INTO public.gate_passes (
                student_id, pass_type, destination, reason, valid_until, status, hmac_signature, approved_by
            ) VALUES (
                v_student_id,
                CASE WHEN i % 2 = 0 THEN 'DAY'::pass_type_enum ELSE 'OVERNIGHT'::pass_type_enum END,
                'City Market / Medical Clinic',
                'Academic project supplies and essential medicines',
                TIMEZONE('utc', NOW() + INTERVAL '4 hours'),
                'APPROVED'::gate_pass_status_enum,
                md5(v_student_id::TEXT || NOW()::TEXT),
                v_warden_id
            );
        END IF;

        -- Seed Maintenance Tickets for ~10% of students
        IF (i % 10 = 0) THEN
            INSERT INTO public.tickets (
                student_id, master_incident_id, raw_text, category, location, urgency, sla_hours, status
            ) VALUES (
                v_student_id,
                CASE WHEN v_block = 'Block B' THEN 'c0000000-0000-0000-0000-000000000001'::UUID ELSE NULL END,
                'Ceiling light fixture sparking when regulator switched on.',
                'Electrical',
                v_block || ', Room ' || v_room,
                'HIGH'::urgency_level_enum,
                4,
                'ASSIGNED'::ticket_status_enum
            );
        END IF;

        -- Seed Today's Zero-Waste Meal RSVPs for all students
        -- ~92% eating lunch, ~88% eating dinner
        INSERT INTO public.meal_rsvps (student_id, meal_date, meal_type, status)
        VALUES 
            (v_student_id, v_today, 'LUNCH', CASE WHEN i % 12 = 0 THEN 'OPTED_OUT'::meal_rsvp_status_enum ELSE 'ATTENDING'::meal_rsvp_status_enum END),
            (v_student_id, v_today, 'DINNER', CASE WHEN i % 8 = 0 THEN 'OPTED_OUT'::meal_rsvp_status_enum ELSE 'ATTENDING'::meal_rsvp_status_enum END)
        ON CONFLICT (student_id, meal_date, meal_type) DO NOTHING;

        -- Seed Document Requests for ~5% of students
        IF (i % 20 = 0) THEN
            INSERT INTO public.document_requests (student_id, doc_type, status, remarks)
            VALUES (
                v_student_id,
                'BONAFIDE'::doc_type_enum,
                CASE WHEN i % 40 = 0 THEN 'READY_FOR_PICKUP'::doc_request_status_enum ELSE 'PROCESSING'::doc_request_status_enum END,
                'Required for Indian Oil Student Merit Scholarship 2026'
            );
        END IF;

        v_counter := v_counter + 1;
    END LOOP;

    RETURN jsonb_build_object(
        'success', true,
        'students_seeded', v_counter,
        'hostel_blocks', v_hostel_blocks,
        'status', 'Ready for CampusDebug OS Production'
    );
END;
$$ LANGUAGE plpgsql;

-- ==============================================================================
-- 8. EXECUTE SEED RUNNER
-- ==============================================================================
SELECT public.seed_campusdebug_production_data();
