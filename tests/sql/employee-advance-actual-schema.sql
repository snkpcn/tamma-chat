-- TEST ONLY: original financial DDL at snkpcn/tamma-chat@910762af1bb548afb326e0ddbcf60a9a3857e049.
-- No proposal is applied by this file. No production/customer/employee data is copied.
-- Use only in an empty disposable database with the exact external prerequisite schema.
-- This is a bounded database-test fixture, not a Supabase service replica.
-- Source blocks below are byte-for-byte slices; their boundaries/hashes are in the manifest.

-- BEGIN EXACT EXTERNAL PREREQUISITES / SYNTHETIC PRE-EXISTING EMPLOYEE
-- TEST ONLY: schema reconstructed from exact PostgreSQL catalog metadata.
-- All application constraint expressions, indexes, triggers and function definitions
-- are preserved. CREATE TABLE/ALTER TABLE wrappers and quoting are generated.
-- Provider prerequisites: existing anon, authenticated and service_role roles.
-- No credentials, real employees or real financial records are present.
-- The sole auth user below models a pre-existing principal; signup is not exercised.
-- Unrelated customer-signup function bodies are retained unchanged. Their external
-- customer subsystem is deliberately not emulated and must not be invoked here.

SET search_path = public;
CREATE SCHEMA auth;
CREATE SCHEMA tamma_chart_os;

-- TABLE FROM CATALOG: tamma_chart_os.employees
CREATE TABLE "tamma_chart_os"."employees" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "restaurant_id" uuid NOT NULL,
  "full_name" text NOT NULL,
  "nickname" text,
  "position_id" uuid,
  "phone" text,
  "start_date" date,
  "employment_type" text,
  "wage_amount" numeric(14,2),
  "status" text DEFAULT 'ทำงานอยู่'::text NOT NULL,
  "notes" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

-- TABLE FROM CATALOG: tamma_chart_os.restaurants
CREATE TABLE "tamma_chart_os"."restaurants" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "owner_id" uuid NOT NULL,
  "name" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

-- TABLE FROM CATALOG: auth.users
CREATE TABLE "auth"."users" (
  "instance_id" uuid,
  "id" uuid NOT NULL,
  "aud" character varying(255),
  "role" character varying(255),
  "email" character varying(255),
  "encrypted_password" character varying(255),
  "email_confirmed_at" timestamp with time zone,
  "invited_at" timestamp with time zone,
  "confirmation_token" character varying(255),
  "confirmation_sent_at" timestamp with time zone,
  "recovery_token" character varying(255),
  "recovery_sent_at" timestamp with time zone,
  "email_change_token_new" character varying(255),
  "email_change" character varying(255),
  "email_change_sent_at" timestamp with time zone,
  "last_sign_in_at" timestamp with time zone,
  "raw_app_meta_data" jsonb,
  "raw_user_meta_data" jsonb,
  "is_super_admin" boolean,
  "created_at" timestamp with time zone,
  "updated_at" timestamp with time zone,
  "phone" text DEFAULT NULL::character varying,
  "phone_confirmed_at" timestamp with time zone,
  "phone_change" text DEFAULT ''::character varying,
  "phone_change_token" character varying(255) DEFAULT ''::character varying,
  "phone_change_sent_at" timestamp with time zone,
  "confirmed_at" timestamp with time zone GENERATED ALWAYS AS (LEAST(email_confirmed_at, phone_confirmed_at)) STORED,
  "email_change_token_current" character varying(255) DEFAULT ''::character varying,
  "email_change_confirm_status" smallint DEFAULT 0,
  "banned_until" timestamp with time zone,
  "reauthentication_token" character varying(255) DEFAULT ''::character varying,
  "reauthentication_sent_at" timestamp with time zone,
  "is_sso_user" boolean DEFAULT false NOT NULL,
  "deleted_at" timestamp with time zone,
  "is_anonymous" boolean DEFAULT false NOT NULL
);

-- TABLE FROM CATALOG: tamma_chart_os.employee_positions
CREATE TABLE "tamma_chart_os"."employee_positions" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "restaurant_id" uuid NOT NULL,
  "name" text NOT NULL
);

-- TABLE FROM CATALOG: tamma_chart_os.investment_categories
CREATE TABLE "tamma_chart_os"."investment_categories" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "restaurant_id" uuid NOT NULL,
  "name" text NOT NULL,
  "sort_order" integer DEFAULT 0 NOT NULL,
  "is_archived" boolean DEFAULT false NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "creation_source" text DEFAULT 'manual'::text NOT NULL
);

-- TABLE FROM CATALOG: tamma_chart_os.investments
CREATE TABLE "tamma_chart_os"."investments" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "restaurant_id" uuid NOT NULL,
  "category_id" uuid,
  "project_id" uuid,
  "name" text NOT NULL,
  "description" text,
  "vendor_name" text,
  "budget_amount" numeric(14,2) DEFAULT 0 NOT NULL,
  "actual_amount" numeric(14,2) DEFAULT 0 NOT NULL,
  "quantity" numeric(14,3) DEFAULT 1 NOT NULL,
  "unit" text,
  "order_date" date,
  "paid_date" date,
  "status" text DEFAULT 'วางแผน'::text NOT NULL,
  "payment_method" text,
  "notes" text,
  "is_archived" boolean DEFAULT false NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "manual_actual_amount" numeric(14,2) DEFAULT 0 NOT NULL,
  "creation_source" text DEFAULT 'manual'::text NOT NULL
);

-- TABLE FROM CATALOG: tamma_chart_os.investment_payments
CREATE TABLE "tamma_chart_os"."investment_payments" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "restaurant_id" uuid NOT NULL,
  "investment_id" uuid NOT NULL,
  "receipt_intake_id" uuid,
  "amount" numeric(14,2) NOT NULL,
  "paid_date" date NOT NULL,
  "payment_method" text DEFAULT 'โอนผ่าน LINE Owner Group'::text NOT NULL,
  "vendor_name" text,
  "reference_number" text,
  "source" text DEFAULT 'line_owner_group'::text NOT NULL,
  "notes" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

-- TABLE FROM CATALOG: tamma_chart_os.projects
CREATE TABLE "tamma_chart_os"."projects" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "restaurant_id" uuid NOT NULL,
  "name" text NOT NULL,
  "description" text,
  "category" text,
  "status" text DEFAULT 'ยังไม่เริ่ม'::text NOT NULL,
  "start_date" date,
  "due_date" date,
  "budget" numeric(14,2),
  "owner_employee_id" uuid,
  "progress_percent" integer DEFAULT 0 NOT NULL,
  "notes" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

-- TABLE FROM CATALOG: tamma_chart_os.investment_receipt_intakes
CREATE TABLE "tamma_chart_os"."investment_receipt_intakes" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "restaurant_id" uuid NOT NULL,
  "source_channel" text DEFAULT 'line_owner_group'::text NOT NULL,
  "source_group_hash" text NOT NULL,
  "source_user_hash" text,
  "source_message_id" text NOT NULL,
  "context_message_id" text,
  "image_sha256" text NOT NULL,
  "storage_bucket" text DEFAULT 'financial-evidence'::text NOT NULL,
  "storage_path" text NOT NULL,
  "mime_type" text NOT NULL,
  "status" text DEFAULT 'awaiting_context'::text NOT NULL,
  "document_type" text,
  "amount" numeric(14,2),
  "paid_date" date,
  "payee_name" text,
  "reference_number" text,
  "extraction_confidence" numeric(4,3),
  "extraction_model" text,
  "extracted_data" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "purpose_text" text,
  "suggested_category_name" text,
  "suggested_category_confidence" numeric(4,3),
  "suggested_project_id" uuid,
  "suggested_investment_name" text,
  "classification_confidence" numeric(4,3),
  "classification_method" text,
  "category_created" boolean DEFAULT false NOT NULL,
  "category_id" uuid,
  "investment_id" uuid,
  "payment_id" uuid,
  "review_reason" text,
  "expires_at" timestamp with time zone DEFAULT (now() + '72:00:00'::interval) NOT NULL,
  "classified_at" timestamp with time zone,
  "posted_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

-- TABLE FROM CATALOG: tamma_chart_os.profiles
CREATE TABLE "tamma_chart_os"."profiles" (
  "id" uuid NOT NULL,
  "restaurant_id" uuid,
  "full_name" text,
  "role" text DEFAULT 'เจ้าของร้าน'::text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

-- EXACT CONSTRAINT: tamma_chart_os.employees.employees_employment_type_check
ALTER TABLE "tamma_chart_os"."employees" ADD CONSTRAINT "employees_employment_type_check" CHECK (employment_type IS NULL OR (employment_type = ANY (ARRAY['เงินเดือน'::text, 'รายวัน'::text, 'รายชั่วโมง'::text])));

-- EXACT CONSTRAINT: tamma_chart_os.employees.employees_pkey
ALTER TABLE "tamma_chart_os"."employees" ADD CONSTRAINT "employees_pkey" PRIMARY KEY (id);

-- EXACT CONSTRAINT: tamma_chart_os.employees.employees_status_check
ALTER TABLE "tamma_chart_os"."employees" ADD CONSTRAINT "employees_status_check" CHECK (status = ANY (ARRAY['ทำงานอยู่'::text, 'พ้นสภาพ'::text]));

-- EXACT CONSTRAINT: tamma_chart_os.restaurants.restaurants_pkey
ALTER TABLE "tamma_chart_os"."restaurants" ADD CONSTRAINT "restaurants_pkey" PRIMARY KEY (id);

-- EXACT CONSTRAINT: auth.users.users_email_change_confirm_status_check
ALTER TABLE "auth"."users" ADD CONSTRAINT "users_email_change_confirm_status_check" CHECK (email_change_confirm_status >= 0 AND email_change_confirm_status <= 2);

-- EXACT CONSTRAINT: auth.users.users_phone_key
ALTER TABLE "auth"."users" ADD CONSTRAINT "users_phone_key" UNIQUE (phone);

-- EXACT CONSTRAINT: auth.users.users_pkey
ALTER TABLE "auth"."users" ADD CONSTRAINT "users_pkey" PRIMARY KEY (id);

-- EXACT CONSTRAINT: tamma_chart_os.employee_positions.employee_positions_pkey
ALTER TABLE "tamma_chart_os"."employee_positions" ADD CONSTRAINT "employee_positions_pkey" PRIMARY KEY (id);

-- EXACT CONSTRAINT: tamma_chart_os.employee_positions.employee_positions_restaurant_id_name_key
ALTER TABLE "tamma_chart_os"."employee_positions" ADD CONSTRAINT "employee_positions_restaurant_id_name_key" UNIQUE (restaurant_id, name);

-- EXACT CONSTRAINT: tamma_chart_os.investment_categories.investment_categories_creation_source_check
ALTER TABLE "tamma_chart_os"."investment_categories" ADD CONSTRAINT "investment_categories_creation_source_check" CHECK (creation_source = ANY (ARRAY['manual'::text, 'thongthai_line'::text]));

-- EXACT CONSTRAINT: tamma_chart_os.investment_categories.investment_categories_pkey
ALTER TABLE "tamma_chart_os"."investment_categories" ADD CONSTRAINT "investment_categories_pkey" PRIMARY KEY (id);

-- EXACT CONSTRAINT: tamma_chart_os.investment_categories.investment_categories_restaurant_id_name_key
ALTER TABLE "tamma_chart_os"."investment_categories" ADD CONSTRAINT "investment_categories_restaurant_id_name_key" UNIQUE (restaurant_id, name);

-- EXACT CONSTRAINT: tamma_chart_os.investments.investments_actual_amount_check
ALTER TABLE "tamma_chart_os"."investments" ADD CONSTRAINT "investments_actual_amount_check" CHECK (actual_amount >= 0::numeric);

-- EXACT CONSTRAINT: tamma_chart_os.investments.investments_budget_amount_check
ALTER TABLE "tamma_chart_os"."investments" ADD CONSTRAINT "investments_budget_amount_check" CHECK (budget_amount >= 0::numeric);

-- EXACT CONSTRAINT: tamma_chart_os.investments.investments_creation_source_check
ALTER TABLE "tamma_chart_os"."investments" ADD CONSTRAINT "investments_creation_source_check" CHECK (creation_source = ANY (ARRAY['manual'::text, 'thongthai_line'::text]));

-- EXACT CONSTRAINT: tamma_chart_os.investments.investments_manual_actual_amount_check
ALTER TABLE "tamma_chart_os"."investments" ADD CONSTRAINT "investments_manual_actual_amount_check" CHECK (manual_actual_amount >= 0::numeric);

-- EXACT CONSTRAINT: tamma_chart_os.investments.investments_pkey
ALTER TABLE "tamma_chart_os"."investments" ADD CONSTRAINT "investments_pkey" PRIMARY KEY (id);

-- EXACT CONSTRAINT: tamma_chart_os.investments.investments_quantity_check
ALTER TABLE "tamma_chart_os"."investments" ADD CONSTRAINT "investments_quantity_check" CHECK (quantity >= 0::numeric);

-- EXACT CONSTRAINT: tamma_chart_os.investments.investments_status_check
ALTER TABLE "tamma_chart_os"."investments" ADD CONSTRAINT "investments_status_check" CHECK (status = ANY (ARRAY['วางแผน'::text, 'ขอราคา'::text, 'อนุมัติแล้ว'::text, 'สั่งซื้อแล้ว'::text, 'ชำระบางส่วน'::text, 'ชำระแล้ว'::text, 'ได้รับของแล้ว'::text, 'ยกเลิก'::text]));

-- EXACT CONSTRAINT: tamma_chart_os.investment_payments.investment_payments_amount_check
ALTER TABLE "tamma_chart_os"."investment_payments" ADD CONSTRAINT "investment_payments_amount_check" CHECK (amount > 0::numeric);

-- EXACT CONSTRAINT: tamma_chart_os.investment_payments.investment_payments_pkey
ALTER TABLE "tamma_chart_os"."investment_payments" ADD CONSTRAINT "investment_payments_pkey" PRIMARY KEY (id);

-- EXACT CONSTRAINT: tamma_chart_os.investment_payments.investment_payments_receipt_intake_id_key
ALTER TABLE "tamma_chart_os"."investment_payments" ADD CONSTRAINT "investment_payments_receipt_intake_id_key" UNIQUE (receipt_intake_id);

-- EXACT CONSTRAINT: tamma_chart_os.investment_payments.investment_payments_source_check
ALTER TABLE "tamma_chart_os"."investment_payments" ADD CONSTRAINT "investment_payments_source_check" CHECK (source = ANY (ARRAY['line_owner_group'::text, 'manual'::text, 'import'::text]));

-- EXACT CONSTRAINT: tamma_chart_os.projects.projects_pkey
ALTER TABLE "tamma_chart_os"."projects" ADD CONSTRAINT "projects_pkey" PRIMARY KEY (id);

-- EXACT CONSTRAINT: tamma_chart_os.projects.projects_progress_percent_check
ALTER TABLE "tamma_chart_os"."projects" ADD CONSTRAINT "projects_progress_percent_check" CHECK (progress_percent >= 0 AND progress_percent <= 100);

-- EXACT CONSTRAINT: tamma_chart_os.projects.projects_status_check
ALTER TABLE "tamma_chart_os"."projects" ADD CONSTRAINT "projects_status_check" CHECK (status = ANY (ARRAY['ยังไม่เริ่ม'::text, 'กำลังทำ'::text, 'รอ'::text, 'เสร็จแล้ว'::text, 'ยกเลิก'::text]));

-- EXACT CONSTRAINT: tamma_chart_os.investment_receipt_intakes.investment_receipt_intakes_amount_check
ALTER TABLE "tamma_chart_os"."investment_receipt_intakes" ADD CONSTRAINT "investment_receipt_intakes_amount_check" CHECK (amount > 0::numeric);

-- EXACT CONSTRAINT: tamma_chart_os.investment_receipt_intakes.investment_receipt_intakes_classification_confidence_check
ALTER TABLE "tamma_chart_os"."investment_receipt_intakes" ADD CONSTRAINT "investment_receipt_intakes_classification_confidence_check" CHECK (classification_confidence >= 0::numeric AND classification_confidence <= 1::numeric);

-- EXACT CONSTRAINT: tamma_chart_os.investment_receipt_intakes.investment_receipt_intakes_extraction_confidence_check
ALTER TABLE "tamma_chart_os"."investment_receipt_intakes" ADD CONSTRAINT "investment_receipt_intakes_extraction_confidence_check" CHECK (extraction_confidence >= 0::numeric AND extraction_confidence <= 1::numeric);

-- EXACT CONSTRAINT: tamma_chart_os.investment_receipt_intakes.investment_receipt_intakes_image_sha256_check
ALTER TABLE "tamma_chart_os"."investment_receipt_intakes" ADD CONSTRAINT "investment_receipt_intakes_image_sha256_check" CHECK (image_sha256 ~ '^[0-9a-f]{64}$'::text);

-- EXACT CONSTRAINT: tamma_chart_os.investment_receipt_intakes.investment_receipt_intakes_mime_type_check
ALTER TABLE "tamma_chart_os"."investment_receipt_intakes" ADD CONSTRAINT "investment_receipt_intakes_mime_type_check" CHECK (mime_type = ANY (ARRAY['image/jpeg'::text, 'image/png'::text, 'image/webp'::text]));

-- EXACT CONSTRAINT: tamma_chart_os.investment_receipt_intakes.investment_receipt_intakes_pkey
ALTER TABLE "tamma_chart_os"."investment_receipt_intakes" ADD CONSTRAINT "investment_receipt_intakes_pkey" PRIMARY KEY (id);

-- EXACT CONSTRAINT: tamma_chart_os.investment_receipt_intakes.investment_receipt_intakes_restaurant_id_image_sha256_key
ALTER TABLE "tamma_chart_os"."investment_receipt_intakes" ADD CONSTRAINT "investment_receipt_intakes_restaurant_id_image_sha256_key" UNIQUE (restaurant_id, image_sha256);

-- EXACT CONSTRAINT: tamma_chart_os.investment_receipt_intakes.investment_receipt_intakes_restaurant_id_source_channel_sou_key
ALTER TABLE "tamma_chart_os"."investment_receipt_intakes" ADD CONSTRAINT "investment_receipt_intakes_restaurant_id_source_channel_sou_key" UNIQUE (restaurant_id, source_channel, source_message_id);

-- EXACT CONSTRAINT: tamma_chart_os.investment_receipt_intakes.investment_receipt_intakes_source_channel_check
ALTER TABLE "tamma_chart_os"."investment_receipt_intakes" ADD CONSTRAINT "investment_receipt_intakes_source_channel_check" CHECK (source_channel = 'line_owner_group'::text);

-- EXACT CONSTRAINT: tamma_chart_os.investment_receipt_intakes.investment_receipt_intakes_status_check
ALTER TABLE "tamma_chart_os"."investment_receipt_intakes" ADD CONSTRAINT "investment_receipt_intakes_status_check" CHECK (status = ANY (ARRAY['awaiting_context'::text, 'needs_review'::text, 'posted'::text, 'cancelled'::text]));

-- EXACT CONSTRAINT: tamma_chart_os.investment_receipt_intakes.investment_receipt_intakes_suggested_category_confidence_check
ALTER TABLE "tamma_chart_os"."investment_receipt_intakes" ADD CONSTRAINT "investment_receipt_intakes_suggested_category_confidence_check" CHECK (suggested_category_confidence >= 0::numeric AND suggested_category_confidence <= 1::numeric);

-- EXACT CONSTRAINT: tamma_chart_os.profiles.profiles_pkey
ALTER TABLE "tamma_chart_os"."profiles" ADD CONSTRAINT "profiles_pkey" PRIMARY KEY (id);

-- EXACT CONSTRAINT: tamma_chart_os.employees.employees_position_id_fkey
ALTER TABLE "tamma_chart_os"."employees" ADD CONSTRAINT "employees_position_id_fkey" FOREIGN KEY (position_id) REFERENCES tamma_chart_os.employee_positions(id) ON DELETE SET NULL;

-- EXACT CONSTRAINT: tamma_chart_os.employees.employees_restaurant_id_fkey
ALTER TABLE "tamma_chart_os"."employees" ADD CONSTRAINT "employees_restaurant_id_fkey" FOREIGN KEY (restaurant_id) REFERENCES tamma_chart_os.restaurants(id) ON DELETE CASCADE;

-- EXACT CONSTRAINT: tamma_chart_os.restaurants.restaurants_owner_id_fkey
ALTER TABLE "tamma_chart_os"."restaurants" ADD CONSTRAINT "restaurants_owner_id_fkey" FOREIGN KEY (owner_id) REFERENCES auth.users(id) ON DELETE CASCADE;

-- EXACT CONSTRAINT: tamma_chart_os.employee_positions.employee_positions_restaurant_id_fkey
ALTER TABLE "tamma_chart_os"."employee_positions" ADD CONSTRAINT "employee_positions_restaurant_id_fkey" FOREIGN KEY (restaurant_id) REFERENCES tamma_chart_os.restaurants(id) ON DELETE CASCADE;

-- EXACT CONSTRAINT: tamma_chart_os.investment_categories.investment_categories_restaurant_id_fkey
ALTER TABLE "tamma_chart_os"."investment_categories" ADD CONSTRAINT "investment_categories_restaurant_id_fkey" FOREIGN KEY (restaurant_id) REFERENCES tamma_chart_os.restaurants(id) ON DELETE CASCADE;

-- EXACT CONSTRAINT: tamma_chart_os.investments.investments_category_id_fkey
ALTER TABLE "tamma_chart_os"."investments" ADD CONSTRAINT "investments_category_id_fkey" FOREIGN KEY (category_id) REFERENCES tamma_chart_os.investment_categories(id) ON DELETE SET NULL;

-- EXACT CONSTRAINT: tamma_chart_os.investments.investments_project_id_fkey
ALTER TABLE "tamma_chart_os"."investments" ADD CONSTRAINT "investments_project_id_fkey" FOREIGN KEY (project_id) REFERENCES tamma_chart_os.projects(id) ON DELETE SET NULL;

-- EXACT CONSTRAINT: tamma_chart_os.investments.investments_restaurant_id_fkey
ALTER TABLE "tamma_chart_os"."investments" ADD CONSTRAINT "investments_restaurant_id_fkey" FOREIGN KEY (restaurant_id) REFERENCES tamma_chart_os.restaurants(id) ON DELETE CASCADE;

-- EXACT CONSTRAINT: tamma_chart_os.investment_payments.investment_payments_investment_id_fkey
ALTER TABLE "tamma_chart_os"."investment_payments" ADD CONSTRAINT "investment_payments_investment_id_fkey" FOREIGN KEY (investment_id) REFERENCES tamma_chart_os.investments(id) ON DELETE CASCADE;

-- EXACT CONSTRAINT: tamma_chart_os.investment_payments.investment_payments_receipt_intake_id_fkey
ALTER TABLE "tamma_chart_os"."investment_payments" ADD CONSTRAINT "investment_payments_receipt_intake_id_fkey" FOREIGN KEY (receipt_intake_id) REFERENCES tamma_chart_os.investment_receipt_intakes(id) ON DELETE RESTRICT;

-- EXACT CONSTRAINT: tamma_chart_os.investment_payments.investment_payments_restaurant_id_fkey
ALTER TABLE "tamma_chart_os"."investment_payments" ADD CONSTRAINT "investment_payments_restaurant_id_fkey" FOREIGN KEY (restaurant_id) REFERENCES tamma_chart_os.restaurants(id) ON DELETE CASCADE;

-- EXACT CONSTRAINT: tamma_chart_os.projects.projects_owner_employee_id_fkey
ALTER TABLE "tamma_chart_os"."projects" ADD CONSTRAINT "projects_owner_employee_id_fkey" FOREIGN KEY (owner_employee_id) REFERENCES tamma_chart_os.employees(id) ON DELETE SET NULL;

-- EXACT CONSTRAINT: tamma_chart_os.projects.projects_restaurant_id_fkey
ALTER TABLE "tamma_chart_os"."projects" ADD CONSTRAINT "projects_restaurant_id_fkey" FOREIGN KEY (restaurant_id) REFERENCES tamma_chart_os.restaurants(id) ON DELETE CASCADE;

-- EXACT CONSTRAINT: tamma_chart_os.investment_receipt_intakes.investment_receipt_intakes_category_id_fkey
ALTER TABLE "tamma_chart_os"."investment_receipt_intakes" ADD CONSTRAINT "investment_receipt_intakes_category_id_fkey" FOREIGN KEY (category_id) REFERENCES tamma_chart_os.investment_categories(id) ON DELETE SET NULL;

-- EXACT CONSTRAINT: tamma_chart_os.investment_receipt_intakes.investment_receipt_intakes_investment_id_fkey
ALTER TABLE "tamma_chart_os"."investment_receipt_intakes" ADD CONSTRAINT "investment_receipt_intakes_investment_id_fkey" FOREIGN KEY (investment_id) REFERENCES tamma_chart_os.investments(id) ON DELETE SET NULL;

-- EXACT CONSTRAINT: tamma_chart_os.investment_receipt_intakes.investment_receipt_intakes_payment_id_fkey
ALTER TABLE "tamma_chart_os"."investment_receipt_intakes" ADD CONSTRAINT "investment_receipt_intakes_payment_id_fkey" FOREIGN KEY (payment_id) REFERENCES tamma_chart_os.investment_payments(id) ON DELETE SET NULL;

-- EXACT CONSTRAINT: tamma_chart_os.investment_receipt_intakes.investment_receipt_intakes_restaurant_id_fkey
ALTER TABLE "tamma_chart_os"."investment_receipt_intakes" ADD CONSTRAINT "investment_receipt_intakes_restaurant_id_fkey" FOREIGN KEY (restaurant_id) REFERENCES tamma_chart_os.restaurants(id) ON DELETE CASCADE;

-- EXACT CONSTRAINT: tamma_chart_os.investment_receipt_intakes.investment_receipt_intakes_suggested_project_id_fkey
ALTER TABLE "tamma_chart_os"."investment_receipt_intakes" ADD CONSTRAINT "investment_receipt_intakes_suggested_project_id_fkey" FOREIGN KEY (suggested_project_id) REFERENCES tamma_chart_os.projects(id) ON DELETE SET NULL;

-- EXACT CONSTRAINT: tamma_chart_os.profiles.profiles_id_fkey
ALTER TABLE "tamma_chart_os"."profiles" ADD CONSTRAINT "profiles_id_fkey" FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE;

-- EXACT CONSTRAINT: tamma_chart_os.profiles.profiles_restaurant_id_fkey
ALTER TABLE "tamma_chart_os"."profiles" ADD CONSTRAINT "profiles_restaurant_id_fkey" FOREIGN KEY (restaurant_id) REFERENCES tamma_chart_os.restaurants(id) ON DELETE SET NULL;

-- EXACT INDEX: auth.users
CREATE INDEX users_instance_id_idx ON auth.users USING btree (instance_id);

-- EXACT INDEX: auth.users
CREATE INDEX users_instance_id_email_idx ON auth.users USING btree (instance_id, lower((email)::text));

-- EXACT INDEX: auth.users
CREATE UNIQUE INDEX confirmation_token_idx ON auth.users USING btree (confirmation_token) WHERE ((confirmation_token)::text !~ '^[0-9 ]*$'::text);

-- EXACT INDEX: auth.users
CREATE UNIQUE INDEX recovery_token_idx ON auth.users USING btree (recovery_token) WHERE ((recovery_token)::text !~ '^[0-9 ]*$'::text);

-- EXACT INDEX: auth.users
CREATE UNIQUE INDEX email_change_token_current_idx ON auth.users USING btree (email_change_token_current) WHERE ((email_change_token_current)::text !~ '^[0-9 ]*$'::text);

-- EXACT INDEX: auth.users
CREATE UNIQUE INDEX email_change_token_new_idx ON auth.users USING btree (email_change_token_new) WHERE ((email_change_token_new)::text !~ '^[0-9 ]*$'::text);

-- EXACT INDEX: auth.users
CREATE UNIQUE INDEX reauthentication_token_idx ON auth.users USING btree (reauthentication_token) WHERE ((reauthentication_token)::text !~ '^[0-9 ]*$'::text);

-- EXACT INDEX: auth.users
CREATE UNIQUE INDEX users_email_partial_key ON auth.users USING btree (email) WHERE (is_sso_user = false);

-- EXACT INDEX: auth.users
CREATE INDEX users_is_anonymous_idx ON auth.users USING btree (is_anonymous);

-- EXACT INDEX: auth.users
CREATE INDEX idx_users_email ON auth.users USING btree (email);

-- EXACT INDEX: auth.users
CREATE INDEX idx_users_created_at_desc ON auth.users USING btree (created_at DESC);

-- EXACT INDEX: auth.users
CREATE INDEX idx_users_last_sign_in_at_desc ON auth.users USING btree (last_sign_in_at DESC);

-- EXACT INDEX: auth.users
CREATE INDEX idx_users_name ON auth.users USING btree (((raw_user_meta_data ->> 'name'::text))) WHERE ((raw_user_meta_data ->> 'name'::text) IS NOT NULL);

-- EXACT INDEX: tamma_chart_os.investment_payments
CREATE INDEX investment_payments_restaurant_date_idx ON tamma_chart_os.investment_payments USING btree (restaurant_id, paid_date DESC);

-- EXACT INDEX: tamma_chart_os.investment_payments
CREATE INDEX investment_payments_investment_idx ON tamma_chart_os.investment_payments USING btree (investment_id, paid_date DESC);

-- EXACT INDEX: tamma_chart_os.investment_receipt_intakes
CREATE INDEX investment_receipt_intakes_category_idx ON tamma_chart_os.investment_receipt_intakes USING btree (category_id);

-- EXACT INDEX: tamma_chart_os.investment_receipt_intakes
CREATE INDEX investment_receipt_intakes_investment_idx ON tamma_chart_os.investment_receipt_intakes USING btree (investment_id);

-- EXACT INDEX: tamma_chart_os.investment_receipt_intakes
CREATE INDEX investment_receipt_intakes_pending_idx ON tamma_chart_os.investment_receipt_intakes USING btree (restaurant_id, source_group_hash, status, created_at DESC);

-- EXACT INDEX: tamma_chart_os.investment_receipt_intakes
CREATE INDEX investment_receipt_intakes_project_idx ON tamma_chart_os.investment_receipt_intakes USING btree (suggested_project_id);

-- EXACT INDEX: tamma_chart_os.investment_receipt_intakes
CREATE INDEX investment_receipt_intakes_payment_idx ON tamma_chart_os.investment_receipt_intakes USING btree (payment_id);

-- EXACT INDEX: tamma_chart_os.investment_receipt_intakes
CREATE UNIQUE INDEX investment_receipt_intakes_one_pending_per_group_idx ON tamma_chart_os.investment_receipt_intakes USING btree (restaurant_id, source_group_hash) WHERE (status = ANY (ARRAY['awaiting_context'::text, 'needs_review'::text]));

-- EXACT INDEX: tamma_chart_os.investment_receipt_intakes
CREATE INDEX investment_receipt_intakes_user_pending_idx ON tamma_chart_os.investment_receipt_intakes USING btree (restaurant_id, source_group_hash, source_user_hash, status, created_at DESC);

-- EXACT FUNCTION: CREATE OR REPLACE FUNCTION tamma_chart_os.set_updated_at()
CREATE OR REPLACE FUNCTION tamma_chart_os.set_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_temp'
AS $function$
begin
  new.updated_at = now();
  return new;
end;
$function$
;

-- EXACT FUNCTION: CREATE OR REPLACE FUNCTION public.handle_new_auth_user_customer_account()
CREATE OR REPLACE FUNCTION public.handle_new_auth_user_customer_account()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
declare
  v_birth date;
  v_gender text;
  v_source text;
  v_marketing boolean := false;
  v_research boolean := false;
  v_consent_version text := 'v1';
  v_customer_id uuid;
  v_birth_raw text;
  v_gender_raw text;
  v_line_raw text;
  v_anonymous_raw text;
  v_guest_id uuid;
begin
  v_source := case when coalesce(new.raw_user_meta_data->>'acquisition_source','') in ('line','web','facebook','messenger','walk_in','staff','campaign') then new.raw_user_meta_data->>'acquisition_source' else 'web' end;
  v_birth_raw := nullif(new.raw_user_meta_data->>'birth_date','');
  if v_birth_raw ~ '^\d{4}-\d{2}-\d{2}$' then begin v_birth:=v_birth_raw::date; if v_birth<date '1900-01-01' or v_birth>current_date then v_birth:=null; end if; exception when others then v_birth:=null; end; end if;
  v_gender_raw := nullif(new.raw_user_meta_data->>'gender','');
  if v_gender_raw in ('male','female','non_binary','self_described','prefer_not_to_say') then v_gender:=v_gender_raw; end if;
  v_line_raw := nullif(trim(new.raw_user_meta_data->>'line_id'),'');
  v_marketing := lower(coalesce(new.raw_user_meta_data->>'marketing_opt_in','false')) in ('true','1','yes','on');
  v_research := lower(coalesce(new.raw_user_meta_data->>'research_opt_in','false')) in ('true','1','yes','on');
  v_consent_version := left(coalesce(nullif(new.raw_user_meta_data->>'consent_version',''),'v1'),40);

  insert into public.customer_accounts(auth_user_id,member_status,membership_started_at,acquisition_source,birth_date,gender,marketing_opt_in,research_opt_in,research_consent_at,consent_version,created_at,updated_at)
  values(new.id,'member',now(),v_source,v_birth,v_gender,v_marketing,v_research,case when v_research then now() else null end,v_consent_version,now(),now())
  on conflict (auth_user_id) do update set member_status='member',membership_started_at=coalesce(public.customer_accounts.membership_started_at,excluded.membership_started_at),acquisition_source=case when public.customer_accounts.acquisition_source='unknown' then excluded.acquisition_source else public.customer_accounts.acquisition_source end,birth_date=coalesce(public.customer_accounts.birth_date,excluded.birth_date),gender=coalesce(public.customer_accounts.gender,excluded.gender),updated_at=now()
  returning id into v_customer_id;

  if v_line_raw is not null then perform public.store_customer_line_id(v_customer_id,v_line_raw); end if;

  insert into public.customer_membership_events(customer_id,event_type,source_channel,metadata)
  values(v_customer_id,'signup_completed',case when v_source in ('line','web','facebook','messenger','walk_in') then v_source else 'web' end,jsonb_build_object('auth_user_id',new.id,'capture','auth_signup'));
  if new.raw_user_meta_data ? 'marketing_opt_in' then insert into public.customer_consents(customer_id,consent_type,granted,consent_version,source_channel,metadata) values(v_customer_id,'marketing',v_marketing,v_consent_version,case when v_source in ('line','web','facebook','messenger','walk_in') then v_source else 'web' end,jsonb_build_object('capture','signup')); end if;
  if new.raw_user_meta_data ? 'research_opt_in' then insert into public.customer_consents(customer_id,consent_type,granted,consent_version,source_channel,metadata) values(v_customer_id,'research',v_research,v_consent_version,case when v_source in ('line','web','facebook','messenger','walk_in') then v_source else 'web' end,jsonb_build_object('capture','signup')); end if;

  -- Optional immediate web guest merge. Treat the browser anonymous UUID as a bearer identifier, matching the existing guest-memory model.
  v_anonymous_raw := nullif(new.raw_user_meta_data->>'anonymous_id','');
  if v_anonymous_raw ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$' then
    select id into v_guest_id from public.guests where anonymous_id=v_anonymous_raw::uuid limit 1;
    if v_guest_id is not null then
      v_customer_id := public.merge_member_identity(new.id,v_guest_id,case when v_source in ('line','web','facebook','messenger') then v_source else 'web' end);
    end if;
  end if;

  perform public.refresh_customer_profile_completion(v_customer_id);
  return new;
end;
$function$
;

-- EXACT FUNCTION: CREATE OR REPLACE FUNCTION public.handle_auth_user_email_change_customer_account()
CREATE OR REPLACE FUNCTION public.handle_auth_user_email_change_customer_account()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
declare v_customer_id uuid;
begin
  select id into v_customer_id from public.customer_accounts where auth_user_id = new.id;
  if v_customer_id is not null then perform public.refresh_customer_profile_completion(v_customer_id); end if;
  return new;
end;
$function$
;

-- EXACT FUNCTION: CREATE OR REPLACE FUNCTION tamma_chart_os.apply_manual_investment_actual_v1()
CREATE OR REPLACE FUNCTION tamma_chart_os.apply_manual_investment_actual_v1()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'tamma_chart_os', 'pg_temp'
AS $function$
begin
  new.actual_amount := new.manual_actual_amount + coalesce((
    select sum(p.amount)
    from tamma_chart_os.investment_payments p
    where p.investment_id = new.id
  ), 0);
  return new;
end;
$function$
;

-- EXACT FUNCTION: CREATE OR REPLACE FUNCTION tamma_chart_os.refresh_investment_actual_from_payment_v1()
CREATE OR REPLACE FUNCTION tamma_chart_os.refresh_investment_actual_from_payment_v1()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'tamma_chart_os', 'pg_temp'
AS $function$
begin
  if tg_op = 'DELETE' then
    perform tamma_chart_os.recalculate_investment_actual_v1(old.investment_id);
    return old;
  elsif tg_op = 'UPDATE' then
    perform tamma_chart_os.recalculate_investment_actual_v1(old.investment_id);
    if new.investment_id <> old.investment_id then
      perform tamma_chart_os.recalculate_investment_actual_v1(new.investment_id);
    end if;
    return new;
  else
    perform tamma_chart_os.recalculate_investment_actual_v1(new.investment_id);
    return new;
  end if;
end;
$function$
;

-- EXACT FUNCTION: CREATE OR REPLACE FUNCTION auth.uid()
CREATE OR REPLACE FUNCTION auth.uid()
 RETURNS uuid
 LANGUAGE sql
 STABLE
AS $function$
  select 
  coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
  )::uuid
$function$
;

-- EXACT FUNCTION: CREATE OR REPLACE FUNCTION tamma_chart_os.auth_restaurant_id()
CREATE OR REPLACE FUNCTION tamma_chart_os.auth_restaurant_id()
 RETURNS uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'tamma_chart_os', 'pg_temp'
AS $function$
  select restaurant_id from tamma_chart_os.profiles where id = auth.uid();
$function$
;

-- EXACT FUNCTION: CREATE OR REPLACE FUNCTION tamma_chart_os.recalculate_investment_actual_v1(p_investment_id uuid)
CREATE OR REPLACE FUNCTION tamma_chart_os.recalculate_investment_actual_v1(p_investment_id uuid)
 RETURNS void
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'tamma_chart_os', 'pg_temp'
AS $function$
  update tamma_chart_os.investments i
  set actual_amount = i.manual_actual_amount + coalesce((
    select sum(p.amount)
    from tamma_chart_os.investment_payments p
    where p.investment_id = i.id
  ), 0)
  where i.id = p_investment_id;
$function$
;

-- ROW SECURITY: auth.users
ALTER TABLE "auth"."users" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "auth"."users" NO FORCE ROW LEVEL SECURITY;

-- ROW SECURITY: tamma_chart_os.restaurants
ALTER TABLE "tamma_chart_os"."restaurants" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "tamma_chart_os"."restaurants" NO FORCE ROW LEVEL SECURITY;

-- ROW SECURITY: tamma_chart_os.employee_positions
ALTER TABLE "tamma_chart_os"."employee_positions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "tamma_chart_os"."employee_positions" NO FORCE ROW LEVEL SECURITY;

-- ROW SECURITY: tamma_chart_os.employees
ALTER TABLE "tamma_chart_os"."employees" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "tamma_chart_os"."employees" NO FORCE ROW LEVEL SECURITY;

-- ROW SECURITY: tamma_chart_os.projects
ALTER TABLE "tamma_chart_os"."projects" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "tamma_chart_os"."projects" NO FORCE ROW LEVEL SECURITY;

-- ROW SECURITY: tamma_chart_os.investment_categories
ALTER TABLE "tamma_chart_os"."investment_categories" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "tamma_chart_os"."investment_categories" NO FORCE ROW LEVEL SECURITY;

-- ROW SECURITY: tamma_chart_os.investments
ALTER TABLE "tamma_chart_os"."investments" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "tamma_chart_os"."investments" NO FORCE ROW LEVEL SECURITY;

-- ROW SECURITY: tamma_chart_os.investment_payments
ALTER TABLE "tamma_chart_os"."investment_payments" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "tamma_chart_os"."investment_payments" NO FORCE ROW LEVEL SECURITY;

-- ROW SECURITY: tamma_chart_os.investment_receipt_intakes
ALTER TABLE "tamma_chart_os"."investment_receipt_intakes" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "tamma_chart_os"."investment_receipt_intakes" NO FORCE ROW LEVEL SECURITY;

-- ROW SECURITY: tamma_chart_os.profiles
ALTER TABLE "tamma_chart_os"."profiles" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "tamma_chart_os"."profiles" NO FORCE ROW LEVEL SECURITY;

-- EXACT POLICY EXPRESSIONS: owner can manage own restaurant
CREATE POLICY "owner can manage own restaurant" ON "tamma_chart_os"."restaurants" AS PERMISSIVE FOR ALL TO PUBLIC
  USING ((owner_id = auth.uid()))
  WITH CHECK ((owner_id = auth.uid()));

-- EXACT POLICY EXPRESSIONS: restaurant scoped access
CREATE POLICY "restaurant scoped access" ON "tamma_chart_os"."employee_positions" AS PERMISSIVE FOR ALL TO PUBLIC
  USING ((restaurant_id = tamma_chart_os.auth_restaurant_id()))
  WITH CHECK ((restaurant_id = tamma_chart_os.auth_restaurant_id()));

-- EXACT POLICY EXPRESSIONS: restaurant scoped access
CREATE POLICY "restaurant scoped access" ON "tamma_chart_os"."employees" AS PERMISSIVE FOR ALL TO PUBLIC
  USING ((restaurant_id = tamma_chart_os.auth_restaurant_id()))
  WITH CHECK ((restaurant_id = tamma_chart_os.auth_restaurant_id()));

-- EXACT POLICY EXPRESSIONS: restaurant scoped access
CREATE POLICY "restaurant scoped access" ON "tamma_chart_os"."projects" AS PERMISSIVE FOR ALL TO PUBLIC
  USING ((restaurant_id = tamma_chart_os.auth_restaurant_id()))
  WITH CHECK ((restaurant_id = tamma_chart_os.auth_restaurant_id()));

-- EXACT POLICY EXPRESSIONS: restaurant scoped access
CREATE POLICY "restaurant scoped access" ON "tamma_chart_os"."investment_categories" AS PERMISSIVE FOR ALL TO PUBLIC
  USING ((restaurant_id = tamma_chart_os.auth_restaurant_id()))
  WITH CHECK ((restaurant_id = tamma_chart_os.auth_restaurant_id()));

-- EXACT POLICY EXPRESSIONS: restaurant scoped access
CREATE POLICY "restaurant scoped access" ON "tamma_chart_os"."investments" AS PERMISSIVE FOR ALL TO PUBLIC
  USING ((restaurant_id = tamma_chart_os.auth_restaurant_id()))
  WITH CHECK ((restaurant_id = tamma_chart_os.auth_restaurant_id()));

-- EXACT POLICY EXPRESSIONS: restaurant can view investment payments
CREATE POLICY "restaurant can view investment payments" ON "tamma_chart_os"."investment_payments" AS PERMISSIVE FOR SELECT TO "authenticated"
  USING ((restaurant_id = tamma_chart_os.auth_restaurant_id()));

-- EXACT POLICY EXPRESSIONS: restaurant can view owner receipt intakes
CREATE POLICY "restaurant can view owner receipt intakes" ON "tamma_chart_os"."investment_receipt_intakes" AS PERMISSIVE FOR SELECT TO "authenticated"
  USING ((restaurant_id = tamma_chart_os.auth_restaurant_id()));

-- EXACT POLICY EXPRESSIONS: user can update own profile
CREATE POLICY "user can update own profile" ON "tamma_chart_os"."profiles" AS PERMISSIVE FOR UPDATE TO PUBLIC
  USING ((id = auth.uid()))
  WITH CHECK ((id = auth.uid()));

-- EXACT POLICY EXPRESSIONS: user can view own profile
CREATE POLICY "user can view own profile" ON "tamma_chart_os"."profiles" AS PERMISSIVE FOR SELECT TO PUBLIC
  USING ((id = auth.uid()));

-- CATALOG TABLE GRANT
GRANT INSERT ON TABLE "tamma_chart_os"."restaurants" TO "authenticated";

-- CATALOG TABLE GRANT
GRANT SELECT ON TABLE "tamma_chart_os"."restaurants" TO "authenticated";

-- CATALOG TABLE GRANT
GRANT UPDATE ON TABLE "tamma_chart_os"."restaurants" TO "authenticated";

-- CATALOG TABLE GRANT
GRANT DELETE ON TABLE "tamma_chart_os"."restaurants" TO "authenticated";

-- CATALOG TABLE GRANT
GRANT TRUNCATE ON TABLE "tamma_chart_os"."restaurants" TO "authenticated";

-- CATALOG TABLE GRANT
GRANT REFERENCES ON TABLE "tamma_chart_os"."restaurants" TO "authenticated";

-- CATALOG TABLE GRANT
GRANT TRIGGER ON TABLE "tamma_chart_os"."restaurants" TO "authenticated";

-- CATALOG TABLE GRANT
GRANT INSERT ON TABLE "tamma_chart_os"."restaurants" TO "service_role";

-- CATALOG TABLE GRANT
GRANT SELECT ON TABLE "tamma_chart_os"."restaurants" TO "service_role";

-- CATALOG TABLE GRANT
GRANT UPDATE ON TABLE "tamma_chart_os"."restaurants" TO "service_role";

-- CATALOG TABLE GRANT
GRANT DELETE ON TABLE "tamma_chart_os"."restaurants" TO "service_role";

-- CATALOG TABLE GRANT
GRANT TRUNCATE ON TABLE "tamma_chart_os"."restaurants" TO "service_role";

-- CATALOG TABLE GRANT
GRANT REFERENCES ON TABLE "tamma_chart_os"."restaurants" TO "service_role";

-- CATALOG TABLE GRANT
GRANT TRIGGER ON TABLE "tamma_chart_os"."restaurants" TO "service_role";

-- CATALOG TABLE GRANT
GRANT INSERT ON TABLE "tamma_chart_os"."employee_positions" TO "authenticated";

-- CATALOG TABLE GRANT
GRANT SELECT ON TABLE "tamma_chart_os"."employee_positions" TO "authenticated";

-- CATALOG TABLE GRANT
GRANT UPDATE ON TABLE "tamma_chart_os"."employee_positions" TO "authenticated";

-- CATALOG TABLE GRANT
GRANT DELETE ON TABLE "tamma_chart_os"."employee_positions" TO "authenticated";

-- CATALOG TABLE GRANT
GRANT TRUNCATE ON TABLE "tamma_chart_os"."employee_positions" TO "authenticated";

-- CATALOG TABLE GRANT
GRANT REFERENCES ON TABLE "tamma_chart_os"."employee_positions" TO "authenticated";

-- CATALOG TABLE GRANT
GRANT TRIGGER ON TABLE "tamma_chart_os"."employee_positions" TO "authenticated";

-- CATALOG TABLE GRANT
GRANT INSERT ON TABLE "tamma_chart_os"."employee_positions" TO "service_role";

-- CATALOG TABLE GRANT
GRANT SELECT ON TABLE "tamma_chart_os"."employee_positions" TO "service_role";

-- CATALOG TABLE GRANT
GRANT UPDATE ON TABLE "tamma_chart_os"."employee_positions" TO "service_role";

-- CATALOG TABLE GRANT
GRANT DELETE ON TABLE "tamma_chart_os"."employee_positions" TO "service_role";

-- CATALOG TABLE GRANT
GRANT TRUNCATE ON TABLE "tamma_chart_os"."employee_positions" TO "service_role";

-- CATALOG TABLE GRANT
GRANT REFERENCES ON TABLE "tamma_chart_os"."employee_positions" TO "service_role";

-- CATALOG TABLE GRANT
GRANT TRIGGER ON TABLE "tamma_chart_os"."employee_positions" TO "service_role";

-- CATALOG TABLE GRANT
GRANT INSERT ON TABLE "tamma_chart_os"."employees" TO "authenticated";

-- CATALOG TABLE GRANT
GRANT SELECT ON TABLE "tamma_chart_os"."employees" TO "authenticated";

-- CATALOG TABLE GRANT
GRANT UPDATE ON TABLE "tamma_chart_os"."employees" TO "authenticated";

-- CATALOG TABLE GRANT
GRANT DELETE ON TABLE "tamma_chart_os"."employees" TO "authenticated";

-- CATALOG TABLE GRANT
GRANT TRUNCATE ON TABLE "tamma_chart_os"."employees" TO "authenticated";

-- CATALOG TABLE GRANT
GRANT REFERENCES ON TABLE "tamma_chart_os"."employees" TO "authenticated";

-- CATALOG TABLE GRANT
GRANT TRIGGER ON TABLE "tamma_chart_os"."employees" TO "authenticated";

-- CATALOG TABLE GRANT
GRANT INSERT ON TABLE "tamma_chart_os"."employees" TO "service_role";

-- CATALOG TABLE GRANT
GRANT SELECT ON TABLE "tamma_chart_os"."employees" TO "service_role";

-- CATALOG TABLE GRANT
GRANT UPDATE ON TABLE "tamma_chart_os"."employees" TO "service_role";

-- CATALOG TABLE GRANT
GRANT DELETE ON TABLE "tamma_chart_os"."employees" TO "service_role";

-- CATALOG TABLE GRANT
GRANT TRUNCATE ON TABLE "tamma_chart_os"."employees" TO "service_role";

-- CATALOG TABLE GRANT
GRANT REFERENCES ON TABLE "tamma_chart_os"."employees" TO "service_role";

-- CATALOG TABLE GRANT
GRANT TRIGGER ON TABLE "tamma_chart_os"."employees" TO "service_role";

-- CATALOG TABLE GRANT
GRANT INSERT ON TABLE "tamma_chart_os"."projects" TO "authenticated";

-- CATALOG TABLE GRANT
GRANT SELECT ON TABLE "tamma_chart_os"."projects" TO "authenticated";

-- CATALOG TABLE GRANT
GRANT UPDATE ON TABLE "tamma_chart_os"."projects" TO "authenticated";

-- CATALOG TABLE GRANT
GRANT DELETE ON TABLE "tamma_chart_os"."projects" TO "authenticated";

-- CATALOG TABLE GRANT
GRANT TRUNCATE ON TABLE "tamma_chart_os"."projects" TO "authenticated";

-- CATALOG TABLE GRANT
GRANT REFERENCES ON TABLE "tamma_chart_os"."projects" TO "authenticated";

-- CATALOG TABLE GRANT
GRANT TRIGGER ON TABLE "tamma_chart_os"."projects" TO "authenticated";

-- CATALOG TABLE GRANT
GRANT INSERT ON TABLE "tamma_chart_os"."projects" TO "service_role";

-- CATALOG TABLE GRANT
GRANT SELECT ON TABLE "tamma_chart_os"."projects" TO "service_role";

-- CATALOG TABLE GRANT
GRANT UPDATE ON TABLE "tamma_chart_os"."projects" TO "service_role";

-- CATALOG TABLE GRANT
GRANT DELETE ON TABLE "tamma_chart_os"."projects" TO "service_role";

-- CATALOG TABLE GRANT
GRANT TRUNCATE ON TABLE "tamma_chart_os"."projects" TO "service_role";

-- CATALOG TABLE GRANT
GRANT REFERENCES ON TABLE "tamma_chart_os"."projects" TO "service_role";

-- CATALOG TABLE GRANT
GRANT TRIGGER ON TABLE "tamma_chart_os"."projects" TO "service_role";

-- CATALOG TABLE GRANT
GRANT INSERT ON TABLE "tamma_chart_os"."investment_categories" TO "authenticated";

-- CATALOG TABLE GRANT
GRANT SELECT ON TABLE "tamma_chart_os"."investment_categories" TO "authenticated";

-- CATALOG TABLE GRANT
GRANT UPDATE ON TABLE "tamma_chart_os"."investment_categories" TO "authenticated";

-- CATALOG TABLE GRANT
GRANT DELETE ON TABLE "tamma_chart_os"."investment_categories" TO "authenticated";

-- CATALOG TABLE GRANT
GRANT TRUNCATE ON TABLE "tamma_chart_os"."investment_categories" TO "authenticated";

-- CATALOG TABLE GRANT
GRANT REFERENCES ON TABLE "tamma_chart_os"."investment_categories" TO "authenticated";

-- CATALOG TABLE GRANT
GRANT TRIGGER ON TABLE "tamma_chart_os"."investment_categories" TO "authenticated";

-- CATALOG TABLE GRANT
GRANT INSERT ON TABLE "tamma_chart_os"."investment_categories" TO "service_role";

-- CATALOG TABLE GRANT
GRANT SELECT ON TABLE "tamma_chart_os"."investment_categories" TO "service_role";

-- CATALOG TABLE GRANT
GRANT UPDATE ON TABLE "tamma_chart_os"."investment_categories" TO "service_role";

-- CATALOG TABLE GRANT
GRANT DELETE ON TABLE "tamma_chart_os"."investment_categories" TO "service_role";

-- CATALOG TABLE GRANT
GRANT TRUNCATE ON TABLE "tamma_chart_os"."investment_categories" TO "service_role";

-- CATALOG TABLE GRANT
GRANT REFERENCES ON TABLE "tamma_chart_os"."investment_categories" TO "service_role";

-- CATALOG TABLE GRANT
GRANT TRIGGER ON TABLE "tamma_chart_os"."investment_categories" TO "service_role";

-- CATALOG TABLE GRANT
GRANT INSERT ON TABLE "tamma_chart_os"."investments" TO "authenticated";

-- CATALOG TABLE GRANT
GRANT SELECT ON TABLE "tamma_chart_os"."investments" TO "authenticated";

-- CATALOG TABLE GRANT
GRANT UPDATE ON TABLE "tamma_chart_os"."investments" TO "authenticated";

-- CATALOG TABLE GRANT
GRANT DELETE ON TABLE "tamma_chart_os"."investments" TO "authenticated";

-- CATALOG TABLE GRANT
GRANT TRUNCATE ON TABLE "tamma_chart_os"."investments" TO "authenticated";

-- CATALOG TABLE GRANT
GRANT REFERENCES ON TABLE "tamma_chart_os"."investments" TO "authenticated";

-- CATALOG TABLE GRANT
GRANT TRIGGER ON TABLE "tamma_chart_os"."investments" TO "authenticated";

-- CATALOG TABLE GRANT
GRANT INSERT ON TABLE "tamma_chart_os"."investments" TO "service_role";

-- CATALOG TABLE GRANT
GRANT SELECT ON TABLE "tamma_chart_os"."investments" TO "service_role";

-- CATALOG TABLE GRANT
GRANT UPDATE ON TABLE "tamma_chart_os"."investments" TO "service_role";

-- CATALOG TABLE GRANT
GRANT DELETE ON TABLE "tamma_chart_os"."investments" TO "service_role";

-- CATALOG TABLE GRANT
GRANT TRUNCATE ON TABLE "tamma_chart_os"."investments" TO "service_role";

-- CATALOG TABLE GRANT
GRANT REFERENCES ON TABLE "tamma_chart_os"."investments" TO "service_role";

-- CATALOG TABLE GRANT
GRANT TRIGGER ON TABLE "tamma_chart_os"."investments" TO "service_role";

-- CATALOG TABLE GRANT
GRANT INSERT ON TABLE "tamma_chart_os"."investment_payments" TO "service_role";

-- CATALOG TABLE GRANT
GRANT SELECT ON TABLE "tamma_chart_os"."investment_payments" TO "service_role";

-- CATALOG TABLE GRANT
GRANT UPDATE ON TABLE "tamma_chart_os"."investment_payments" TO "service_role";

-- CATALOG TABLE GRANT
GRANT DELETE ON TABLE "tamma_chart_os"."investment_payments" TO "service_role";

-- CATALOG TABLE GRANT
GRANT TRUNCATE ON TABLE "tamma_chart_os"."investment_payments" TO "service_role";

-- CATALOG TABLE GRANT
GRANT REFERENCES ON TABLE "tamma_chart_os"."investment_payments" TO "service_role";

-- CATALOG TABLE GRANT
GRANT TRIGGER ON TABLE "tamma_chart_os"."investment_payments" TO "service_role";

-- CATALOG TABLE GRANT
GRANT SELECT ON TABLE "tamma_chart_os"."investment_payments" TO "authenticated";

-- CATALOG TABLE GRANT
GRANT INSERT ON TABLE "tamma_chart_os"."investment_receipt_intakes" TO "service_role";

-- CATALOG TABLE GRANT
GRANT SELECT ON TABLE "tamma_chart_os"."investment_receipt_intakes" TO "service_role";

-- CATALOG TABLE GRANT
GRANT UPDATE ON TABLE "tamma_chart_os"."investment_receipt_intakes" TO "service_role";

-- CATALOG TABLE GRANT
GRANT DELETE ON TABLE "tamma_chart_os"."investment_receipt_intakes" TO "service_role";

-- CATALOG TABLE GRANT
GRANT TRUNCATE ON TABLE "tamma_chart_os"."investment_receipt_intakes" TO "service_role";

-- CATALOG TABLE GRANT
GRANT REFERENCES ON TABLE "tamma_chart_os"."investment_receipt_intakes" TO "service_role";

-- CATALOG TABLE GRANT
GRANT TRIGGER ON TABLE "tamma_chart_os"."investment_receipt_intakes" TO "service_role";

-- CATALOG TABLE GRANT
GRANT SELECT ON TABLE "tamma_chart_os"."investment_receipt_intakes" TO "authenticated";

-- CATALOG TABLE GRANT
GRANT INSERT ON TABLE "tamma_chart_os"."profiles" TO "authenticated";

-- CATALOG TABLE GRANT
GRANT SELECT ON TABLE "tamma_chart_os"."profiles" TO "authenticated";

-- CATALOG TABLE GRANT
GRANT UPDATE ON TABLE "tamma_chart_os"."profiles" TO "authenticated";

-- CATALOG TABLE GRANT
GRANT DELETE ON TABLE "tamma_chart_os"."profiles" TO "authenticated";

-- CATALOG TABLE GRANT
GRANT TRUNCATE ON TABLE "tamma_chart_os"."profiles" TO "authenticated";

-- CATALOG TABLE GRANT
GRANT REFERENCES ON TABLE "tamma_chart_os"."profiles" TO "authenticated";

-- CATALOG TABLE GRANT
GRANT TRIGGER ON TABLE "tamma_chart_os"."profiles" TO "authenticated";

-- CATALOG TABLE GRANT
GRANT INSERT ON TABLE "tamma_chart_os"."profiles" TO "service_role";

-- CATALOG TABLE GRANT
GRANT SELECT ON TABLE "tamma_chart_os"."profiles" TO "service_role";

-- CATALOG TABLE GRANT
GRANT UPDATE ON TABLE "tamma_chart_os"."profiles" TO "service_role";

-- CATALOG TABLE GRANT
GRANT DELETE ON TABLE "tamma_chart_os"."profiles" TO "service_role";

-- CATALOG TABLE GRANT
GRANT TRUNCATE ON TABLE "tamma_chart_os"."profiles" TO "service_role";

-- CATALOG TABLE GRANT
GRANT REFERENCES ON TABLE "tamma_chart_os"."profiles" TO "service_role";

-- CATALOG TABLE GRANT
GRANT TRIGGER ON TABLE "tamma_chart_os"."profiles" TO "service_role";

-- RESET SCHEMA ACL FOR TESTED ROLES
REVOKE ALL ON SCHEMA "auth" FROM PUBLIC, anon, authenticated, service_role;

-- CATALOG SCHEMA GRANT FOR TESTED ROLE
GRANT USAGE ON SCHEMA "auth" TO "anon";

-- CATALOG SCHEMA GRANT FOR TESTED ROLE
GRANT USAGE ON SCHEMA "auth" TO "authenticated";

-- CATALOG SCHEMA GRANT FOR TESTED ROLE
GRANT USAGE ON SCHEMA "auth" TO "service_role";

-- CATALOG SCHEMA GRANT FOR TESTED ROLE
GRANT USAGE ON SCHEMA "auth" TO "postgres";

-- RESET SCHEMA ACL FOR TESTED ROLES
REVOKE ALL ON SCHEMA "tamma_chart_os" FROM PUBLIC, anon, authenticated, service_role;

-- CATALOG SCHEMA GRANT FOR TESTED ROLE
GRANT USAGE ON SCHEMA "tamma_chart_os" TO "postgres";

-- CATALOG SCHEMA GRANT FOR TESTED ROLE
GRANT CREATE ON SCHEMA "tamma_chart_os" TO "postgres";

-- CATALOG SCHEMA GRANT FOR TESTED ROLE
GRANT USAGE ON SCHEMA "tamma_chart_os" TO "authenticated";

-- CATALOG SCHEMA GRANT FOR TESTED ROLE
GRANT USAGE ON SCHEMA "tamma_chart_os" TO "service_role";

-- RESET FUNCTION ACL FOR TESTED ROLES
REVOKE ALL ON FUNCTION "tamma_chart_os"."set_updated_at"() FROM PUBLIC, anon, authenticated, service_role;

-- CATALOG FUNCTION GRANT FOR TESTED ROLE
GRANT EXECUTE ON FUNCTION "tamma_chart_os"."set_updated_at"() TO PUBLIC;

-- CATALOG FUNCTION GRANT FOR TESTED ROLE
GRANT EXECUTE ON FUNCTION "tamma_chart_os"."set_updated_at"() TO "postgres";

-- CATALOG FUNCTION GRANT FOR TESTED ROLE
GRANT EXECUTE ON FUNCTION "tamma_chart_os"."set_updated_at"() TO "authenticated";

-- CATALOG FUNCTION GRANT FOR TESTED ROLE
GRANT EXECUTE ON FUNCTION "tamma_chart_os"."set_updated_at"() TO "service_role";

-- RESET FUNCTION ACL FOR TESTED ROLES
REVOKE ALL ON FUNCTION "public"."handle_new_auth_user_customer_account"() FROM PUBLIC, anon, authenticated, service_role;

-- CATALOG FUNCTION GRANT FOR TESTED ROLE
GRANT EXECUTE ON FUNCTION "public"."handle_new_auth_user_customer_account"() TO "postgres";

-- CATALOG FUNCTION GRANT FOR TESTED ROLE
GRANT EXECUTE ON FUNCTION "public"."handle_new_auth_user_customer_account"() TO "service_role";

-- RESET FUNCTION ACL FOR TESTED ROLES
REVOKE ALL ON FUNCTION "public"."handle_auth_user_email_change_customer_account"() FROM PUBLIC, anon, authenticated, service_role;

-- CATALOG FUNCTION GRANT FOR TESTED ROLE
GRANT EXECUTE ON FUNCTION "public"."handle_auth_user_email_change_customer_account"() TO "postgres";

-- CATALOG FUNCTION GRANT FOR TESTED ROLE
GRANT EXECUTE ON FUNCTION "public"."handle_auth_user_email_change_customer_account"() TO "service_role";

-- RESET FUNCTION ACL FOR TESTED ROLES
REVOKE ALL ON FUNCTION "tamma_chart_os"."apply_manual_investment_actual_v1"() FROM PUBLIC, anon, authenticated, service_role;

-- CATALOG FUNCTION GRANT FOR TESTED ROLE
GRANT EXECUTE ON FUNCTION "tamma_chart_os"."apply_manual_investment_actual_v1"() TO "postgres";

-- CATALOG FUNCTION GRANT FOR TESTED ROLE
GRANT EXECUTE ON FUNCTION "tamma_chart_os"."apply_manual_investment_actual_v1"() TO "service_role";

-- RESET FUNCTION ACL FOR TESTED ROLES
REVOKE ALL ON FUNCTION "tamma_chart_os"."refresh_investment_actual_from_payment_v1"() FROM PUBLIC, anon, authenticated, service_role;

-- CATALOG FUNCTION GRANT FOR TESTED ROLE
GRANT EXECUTE ON FUNCTION "tamma_chart_os"."refresh_investment_actual_from_payment_v1"() TO "postgres";

-- CATALOG FUNCTION GRANT FOR TESTED ROLE
GRANT EXECUTE ON FUNCTION "tamma_chart_os"."refresh_investment_actual_from_payment_v1"() TO "service_role";

-- RESET FUNCTION ACL FOR TESTED ROLES
REVOKE ALL ON FUNCTION "auth"."uid"() FROM PUBLIC, anon, authenticated, service_role;

-- CATALOG FUNCTION GRANT FOR TESTED ROLE
GRANT EXECUTE ON FUNCTION "auth"."uid"() TO PUBLIC;

-- RESET FUNCTION ACL FOR TESTED ROLES
REVOKE ALL ON FUNCTION "tamma_chart_os"."auth_restaurant_id"() FROM PUBLIC, anon, authenticated, service_role;

-- CATALOG FUNCTION GRANT FOR TESTED ROLE
GRANT EXECUTE ON FUNCTION "tamma_chart_os"."auth_restaurant_id"() TO PUBLIC;

-- CATALOG FUNCTION GRANT FOR TESTED ROLE
GRANT EXECUTE ON FUNCTION "tamma_chart_os"."auth_restaurant_id"() TO "postgres";

-- CATALOG FUNCTION GRANT FOR TESTED ROLE
GRANT EXECUTE ON FUNCTION "tamma_chart_os"."auth_restaurant_id"() TO "authenticated";

-- CATALOG FUNCTION GRANT FOR TESTED ROLE
GRANT EXECUTE ON FUNCTION "tamma_chart_os"."auth_restaurant_id"() TO "service_role";

-- RESET FUNCTION ACL FOR TESTED ROLES
REVOKE ALL ON FUNCTION "tamma_chart_os"."recalculate_investment_actual_v1"(uuid) FROM PUBLIC, anon, authenticated, service_role;

-- CATALOG FUNCTION GRANT FOR TESTED ROLE
GRANT EXECUTE ON FUNCTION "tamma_chart_os"."recalculate_investment_actual_v1"(uuid) TO "postgres";

-- CATALOG FUNCTION GRANT FOR TESTED ROLE
GRANT EXECUTE ON FUNCTION "tamma_chart_os"."recalculate_investment_actual_v1"(uuid) TO "service_role";

-- EXACT TRIGGER: tamma_chart_os.employees.set_updated_at
CREATE TRIGGER set_updated_at BEFORE UPDATE ON tamma_chart_os.employees FOR EACH ROW EXECUTE FUNCTION tamma_chart_os.set_updated_at();

-- EXACT TRIGGER: tamma_chart_os.restaurants.set_updated_at
CREATE TRIGGER set_updated_at BEFORE UPDATE ON tamma_chart_os.restaurants FOR EACH ROW EXECUTE FUNCTION tamma_chart_os.set_updated_at();

-- EXACT TRIGGER: tamma_chart_os.investment_categories.set_updated_at
CREATE TRIGGER set_updated_at BEFORE UPDATE ON tamma_chart_os.investment_categories FOR EACH ROW EXECUTE FUNCTION tamma_chart_os.set_updated_at();

-- EXACT TRIGGER: tamma_chart_os.investments.investments_apply_manual_actual_v1
CREATE TRIGGER investments_apply_manual_actual_v1 BEFORE INSERT OR UPDATE OF manual_actual_amount ON tamma_chart_os.investments FOR EACH ROW EXECUTE FUNCTION tamma_chart_os.apply_manual_investment_actual_v1();

-- EXACT TRIGGER: tamma_chart_os.investments.set_updated_at
CREATE TRIGGER set_updated_at BEFORE UPDATE ON tamma_chart_os.investments FOR EACH ROW EXECUTE FUNCTION tamma_chart_os.set_updated_at();

-- EXACT TRIGGER: tamma_chart_os.investment_payments.investment_payments_refresh_actual_v1
CREATE TRIGGER investment_payments_refresh_actual_v1 AFTER INSERT OR DELETE OR UPDATE ON tamma_chart_os.investment_payments FOR EACH ROW EXECUTE FUNCTION tamma_chart_os.refresh_investment_actual_from_payment_v1();

-- EXACT TRIGGER: tamma_chart_os.investment_payments.set_updated_at
CREATE TRIGGER set_updated_at BEFORE UPDATE ON tamma_chart_os.investment_payments FOR EACH ROW EXECUTE FUNCTION tamma_chart_os.set_updated_at();

-- EXACT TRIGGER: tamma_chart_os.projects.set_updated_at
CREATE TRIGGER set_updated_at BEFORE UPDATE ON tamma_chart_os.projects FOR EACH ROW EXECUTE FUNCTION tamma_chart_os.set_updated_at();

-- EXACT TRIGGER: tamma_chart_os.investment_receipt_intakes.set_updated_at
CREATE TRIGGER set_updated_at BEFORE UPDATE ON tamma_chart_os.investment_receipt_intakes FOR EACH ROW EXECUTE FUNCTION tamma_chart_os.set_updated_at();

-- EXACT TRIGGER: tamma_chart_os.profiles.set_updated_at
CREATE TRIGGER set_updated_at BEFORE UPDATE ON tamma_chart_os.profiles FOR EACH ROW EXECUTE FUNCTION tamma_chart_os.set_updated_at();

-- SYNTHETIC EXISTING PRINCIPAL AND EMPLOYEE: no signup, password, token or real financial data
INSERT INTO auth.users(id, created_at, updated_at)
VALUES ('10000000-0000-4000-8000-000000000003', '2026-09-01T00:00:00Z', '2026-09-01T00:00:00Z');
INSERT INTO tamma_chart_os.restaurants(id, owner_id, name, created_at, updated_at)
VALUES ('10000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000003',
        'Synthetic Restaurant', '2026-09-01T00:00:00Z', '2026-09-01T00:00:00Z');
INSERT INTO tamma_chart_os.employees(id, restaurant_id, full_name, nickname, wage_amount, employment_type, status, created_at, updated_at)
VALUES ('10000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000002',
        'Synthetic Employee', 'Worker', 12000, 'เงินเดือน', 'ทำงานอยู่',
        '2026-09-01T00:00:00Z', '2026-09-01T00:00:00Z');

-- EXACT AUTH TRIGGER, ATTACHED AFTER PRE-EXISTING USER SEED: on_auth_user_created_customer_account
CREATE TRIGGER on_auth_user_created_customer_account AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION handle_new_auth_user_customer_account();

-- EXACT AUTH TRIGGER, ATTACHED AFTER PRE-EXISTING USER SEED: on_auth_user_email_changed_customer_account
CREATE TRIGGER on_auth_user_email_changed_customer_account AFTER UPDATE OF email ON auth.users FOR EACH ROW EXECUTE FUNCTION handle_auth_user_email_change_customer_account();


-- END EXACT EXTERNAL PREREQUISITES

-- Harness precondition only. This does not stand in for any application function.
DO $employee_advance_fixture_preflight$
DECLARE required_name text;
BEGIN
  FOREACH required_name IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname=required_name) THEN
      RAISE EXCEPTION 'actual_schema_platform_role_missing: %', required_name;
    END IF;
  END LOOP;
  FOREACH required_name IN ARRAY ARRAY[
    'tamma_chart_os.employees', 'tamma_chart_os.restaurants',
    'tamma_chart_os.investments', 'tamma_chart_os.investment_categories'
  ] LOOP
    IF pg_catalog.to_regclass(required_name) IS NULL THEN
      RAISE EXCEPTION 'actual_schema_prerequisite_missing: %; supply actual schema-only DDL, never a stub', required_name;
    END IF;
  END LOOP;
  IF pg_catalog.to_regclass('public.financial_employee_payroll_events') IS NOT NULL
    OR pg_catalog.to_regclass('public.financial_owner_expense_intakes') IS NOT NULL
    OR pg_catalog.to_regclass('public.financial_investment_entries') IS NOT NULL
    OR pg_catalog.to_regclass('public.owner_projects') IS NOT NULL THEN
    RAISE EXCEPTION 'actual_schema_fixture_requires_empty_financial_schema';
  END IF;
END;
$employee_advance_fixture_preflight$;

-- BEGIN UPSTREAM supabase/migrations/20261002092518_financial_daily_close_v1.sql:L166-L174
create or replace function public.financial_touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- END UPSTREAM supabase/migrations/20261002092518_financial_daily_close_v1.sql:L166-L174

-- BEGIN UPSTREAM supabase/migrations/20261002134500_financial_cp8_live_owner_payroll_v1.sql:L99-L340
create table if not exists public.financial_employee_payroll_events(
  id uuid primary key default gen_random_uuid(),
  event_type text not null check(event_type in ('salary_advance','salary_payment','advance_deduction')),
  employee_label text not null check(length(trim(employee_label)) between 1 and 120),
  employee_key text not null,
  amount numeric(14,2) not null check(amount>0),
  event_date date not null,
  pay_period text null,
  funding_source text not null default 'owner_personal'
    check(funding_source in ('owner_personal','business_account','cash','other')),
  status text not null
    check(status in ('awaiting_slip','paid','recorded','needs_review','cancelled')),
  source_channel text not null default 'line'
    check(source_channel in ('line','backoffice','import','system')),
  source_message_id text null,
  owner_group_hash text not null,
  created_by_hash text null,
  slip_message_id text null,
  slip_sha256 text null,
  storage_bucket text null,
  storage_path text null,
  mime_type text null,
  slip_amount numeric(14,2) null,
  slip_confidence numeric(5,4) null,
  slip_extracted_data jsonb not null default '{}'::jsonb,
  review_reason text null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists financial_employee_payroll_source_unique
on public.financial_employee_payroll_events(source_channel,source_message_id)
where source_message_id is not null;

create unique index if not exists financial_employee_payroll_slip_message_unique
on public.financial_employee_payroll_events(slip_message_id)
where slip_message_id is not null;

create unique index if not exists financial_employee_payroll_slip_sha_unique
on public.financial_employee_payroll_events(slip_sha256)
where slip_sha256 is not null;

create index if not exists financial_employee_payroll_pending_idx
on public.financial_employee_payroll_events(owner_group_hash,created_by_hash,status,created_at desc);

alter table public.financial_employee_payroll_events enable row level security;
revoke all on public.financial_employee_payroll_events from public,anon,authenticated;
grant select,insert,update,delete on public.financial_employee_payroll_events to service_role;

drop trigger if exists financial_employee_payroll_touch on public.financial_employee_payroll_events;
create trigger financial_employee_payroll_touch
before update on public.financial_employee_payroll_events
for each row execute function public.financial_touch_updated_at();

create or replace view public.financial_employee_advance_owner_v1
with (security_invoker=true) as
select
  employee_key,
  max(employee_label) as employee_label,
  coalesce(sum(case when event_type='salary_advance' and status='paid' then amount else 0 end),0)::numeric(16,2) as total_advanced,
  coalesce(sum(case when event_type='advance_deduction' and status='recorded' then amount else 0 end),0)::numeric(16,2) as total_deducted,
  greatest(
    0,
    coalesce(sum(case when event_type='salary_advance' and status='paid' then amount else 0 end),0)
    - coalesce(sum(case when event_type='advance_deduction' and status='recorded' then amount else 0 end),0)
  )::numeric(16,2) as advance_outstanding,
  coalesce(sum(case when event_type='salary_payment' and status='paid' then amount else 0 end),0)::numeric(16,2) as salary_paid_recorded,
  max(created_at) as last_event_at
from public.financial_employee_payroll_events
where status<>'cancelled'
group by employee_key;

grant select on public.financial_employee_advance_owner_v1 to service_role;

create or replace function public.financial_create_owner_payroll_event_v1(
  p_event_type text,
  p_employee_label text,
  p_amount numeric,
  p_event_date date,
  p_pay_period text,
  p_group_hash text,
  p_user_hash text,
  p_message_id text
)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  v_event_id uuid;
  v_status text;
  v_existing record;
begin
  if p_event_type not in ('salary_advance','salary_payment','advance_deduction') then
    raise exception 'invalid_payroll_event_type';
  end if;
  if coalesce(trim(p_employee_label),'')='' then raise exception 'employee_label_required'; end if;
  if p_amount is null or p_amount<=0 then raise exception 'payroll_amount_required'; end if;
  if coalesce(trim(p_group_hash),'')='' then raise exception 'owner_group_required'; end if;
  if coalesce(trim(p_message_id),'')='' then raise exception 'message_id_required'; end if;

  select * into v_existing
  from public.financial_employee_payroll_events
  where source_channel='line' and source_message_id=p_message_id
  limit 1;

  if v_existing.id is not null then
    return jsonb_build_object(
      'ok',true,'duplicate',true,'event_id',v_existing.id,
      'event_type',v_existing.event_type,'status',v_existing.status,
      'employee_label',v_existing.employee_label,'amount',v_existing.amount
    );
  end if;

  if p_event_type in ('salary_advance','salary_payment') and exists(
    select 1
    from public.financial_employee_payroll_events
    where owner_group_hash=p_group_hash
      and status='awaiting_slip'
      and created_at>now()-interval '12 hours'
  ) then
    raise exception 'payroll_slip_pending';
  end if;

  v_status:=case when p_event_type='advance_deduction' then 'recorded' else 'awaiting_slip' end;

  insert into public.financial_employee_payroll_events(
    event_type,employee_label,employee_key,amount,event_date,pay_period,
    funding_source,status,source_channel,source_message_id,owner_group_hash,created_by_hash,metadata
  )
  values(
    p_event_type,trim(p_employee_label),lower(regexp_replace(trim(p_employee_label),'\s+',' ','g')),
    round(p_amount,2),coalesce(p_event_date,timezone('Asia/Bangkok',now())::date),
    nullif(trim(coalesce(p_pay_period,'')),''),
    'owner_personal',v_status,'line',p_message_id,trim(p_group_hash),
    nullif(trim(coalesce(p_user_hash,'')),''),
    jsonb_build_object('privacy_scope','owner_only','not_shop_expense',p_event_type='salary_advance')
  )
  returning id into v_event_id;

  return jsonb_build_object(
    'ok',true,'duplicate',false,'event_id',v_event_id,
    'event_type',p_event_type,'status',v_status,
    'employee_label',trim(p_employee_label),'amount',round(p_amount,2)
  );
end;
$$;

create or replace function public.financial_attach_owner_payroll_slip_v1(
  p_event_id uuid,
  p_slip_message_id text,
  p_slip_sha256 text,
  p_storage_bucket text,
  p_storage_path text,
  p_mime_type text,
  p_document_type text,
  p_slip_amount numeric,
  p_confidence numeric,
  p_extracted_data jsonb
)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  e record;
  v_match boolean;
  v_status text;
  v_reason text;
begin
  if p_storage_bucket<>'owner-payroll-evidence' then raise exception 'invalid_payroll_evidence_bucket'; end if;
  if coalesce(trim(p_slip_message_id),'')='' then raise exception 'slip_message_id_required'; end if;
  if coalesce(trim(p_slip_sha256),'')='' then raise exception 'slip_sha256_required'; end if;

  select * into e
  from public.financial_employee_payroll_events
  where id=p_event_id
  for update;

  if e.id is null then raise exception 'payroll_event_not_found'; end if;
  if e.event_type='advance_deduction' then raise exception 'deduction_does_not_accept_slip'; end if;

  if e.status='paid' then
    return jsonb_build_object(
      'ok',true,'duplicate',true,'event_id',e.id,'status',e.status,
      'employee_label',e.employee_label,'amount',e.amount
    );
  end if;

  if exists(
    select 1 from public.financial_employee_payroll_events
    where id<>e.id and (slip_message_id=p_slip_message_id or slip_sha256=p_slip_sha256)
  ) then
    raise exception 'payroll_slip_already_used';
  end if;

  v_match:=
    p_document_type='transfer_slip'
    and coalesce(p_confidence,0)>=0.80
    and p_slip_amount is not null
    and abs(p_slip_amount-e.amount)<0.01;

  v_status:=case when v_match then 'paid' else 'needs_review' end;
  v_reason:=case
    when p_document_type<>'transfer_slip' then 'image_not_transfer_slip'
    when coalesce(p_confidence,0)<0.80 then 'low_extraction_confidence'
    when p_slip_amount is null then 'slip_amount_unreadable'
    when abs(p_slip_amount-e.amount)>=0.01 then 'slip_amount_mismatch'
    else null
  end;

  update public.financial_employee_payroll_events
  set status=v_status,
      slip_message_id=p_slip_message_id,
      slip_sha256=p_slip_sha256,
      storage_bucket=p_storage_bucket,
      storage_path=p_storage_path,
      mime_type=p_mime_type,
      slip_amount=p_slip_amount,
      slip_confidence=greatest(0,least(1,coalesce(p_confidence,0))),
      slip_extracted_data=coalesce(p_extracted_data,'{}'::jsonb),
      review_reason=v_reason,
      metadata=coalesce(metadata,'{}'::jsonb)
        || jsonb_build_object('slip_attached_at',now(),'privacy_scope','owner_only'),
      updated_at=now()
  where id=e.id;

  return jsonb_build_object(
    'ok',true,'duplicate',false,'event_id',e.id,'status',v_status,
    'employee_label',e.employee_label,'amount',e.amount,
    'slip_amount',p_slip_amount,'match',v_match,'review_reason',v_reason
  );
end;
$$;

revoke all on function public.financial_create_owner_payroll_event_v1(text,text,numeric,date,text,text,text,text) from public,anon,authenticated;
grant execute on function public.financial_create_owner_payroll_event_v1(text,text,numeric,date,text,text,text,text) to service_role;
revoke all on function public.financial_attach_owner_payroll_slip_v1(uuid,text,text,text,text,text,text,numeric,numeric,jsonb) from public,anon,authenticated;
grant execute on function public.financial_attach_owner_payroll_slip_v1(uuid,text,text,text,text,text,text,numeric,numeric,jsonb) to service_role;

-- END UPSTREAM supabase/migrations/20261002134500_financial_cp8_live_owner_payroll_v1.sql:L99-L340

-- BEGIN UPSTREAM supabase/migrations/20261002141000_financial_cp8_payroll_pending_guard_v1.sql:L1-L51
-- CP8 follow-up: keep unresolved payroll slips singular and prevent over-deducting salary advances.
do $$
declare ddl text;
begin
  select pg_get_functiondef(
    'public.financial_create_owner_payroll_event_v1(text,text,numeric,date,text,text,text,text)'::regprocedure
  ) into ddl;
  ddl:=replace(
    ddl,
    'and status=''awaiting_slip''',
    'and status in (''awaiting_slip'',''needs_review'')'
  );
  execute ddl;
end;
$$;

create or replace function public.financial_guard_employee_payroll_event_v1()
returns trigger
language plpgsql
set search_path=public
as $$
declare
  v_outstanding numeric(16,2);
begin
  if new.event_type='advance_deduction' and new.status='recorded' then
    select greatest(
      0,
      coalesce(sum(case when event_type='salary_advance' and status='paid' then amount else 0 end),0)
      - coalesce(sum(case when event_type='advance_deduction' and status='recorded' then amount else 0 end),0)
    )
    into v_outstanding
    from public.financial_employee_payroll_events
    where employee_key=new.employee_key
      and (tg_op='INSERT' or id<>new.id);

    if new.amount>coalesce(v_outstanding,0)+0.009 then
      raise exception 'advance_deduction_exceeds_outstanding';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists financial_employee_payroll_guard
on public.financial_employee_payroll_events;
create trigger financial_employee_payroll_guard
before insert or update on public.financial_employee_payroll_events
for each row execute function public.financial_guard_employee_payroll_event_v1();

revoke all on function public.financial_guard_employee_payroll_event_v1()
from public,anon,authenticated;

-- END UPSTREAM supabase/migrations/20261002141000_financial_cp8_payroll_pending_guard_v1.sql:L1-L51

-- BEGIN UPSTREAM supabase/migrations/20261005080000_owner_group_expense_inbox_v1.sql:L15-L574
create table if not exists public.financial_owner_expense_intakes(
  id uuid primary key default gen_random_uuid(),
  owner_group_hash text not null check(length(trim(owner_group_hash))>=16),
  source_channel text not null default 'line'
    check(source_channel in ('line','backoffice','import','system')),
  evidence_message_id text not null check(length(trim(evidence_message_id)) between 1 and 255),
  evidence_sha256 text not null check(evidence_sha256 ~ '^[0-9a-f]{64}$'),
  source_user_hash text null,
  occurred_on date not null,
  amount numeric(14,2) null check(amount is null or (amount>0 and amount<=100000000)),
  currency text not null default 'THB' check(currency='THB'),
  document_type text not null default 'other'
    check(document_type in ('transfer_slip','purchase_receipt','expense_receipt','other')),
  vendor_label text null,
  reference_number text null,
  status text not null default 'awaiting_purpose'
    check(status in ('awaiting_purpose','awaiting_business','categorized','needs_review','cancelled')),
  purpose_raw text null,
  business_unit_code text null
    check(business_unit_code is null or business_unit_code in (
      'inthanin','tamma_restaurant','huenstay','adventure','otop',
      'shared_infrastructure','shared','other'
    )),
  expense_class text null
    check(expense_class is null or expense_class in (
      'capital_investment','operating_expense','owner_private','uncategorized'
    )),
  expense_category text null
    check(expense_category is null or expense_category in (
      'construction','land_infrastructure','kitchen_equipment','equipment',
      'furniture_fixtures','activity_assets','technology','licenses',
      'inventory','ingredients','beverages','packaging','consumables','cleaning',
      'maintenance','utilities','transport','staff','marketing','fees',
      'professional_services','tax','financing','petty_cash','other'
    )),
  expense_subcategory text null,
  classification_confidence numeric(4,3) null
    check(classification_confidence is null or (classification_confidence>=0 and classification_confidence<=1)),
  classification_source text null
    check(classification_source is null or classification_source in ('rule','owner','backoffice','import')),
  extraction_confidence numeric(4,3) null
    check(extraction_confidence is null or (extraction_confidence>=0 and extraction_confidence<=1)),
  extraction_data jsonb not null default '{}'::jsonb,
  storage_bucket text not null default 'owner-expense-evidence',
  storage_path text not null,
  mime_type text not null check(mime_type in ('image/jpeg','image/png','image/webp')),
  resolved_by_message_id text null,
  resolved_by_hash text null,
  categorized_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists financial_owner_expense_line_message_unique
on public.financial_owner_expense_intakes(source_channel,evidence_message_id)
where source_channel='line';

create unique index if not exists financial_owner_expense_group_image_unique
on public.financial_owner_expense_intakes(owner_group_hash,evidence_sha256);

create index if not exists financial_owner_expense_pending_group_idx
on public.financial_owner_expense_intakes(owner_group_hash,status,created_at);

create index if not exists financial_owner_expense_dashboard_idx
on public.financial_owner_expense_intakes(occurred_on,business_unit_code,expense_class,expense_category)
where status<>'cancelled';

create table if not exists public.financial_owner_expense_audit_events(
  id uuid primary key default gen_random_uuid(),
  intake_id uuid not null references public.financial_owner_expense_intakes(id) on delete restrict,
  action text not null check(action in ('captured_slip','purpose_staged','categorized','reclassified','cancelled')),
  source text not null check(source in ('line','backoffice','import','system')),
  actor_hash text null,
  message_id text null,
  reason text null,
  before_data jsonb not null default '{}'::jsonb,
  after_data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists financial_owner_expense_audit_intake_idx
on public.financial_owner_expense_audit_events(intake_id,created_at);

alter table public.financial_owner_expense_intakes enable row level security;
alter table public.financial_owner_expense_audit_events enable row level security;
revoke all on public.financial_owner_expense_intakes from public,anon,authenticated;
revoke all on public.financial_owner_expense_audit_events from public,anon,authenticated;
grant select,insert,update on public.financial_owner_expense_intakes to service_role;
grant select,insert on public.financial_owner_expense_audit_events to service_role;

create or replace function public.financial_capture_owner_expense_slip_v1(
  p_group_hash text,
  p_message_id text,
  p_user_hash text,
  p_occurred_on date,
  p_image_sha256 text,
  p_storage_bucket text,
  p_storage_path text,
  p_mime_type text,
  p_extraction jsonb
)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  v_existing public.financial_owner_expense_intakes%rowtype;
  v_id uuid;
  v_document_type text;
  v_amount numeric(14,2);
  v_confidence numeric(4,3);
  v_date date;
begin
  if coalesce(trim(p_group_hash),'')='' then raise exception 'owner_group_required'; end if;
  if coalesce(trim(p_message_id),'')='' then raise exception 'message_id_required'; end if;
  if coalesce(trim(p_image_sha256),'') !~ '^[0-9a-f]{64}$' then raise exception 'invalid_image_sha256'; end if;
  if coalesce(trim(p_storage_bucket),'')<>'owner-expense-evidence' then raise exception 'invalid_owner_expense_bucket'; end if;
  if coalesce(trim(p_storage_path),'')='' then raise exception 'storage_path_required'; end if;
  if coalesce(trim(p_mime_type),'') not in ('image/jpeg','image/png','image/webp') then raise exception 'invalid_evidence_mime_type'; end if;

  select * into v_existing
  from public.financial_owner_expense_intakes
  where source_channel='line'
    and (
      evidence_message_id=trim(p_message_id)
      or (owner_group_hash=trim(p_group_hash) and evidence_sha256=lower(trim(p_image_sha256)))
    )
  order by created_at asc
  limit 1;

  if v_existing.id is not null then
    return jsonb_build_object(
      'ok',true,'duplicate',true,'intake_id',v_existing.id,
      'status',v_existing.status,'amount',v_existing.amount,
      'document_type',v_existing.document_type
    );
  end if;

  v_document_type:=lower(trim(coalesce(p_extraction->>'document_type','other')));
  if v_document_type not in ('transfer_slip','purchase_receipt','expense_receipt') then
    v_document_type:='other';
  end if;

  v_amount:=case
    when coalesce(p_extraction->>'amount_total','') ~ '^[0-9]+([.][0-9]{1,2})?$'
      then (p_extraction->>'amount_total')::numeric(14,2)
    else null
  end;
  if v_amount is not null and (v_amount<=0 or v_amount>100000000) then v_amount:=null; end if;

  v_confidence:=case
    when coalesce(p_extraction->>'confidence','') ~ '^(0([.][0-9]+)?|1([.]0+)?)$'
      then least(1::numeric,greatest(0::numeric,(p_extraction->>'confidence')::numeric))::numeric(4,3)
    else 0
  end;

  v_date:=coalesce(
    p_occurred_on,
    case when coalesce(p_extraction->>'document_date_local','') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
      then (p_extraction->>'document_date_local')::date
      else null end,
    timezone('Asia/Bangkok',now())::date
  );

  insert into public.financial_owner_expense_intakes(
    owner_group_hash,source_channel,evidence_message_id,evidence_sha256,source_user_hash,
    occurred_on,amount,document_type,vendor_label,reference_number,
    extraction_confidence,extraction_data,storage_bucket,storage_path,mime_type,status
  ) values (
    trim(p_group_hash),'line',trim(p_message_id),lower(trim(p_image_sha256)),
    nullif(trim(coalesce(p_user_hash,'')),''),
    v_date,v_amount,v_document_type,
    nullif(left(trim(coalesce(p_extraction->>'merchant','')),180),''),
    nullif(left(trim(coalesce(p_extraction->>'reference_number','')),120),''),
    v_confidence,coalesce(p_extraction,'{}'::jsonb),
    'owner-expense-evidence',trim(p_storage_path),trim(p_mime_type),'awaiting_purpose'
  ) returning id into v_id;

  insert into public.financial_owner_expense_audit_events(
    intake_id,action,source,actor_hash,message_id,after_data
  ) values (
    v_id,'captured_slip','line',nullif(trim(coalesce(p_user_hash,'')),''),trim(p_message_id),
    jsonb_build_object(
      'status','awaiting_purpose','amount',v_amount,'document_type',v_document_type,
      'occurred_on',v_date,'evidence_sha256',lower(trim(p_image_sha256))
    )
  );

  return jsonb_build_object(
    'ok',true,'duplicate',false,'intake_id',v_id,'status','awaiting_purpose',
    'amount',v_amount,'document_type',v_document_type,'occurred_on',v_date,
    'pending_count',(
      select count(*) from public.financial_owner_expense_intakes
      where owner_group_hash=trim(p_group_hash)
        and status in ('awaiting_purpose','awaiting_business')
        and created_at>now()-interval '14 days'
    )
  );
end;
$$;

create or replace function public.financial_stage_owner_expense_purpose_v1(
  p_intake_id uuid,
  p_purpose text,
  p_expense_class text,
  p_expense_category text,
  p_expense_subcategory text,
  p_confidence numeric,
  p_user_hash text,
  p_message_id text
)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  v_row public.financial_owner_expense_intakes%rowtype;
  v_before jsonb;
  v_confidence numeric(4,3);
begin
  if coalesce(trim(p_purpose),'')='' then raise exception 'purpose_required'; end if;
  if coalesce(trim(p_message_id),'')='' then raise exception 'message_id_required'; end if;
  if p_expense_class not in ('capital_investment','operating_expense','owner_private','uncategorized') then
    raise exception 'invalid_expense_class';
  end if;
  if p_expense_category not in (
    'construction','land_infrastructure','kitchen_equipment','equipment',
    'furniture_fixtures','activity_assets','technology','licenses',
    'inventory','ingredients','beverages','packaging','consumables','cleaning',
    'maintenance','utilities','transport','staff','marketing','fees',
    'professional_services','tax','financing','petty_cash','other'
  ) then raise exception 'invalid_expense_category'; end if;

  if exists(
    select 1 from public.financial_owner_expense_audit_events
    where intake_id=p_intake_id and message_id=trim(p_message_id)
  ) then
    select * into v_row from public.financial_owner_expense_intakes where id=p_intake_id;
    if v_row.id is null then raise exception 'owner_expense_not_found'; end if;
    return jsonb_build_object('ok',true,'duplicate',true,'intake_id',v_row.id,'status',v_row.status);
  end if;

  select * into v_row
  from public.financial_owner_expense_intakes where id=p_intake_id for update;
  if v_row.id is null then raise exception 'owner_expense_not_found'; end if;
  if v_row.status in ('categorized','needs_review','cancelled') then
    return jsonb_build_object('ok',true,'duplicate',true,'intake_id',v_row.id,'status',v_row.status);
  end if;

  v_confidence:=least(1::numeric,greatest(0::numeric,coalesce(p_confidence,0)))::numeric(4,3);
  v_before:=jsonb_build_object(
    'status',v_row.status,'purpose_raw',v_row.purpose_raw,
    'expense_class',v_row.expense_class,'expense_category',v_row.expense_category,
    'expense_subcategory',v_row.expense_subcategory,'classification_confidence',v_row.classification_confidence
  );

  update public.financial_owner_expense_intakes
  set status='awaiting_business',
      purpose_raw=left(trim(p_purpose),500),
      expense_class=p_expense_class,
      expense_category=p_expense_category,
      expense_subcategory=nullif(left(trim(coalesce(p_expense_subcategory,'')),120),''),
      classification_confidence=v_confidence,
      classification_source='rule',
      updated_at=now()
  where id=v_row.id;

  insert into public.financial_owner_expense_audit_events(
    intake_id,action,source,actor_hash,message_id,before_data,after_data
  ) values (
    v_row.id,'purpose_staged','line',nullif(trim(coalesce(p_user_hash,'')),''),trim(p_message_id),v_before,
    jsonb_build_object(
      'status','awaiting_business','purpose_raw',left(trim(p_purpose),500),
      'expense_class',p_expense_class,'expense_category',p_expense_category,
      'expense_subcategory',nullif(left(trim(coalesce(p_expense_subcategory,'')),120),''),
      'classification_confidence',v_confidence
    )
  );

  return jsonb_build_object(
    'ok',true,'duplicate',false,'intake_id',v_row.id,'status','awaiting_business',
    'amount',v_row.amount,'purpose',left(trim(p_purpose),500),
    'expense_class',p_expense_class,'expense_category',p_expense_category,
    'expense_subcategory',nullif(left(trim(coalesce(p_expense_subcategory,'')),120),'')
  );
end;
$$;

create or replace function public.financial_resolve_owner_expense_intake_v1(
  p_intake_id uuid,
  p_purpose text,
  p_business_unit_code text,
  p_expense_class text,
  p_expense_category text,
  p_expense_subcategory text,
  p_confidence numeric,
  p_user_hash text,
  p_message_id text
)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  v_row public.financial_owner_expense_intakes%rowtype;
  v_before jsonb;
  v_confidence numeric(4,3);
  v_status text;
  v_purpose text;
begin
  if coalesce(trim(p_business_unit_code),'') not in (
    'inthanin','tamma_restaurant','huenstay','adventure','otop',
    'shared_infrastructure','shared','other'
  ) then raise exception 'invalid_business_unit'; end if;
  if p_expense_class not in ('capital_investment','operating_expense','owner_private','uncategorized') then
    raise exception 'invalid_expense_class';
  end if;
  if p_expense_category not in (
    'construction','land_infrastructure','kitchen_equipment','equipment',
    'furniture_fixtures','activity_assets','technology','licenses',
    'inventory','ingredients','beverages','packaging','consumables','cleaning',
    'maintenance','utilities','transport','staff','marketing','fees',
    'professional_services','tax','financing','petty_cash','other'
  ) then raise exception 'invalid_expense_category'; end if;
  if coalesce(trim(p_message_id),'')='' then raise exception 'message_id_required'; end if;

  if exists(
    select 1 from public.financial_owner_expense_audit_events
    where intake_id=p_intake_id and message_id=trim(p_message_id)
  ) then
    select * into v_row from public.financial_owner_expense_intakes where id=p_intake_id;
    if v_row.id is null then raise exception 'owner_expense_not_found'; end if;
    return jsonb_build_object('ok',true,'duplicate',true,'intake_id',v_row.id,'status',v_row.status);
  end if;

  select * into v_row
  from public.financial_owner_expense_intakes where id=p_intake_id for update;
  if v_row.id is null then raise exception 'owner_expense_not_found'; end if;
  if v_row.status in ('categorized','needs_review') then
    if v_row.resolved_by_message_id=trim(p_message_id) then
      return jsonb_build_object('ok',true,'duplicate',true,'intake_id',v_row.id,'status',v_row.status);
    end if;
    raise exception 'owner_expense_already_resolved';
  end if;
  if v_row.status not in ('awaiting_purpose','awaiting_business') then
    raise exception 'owner_expense_not_pending';
  end if;

  v_purpose:=coalesce(nullif(left(trim(coalesce(p_purpose,'')),500),''),v_row.purpose_raw);
  if v_purpose is null then raise exception 'purpose_required'; end if;
  v_confidence:=least(1::numeric,greatest(0::numeric,coalesce(p_confidence,0)))::numeric(4,3);
  v_status:=case
    when p_business_unit_code='other' or p_expense_category='other' or v_confidence<0.70 then 'needs_review'
    else 'categorized'
  end;
  v_before:=jsonb_build_object(
    'status',v_row.status,'purpose_raw',v_row.purpose_raw,'business_unit_code',v_row.business_unit_code,
    'expense_class',v_row.expense_class,'expense_category',v_row.expense_category,
    'expense_subcategory',v_row.expense_subcategory,'classification_confidence',v_row.classification_confidence
  );

  update public.financial_owner_expense_intakes
  set status=v_status,
      purpose_raw=v_purpose,
      business_unit_code=p_business_unit_code,
      expense_class=p_expense_class,
      expense_category=p_expense_category,
      expense_subcategory=nullif(left(trim(coalesce(p_expense_subcategory,'')),120),''),
      classification_confidence=v_confidence,
      classification_source='rule',
      resolved_by_message_id=trim(p_message_id),
      resolved_by_hash=nullif(trim(coalesce(p_user_hash,'')),''),
      categorized_at=now(),
      updated_at=now()
  where id=v_row.id;

  insert into public.financial_owner_expense_audit_events(
    intake_id,action,source,actor_hash,message_id,before_data,after_data
  ) values (
    v_row.id,'categorized','line',nullif(trim(coalesce(p_user_hash,'')),''),trim(p_message_id),v_before,
    jsonb_build_object(
      'status',v_status,'purpose_raw',v_purpose,'business_unit_code',p_business_unit_code,
      'expense_class',p_expense_class,'expense_category',p_expense_category,
      'expense_subcategory',nullif(left(trim(coalesce(p_expense_subcategory,'')),120),''),
      'classification_confidence',v_confidence
    )
  );

  return jsonb_build_object(
    'ok',true,'duplicate',false,'intake_id',v_row.id,'status',v_status,
    'amount',v_row.amount,'purpose',v_purpose,'business_unit_code',p_business_unit_code,
    'expense_class',p_expense_class,'expense_category',p_expense_category,
    'expense_subcategory',nullif(left(trim(coalesce(p_expense_subcategory,'')),120),''),
    'confidence',v_confidence
  );
end;
$$;

create or replace function public.financial_mark_owner_expense_not_expense_v1(
  p_intake_id uuid,
  p_reason text,
  p_user_hash text,
  p_message_id text
)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  v_row public.financial_owner_expense_intakes%rowtype;
  v_before jsonb;
begin
  if coalesce(trim(p_reason),'')='' then raise exception 'cancellation_reason_required'; end if;
  if coalesce(trim(p_message_id),'')='' then raise exception 'message_id_required'; end if;

  select * into v_row
  from public.financial_owner_expense_intakes where id=p_intake_id for update;
  if v_row.id is null then raise exception 'owner_expense_not_found'; end if;
  if v_row.status='cancelled' then
    return jsonb_build_object('ok',true,'duplicate',true,'intake_id',v_row.id,'status',v_row.status);
  end if;
  if exists(
    select 1 from public.financial_owner_expense_audit_events
    where intake_id=p_intake_id and message_id=trim(p_message_id)
  ) then
    return jsonb_build_object('ok',true,'duplicate',true,'intake_id',v_row.id,'status',v_row.status);
  end if;

  v_before:=jsonb_build_object(
    'status',v_row.status,'purpose_raw',v_row.purpose_raw,
    'business_unit_code',v_row.business_unit_code,'expense_class',v_row.expense_class,
    'expense_category',v_row.expense_category
  );

  update public.financial_owner_expense_intakes
  set status='cancelled',updated_at=now()
  where id=v_row.id;

  insert into public.financial_owner_expense_audit_events(
    intake_id,action,source,actor_hash,message_id,reason,before_data,after_data
  ) values (
    v_row.id,'cancelled','line',nullif(trim(coalesce(p_user_hash,'')),''),trim(p_message_id),
    left(trim(p_reason),500),v_before,jsonb_build_object('status','cancelled')
  );

  return jsonb_build_object('ok',true,'duplicate',false,'intake_id',v_row.id,'status','cancelled');
end;
$$;

create or replace function public.financial_reclassify_owner_expense_intake_v1(
  p_intake_id uuid,
  p_business_unit_code text,
  p_expense_class text,
  p_expense_category text,
  p_expense_subcategory text,
  p_reason text,
  p_actor_hash text
)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  v_row public.financial_owner_expense_intakes%rowtype;
  v_before jsonb;
begin
  if coalesce(trim(p_reason),'')='' then raise exception 'reclassification_reason_required'; end if;
  if coalesce(trim(p_business_unit_code),'') not in (
    'inthanin','tamma_restaurant','huenstay','adventure','otop',
    'shared_infrastructure','shared','other'
  ) then raise exception 'invalid_business_unit'; end if;
  if p_expense_class not in ('capital_investment','operating_expense','owner_private','uncategorized') then
    raise exception 'invalid_expense_class';
  end if;
  if p_expense_category not in (
    'construction','land_infrastructure','kitchen_equipment','equipment',
    'furniture_fixtures','activity_assets','technology','licenses',
    'inventory','ingredients','beverages','packaging','consumables','cleaning',
    'maintenance','utilities','transport','staff','marketing','fees',
    'professional_services','tax','financing','petty_cash','other'
  ) then raise exception 'invalid_expense_category'; end if;

  select * into v_row
  from public.financial_owner_expense_intakes where id=p_intake_id for update;
  if v_row.id is null then raise exception 'owner_expense_not_found'; end if;
  if v_row.status='cancelled' then raise exception 'cancelled_owner_expense_immutable'; end if;

  v_before:=jsonb_build_object(
    'status',v_row.status,'business_unit_code',v_row.business_unit_code,
    'expense_class',v_row.expense_class,'expense_category',v_row.expense_category,
    'expense_subcategory',v_row.expense_subcategory,'classification_confidence',v_row.classification_confidence
  );

  update public.financial_owner_expense_intakes
  set status=case when p_business_unit_code='other' or p_expense_category='other' then 'needs_review' else 'categorized' end,
      business_unit_code=p_business_unit_code,
      expense_class=p_expense_class,
      expense_category=p_expense_category,
      expense_subcategory=nullif(left(trim(coalesce(p_expense_subcategory,'')),120),''),
      classification_confidence=1,
      classification_source='backoffice',
      categorized_at=coalesce(categorized_at,now()),
      updated_at=now()
  where id=v_row.id;

  insert into public.financial_owner_expense_audit_events(
    intake_id,action,source,actor_hash,reason,before_data,after_data
  ) values (
    v_row.id,'reclassified','backoffice',nullif(trim(coalesce(p_actor_hash,'')),''),left(trim(p_reason),500),v_before,
    jsonb_build_object(
      'business_unit_code',p_business_unit_code,'expense_class',p_expense_class,
      'expense_category',p_expense_category,
      'expense_subcategory',nullif(left(trim(coalesce(p_expense_subcategory,'')),120),''),
      'classification_confidence',1
    )
  );

  return jsonb_build_object('ok',true,'intake_id',v_row.id);
end;
$$;

create or replace view public.financial_owner_expense_summary_v1
with (security_invoker=true) as
select
  date_trunc('month',occurred_on)::date as month_start,
  owner_group_hash,
  coalesce(business_unit_code,'other') as business_unit_code,
  coalesce(expense_class,'uncategorized') as expense_class,
  coalesce(expense_category,'other') as expense_category,
  count(*)::integer as item_count,
  coalesce(sum(amount),0)::numeric(16,2) as total_amount,
  count(*) filter(where status='categorized')::integer as categorized_count,
  count(*) filter(where status in ('awaiting_purpose','awaiting_business','needs_review'))::integer as attention_count
from public.financial_owner_expense_intakes
where status<>'cancelled'
group by 1,2,3,4,5;

revoke all on public.financial_owner_expense_summary_v1 from public,anon,authenticated;
grant select on public.financial_owner_expense_summary_v1 to service_role;

revoke all on function public.financial_capture_owner_expense_slip_v1(text,text,text,date,text,text,text,text,jsonb)
from public,anon,authenticated;
revoke all on function public.financial_stage_owner_expense_purpose_v1(uuid,text,text,text,text,numeric,text,text)
from public,anon,authenticated;
revoke all on function public.financial_resolve_owner_expense_intake_v1(uuid,text,text,text,text,text,numeric,text,text)
from public,anon,authenticated;
revoke all on function public.financial_reclassify_owner_expense_intake_v1(uuid,text,text,text,text,text,text)
from public,anon,authenticated;
revoke all on function public.financial_mark_owner_expense_not_expense_v1(uuid,text,text,text)
from public,anon,authenticated;
grant execute on function public.financial_capture_owner_expense_slip_v1(text,text,text,date,text,text,text,text,jsonb) to service_role;
grant execute on function public.financial_stage_owner_expense_purpose_v1(uuid,text,text,text,text,numeric,text,text) to service_role;
grant execute on function public.financial_resolve_owner_expense_intake_v1(uuid,text,text,text,text,text,numeric,text,text) to service_role;
grant execute on function public.financial_reclassify_owner_expense_intake_v1(uuid,text,text,text,text,text,text) to service_role;
grant execute on function public.financial_mark_owner_expense_not_expense_v1(uuid,text,text,text) to service_role;

-- END UPSTREAM supabase/migrations/20261005080000_owner_group_expense_inbox_v1.sql:L15-L574

-- BEGIN UPSTREAM supabase/migrations/20261005081000_owner_group_expense_deny_client_policy_v1.sql:L1-L19
-- Owner Expense is server-mediated only.  These explicit deny policies make
-- that boundary visible to RLS tooling as well as to future maintainers.
-- service_role continues to use the narrowly granted RPCs and bypasses RLS.

create policy "owner_expense_intakes_no_direct_client_access"
on public.financial_owner_expense_intakes
as restrictive
for all
to public
using (false)
with check (false);

create policy "owner_expense_audit_no_direct_client_access"
on public.financial_owner_expense_audit_events
as restrictive
for all
to public
using (false)
with check (false);

-- END UPSTREAM supabase/migrations/20261005081000_owner_group_expense_deny_client_policy_v1.sql:L1-L19

-- BEGIN UPSTREAM supabase/migrations/20261005090000_investment_os_global_ledger_v1.sql:L1-L107
-- Investment OS is a global ledger: it deliberately does not belong to Restaurant OS.
-- Existing tamma_chart_os investments stay untouched and are exposed read-only below.

create table if not exists public.financial_investment_entries(
  id uuid primary key default gen_random_uuid(),
  occurred_on date not null default timezone('Asia/Bangkok',now())::date,
  business_unit_code text not null check(business_unit_code in ('inthanin','tamma_restaurant','huenstay','adventure','otop','shared_infrastructure','shared','other')),
  title text not null check(length(trim(title)) between 2 and 240),
  category text not null default 'other',
  amount numeric(14,2) not null check(amount>0 and amount<=100000000),
  payment_method text not null check(payment_method in ('cash','transfer','card','other')),
  vendor_name text null,
  notes text null,
  source_channel text not null check(source_channel in ('line','backoffice','import','system')),
  owner_group_hash text null,
  source_message_id text null,
  source_user_hash text null,
  status text not null default 'recorded' check(status in ('recorded','cancelled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(source_channel,source_message_id)
);

create index if not exists financial_investment_entries_dashboard_idx
  on public.financial_investment_entries(occurred_on,business_unit_code,category)
  where status='recorded';

create table if not exists public.financial_investment_entry_audit_events(
  id uuid primary key default gen_random_uuid(),
  entry_id uuid not null references public.financial_investment_entries(id) on delete restrict,
  action text not null check(action in ('recorded','cancelled')),
  source text not null check(source in ('line','backoffice','import','system')),
  actor_hash text null,
  message_id text null,
  before_data jsonb not null default '{}'::jsonb,
  after_data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists financial_investment_entry_audit_idx
  on public.financial_investment_entry_audit_events(entry_id,created_at);

alter table public.financial_investment_entries enable row level security;
alter table public.financial_investment_entry_audit_events enable row level security;
revoke all on public.financial_investment_entries from public,anon,authenticated;
revoke all on public.financial_investment_entry_audit_events from public,anon,authenticated;
grant select,insert,update on public.financial_investment_entries to service_role;
grant select,insert on public.financial_investment_entry_audit_events to service_role;

create or replace view public.financial_investment_legacy_v1
with (security_invoker=true)
as select
  i.id::text as source_id,
  i.created_at,
  coalesce(i.paid_date,i.order_date,i.created_at::date) as occurred_on,
  'tamma_restaurant'::text as business_unit_code,
  i.name as title,
  coalesce(c.name,'อื่น ๆ') as category,
  i.budget_amount,
  i.actual_amount as amount,
  coalesce(nullif(i.payment_method,''),'other') as payment_method,
  i.vendor_name,
  i.notes,
  i.status,
  'legacy_restaurant'::text as source_kind
from tamma_chart_os.investments i
left join tamma_chart_os.investment_categories c on c.id=i.category_id
where coalesce(i.is_archived,false)=false;

revoke all on public.financial_investment_legacy_v1 from public,anon,authenticated;
grant select on public.financial_investment_legacy_v1 to service_role;

create or replace function public.financial_record_investment_v1(
  p_occurred_on date,
  p_business_unit_code text,
  p_title text,
  p_category text,
  p_amount numeric,
  p_payment_method text,
  p_vendor_name text,
  p_notes text,
  p_source_channel text,
  p_owner_group_hash text,
  p_source_message_id text,
  p_actor_hash text
)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_row public.financial_investment_entries%rowtype; v_id uuid;
begin
  if coalesce(trim(p_business_unit_code),'') not in ('inthanin','tamma_restaurant','huenstay','adventure','otop','shared_infrastructure','shared','other') then raise exception 'invalid_business_unit'; end if;
  if length(trim(coalesce(p_title,'')))<2 then raise exception 'investment_title_required'; end if;
  if p_amount is null or p_amount<=0 or p_amount>100000000 then raise exception 'invalid_investment_amount'; end if;
  if coalesce(trim(p_payment_method),'') not in ('cash','transfer','card','other') then raise exception 'invalid_payment_method'; end if;
  if coalesce(trim(p_source_channel),'') not in ('line','backoffice','import','system') then raise exception 'invalid_source_channel'; end if;
  if p_source_message_id is not null then
    select * into v_row from public.financial_investment_entries where source_channel=trim(p_source_channel) and source_message_id=trim(p_source_message_id);
    if v_row.id is not null then return jsonb_build_object('ok',true,'duplicate',true,'id',v_row.id); end if;
  end if;
  insert into public.financial_investment_entries(occurred_on,business_unit_code,title,category,amount,payment_method,vendor_name,notes,source_channel,owner_group_hash,source_message_id,source_user_hash)
  values(coalesce(p_occurred_on,timezone('Asia/Bangkok',now())::date),trim(p_business_unit_code),left(trim(p_title),240),coalesce(nullif(left(trim(coalesce(p_category,'')),120),''),'other'),p_amount,trim(p_payment_method),nullif(left(trim(coalesce(p_vendor_name,'')),180),''),nullif(left(trim(coalesce(p_notes,'')),2000),''),trim(p_source_channel),nullif(trim(coalesce(p_owner_group_hash,'')),''),nullif(trim(coalesce(p_source_message_id,'')),''),nullif(trim(coalesce(p_actor_hash,'')),'')) returning id into v_id;
  insert into public.financial_investment_entry_audit_events(entry_id,action,source,actor_hash,message_id,after_data)
  values(v_id,'recorded',trim(p_source_channel),nullif(trim(coalesce(p_actor_hash,'')),''),nullif(trim(coalesce(p_source_message_id,'')),''),jsonb_build_object('occurred_on',coalesce(p_occurred_on,timezone('Asia/Bangkok',now())::date),'business_unit_code',trim(p_business_unit_code),'title',left(trim(p_title),240),'amount',p_amount,'payment_method',trim(p_payment_method)));
  return jsonb_build_object('ok',true,'duplicate',false,'id',v_id);
end; $$;

revoke all on function public.financial_record_investment_v1(date,text,text,text,numeric,text,text,text,text,text,text,text) from public,anon,authenticated;
grant execute on function public.financial_record_investment_v1(date,text,text,text,numeric,text,text,text,text,text,text,text) to service_role;

-- END UPSTREAM supabase/migrations/20261005090000_investment_os_global_ledger_v1.sql:L1-L107

-- BEGIN UPSTREAM supabase/migrations/20261005093000_investment_legacy_correction_audit_v1.sql:L1-L74
-- Preserve an immutable explanation whenever a legacy Restaurant OS investment total is corrected.
-- The original row remains in tamma_chart_os; this audit stores both numerical states.

create table if not exists public.financial_investment_legacy_adjustment_audit_events(
  id uuid primary key default gen_random_uuid(),
  legacy_investment_id uuid not null,
  action text not null check(action in ('actual_corrected')),
  source text not null check(source in ('owner_instruction','backoffice','import','system')),
  actor_hash text null,
  reason text not null check(length(trim(reason))>=3),
  previous_manual_actual_amount numeric(14,2) null,
  previous_actual_amount numeric(14,2) null,
  new_manual_actual_amount numeric(14,2) not null,
  new_actual_amount numeric(14,2) not null,
  created_at timestamptz not null default now()
);

create index if not exists financial_investment_legacy_adjustment_audit_idx
  on public.financial_investment_legacy_adjustment_audit_events(legacy_investment_id,created_at);

alter table public.financial_investment_legacy_adjustment_audit_events enable row level security;
revoke all on public.financial_investment_legacy_adjustment_audit_events from public,anon,authenticated;
grant select,insert on public.financial_investment_legacy_adjustment_audit_events to service_role;

create or replace function public.financial_correct_legacy_investment_actual_v1(
  p_investment_id uuid,
  p_manual_actual_amount numeric,
  p_reason text,
  p_source text,
  p_actor_hash text
)
returns jsonb
language plpgsql
security definer
set search_path=public,tamma_chart_os
as $$
declare
  v_before tamma_chart_os.investments%rowtype;
  v_after tamma_chart_os.investments%rowtype;
begin
  if p_investment_id is null then raise exception 'legacy_investment_id_required'; end if;
  if p_manual_actual_amount is null or p_manual_actual_amount<0 or p_manual_actual_amount>100000000 then raise exception 'invalid_actual_amount'; end if;
  if length(trim(coalesce(p_reason,'')))<3 then raise exception 'correction_reason_required'; end if;
  if coalesce(trim(p_source),'') not in ('owner_instruction','backoffice','import','system') then raise exception 'invalid_correction_source'; end if;

  select * into v_before from tamma_chart_os.investments where id=p_investment_id for update;
  if v_before.id is null then raise exception 'legacy_investment_not_found'; end if;

  update tamma_chart_os.investments
  set manual_actual_amount=p_manual_actual_amount
  where id=p_investment_id
  returning * into v_after;

  insert into public.financial_investment_legacy_adjustment_audit_events(
    legacy_investment_id,action,source,actor_hash,reason,
    previous_manual_actual_amount,previous_actual_amount,
    new_manual_actual_amount,new_actual_amount
  ) values (
    p_investment_id,'actual_corrected',trim(p_source),nullif(trim(coalesce(p_actor_hash,'')),''),trim(p_reason),
    v_before.manual_actual_amount,v_before.actual_amount,
    v_after.manual_actual_amount,v_after.actual_amount
  );

  return jsonb_build_object(
    'ok',true,'investment_id',v_after.id,'name',v_after.name,
    'previous_actual_amount',v_before.actual_amount,
    'actual_amount',v_after.actual_amount,
    'manual_actual_amount',v_after.manual_actual_amount
  );
end;
$$;

revoke all on function public.financial_correct_legacy_investment_actual_v1(uuid,numeric,text,text,text) from public,anon,authenticated;
grant execute on function public.financial_correct_legacy_investment_actual_v1(uuid,numeric,text,text,text) to service_role;

-- END UPSTREAM supabase/migrations/20261005093000_investment_legacy_correction_audit_v1.sql:L1-L74

-- BEGIN UPSTREAM supabase/migrations/20261005112859_owner_expense_backoffice_cancel_v1.sql:L1-L89
-- Owner Expense backoffice cancellation
--
-- A wrong expense is removed from every active total without deleting the
-- original evidence or its history. Only the server-side service role can
-- call this RPC.

create or replace function public.financial_cancel_owner_expense_intake_v1(
  p_intake_id uuid,
  p_reason text,
  p_actor_hash text
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_row public.financial_owner_expense_intakes%rowtype;
  v_reason text;
  v_before jsonb;
begin
  v_reason:=left(trim(coalesce(p_reason,'')),500);
  if length(v_reason)<3 then
    raise exception 'cancellation_reason_required';
  end if;

  select * into v_row
  from public.financial_owner_expense_intakes
  where id=p_intake_id
  for update;

  if v_row.id is null then
    raise exception 'owner_expense_not_found';
  end if;

  if v_row.status='cancelled' then
    return jsonb_build_object(
      'ok',true,
      'duplicate',true,
      'intake_id',v_row.id,
      'status',v_row.status
    );
  end if;

  v_before:=jsonb_build_object(
    'status',v_row.status,
    'occurred_on',v_row.occurred_on,
    'amount',v_row.amount,
    'purpose_raw',v_row.purpose_raw,
    'business_unit_code',v_row.business_unit_code,
    'expense_class',v_row.expense_class,
    'expense_category',v_row.expense_category,
    'expense_subcategory',v_row.expense_subcategory
  );

  update public.financial_owner_expense_intakes
  set status='cancelled',updated_at=now()
  where id=v_row.id;

  insert into public.financial_owner_expense_audit_events(
    intake_id,action,source,actor_hash,reason,before_data,after_data
  ) values (
    v_row.id,
    'cancelled',
    'backoffice',
    nullif(trim(coalesce(p_actor_hash,'')),''),
    v_reason,
    v_before,
    jsonb_build_object(
      'status','cancelled',
      'excluded_from_active_totals',true,
      'evidence_retained',true
    )
  );

  return jsonb_build_object(
    'ok',true,
    'duplicate',false,
    'intake_id',v_row.id,
    'status','cancelled',
    'evidence_retained',true
  );
end;
$$;

revoke all on function public.financial_cancel_owner_expense_intake_v1(uuid,text,text)
from public,anon,authenticated;
grant execute on function public.financial_cancel_owner_expense_intake_v1(uuid,text,text)
to service_role;

-- END UPSTREAM supabase/migrations/20261005112859_owner_expense_backoffice_cancel_v1.sql:L1-L89

-- BEGIN UPSTREAM supabase/migrations/20261005145713_owner_project_task_os_v1.sql:L1-L885
-- Owner Project & Work OS
--
-- Canonical project, task, weekly-check-in, and installment records shared by
-- the Owner LINE group and Backoffice. Existing investment/expense rows are
-- preserved and only receive nullable links to this new model.

create table if not exists public.owner_projects(
  id uuid primary key default gen_random_uuid(),
  project_code text not null unique default (
    'PJ-' || upper(substr(replace(gen_random_uuid()::text,'-',''),1,8))
  ),
  owner_group_hash text not null check(length(trim(owner_group_hash))>=16),
  name text not null check(length(trim(name)) between 2 and 180),
  normalized_name text not null check(length(trim(normalized_name)) between 2 and 180),
  purpose text null,
  business_unit_code text null check(
    business_unit_code is null or business_unit_code in (
      'inthanin','tamma_restaurant','huenstay','adventure','otop',
      'shared_infrastructure','shared','other'
    )
  ),
  location_label text null,
  budget_amount numeric(14,2) null check(
    budget_amount is null or (budget_amount>=0 and budget_amount<=100000000)
  ),
  currency text not null default 'THB' check(currency='THB'),
  status text not null default 'planning' check(
    status in ('planning','approved','active','paused','completed','cancelled')
  ),
  start_on date null,
  due_on date null,
  source_channel text not null check(source_channel in ('line','backoffice','import','system')),
  source_message_id text null,
  created_by_hash text null,
  confirmed_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists owner_projects_group_name_active_unique
  on public.owner_projects(owner_group_hash,normalized_name)
  where status<>'cancelled';

create index if not exists owner_projects_dashboard_idx
  on public.owner_projects(status,due_on,updated_at desc);

create table if not exists public.owner_project_tasks(
  id uuid primary key default gen_random_uuid(),
  task_code text not null unique default (
    'WK-' || upper(substr(replace(gen_random_uuid()::text,'-',''),1,8))
  ),
  project_id uuid not null references public.owner_projects(id) on delete restrict,
  title text not null check(length(trim(title)) between 2 and 240),
  description text null,
  task_kind text not null default 'one_time' check(
    task_kind in ('pre_opening','one_time','weekly')
  ),
  recurrence_weekdays smallint[] not null default '{}'::smallint[] check(
    recurrence_weekdays <@ array[0,1,2,3,4,5,6]::smallint[]
  ),
  recurrence_start_on date null,
  recurrence_end_on date null,
  due_on date null,
  schedule_text text null,
  responsible_name text null,
  counterparty_name text null,
  budget_amount numeric(14,2) null check(
    budget_amount is null or (budget_amount>=0 and budget_amount<=100000000)
  ),
  status text not null default 'todo' check(
    status in ('todo','in_progress','blocked','done','cancelled')
  ),
  source_channel text not null check(source_channel in ('line','backoffice','import','system')),
  source_message_id text null,
  created_by_hash text null,
  confirmed_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists owner_project_tasks_dashboard_idx
  on public.owner_project_tasks(project_id,status,due_on,updated_at desc);

create index if not exists owner_project_tasks_weekly_idx
  on public.owner_project_tasks(task_kind,status)
  where task_kind='weekly' and status not in ('done','cancelled');

create table if not exists public.owner_project_task_checkins(
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.owner_project_tasks(id) on delete restrict,
  week_start date not null,
  state text not null default 'pending' check(state in ('pending','done','blocked','skipped')),
  note text null,
  actor_hash text null,
  source text not null check(source in ('line','backoffice','system')),
  source_message_id text null,
  completed_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(task_id,week_start)
);

create index if not exists owner_project_task_checkins_week_idx
  on public.owner_project_task_checkins(week_start,state,task_id);

create table if not exists public.owner_project_installments(
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.owner_projects(id) on delete restrict,
  task_id uuid not null references public.owner_project_tasks(id) on delete restrict,
  installment_no smallint not null check(installment_no between 1 and 120),
  title text not null,
  amount numeric(14,2) null check(amount is null or (amount>=0 and amount<=100000000)),
  due_on date null,
  counterparty_name text null,
  payment_method text null check(
    payment_method is null or payment_method in ('cash','transfer','card','other')
  ),
  status text not null default 'planned' check(
    status in ('planned','due','paid','cancelled')
  ),
  paid_amount numeric(14,2) not null default 0 check(paid_amount>=0 and paid_amount<=100000000),
  paid_on date null,
  financial_investment_entry_id uuid null,
  owner_expense_intake_id uuid null,
  source_channel text not null check(source_channel in ('line','backoffice','import','system')),
  source_message_id text null,
  created_by_hash text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(task_id,installment_no)
);

create index if not exists owner_project_installments_due_idx
  on public.owner_project_installments(status,due_on,project_id)
  where status not in ('paid','cancelled');

create table if not exists public.owner_project_conversation_drafts(
  id uuid primary key default gen_random_uuid(),
  owner_group_hash text not null check(length(trim(owner_group_hash))>=16),
  actor_hash text not null check(length(trim(actor_hash))>=16),
  intent text not null check(intent in ('new_project','investment_plan','weekly_task','one_time_task')),
  status text not null default 'collecting' check(
    status in ('collecting','awaiting_confirmation','confirmed','cancelled','expired')
  ),
  data jsonb not null default '{}'::jsonb,
  missing_fields text[] not null default '{}'::text[],
  source_message_id text not null,
  last_message_id text not null,
  confirmed_by_message_id text null,
  confirmed_project_id uuid null references public.owner_projects(id) on delete restrict,
  confirmed_task_id uuid null references public.owner_project_tasks(id) on delete restrict,
  expires_at timestamptz not null default (now()+interval '7 days'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists owner_project_drafts_one_active_per_actor
  on public.owner_project_conversation_drafts(owner_group_hash,actor_hash)
  where status in ('collecting','awaiting_confirmation');

create unique index if not exists owner_project_drafts_confirm_message_unique
  on public.owner_project_conversation_drafts(confirmed_by_message_id)
  where confirmed_by_message_id is not null;

create index if not exists owner_project_drafts_active_idx
  on public.owner_project_conversation_drafts(owner_group_hash,actor_hash,updated_at desc)
  where status in ('collecting','awaiting_confirmation');

create table if not exists public.owner_project_conversation_messages(
  source_channel text not null default 'line' check(source_channel in ('line','backoffice','system')),
  message_id text not null,
  owner_group_hash text not null,
  actor_hash text not null,
  message_sha256 text not null check(message_sha256 ~ '^[0-9a-f]{64}$'),
  draft_id uuid null references public.owner_project_conversation_drafts(id) on delete restrict,
  reply_text text null,
  created_at timestamptz not null default now(),
  primary key(source_channel,message_id)
);

create table if not exists public.owner_project_audit_events(
  id uuid primary key default gen_random_uuid(),
  entity_type text not null check(
    entity_type in ('project','task','installment','checkin','draft','expense_link')
  ),
  entity_id uuid not null,
  action text not null check(
    action in ('created','updated','status_changed','confirmed','cancelled','linked','payment_recorded')
  ),
  source text not null check(source in ('line','backoffice','import','system')),
  actor_hash text null,
  message_id text null,
  reason text null,
  before_data jsonb not null default '{}'::jsonb,
  after_data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists owner_project_audit_entity_idx
  on public.owner_project_audit_events(entity_type,entity_id,created_at);

alter table public.financial_investment_entries
  add column if not exists owner_project_id uuid null references public.owner_projects(id) on delete restrict,
  add column if not exists owner_project_task_id uuid null references public.owner_project_tasks(id) on delete restrict,
  add column if not exists owner_project_installment_id uuid null references public.owner_project_installments(id) on delete restrict;

alter table public.financial_owner_expense_intakes
  add column if not exists owner_project_id uuid null references public.owner_projects(id) on delete restrict,
  add column if not exists owner_project_task_id uuid null references public.owner_project_tasks(id) on delete restrict,
  add column if not exists owner_project_installment_id uuid null references public.owner_project_installments(id) on delete restrict;

create index if not exists financial_investment_entries_owner_project_idx
  on public.financial_investment_entries(owner_project_id,occurred_on)
  where status='recorded' and owner_project_id is not null;

create index if not exists financial_owner_expense_owner_project_idx
  on public.financial_owner_expense_intakes(owner_project_id,occurred_on)
  where status<>'cancelled' and owner_project_id is not null;

alter table public.owner_projects enable row level security;
alter table public.owner_project_tasks enable row level security;
alter table public.owner_project_task_checkins enable row level security;
alter table public.owner_project_installments enable row level security;
alter table public.owner_project_conversation_drafts enable row level security;
alter table public.owner_project_conversation_messages enable row level security;
alter table public.owner_project_audit_events enable row level security;

revoke all on public.owner_projects from public,anon,authenticated;
revoke all on public.owner_project_tasks from public,anon,authenticated;
revoke all on public.owner_project_task_checkins from public,anon,authenticated;
revoke all on public.owner_project_installments from public,anon,authenticated;
revoke all on public.owner_project_conversation_drafts from public,anon,authenticated;
revoke all on public.owner_project_conversation_messages from public,anon,authenticated;
revoke all on public.owner_project_audit_events from public,anon,authenticated;

grant select,insert,update on public.owner_projects to service_role;
grant select,insert,update on public.owner_project_tasks to service_role;
grant select,insert,update on public.owner_project_task_checkins to service_role;
grant select,insert,update on public.owner_project_installments to service_role;
grant select,insert,update on public.owner_project_conversation_drafts to service_role;
grant select,insert,update on public.owner_project_conversation_messages to service_role;
grant select,insert on public.owner_project_audit_events to service_role;

create or replace function public.owner_project_confirm_draft_v1(
  p_draft_id uuid,
  p_message_id text,
  p_actor_hash text
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_draft public.owner_project_conversation_drafts%rowtype;
  v_project public.owner_projects%rowtype;
  v_task public.owner_project_tasks%rowtype;
  v_project_name text;
  v_normalized_name text;
  v_work_title text;
  v_business text;
  v_task_kind text;
  v_budget numeric(14,2);
  v_installment_count integer;
  v_counterparty text;
  v_responsible text;
  v_payment_method text;
  v_due_on date;
  v_first_due_on date;
  v_weekdays smallint[]:='{}'::smallint[];
  v_index integer;
  v_installment_amount numeric(14,2);
  v_running_amount numeric(14,2):=0;
begin
  if coalesce(trim(p_message_id),'')='' then raise exception 'message_id_required'; end if;
  if coalesce(trim(p_actor_hash),'')='' then raise exception 'actor_required'; end if;

  select * into v_draft
  from public.owner_project_conversation_drafts
  where id=p_draft_id
  for update;

  if v_draft.id is null then raise exception 'owner_project_draft_not_found'; end if;
  if v_draft.actor_hash<>trim(p_actor_hash) then raise exception 'owner_project_draft_actor_mismatch'; end if;

  if v_draft.status='confirmed' then
    select * into v_project from public.owner_projects where id=v_draft.confirmed_project_id;
    select * into v_task from public.owner_project_tasks where id=v_draft.confirmed_task_id;
    return jsonb_build_object(
      'ok',true,'duplicate',true,'draft_id',v_draft.id,
      'project_id',v_project.id,'project_code',v_project.project_code,'project_name',v_project.name,
      'task_id',v_task.id,'task_code',v_task.task_code
    );
  end if;

  if v_draft.status<>'awaiting_confirmation' then raise exception 'owner_project_draft_not_ready'; end if;
  if cardinality(v_draft.missing_fields)>0 then raise exception 'owner_project_draft_missing_fields'; end if;
  if v_draft.expires_at<=now() then raise exception 'owner_project_draft_expired'; end if;

  v_project_name:=left(trim(coalesce(v_draft.data->>'project_name','')),180);
  v_normalized_name:=left(regexp_replace(lower(v_project_name),'\s+',' ','g'),180);
  v_work_title:=left(trim(coalesce(v_draft.data->>'work_title','')),240);
  if length(v_project_name)<2 then raise exception 'owner_project_name_required'; end if;
  if length(v_work_title)<2 then raise exception 'owner_project_work_title_required'; end if;

  v_business:=nullif(trim(coalesce(v_draft.data->>'business_unit_code','')),'');
  if v_business is not null and v_business not in (
    'inthanin','tamma_restaurant','huenstay','adventure','otop',
    'shared_infrastructure','shared','other'
  ) then v_business:='other'; end if;

  if coalesce(v_draft.data->>'budget_amount','') ~ '^[0-9]+([.][0-9]{1,2})?$' then
    v_budget:=(v_draft.data->>'budget_amount')::numeric(14,2);
    if v_budget<0 or v_budget>100000000 then raise exception 'invalid_owner_project_budget'; end if;
  else
    v_budget:=null;
  end if;

  select * into v_project
  from public.owner_projects
  where owner_group_hash=v_draft.owner_group_hash
    and normalized_name=v_normalized_name
    and status<>'cancelled'
  order by created_at asc
  limit 1
  for update;

  if v_project.id is null then
    insert into public.owner_projects(
      owner_group_hash,name,normalized_name,purpose,business_unit_code,location_label,
      budget_amount,status,start_on,due_on,source_channel,source_message_id,
      created_by_hash,confirmed_at
    ) values (
      v_draft.owner_group_hash,v_project_name,v_normalized_name,
      nullif(left(trim(coalesce(v_draft.data->>'project_purpose','')),2000),''),
      v_business,nullif(left(trim(coalesce(v_draft.data->>'location_label','')),180),''),
      v_budget,'active',
      case when coalesce(v_draft.data->>'start_on','') ~ '^20[0-9]{2}-[0-9]{2}-[0-9]{2}$' then (v_draft.data->>'start_on')::date else null end,
      case when coalesce(v_draft.data->>'project_due_on','') ~ '^20[0-9]{2}-[0-9]{2}-[0-9]{2}$' then (v_draft.data->>'project_due_on')::date else null end,
      'line',trim(p_message_id),v_draft.actor_hash,now()
    ) returning * into v_project;

    insert into public.owner_project_audit_events(
      entity_type,entity_id,action,source,actor_hash,message_id,after_data
    ) values (
      'project',v_project.id,'created','line',v_draft.actor_hash,trim(p_message_id),to_jsonb(v_project)
    );
  elsif v_project.budget_amount is null and v_budget is not null then
    update public.owner_projects
    set budget_amount=v_budget,updated_at=now()
    where id=v_project.id
    returning * into v_project;
  end if;

  v_task_kind:=coalesce(nullif(trim(v_draft.data->>'task_kind'),''),'one_time');
  if v_task_kind not in ('pre_opening','one_time','weekly') then v_task_kind:='one_time'; end if;

  select coalesce(array_agg(value::smallint order by value::integer),'{}'::smallint[])
  into v_weekdays
  from jsonb_array_elements_text(coalesce(v_draft.data->'recurrence_weekdays','[]'::jsonb)) as weekday(value)
  where value ~ '^[0-6]$';

  v_due_on:=case
    when coalesce(v_draft.data->>'due_on','') ~ '^20[0-9]{2}-[0-9]{2}-[0-9]{2}$'
      then (v_draft.data->>'due_on')::date
    else null end;
  v_counterparty:=nullif(left(trim(coalesce(v_draft.data->>'counterparty_name','')),180),'');
  v_responsible:=nullif(left(trim(coalesce(v_draft.data->>'responsible_name','')),180),'');

  insert into public.owner_project_tasks(
    project_id,title,description,task_kind,recurrence_weekdays,recurrence_start_on,
    recurrence_end_on,due_on,schedule_text,responsible_name,counterparty_name,
    budget_amount,status,source_channel,source_message_id,created_by_hash,confirmed_at
  ) values (
    v_project.id,v_work_title,
    nullif(left(trim(coalesce(v_draft.data->>'description','')),2000),''),
    v_task_kind,v_weekdays,
    case when v_task_kind='weekly' then coalesce(v_due_on,(timezone('Asia/Bangkok',now()))::date) else null end,
    case when coalesce(v_draft.data->>'recurrence_end_on','') ~ '^20[0-9]{2}-[0-9]{2}-[0-9]{2}$' then (v_draft.data->>'recurrence_end_on')::date else null end,
    case when v_task_kind='weekly' then null else v_due_on end,
    nullif(left(trim(coalesce(v_draft.data->>'schedule_text','')),240),''),
    v_responsible,v_counterparty,v_budget,'todo','line',trim(p_message_id),v_draft.actor_hash,now()
  ) returning * into v_task;

  insert into public.owner_project_audit_events(
    entity_type,entity_id,action,source,actor_hash,message_id,after_data
  ) values ('task',v_task.id,'created','line',v_draft.actor_hash,trim(p_message_id),to_jsonb(v_task));

  if coalesce(v_draft.data->>'installment_count','') ~ '^[0-9]+$' then
    v_installment_count:=(v_draft.data->>'installment_count')::integer;
  else
    v_installment_count:=0;
  end if;
  if v_installment_count<0 or v_installment_count>120 then raise exception 'invalid_installment_count'; end if;

  v_payment_method:=nullif(trim(coalesce(v_draft.data->>'payment_method','')),'');
  if v_payment_method is not null and v_payment_method not in ('cash','transfer','card','other') then
    v_payment_method:='other';
  end if;
  v_first_due_on:=case
    when coalesce(v_draft.data->>'first_installment_on','') ~ '^20[0-9]{2}-[0-9]{2}-[0-9]{2}$'
      then (v_draft.data->>'first_installment_on')::date
    else null end;

  if v_installment_count>0 then
    for v_index in 1..v_installment_count loop
      if v_budget is null then
        v_installment_amount:=null;
      elsif v_index<v_installment_count then
        v_installment_amount:=round(v_budget/v_installment_count,2);
      else
        v_installment_amount:=v_budget-v_running_amount;
      end if;
      v_running_amount:=v_running_amount+coalesce(v_installment_amount,0);

      insert into public.owner_project_installments(
        project_id,task_id,installment_no,title,amount,due_on,counterparty_name,
        payment_method,status,source_channel,source_message_id,created_by_hash
      ) values (
        v_project.id,v_task.id,v_index,'งวดที่ '||v_index,v_installment_amount,
        case when v_index=1 then v_first_due_on else null end,
        v_counterparty,v_payment_method,'planned','line',trim(p_message_id),v_draft.actor_hash
      );
    end loop;
  end if;

  update public.owner_project_conversation_drafts
  set status='confirmed',confirmed_by_message_id=trim(p_message_id),
      confirmed_project_id=v_project.id,confirmed_task_id=v_task.id,updated_at=now()
  where id=v_draft.id;

  insert into public.owner_project_audit_events(
    entity_type,entity_id,action,source,actor_hash,message_id,after_data
  ) values (
    'draft',v_draft.id,'confirmed','line',v_draft.actor_hash,trim(p_message_id),
    jsonb_build_object('project_id',v_project.id,'task_id',v_task.id,'installment_count',v_installment_count)
  );

  return jsonb_build_object(
    'ok',true,'duplicate',false,'draft_id',v_draft.id,
    'project_id',v_project.id,'project_code',v_project.project_code,'project_name',v_project.name,
    'task_id',v_task.id,'task_code',v_task.task_code,'installment_count',v_installment_count
  );
end;
$$;

create or replace function public.owner_project_backoffice_update_v1(
  p_entity_type text,
  p_entity_id uuid,
  p_patch jsonb,
  p_reason text,
  p_actor_hash text
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_reason text:=left(trim(coalesce(p_reason,'')),500);
  v_before jsonb;
  v_after jsonb;
  v_amount numeric(14,2);
  v_paid_amount numeric(14,2);
begin
  if length(v_reason)<3 then raise exception 'update_reason_required'; end if;
  if p_patch is null or jsonb_typeof(p_patch)<>'object' then raise exception 'invalid_update_patch'; end if;

  if p_entity_type='project' then
    select to_jsonb(row) into v_before from public.owner_projects row where id=p_entity_id for update;
    if v_before is null then raise exception 'owner_project_not_found'; end if;
    if p_patch ? 'budget_amount' then
      if jsonb_typeof(p_patch->'budget_amount')='null' then v_amount:=null;
      elsif coalesce(p_patch->>'budget_amount','') ~ '^[0-9]+([.][0-9]{1,2})?$' then v_amount:=(p_patch->>'budget_amount')::numeric;
      else raise exception 'invalid_owner_project_budget'; end if;
    end if;
    update public.owner_projects
    set name=case when p_patch ? 'name' then left(trim(p_patch->>'name'),180) else name end,
        normalized_name=case when p_patch ? 'name' then left(regexp_replace(lower(trim(p_patch->>'name')),'\s+',' ','g'),180) else normalized_name end,
        purpose=case when p_patch ? 'purpose' then nullif(left(trim(p_patch->>'purpose'),2000),'') else purpose end,
        budget_amount=case when p_patch ? 'budget_amount' then v_amount else budget_amount end,
        status=case when p_patch ? 'status' and p_patch->>'status' in ('planning','approved','active','paused','completed','cancelled') then p_patch->>'status' else status end,
        due_on=case when p_patch ? 'due_on' then case when coalesce(p_patch->>'due_on','')='' then null else (p_patch->>'due_on')::date end else due_on end,
        updated_at=now()
    where id=p_entity_id;
    select to_jsonb(row) into v_after from public.owner_projects row where id=p_entity_id;
  elsif p_entity_type='task' then
    select to_jsonb(row) into v_before from public.owner_project_tasks row where id=p_entity_id for update;
    if v_before is null then raise exception 'owner_project_task_not_found'; end if;
    if p_patch ? 'budget_amount' then
      if jsonb_typeof(p_patch->'budget_amount')='null' then v_amount:=null;
      elsif coalesce(p_patch->>'budget_amount','') ~ '^[0-9]+([.][0-9]{1,2})?$' then v_amount:=(p_patch->>'budget_amount')::numeric;
      else raise exception 'invalid_owner_task_budget'; end if;
    end if;
    update public.owner_project_tasks
    set title=case when p_patch ? 'title' then left(trim(p_patch->>'title'),240) else title end,
        description=case when p_patch ? 'description' then nullif(left(trim(p_patch->>'description'),2000),'') else description end,
        schedule_text=case when p_patch ? 'schedule_text' then nullif(left(trim(p_patch->>'schedule_text'),240),'') else schedule_text end,
        responsible_name=case when p_patch ? 'responsible_name' then nullif(left(trim(p_patch->>'responsible_name'),180),'') else responsible_name end,
        counterparty_name=case when p_patch ? 'counterparty_name' then nullif(left(trim(p_patch->>'counterparty_name'),180),'') else counterparty_name end,
        budget_amount=case when p_patch ? 'budget_amount' then v_amount else budget_amount end,
        status=case when p_patch ? 'status' and p_patch->>'status' in ('todo','in_progress','blocked','done','cancelled') then p_patch->>'status' else status end,
        due_on=case when p_patch ? 'due_on' then case when coalesce(p_patch->>'due_on','')='' then null else (p_patch->>'due_on')::date end else due_on end,
        updated_at=now()
    where id=p_entity_id;
    select to_jsonb(row) into v_after from public.owner_project_tasks row where id=p_entity_id;
  elsif p_entity_type='installment' then
    select to_jsonb(row) into v_before from public.owner_project_installments row where id=p_entity_id for update;
    if v_before is null then raise exception 'owner_project_installment_not_found'; end if;
    if p_patch ? 'amount' then
      if jsonb_typeof(p_patch->'amount')='null' then v_amount:=null;
      elsif coalesce(p_patch->>'amount','') ~ '^[0-9]+([.][0-9]{1,2})?$' then v_amount:=(p_patch->>'amount')::numeric;
      else raise exception 'invalid_installment_amount'; end if;
    end if;
    if p_patch ? 'paid_amount' then
      if coalesce(p_patch->>'paid_amount','') ~ '^[0-9]+([.][0-9]{1,2})?$' then v_paid_amount:=(p_patch->>'paid_amount')::numeric;
      else raise exception 'invalid_installment_paid_amount'; end if;
    end if;
    update public.owner_project_installments
    set amount=case when p_patch ? 'amount' then v_amount else amount end,
        due_on=case when p_patch ? 'due_on' then case when coalesce(p_patch->>'due_on','')='' then null else (p_patch->>'due_on')::date end else due_on end,
        counterparty_name=case when p_patch ? 'counterparty_name' then nullif(left(trim(p_patch->>'counterparty_name'),180),'') else counterparty_name end,
        status=case when p_patch ? 'status' and p_patch->>'status' in ('planned','due','paid','cancelled') then p_patch->>'status' else status end,
        paid_amount=case when p_patch ? 'paid_amount' then v_paid_amount else paid_amount end,
        paid_on=case when p_patch ? 'paid_on' then case when coalesce(p_patch->>'paid_on','')='' then null else (p_patch->>'paid_on')::date end else paid_on end,
        updated_at=now()
    where id=p_entity_id;
    select to_jsonb(row) into v_after from public.owner_project_installments row where id=p_entity_id;
  else
    raise exception 'invalid_owner_project_entity_type';
  end if;

  if coalesce(v_after->>'name',v_after->>'title','')='' then raise exception 'owner_project_title_required'; end if;

  insert into public.owner_project_audit_events(
    entity_type,entity_id,action,source,actor_hash,reason,before_data,after_data
  ) values (
    p_entity_type,p_entity_id,
    case when v_after->>'status'='cancelled' and v_before->>'status'<>'cancelled' then 'cancelled'
         when v_after->>'status' is distinct from v_before->>'status' then 'status_changed'
         else 'updated' end,
    'backoffice',nullif(trim(coalesce(p_actor_hash,'')),''),v_reason,v_before,v_after
  );

  return jsonb_build_object('ok',true,'entity_type',p_entity_type,'entity_id',p_entity_id,'record',v_after);
end;
$$;

create or replace function public.owner_project_set_week_state_v1(
  p_task_id uuid,
  p_week_start date,
  p_state text,
  p_note text,
  p_source text,
  p_actor_hash text,
  p_message_id text
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_task public.owner_project_tasks%rowtype;
  v_row public.owner_project_task_checkins%rowtype;
  v_before jsonb:='{}'::jsonb;
begin
  if p_state not in ('pending','done','blocked','skipped') then raise exception 'invalid_week_state'; end if;
  if p_source not in ('line','backoffice','system') then raise exception 'invalid_week_state_source'; end if;
  select * into v_task from public.owner_project_tasks where id=p_task_id for update;
  if v_task.id is null then raise exception 'owner_project_task_not_found'; end if;
  if v_task.task_kind<>'weekly' then raise exception 'owner_project_task_not_weekly'; end if;
  select to_jsonb(row) into v_before from public.owner_project_task_checkins row
    where task_id=p_task_id and week_start=p_week_start for update;
  insert into public.owner_project_task_checkins(
    task_id,week_start,state,note,actor_hash,source,source_message_id,completed_at
  ) values (
    p_task_id,p_week_start,p_state,nullif(left(trim(coalesce(p_note,'')),500),''),
    nullif(trim(coalesce(p_actor_hash,'')),''),p_source,nullif(trim(coalesce(p_message_id,'')),''),
    case when p_state='done' then now() else null end
  )
  on conflict(task_id,week_start) do update set
    state=excluded.state,note=excluded.note,actor_hash=excluded.actor_hash,
    source=excluded.source,source_message_id=excluded.source_message_id,
    completed_at=excluded.completed_at,updated_at=now()
  returning * into v_row;
  insert into public.owner_project_audit_events(
    entity_type,entity_id,action,source,actor_hash,message_id,before_data,after_data
  ) values (
    'checkin',v_row.id,'status_changed',p_source,
    nullif(trim(coalesce(p_actor_hash,'')),''),nullif(trim(coalesce(p_message_id,'')),''),
    coalesce(v_before,'{}'::jsonb),to_jsonb(v_row)
  );
  return jsonb_build_object('ok',true,'checkin_id',v_row.id,'task_id',p_task_id,'state',p_state);
end;
$$;

create or replace function public.owner_project_link_financial_v1(
  p_financial_kind text,
  p_financial_id uuid,
  p_project_id uuid,
  p_task_id uuid,
  p_installment_id uuid,
  p_source text,
  p_actor_hash text,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_before jsonb;
  v_after jsonb;
begin
  if p_source not in ('line','backoffice','system') then raise exception 'invalid_link_source'; end if;
  if not exists(
    select 1 from public.owner_projects
    where id=p_project_id and status<>'cancelled'
  ) then raise exception 'owner_project_not_found'; end if;

  if p_task_id is not null and not exists(
    select 1 from public.owner_project_tasks
    where id=p_task_id and project_id=p_project_id and status<>'cancelled'
  ) then raise exception 'owner_project_task_mismatch'; end if;

  if p_installment_id is not null and not exists(
    select 1 from public.owner_project_installments
    where id=p_installment_id and project_id=p_project_id
      and (p_task_id is null or task_id=p_task_id) and status<>'cancelled'
  ) then raise exception 'owner_project_installment_mismatch'; end if;

  if p_financial_kind='investment_entry' then
    select to_jsonb(row) into v_before
    from public.financial_investment_entries row
    where id=p_financial_id for update;
    if v_before is null then raise exception 'financial_investment_entry_not_found'; end if;
    update public.financial_investment_entries
    set owner_project_id=p_project_id,
        owner_project_task_id=p_task_id,
        owner_project_installment_id=p_installment_id
    where id=p_financial_id;
    select to_jsonb(row) into v_after
    from public.financial_investment_entries row where id=p_financial_id;
  elsif p_financial_kind='owner_expense' then
    select to_jsonb(row) into v_before
    from public.financial_owner_expense_intakes row
    where id=p_financial_id for update;
    if v_before is null then raise exception 'financial_owner_expense_not_found'; end if;
    update public.financial_owner_expense_intakes
    set owner_project_id=p_project_id,
        owner_project_task_id=p_task_id,
        owner_project_installment_id=p_installment_id,
        updated_at=now()
    where id=p_financial_id;
    select to_jsonb(row) into v_after
    from public.financial_owner_expense_intakes row where id=p_financial_id;
  else
    raise exception 'invalid_financial_kind';
  end if;

  insert into public.owner_project_audit_events(
    entity_type,entity_id,action,source,actor_hash,reason,before_data,after_data
  ) values (
    'expense_link',p_financial_id,'linked',p_source,
    nullif(trim(coalesce(p_actor_hash,'')),''),
    nullif(left(trim(coalesce(p_reason,'')),500),''),v_before,v_after
  );
  return jsonb_build_object(
    'ok',true,'financial_kind',p_financial_kind,'financial_id',p_financial_id,
    'project_id',p_project_id,'task_id',p_task_id,'installment_id',p_installment_id
  );
end;
$$;

-- Edit/cancel financial rows with an audit record in the same transaction.
-- Owner expense cancellations continue to use the dedicated audited RPC.
create or replace function public.owner_project_update_financial_v1(
  p_financial_kind text,
  p_financial_id uuid,
  p_action text,
  p_patch jsonb,
  p_reason text,
  p_actor_hash text
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_before jsonb;
  v_after jsonb;
  v_amount numeric(14,2);
  v_business text;
  v_class text;
  v_category text;
begin
  if length(trim(coalesce(p_reason,'')))<3 then raise exception 'financial_change_reason_required'; end if;
  if p_patch is null or jsonb_typeof(p_patch)<>'object' then raise exception 'invalid_financial_patch'; end if;

  if p_financial_kind='investment_entry' then
    select to_jsonb(row) into v_before
    from public.financial_investment_entries row
    where id=p_financial_id for update;
    if v_before is null then raise exception 'financial_investment_entry_not_found'; end if;
    if v_before->>'status'='cancelled' then raise exception 'financial_investment_entry_cancelled'; end if;

    if p_action='cancel' then
      update public.financial_investment_entries
      set status='cancelled',updated_at=now()
      where id=p_financial_id;
      insert into public.financial_investment_entry_audit_events(
        entry_id,action,source,actor_hash,before_data,after_data
      ) values (
        p_financial_id,'cancelled','backoffice',nullif(trim(coalesce(p_actor_hash,'')),''),
        v_before,(select to_jsonb(row) from public.financial_investment_entries row where id=p_financial_id)
      );
    elsif p_action='update' then
      if not (p_patch ?| array['occurred_on','business_unit_code','title','category','amount','payment_method','vendor_name','notes']) then
        raise exception 'empty_financial_patch';
      end if;
      if p_patch ? 'amount' then
        if coalesce(p_patch->>'amount','') ~ '^[0-9]+([.][0-9]{1,2})?$' then v_amount:=(p_patch->>'amount')::numeric;
        else raise exception 'invalid_investment_amount'; end if;
      end if;
      if p_patch ? 'business_unit_code' then
        v_business:=p_patch->>'business_unit_code';
        if v_business not in ('inthanin','tamma_restaurant','huenstay','adventure','otop','shared_infrastructure','shared','other') then
          raise exception 'invalid_business_unit';
        end if;
      end if;
      if p_patch ? 'payment_method' and p_patch->>'payment_method' not in ('cash','transfer','card','other') then
        raise exception 'invalid_payment_method';
      end if;
      if p_patch ? 'title' and length(trim(coalesce(p_patch->>'title','')))<2 then raise exception 'investment_title_required'; end if;

      update public.financial_investment_entries
      set occurred_on=case when p_patch ? 'occurred_on' then (p_patch->>'occurred_on')::date else occurred_on end,
          business_unit_code=case when p_patch ? 'business_unit_code' then v_business else business_unit_code end,
          title=case when p_patch ? 'title' then left(trim(p_patch->>'title'),240) else title end,
          category=case when p_patch ? 'category' then coalesce(nullif(left(trim(p_patch->>'category'),120),''),'other') else category end,
          amount=case when p_patch ? 'amount' then v_amount else amount end,
          payment_method=case when p_patch ? 'payment_method' then p_patch->>'payment_method' else payment_method end,
          vendor_name=case when p_patch ? 'vendor_name' then nullif(left(trim(coalesce(p_patch->>'vendor_name','')),180),'') else vendor_name end,
          notes=case when p_patch ? 'notes' then nullif(left(trim(coalesce(p_patch->>'notes','')),2000),'') else notes end,
          updated_at=now()
      where id=p_financial_id;
    else
      raise exception 'invalid_financial_action';
    end if;

    select to_jsonb(row) into v_after
    from public.financial_investment_entries row where id=p_financial_id;
  elsif p_financial_kind='owner_expense' and p_action='update' then
    select to_jsonb(row) into v_before
    from public.financial_owner_expense_intakes row
    where id=p_financial_id for update;
    if v_before is null then raise exception 'financial_owner_expense_not_found'; end if;
    if v_before->>'status'='cancelled' then raise exception 'financial_owner_expense_cancelled'; end if;
    if not (p_patch ?| array['occurred_on','business_unit_code','expense_class','expense_category','expense_subcategory','purpose_raw','amount','vendor_label']) then
      raise exception 'empty_financial_patch';
    end if;
    if p_patch ? 'amount' then
      if jsonb_typeof(p_patch->'amount')='null' then v_amount:=null;
      elsif coalesce(p_patch->>'amount','') ~ '^[0-9]+([.][0-9]{1,2})?$' then v_amount:=(p_patch->>'amount')::numeric;
      else raise exception 'invalid_owner_expense_amount'; end if;
      if v_amount is not null and (v_amount<=0 or v_amount>100000000) then raise exception 'invalid_owner_expense_amount'; end if;
    end if;
    if p_patch ? 'business_unit_code' then
      v_business:=p_patch->>'business_unit_code';
      if v_business not in ('inthanin','tamma_restaurant','huenstay','adventure','otop','shared_infrastructure','shared','other') then
        raise exception 'invalid_business_unit';
      end if;
    end if;
    if p_patch ? 'expense_class' then
      v_class:=p_patch->>'expense_class';
      if v_class not in ('capital_investment','operating_expense','owner_private','uncategorized') then raise exception 'invalid_expense_class'; end if;
    end if;
    if p_patch ? 'expense_category' then
      v_category:=p_patch->>'expense_category';
      if v_category not in ('construction','land_infrastructure','kitchen_equipment','equipment','furniture_fixtures','activity_assets','technology','licenses','inventory','ingredients','beverages','packaging','consumables','cleaning','maintenance','utilities','transport','staff','marketing','fees','professional_services','tax','financing','petty_cash','other') then
        raise exception 'invalid_expense_category';
      end if;
    end if;
    update public.financial_owner_expense_intakes
    set occurred_on=case when p_patch ? 'occurred_on' then (p_patch->>'occurred_on')::date else occurred_on end,
        business_unit_code=case when p_patch ? 'business_unit_code' then v_business else business_unit_code end,
        expense_class=case when p_patch ? 'expense_class' then v_class else expense_class end,
        expense_category=case when p_patch ? 'expense_category' then v_category else expense_category end,
        expense_subcategory=case when p_patch ? 'expense_subcategory' then nullif(left(trim(coalesce(p_patch->>'expense_subcategory','')),120),'') else expense_subcategory end,
        purpose_raw=case when p_patch ? 'purpose_raw' then nullif(left(trim(coalesce(p_patch->>'purpose_raw','')),500),'') else purpose_raw end,
        amount=case when p_patch ? 'amount' then v_amount else amount end,
        vendor_label=case when p_patch ? 'vendor_label' then nullif(left(trim(coalesce(p_patch->>'vendor_label','')),180),'') else vendor_label end,
        classification_source=case when p_patch ?| array['business_unit_code','expense_class','expense_category'] then 'backoffice' else classification_source end,
        classification_confidence=case when p_patch ?| array['business_unit_code','expense_class','expense_category'] then 1 else classification_confidence end,
        categorized_at=case when p_patch ?| array['business_unit_code','expense_class','expense_category'] then now() else categorized_at end,
        updated_at=now()
    where id=p_financial_id;
    select to_jsonb(row) into v_after
    from public.financial_owner_expense_intakes row where id=p_financial_id;
  else
    raise exception 'invalid_financial_kind_or_action';
  end if;

  insert into public.owner_project_audit_events(
    entity_type,entity_id,action,source,actor_hash,reason,before_data,after_data
  ) values (
    'expense_link',p_financial_id,
    case when p_action='cancel' then 'cancelled' else 'updated' end,
    'backoffice',nullif(trim(coalesce(p_actor_hash,'')),''),left(trim(p_reason),500),v_before,v_after
  );
  return jsonb_build_object('ok',true,'financial_kind',p_financial_kind,'financial_id',p_financial_id,'action',p_action,'record',v_after);
end;
$$;

-- Record a Backoffice investment and attach it to its project in one transaction.
create or replace function public.owner_project_record_investment_v1(
  p_occurred_on date,
  p_business_unit_code text,
  p_title text,
  p_category text,
  p_amount numeric,
  p_payment_method text,
  p_vendor_name text,
  p_notes text,
  p_source_message_id text,
  p_actor_hash text,
  p_project_id uuid,
  p_task_id uuid,
  p_installment_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_result jsonb;
  v_link jsonb;
begin
  if length(trim(coalesce(p_source_message_id,'')))<1 then raise exception 'investment_request_id_required'; end if;
  if p_project_id is null and (p_task_id is not null or p_installment_id is not null) then
    raise exception 'owner_project_required_for_link';
  end if;
  v_result:=public.financial_record_investment_v1(
    p_occurred_on,p_business_unit_code,p_title,p_category,p_amount,p_payment_method,
    p_vendor_name,p_notes,'backoffice',null,p_source_message_id,p_actor_hash
  );
  if p_project_id is not null then
    v_link:=public.owner_project_link_financial_v1(
      'investment_entry',(v_result->>'id')::uuid,p_project_id,p_task_id,p_installment_id,
      'backoffice',p_actor_hash,'บันทึกและผูกจากหน้าการลงทุน'
    );
  end if;
  return v_result || jsonb_build_object('link',v_link);
end;
$$;

revoke all on function public.owner_project_confirm_draft_v1(uuid,text,text)
  from public,anon,authenticated;
revoke all on function public.owner_project_backoffice_update_v1(text,uuid,jsonb,text,text)
  from public,anon,authenticated;
revoke all on function public.owner_project_set_week_state_v1(uuid,date,text,text,text,text,text)
  from public,anon,authenticated;
revoke all on function public.owner_project_link_financial_v1(text,uuid,uuid,uuid,uuid,text,text,text)
  from public,anon,authenticated;
revoke all on function public.owner_project_update_financial_v1(text,uuid,text,jsonb,text,text)
  from public,anon,authenticated;
revoke all on function public.owner_project_record_investment_v1(date,text,text,text,numeric,text,text,text,text,text,uuid,uuid,uuid)
  from public,anon,authenticated;

grant execute on function public.owner_project_confirm_draft_v1(uuid,text,text)
  to service_role;
grant execute on function public.owner_project_backoffice_update_v1(text,uuid,jsonb,text,text)
  to service_role;
grant execute on function public.owner_project_set_week_state_v1(uuid,date,text,text,text,text,text)
  to service_role;
grant execute on function public.owner_project_link_financial_v1(text,uuid,uuid,uuid,uuid,text,text,text)
  to service_role;
grant execute on function public.owner_project_update_financial_v1(text,uuid,text,jsonb,text,text)
  to service_role;
grant execute on function public.owner_project_record_investment_v1(date,text,text,text,numeric,text,text,text,text,text,uuid,uuid,uuid)
  to service_role;

-- END UPSTREAM supabase/migrations/20261005145713_owner_project_task_os_v1.sql:L1-L885

-- BEGIN UPSTREAM supabase/migrations/20261005150008_owner_project_os_fk_indexes_v1.sql:L1-L33
-- Cover the new foreign keys for task, installment, and draft links.
-- These indexes are additive and retain all existing rows.

create index if not exists owner_project_installments_project_due_idx
  on public.owner_project_installments(project_id,due_on);

create index if not exists owner_project_drafts_confirmed_project_idx
  on public.owner_project_conversation_drafts(confirmed_project_id)
  where confirmed_project_id is not null;

create index if not exists owner_project_drafts_confirmed_task_idx
  on public.owner_project_conversation_drafts(confirmed_task_id)
  where confirmed_task_id is not null;

create index if not exists owner_project_messages_draft_idx
  on public.owner_project_conversation_messages(draft_id)
  where draft_id is not null;

create index if not exists financial_investment_entries_owner_project_task_idx
  on public.financial_investment_entries(owner_project_task_id,occurred_on)
  where status='recorded' and owner_project_task_id is not null;

create index if not exists financial_investment_entries_owner_project_installment_idx
  on public.financial_investment_entries(owner_project_installment_id,occurred_on)
  where status='recorded' and owner_project_installment_id is not null;

create index if not exists financial_owner_expense_owner_project_task_idx
  on public.financial_owner_expense_intakes(owner_project_task_id,occurred_on)
  where status<>'cancelled' and owner_project_task_id is not null;

create index if not exists financial_owner_expense_owner_project_installment_idx
  on public.financial_owner_expense_intakes(owner_project_installment_id,occurred_on)
  where status<>'cancelled' and owner_project_installment_id is not null;

-- END UPSTREAM supabase/migrations/20261005150008_owner_project_os_fk_indexes_v1.sql:L1-L33

-- BEGIN UPSTREAM supabase/migrations/20261006025000_owner_expense_line_reclassification_v1.sql:L1-L110
-- Owner LINE can correct a reviewed expense on the same financial row.
-- The LINE message id makes retries idempotent; evidence and project links are not modified.

create or replace function public.financial_reclassify_owner_expense_from_line_v1(
  p_intake_id uuid,
  p_business_unit_code text,
  p_expense_class text,
  p_expense_category text,
  p_expense_subcategory text,
  p_user_hash text,
  p_message_id text
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_row public.financial_owner_expense_intakes%rowtype;
  v_before jsonb;
  v_status text;
  v_subcategory text;
begin
  if coalesce(trim(p_message_id),'')='' then raise exception 'message_id_required'; end if;
  if coalesce(trim(p_business_unit_code),'') not in (
    'inthanin','tamma_restaurant','huenstay','adventure','otop',
    'shared_infrastructure','shared','other'
  ) then raise exception 'invalid_business_unit'; end if;
  if p_expense_class not in ('capital_investment','operating_expense','owner_private','uncategorized') then
    raise exception 'invalid_expense_class';
  end if;
  if p_expense_category not in (
    'construction','land_infrastructure','kitchen_equipment','equipment',
    'furniture_fixtures','activity_assets','technology','licenses',
    'inventory','ingredients','beverages','packaging','consumables','cleaning',
    'maintenance','utilities','transport','staff','marketing','fees',
    'professional_services','tax','financing','petty_cash','other'
  ) then raise exception 'invalid_expense_category'; end if;

  select * into v_row
  from public.financial_owner_expense_intakes
  where id=p_intake_id
  for update;
  if v_row.id is null then raise exception 'owner_expense_not_found'; end if;

  if exists(
    select 1 from public.financial_owner_expense_audit_events
    where intake_id=p_intake_id and message_id=trim(p_message_id)
  ) then
    return jsonb_build_object(
      'ok',true,'duplicate',true,'intake_id',v_row.id,'status',v_row.status,'amount',v_row.amount,
      'business_unit_code',v_row.business_unit_code,'expense_class',v_row.expense_class,
      'expense_category',v_row.expense_category,'expense_subcategory',v_row.expense_subcategory
    );
  end if;
  if v_row.status='cancelled' then raise exception 'cancelled_owner_expense_immutable'; end if;
  if v_row.status<>'needs_review' then raise exception 'owner_expense_not_reviewable'; end if;

  v_status:=case
    when p_business_unit_code='other' or p_expense_category='other' then 'needs_review'
    else 'categorized'
  end;
  v_subcategory:=nullif(left(trim(coalesce(p_expense_subcategory,'')),120),'');

  v_before:=jsonb_build_object(
    'status',v_row.status,'business_unit_code',v_row.business_unit_code,
    'expense_class',v_row.expense_class,'expense_category',v_row.expense_category,
    'expense_subcategory',v_row.expense_subcategory,
    'classification_confidence',v_row.classification_confidence
  );

  update public.financial_owner_expense_intakes
  set status=v_status,
      business_unit_code=p_business_unit_code,
      expense_class=p_expense_class,
      expense_category=p_expense_category,
      expense_subcategory=coalesce(v_subcategory,expense_subcategory),
      classification_confidence=1,
      classification_source='owner',
      categorized_at=now(),
      updated_at=now()
  where id=p_intake_id;

  insert into public.financial_owner_expense_audit_events(
    intake_id,action,source,actor_hash,message_id,reason,before_data,after_data
  ) values (
    p_intake_id,'reclassified','line',nullif(trim(coalesce(p_user_hash,'')),''),trim(p_message_id),
    'เจ้าของยืนยันหมวด/กิจการผ่านข้อความใน LINE Owner',
    v_before,
    jsonb_build_object(
      'status',v_status,'business_unit_code',p_business_unit_code,
      'expense_class',p_expense_class,'expense_category',p_expense_category,
      'expense_subcategory',coalesce(v_subcategory,v_row.expense_subcategory),
      'classification_confidence',1
    )
  );

  return jsonb_build_object(
    'ok',true,'duplicate',false,'intake_id',p_intake_id,'status',v_status,'amount',v_row.amount,
    'business_unit_code',p_business_unit_code,'expense_class',p_expense_class,
    'expense_category',p_expense_category,
    'expense_subcategory',coalesce(v_subcategory,v_row.expense_subcategory)
  );
end;
$$;

revoke all on function public.financial_reclassify_owner_expense_from_line_v1(uuid,text,text,text,text,text,text)
  from public,anon,authenticated;
grant execute on function public.financial_reclassify_owner_expense_from_line_v1(uuid,text,text,text,text,text,text)
  to service_role;

-- END UPSTREAM supabase/migrations/20261006025000_owner_expense_line_reclassification_v1.sql:L1-L110

-- BEGIN UPSTREAM supabase/migrations/20261006081244_owner_project_bulk_tasks_v1.sql:L1-L271
-- Add ordered bulk-task capture and LINE task-state updates to the existing
-- Owner Project OS. No existing rows are deleted or rewritten.

alter table public.owner_project_tasks
  add column if not exists source_batch_position smallint null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname='owner_project_tasks_batch_position_check'
      and conrelid='public.owner_project_tasks'::regclass
  ) then
    alter table public.owner_project_tasks
      add constraint owner_project_tasks_batch_position_check
      check(source_batch_position is null or source_batch_position between 1 and 100);
  end if;
end;
$$;

create index if not exists owner_project_tasks_source_batch_idx
  on public.owner_project_tasks(source_message_id,source_batch_position)
  where source_batch_position is not null;

create or replace function public.owner_project_confirm_bulk_tasks_v1(
  p_draft_id uuid,
  p_message_id text,
  p_actor_hash text
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_draft public.owner_project_conversation_drafts%rowtype;
  v_project public.owner_projects%rowtype;
  v_task public.owner_project_tasks%rowtype;
  v_project_name text;
  v_normalized_name text;
  v_business text;
  v_due_on date;
  v_schedule text;
  v_responsible text;
  v_item jsonb;
  v_position integer;
  v_title text;
  v_item_due_on date;
  v_item_responsible text;
  v_first_task_id uuid;
  v_tasks jsonb:='[]'::jsonb;
  v_task_count integer;
begin
  if coalesce(trim(p_message_id),'')='' then raise exception 'message_id_required'; end if;
  if coalesce(trim(p_actor_hash),'')='' then raise exception 'actor_required'; end if;

  select * into v_draft
  from public.owner_project_conversation_drafts
  where id=p_draft_id
  for update;

  if v_draft.id is null then raise exception 'owner_project_draft_not_found'; end if;
  if v_draft.actor_hash<>trim(p_actor_hash) then raise exception 'owner_project_draft_actor_mismatch'; end if;

  if v_draft.status='confirmed' then
    select * into v_project from public.owner_projects where id=v_draft.confirmed_project_id;
    select coalesce(jsonb_agg(
      jsonb_build_object(
        'id',row.id,'task_code',row.task_code,'title',row.title,
        'position',row.source_batch_position
      ) order by row.source_batch_position
    ),'[]'::jsonb)
    into v_tasks
    from public.owner_project_tasks row
    where row.project_id=v_draft.confirmed_project_id
      and row.source_message_id=v_draft.confirmed_by_message_id
      and row.source_batch_position is not null;
    return jsonb_build_object(
      'ok',true,'duplicate',true,'draft_id',v_draft.id,
      'project_id',v_project.id,'project_code',v_project.project_code,'project_name',v_project.name,
      'task_id',v_draft.confirmed_task_id,'task_count',jsonb_array_length(v_tasks),'tasks',v_tasks
    );
  end if;

  if v_draft.status<>'awaiting_confirmation' then raise exception 'owner_project_draft_not_ready'; end if;
  if cardinality(v_draft.missing_fields)>0 then raise exception 'owner_project_draft_missing_fields'; end if;
  if v_draft.expires_at<=now() then raise exception 'owner_project_draft_expired'; end if;
  if jsonb_typeof(coalesce(v_draft.data->'bulk_tasks','null'::jsonb))<>'array' then
    raise exception 'owner_project_bulk_tasks_required';
  end if;
  v_task_count:=jsonb_array_length(v_draft.data->'bulk_tasks');
  if v_task_count<2 or v_task_count>40 then raise exception 'invalid_owner_project_bulk_task_count'; end if;

  v_project_name:=left(trim(coalesce(v_draft.data->>'project_name','')),180);
  v_normalized_name:=left(regexp_replace(lower(v_project_name),'\s+',' ','g'),180);
  if length(v_project_name)<2 then raise exception 'owner_project_name_required'; end if;

  v_business:=nullif(trim(coalesce(v_draft.data->>'business_unit_code','')),'');
  if v_business is not null and v_business not in (
    'inthanin','tamma_restaurant','huenstay','adventure','otop',
    'shared_infrastructure','shared','other'
  ) then v_business:='other'; end if;

  select * into v_project
  from public.owner_projects
  where owner_group_hash=v_draft.owner_group_hash
    and normalized_name=v_normalized_name
    and status<>'cancelled'
  order by created_at asc
  limit 1
  for update;

  if v_project.id is null then
    insert into public.owner_projects(
      owner_group_hash,name,normalized_name,purpose,business_unit_code,status,
      source_channel,source_message_id,created_by_hash,confirmed_at
    ) values (
      v_draft.owner_group_hash,v_project_name,v_normalized_name,
      nullif(left(trim(coalesce(v_draft.data->>'project_purpose','')),2000),''),
      v_business,'active','line',trim(p_message_id),v_draft.actor_hash,now()
    ) returning * into v_project;

    insert into public.owner_project_audit_events(
      entity_type,entity_id,action,source,actor_hash,message_id,after_data
    ) values (
      'project',v_project.id,'created','line',v_draft.actor_hash,trim(p_message_id),to_jsonb(v_project)
    );
  end if;

  v_due_on:=case
    when coalesce(v_draft.data->>'due_on','') ~ '^20[0-9]{2}-[0-9]{2}-[0-9]{2}$'
      then (v_draft.data->>'due_on')::date
    else null end;
  v_schedule:=nullif(left(trim(coalesce(v_draft.data->>'schedule_text','')),240),'');
  v_responsible:=nullif(left(trim(coalesce(v_draft.data->>'responsible_name','')),180),'');

  for v_item,v_position in
    select value,ordinality::integer
    from jsonb_array_elements(v_draft.data->'bulk_tasks') with ordinality as items(value,ordinality)
  loop
    v_title:=left(trim(case
      when jsonb_typeof(v_item)='string' then trim(both '"' from v_item::text)
      else coalesce(v_item->>'title','')
    end),240);
    if length(v_title)<2 then raise exception 'owner_project_bulk_task_title_required'; end if;

    v_item_due_on:=case
      when coalesce(v_item->>'due_on','') ~ '^20[0-9]{2}-[0-9]{2}-[0-9]{2}$'
        then (v_item->>'due_on')::date
      else v_due_on end;
    v_item_responsible:=coalesce(
      nullif(left(trim(coalesce(v_item->>'responsible_name','')),180),''),
      v_responsible
    );

    insert into public.owner_project_tasks(
      project_id,title,description,task_kind,due_on,schedule_text,responsible_name,
      status,source_channel,source_message_id,source_batch_position,created_by_hash,confirmed_at
    ) values (
      v_project.id,v_title,
      nullif(left(trim(coalesce(v_item->>'description','')),2000),''),
      'one_time',v_item_due_on,v_schedule,v_item_responsible,
      'todo','line',trim(p_message_id),v_position,v_draft.actor_hash,now()
    ) returning * into v_task;

    if v_first_task_id is null then v_first_task_id:=v_task.id; end if;
    v_tasks:=v_tasks || jsonb_build_array(jsonb_build_object(
      'id',v_task.id,'task_code',v_task.task_code,'title',v_task.title,
      'position',v_task.source_batch_position
    ));

    insert into public.owner_project_audit_events(
      entity_type,entity_id,action,source,actor_hash,message_id,after_data
    ) values ('task',v_task.id,'created','line',v_draft.actor_hash,trim(p_message_id),to_jsonb(v_task));
  end loop;

  update public.owner_project_conversation_drafts
  set status='confirmed',confirmed_by_message_id=trim(p_message_id),
      confirmed_project_id=v_project.id,confirmed_task_id=v_first_task_id,updated_at=now()
  where id=v_draft.id;

  insert into public.owner_project_audit_events(
    entity_type,entity_id,action,source,actor_hash,message_id,after_data
  ) values (
    'draft',v_draft.id,'confirmed','line',v_draft.actor_hash,trim(p_message_id),
    jsonb_build_object('project_id',v_project.id,'task_ids',(
      select coalesce(jsonb_agg(value->'id'),'[]'::jsonb) from jsonb_array_elements(v_tasks)
    ),'task_count',v_task_count)
  );

  return jsonb_build_object(
    'ok',true,'duplicate',false,'draft_id',v_draft.id,
    'project_id',v_project.id,'project_code',v_project.project_code,'project_name',v_project.name,
    'task_id',v_first_task_id,'task_count',v_task_count,'tasks',v_tasks
  );
end;
$$;

create or replace function public.owner_project_set_task_state_from_line_v1(
  p_task_id uuid,
  p_group_hash text,
  p_state text,
  p_actor_hash text,
  p_message_id text
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_task public.owner_project_tasks%rowtype;
  v_before jsonb;
  v_project_name text;
begin
  if p_state not in ('todo','done') then raise exception 'invalid_owner_project_line_task_state'; end if;
  if length(trim(coalesce(p_group_hash,'')))<16 then raise exception 'owner_group_required'; end if;
  if coalesce(trim(p_actor_hash),'')='' then raise exception 'actor_required'; end if;
  if coalesce(trim(p_message_id),'')='' then raise exception 'message_id_required'; end if;

  select task.* into v_task
  from public.owner_project_tasks task
  join public.owner_projects project on project.id=task.project_id
  where task.id=p_task_id
    and task.status<>'cancelled'
    and project.status<>'cancelled'
    and project.owner_group_hash=trim(p_group_hash)
  for update of task;

  if v_task.id is null then raise exception 'owner_project_task_not_found_for_group'; end if;
  select name into v_project_name from public.owner_projects where id=v_task.project_id;

  if v_task.status=p_state then
    return jsonb_build_object(
      'ok',true,'duplicate',true,'task_id',v_task.id,'task_code',v_task.task_code,
      'task_title',v_task.title,'task_status',v_task.status,
      'project_name',v_project_name,'batch_position',v_task.source_batch_position
    );
  end if;

  v_before:=to_jsonb(v_task);
  update public.owner_project_tasks
  set status=p_state,updated_at=now()
  where id=v_task.id
  returning * into v_task;

  insert into public.owner_project_audit_events(
    entity_type,entity_id,action,source,actor_hash,message_id,reason,before_data,after_data
  ) values (
    'task',v_task.id,'status_changed','line',trim(p_actor_hash),trim(p_message_id),
    case when p_state='done' then 'เจ้าของแจ้งว่างานเสร็จจาก LINE' else 'เจ้าของย้ายงานกลับเป็นงานค้างจาก LINE' end,
    v_before,to_jsonb(v_task)
  );

  return jsonb_build_object(
    'ok',true,'duplicate',false,'task_id',v_task.id,'task_code',v_task.task_code,
    'task_title',v_task.title,'task_status',v_task.status,
    'project_name',v_project_name,'batch_position',v_task.source_batch_position
  );
end;
$$;

revoke all on function public.owner_project_confirm_bulk_tasks_v1(uuid,text,text)
  from public,anon,authenticated;
revoke all on function public.owner_project_set_task_state_from_line_v1(uuid,text,text,text,text)
  from public,anon,authenticated;

grant execute on function public.owner_project_confirm_bulk_tasks_v1(uuid,text,text)
  to service_role;
grant execute on function public.owner_project_set_task_state_from_line_v1(uuid,text,text,text,text)
  to service_role;

-- END UPSTREAM supabase/migrations/20261006081244_owner_project_bulk_tasks_v1.sql:L1-L271

-- BEGIN UPSTREAM supabase/migrations/20261006102000_owner_project_multi_task_state_v1.sql:L1-L81
-- Update several confirmed Owner tasks in one transaction. An invalid or
-- out-of-group task rejects the entire request without changing any task.
create or replace function public.owner_project_set_task_states_from_line_v1(
  p_task_ids uuid[],
  p_group_hash text,
  p_state text,
  p_actor_hash text,
  p_message_id text
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_task_id uuid;
  v_task public.owner_project_tasks%rowtype;
  v_before jsonb;
  v_count integer;
  v_unique_count integer;
  v_changed integer:=0;
  v_duplicate boolean;
  v_tasks jsonb:='[]'::jsonb;
begin
  v_count:=cardinality(p_task_ids);
  if v_count is null or v_count not between 2 and 20 then
    raise exception 'invalid_owner_project_task_state_count';
  end if;
  select count(distinct id) into v_unique_count from unnest(p_task_ids) as selected(id) where id is not null;
  if v_unique_count<>v_count then raise exception 'duplicate_or_null_owner_project_task_id'; end if;
  if p_state is null or p_state not in ('todo','done') then raise exception 'invalid_owner_project_line_task_state'; end if;
  if length(trim(coalesce(p_group_hash,'')))<16 then raise exception 'owner_group_required'; end if;
  if coalesce(trim(p_actor_hash),'')='' then raise exception 'actor_required'; end if;
  if coalesce(trim(p_message_id),'')='' then raise exception 'message_id_required'; end if;

  foreach v_task_id in array p_task_ids loop
    select task.* into v_task
    from public.owner_project_tasks task
    join public.owner_projects project on project.id=task.project_id
    where task.id=v_task_id
      and task.status<>'cancelled'
      and project.status<>'cancelled'
      and project.owner_group_hash=trim(p_group_hash)
    for update of task;
    if v_task.id is null then raise exception 'owner_project_task_not_found_for_group'; end if;

    v_duplicate:=v_task.status=p_state or exists (
      select 1 from public.owner_project_audit_events audit
      where audit.entity_type='task' and audit.entity_id=v_task.id
        and audit.action='status_changed' and audit.source='line'
        and audit.message_id=trim(p_message_id)
    );
    if not v_duplicate then
      v_before:=to_jsonb(v_task);
      update public.owner_project_tasks
      set status=p_state,updated_at=now()
      where id=v_task.id
      returning * into v_task;
      insert into public.owner_project_audit_events(
        entity_type,entity_id,action,source,actor_hash,message_id,reason,before_data,after_data
      ) values (
        'task',v_task.id,'status_changed','line',trim(p_actor_hash),trim(p_message_id),
        case when p_state='done' then 'เจ้าของแจ้งว่างานเสร็จจาก LINE' else 'เจ้าของย้ายงานกลับเป็นงานค้างจาก LINE' end,
        v_before,to_jsonb(v_task)
      );
      v_changed:=v_changed+1;
    end if;
    v_tasks:=v_tasks || jsonb_build_array(jsonb_build_object(
      'task_id',v_task.id,'task_code',v_task.task_code,'task_title',v_task.title,
      'task_status',v_task.status,'batch_position',v_task.source_batch_position,
      'duplicate',v_duplicate
    ));
  end loop;
  return jsonb_build_object('ok',true,'task_count',v_count,'changed_count',v_changed,'tasks',v_tasks);
end;
$$;

revoke all on function public.owner_project_set_task_states_from_line_v1(uuid[],text,text,text,text)
  from public,anon,authenticated;
grant execute on function public.owner_project_set_task_states_from_line_v1(uuid[],text,text,text,text)
  to service_role;

-- END UPSTREAM supabase/migrations/20261006102000_owner_project_multi_task_state_v1.sql:L1-L81

-- BEGIN UPSTREAM supabase/migrations/20261006120000_owner_project_line_state_v1.sql:L1-L81
-- A project completion is distinct from completing an individual task.
-- Keep every task, financial record, and audit event intact.
create or replace function public.owner_project_set_project_state_from_line_v1(
  p_project_id uuid,
  p_group_hash text,
  p_state text,
  p_actor_hash text,
  p_message_id text
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_project public.owner_projects%rowtype;
  v_before jsonb;
  v_pending integer;
  v_pending_examples jsonb;
  v_duplicate boolean;
begin
  if p_state is null or p_state not in ('active','completed') then
    raise exception 'invalid_owner_project_line_state';
  end if;
  if length(trim(coalesce(p_group_hash,'')))<16 then raise exception 'owner_group_required'; end if;
  if coalesce(trim(p_actor_hash),'')='' then raise exception 'actor_required'; end if;
  if coalesce(trim(p_message_id),'')='' then raise exception 'message_id_required'; end if;

  select * into v_project from public.owner_projects
  where id=p_project_id and owner_group_hash=trim(p_group_hash) and status<>'cancelled'
  for update;
  if v_project.id is null then raise exception 'owner_project_not_found_for_group'; end if;

  v_duplicate:=v_project.status=p_state or exists (
    select 1 from public.owner_project_audit_events audit
    where audit.entity_type='project' and audit.entity_id=v_project.id
      and audit.action='status_changed' and audit.source='line'
      and audit.message_id=trim(p_message_id)
  );
  if not v_duplicate and p_state='completed' then
    -- Lock the existing tasks before checking, so a concurrent task update
    -- cannot turn a pending task into a completed project by accident.
    perform id from public.owner_project_tasks where project_id=v_project.id for update;
    select count(*)::integer into v_pending from public.owner_project_tasks
    where project_id=v_project.id and status not in ('done','cancelled');
    if v_pending>0 then
      select coalesce(jsonb_agg(jsonb_build_object('code',task_code,'title',title)),'[]'::jsonb)
      into v_pending_examples from (
        select task_code,title from public.owner_project_tasks
        where project_id=v_project.id and status not in ('done','cancelled')
        order by created_at limit 5
      ) pending;
      return jsonb_build_object('ok',false,'blocked',true,'project_name',v_project.name,
        'pending_count',v_pending,'pending_tasks',v_pending_examples);
    end if;
  end if;

  if not v_duplicate then
    v_before:=to_jsonb(v_project);
    update public.owner_projects set status=p_state,updated_at=now()
    where id=v_project.id returning * into v_project;
    insert into public.owner_project_audit_events(
      entity_type,entity_id,action,source,actor_hash,message_id,reason,before_data,after_data
    ) values (
      'project',v_project.id,'status_changed','line',trim(p_actor_hash),trim(p_message_id),
      case when p_state='completed' then 'เจ้าของแจ้งว่าทั้งโครงการเสร็จจาก LINE'
           else 'เจ้าของเปิดโครงการกลับมาดำเนินการจาก LINE' end,
      v_before,to_jsonb(v_project)
    );
  end if;

  return jsonb_build_object('ok',true,'duplicate',v_duplicate,
    'project_id',v_project.id,'project_code',v_project.project_code,
    'project_name',v_project.name,'project_status',v_project.status);
end;
$$;

revoke all on function public.owner_project_set_project_state_from_line_v1(uuid,text,text,text,text)
  from public,anon,authenticated;
grant execute on function public.owner_project_set_project_state_from_line_v1(uuid,text,text,text,text)
  to service_role;

-- END UPSTREAM supabase/migrations/20261006120000_owner_project_line_state_v1.sql:L1-L81

-- BEGIN UPSTREAM supabase/migrations/20261007083000_owner_paid_expense_line_v1.sql:L1-L74
-- Record a plain-text paid expense from the Owner LINE group and link the
-- matching project in one transaction. The LINE message ID is the dedupe key.
create or replace function public.owner_project_record_line_investment_v1(
  p_occurred_on date,
  p_business_unit_code text,
  p_title text,
  p_category text,
  p_amount numeric,
  p_payment_method text,
  p_vendor_name text,
  p_notes text,
  p_owner_group_hash text,
  p_source_message_id text,
  p_actor_hash text,
  p_project_id uuid
) returns jsonb
language plpgsql security definer set search_path = ''
as $function$
declare
  v_result jsonb;
  v_entry public.financial_investment_entries%rowtype;
begin
  if nullif(trim(coalesce(p_owner_group_hash,'')),'') is null
    or nullif(trim(coalesce(p_source_message_id,'')),'') is null then
    raise exception 'owner_line_group_and_message_required';
  end if;
  if p_project_id is not null and not exists (
    select 1 from public.owner_projects
    where id=p_project_id and owner_group_hash=trim(p_owner_group_hash)
      and status='active' and business_unit_code=p_business_unit_code
  ) then
    raise exception 'owner_project_group_or_business_mismatch';
  end if;

  begin
    v_result:=public.financial_record_investment_v1(
      p_occurred_on,p_business_unit_code,p_title,p_category,p_amount,p_payment_method,
      p_vendor_name,p_notes,'line',p_owner_group_hash,p_source_message_id,p_actor_hash
    );
  exception when unique_violation then
    select * into v_entry from public.financial_investment_entries
    where source_channel='line' and source_message_id=trim(p_source_message_id);
    if v_entry.id is null then raise; end if;
    v_result:=jsonb_build_object('ok',true,'duplicate',true,'id',v_entry.id);
  end;

  select * into v_entry from public.financial_investment_entries
  where id=(v_result->>'id')::uuid for update;
  if v_entry.owner_group_hash is distinct from trim(p_owner_group_hash)
    or v_entry.business_unit_code is distinct from p_business_unit_code
    or v_entry.amount is distinct from p_amount
    or v_entry.title is distinct from left(trim(p_title),240)
    or v_entry.status='cancelled' then
    raise exception 'owner_line_message_conflict';
  end if;
  if v_entry.owner_project_id is not null and v_entry.owner_project_id is distinct from p_project_id then
    raise exception 'owner_line_project_conflict';
  end if;
  if p_project_id is not null and v_entry.owner_project_id is null then
    perform public.owner_project_link_financial_v1(
      'investment_entry',v_entry.id,p_project_id,null,null,'line',p_actor_hash,
      'ผูกจากรายการจ่ายที่เจ้าของพิมพ์ในกลุ่ม LINE'
    );
  end if;
  return v_result || jsonb_build_object('project_id',p_project_id);
end;
$function$;

revoke all on function public.owner_project_record_line_investment_v1(
  date,text,text,text,numeric,text,text,text,text,text,text,uuid
) from public, anon, authenticated;
grant execute on function public.owner_project_record_line_investment_v1(
  date,text,text,text,numeric,text,text,text,text,text,text,uuid
) to service_role;

-- END UPSTREAM supabase/migrations/20261007083000_owner_paid_expense_line_v1.sql:L1-L74

-- BEGIN UPSTREAM supabase/migrations/20261008070000_owner_paid_expense_continuation_v1.sql:L1-L101
-- Allow a later paid expense to attach to a completed project. Completion
-- stops open work; it does not make subsequent payment evidence disappear.
create or replace function public.owner_project_record_line_investment_v1(
  p_occurred_on date, p_business_unit_code text, p_title text, p_category text,
  p_amount numeric, p_payment_method text, p_vendor_name text, p_notes text,
  p_owner_group_hash text, p_source_message_id text, p_actor_hash text,
  p_project_id uuid
) returns jsonb language plpgsql security definer set search_path = '' as $function$
declare
  v_result jsonb;
  v_entry public.financial_investment_entries%rowtype;
begin
  if nullif(trim(coalesce(p_owner_group_hash,'')),'') is null
    or nullif(trim(coalesce(p_source_message_id,'')),'') is null then
    raise exception 'owner_line_group_and_message_required';
  end if;
  if p_project_id is not null and not exists (
    select 1 from public.owner_projects
    where id=p_project_id and owner_group_hash=trim(p_owner_group_hash)
      and status<>'cancelled'
      and (business_unit_code is null or business_unit_code=p_business_unit_code)
  ) then raise exception 'owner_project_group_or_business_mismatch'; end if;

  begin
    v_result:=public.financial_record_investment_v1(
      p_occurred_on,p_business_unit_code,p_title,p_category,p_amount,p_payment_method,
      p_vendor_name,p_notes,'line',p_owner_group_hash,p_source_message_id,p_actor_hash
    );
  exception when unique_violation then
    select * into v_entry from public.financial_investment_entries
    where source_channel='line' and source_message_id=trim(p_source_message_id);
    if v_entry.id is null then raise; end if;
    v_result:=jsonb_build_object('ok',true,'duplicate',true,'id',v_entry.id);
  end;

  select * into v_entry from public.financial_investment_entries
  where id=(v_result->>'id')::uuid for update;
  if v_entry.owner_group_hash is distinct from trim(p_owner_group_hash)
    or v_entry.business_unit_code is distinct from p_business_unit_code
    or v_entry.amount is distinct from p_amount
    or v_entry.title is distinct from left(trim(p_title),240)
    or v_entry.status='cancelled' then raise exception 'owner_line_message_conflict'; end if;
  if v_entry.owner_project_id is not null and v_entry.owner_project_id is distinct from p_project_id then
    raise exception 'owner_line_project_conflict';
  end if;
  if p_project_id is not null and v_entry.owner_project_id is null then
    perform public.owner_project_link_financial_v1(
      'investment_entry',v_entry.id,p_project_id,null,null,'line',p_actor_hash,
      'ผูกจากรายการจ่ายที่เจ้าของพิมพ์ในกลุ่ม LINE'
    );
  end if;
  return v_result || jsonb_build_object('project_id',p_project_id);
end;
$function$;

revoke all on function public.owner_project_record_line_investment_v1(
  date,text,text,text,numeric,text,text,text,text,text,text,uuid
) from public,anon,authenticated;
grant execute on function public.owner_project_record_line_investment_v1(
  date,text,text,text,numeric,text,text,text,text,text,text,uuid
) to service_role;

-- A one-word follow-up corrects the payment method of the same LINE record.
-- The ledger amount and original evidence are never reinserted or erased.
create or replace function public.owner_project_set_line_payment_method_v1(
  p_entry_id uuid, p_group_hash text, p_actor_hash text,
  p_method text, p_message_id text
) returns jsonb language plpgsql security definer set search_path = '' as $function$
declare
  v_entry public.financial_investment_entries%rowtype;
  v_before jsonb;
begin
  if p_method not in ('cash','transfer','card') then raise exception 'invalid_payment_method'; end if;
  if nullif(trim(coalesce(p_group_hash,'')),'') is null
    or nullif(trim(coalesce(p_actor_hash,'')),'') is null
    or nullif(trim(coalesce(p_message_id,'')),'') is null then
    raise exception 'owner_line_identity_required'; end if;
  select * into v_entry from public.financial_investment_entries
  where id=p_entry_id for update;
  if v_entry.id is null or v_entry.source_channel<>'line' or v_entry.status<>'recorded'
    or v_entry.owner_group_hash is distinct from trim(p_group_hash)
    or v_entry.source_user_hash is distinct from trim(p_actor_hash) then
    raise exception 'owner_line_entry_mismatch'; end if;
  if v_entry.payment_method=p_method then
    return jsonb_build_object('ok',true,'duplicate',true,'id',v_entry.id,'payment_method',p_method);
  end if;
  if v_entry.payment_method<>'other' then raise exception 'owner_line_payment_already_set'; end if;
  v_before:=to_jsonb(v_entry);
  update public.financial_investment_entries set payment_method=p_method,updated_at=now()
  where id=v_entry.id returning * into v_entry;
  insert into public.financial_investment_entry_audit_events(
    entry_id,action,source,actor_hash,message_id,before_data,after_data
  ) values (v_entry.id,'recorded','line',trim(p_actor_hash),trim(p_message_id),v_before,to_jsonb(v_entry));
  return jsonb_build_object('ok',true,'duplicate',false,'id',v_entry.id,'payment_method',p_method);
end;
$function$;

revoke all on function public.owner_project_set_line_payment_method_v1(uuid,text,text,text,text)
from public,anon,authenticated;
grant execute on function public.owner_project_set_line_payment_method_v1(uuid,text,text,text,text)
to service_role;

-- END UPSTREAM supabase/migrations/20261008070000_owner_paid_expense_continuation_v1.sql:L1-L101

-- BEGIN UPSTREAM supabase/migrations/20261011052544_owner_slip_review_v1.sql:L1-L203
-- Existing intake is an evidence inbox. Draft JSON never changes its financial allocation.
alter table public.financial_owner_expense_intakes
  add column review_state text check(review_state in ('draft','confirmed','cancelled')),
  add column review_revision integer not null default 0,
  add column review_data jsonb,
  add column review_message_id text;

create function public.financial_capture_owner_slip_review_v1(
  p_group_hash text,p_message_id text,p_user_hash text,p_occurred_on date,
  p_image_sha256 text,p_storage_bucket text,p_storage_path text,p_mime_type text,p_extraction jsonb
) returns jsonb language plpgsql security definer set search_path='' as $$
declare v_row public.financial_owner_expense_intakes%rowtype; v_result jsonb; v_ref text;
begin
  if nullif(trim(p_user_hash),'') is null then raise exception 'owner_actor_required'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_group_hash,117));
  v_ref:=nullif(lower(regexp_replace(coalesce(p_extraction->>'reference_number',''),'\s','','g')),'');
  select * into v_row from public.financial_owner_expense_intakes
  where owner_group_hash=p_group_hash and (
    evidence_message_id=p_message_id or evidence_sha256=p_image_sha256 or
    (v_ref is not null and lower(regexp_replace(reference_number,'\s','','g'))=v_ref))
  order by created_at limit 1;
  if v_row.id is not null then
    return jsonb_build_object('ok',true,'duplicate',true,'intake_id',v_row.id,'status',v_row.status);
  end if;
  v_result:=public.financial_capture_owner_expense_slip_v1(p_group_hash,p_message_id,p_user_hash,p_occurred_on,
    p_image_sha256,p_storage_bucket,p_storage_path,p_mime_type,p_extraction);
  if not coalesce((v_result->>'duplicate')::boolean,false) then
    -- Backoffice also aggregates raw intake rows (not only the summary view).
    -- Keep the read amount in extraction/review metadata until confirmation.
    update public.financial_owner_expense_intakes set review_state='draft',amount=null
    where id=(v_result->>'intake_id')::uuid;
  end if;
  return v_result;
end $$;

create function public.financial_stage_owner_slip_review_v1(
 p_intake_id uuid,p_group_hash text,p_actor_hash text,p_message_id text,p_revision integer,p_proposal jsonb
) returns jsonb language plpgsql security definer set search_path='' as $$
declare v_row public.financial_owner_expense_intakes%rowtype;
begin
  select * into v_row from public.financial_owner_expense_intakes where id=p_intake_id for update;
  if v_row.id is null or v_row.owner_group_hash is distinct from p_group_hash
    or nullif(trim(p_actor_hash),'') is null or v_row.source_user_hash is distinct from p_actor_hash
    or nullif(trim(p_message_id),'') is null then raise exception 'owner_review_identity_mismatch'; end if;
  if v_row.review_message_id=p_message_id or exists(
    select 1 from public.financial_owner_expense_audit_events
    where intake_id=p_intake_id and message_id=p_message_id and action='purpose_staged'
  ) then
    return jsonb_build_object('ok',true,'duplicate',true,'revision',v_row.review_revision,'proposal',v_row.review_data);
  end if;
  if v_row.review_state is distinct from 'draft' or v_row.review_revision is distinct from p_revision then
    return jsonb_build_object('conflict',true);
  end if;
  if jsonb_typeof(p_proposal)<>'object' or jsonb_typeof(p_proposal->'questions') is distinct from 'array'
    then raise exception 'invalid_review_proposal'; end if;
  update public.financial_owner_expense_intakes
  set review_data=p_proposal,review_revision=review_revision+1,review_message_id=p_message_id,updated_at=now()
  where id=p_intake_id;
  insert into public.financial_owner_expense_audit_events(intake_id,action,source,actor_hash,message_id,before_data,after_data)
  values(p_intake_id,'purpose_staged','line',p_actor_hash,p_message_id,
    jsonb_build_object('review',v_row.review_data,'revision',v_row.review_revision),
    jsonb_build_object('review',p_proposal,'revision',p_revision+1));
  return jsonb_build_object('ok',true,'revision',p_revision+1,'proposal',p_proposal);
end $$;

create function public.financial_confirm_owner_slip_review_v1(
 p_intake_id uuid,p_group_hash text,p_actor_hash text,p_revision integer,p_message_id text,p_cancel boolean
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
  v_row public.financial_owner_expense_intakes%rowtype;
  v_project public.owner_projects%rowtype;
  v_installment public.owner_project_installments%rowtype;
  v_data jsonb; v_project_id uuid; v_task_id uuid; v_installment_id uuid; v_amount numeric; v_date date; v_ref text;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_group_hash,117));
  select * into v_row from public.financial_owner_expense_intakes where id=p_intake_id for update;
  if v_row.id is null or v_row.owner_group_hash is distinct from p_group_hash
    or nullif(trim(p_actor_hash),'') is null or v_row.source_user_hash is distinct from p_actor_hash
    or nullif(trim(p_message_id),'') is null then raise exception 'owner_review_identity_mismatch'; end if;
  if v_row.review_state in ('confirmed','cancelled') then
    return jsonb_build_object('ok',true,'duplicate',true,'state',v_row.review_state);
  end if;
  if v_row.review_state is distinct from 'draft' or v_row.review_revision is distinct from p_revision then
    return jsonb_build_object('conflict',true);
  end if;
  if p_cancel is null then raise exception 'owner_review_action_required'; end if;
  if p_cancel then
    perform public.financial_mark_owner_expense_not_expense_v1(v_row.id,'Owner cancelled slip review',p_actor_hash,p_message_id);
    update public.financial_owner_expense_intakes set review_state='cancelled' where id=v_row.id;
    return jsonb_build_object('ok',true,'state','cancelled');
  end if;
  v_data:=v_row.review_data;
  if v_data is null or jsonb_typeof(v_data->'questions') is distinct from 'array'
    or jsonb_array_length(v_data->'questions')<>0
    or nullif(trim(v_data->>'purpose'),'') is null
    or coalesce(v_data->>'expense_class','') not in ('capital_investment','operating_expense')
    or coalesce(v_data->>'expense_category','other')='other'
    or coalesce(v_data->>'business_unit_code','other')='other'
    then raise exception 'owner_review_incomplete'; end if;
  v_amount:=(v_data->>'amount')::numeric;
  v_date:=(v_data->>'occurred_on')::date;
  if v_amount is null or v_amount<=0 or v_amount>100000000 or v_date is null then raise exception 'owner_review_amount_date_required'; end if;
  v_project_id:=(v_data->>'project_id')::uuid;
  v_task_id:=(v_data->>'task_id')::uuid;
  v_installment_id:=(v_data->>'installment_id')::uuid;
  if v_project_id is not null then
    select * into v_project from public.owner_projects where id=v_project_id for share;
    if v_project.id is null or v_project.owner_group_hash is distinct from p_group_hash or v_project.status='cancelled'
      or (v_project.business_unit_code is not null and v_project.business_unit_code is distinct from v_data->>'business_unit_code')
      then raise exception 'owner_review_project_changed'; end if;
  elsif v_installment_id is not null or v_task_id is not null then raise exception 'owner_review_project_required'; end if;
  if v_installment_id is not null then
    select * into v_installment from public.owner_project_installments where id=v_installment_id for update;
    if v_installment.id is null or v_installment.project_id is distinct from v_project_id
      or v_installment.task_id is distinct from v_task_id or v_installment.status in ('cancelled','paid')
      or (v_installment.amount is not null and v_installment.paid_amount+v_amount>v_installment.amount)
      then raise exception 'owner_review_installment_changed'; end if;
  end if;
  v_ref:=nullif(lower(regexp_replace(coalesce(v_row.reference_number,''),'\s','','g')),'');
  if exists(select 1 from public.financial_owner_expense_intakes i where i.id<>v_row.id
    and i.owner_group_hash=p_group_hash and i.status in ('categorized','needs_review')
    and (i.evidence_sha256=v_row.evidence_sha256 or
      (v_ref is not null and lower(regexp_replace(i.reference_number,'\s','','g'))=v_ref))) then
    return jsonb_build_object('duplicate_transaction',true);
  end if;
  -- This state change and all allocation/audit writes commit or roll back together.
  update public.financial_owner_expense_intakes set review_state='confirmed',amount=v_amount,occurred_on=v_date where id=v_row.id;
  perform public.financial_resolve_owner_expense_intake_v1(v_row.id,v_data->>'purpose',v_data->>'business_unit_code',
    v_data->>'expense_class',v_data->>'expense_category',v_data->>'expense_subcategory',0.95,p_actor_hash,p_message_id);
  update public.financial_owner_expense_intakes set classification_source='owner' where id=v_row.id;
  if v_project_id is not null then
    perform public.owner_project_link_financial_v1('owner_expense',v_row.id,v_project_id,v_task_id,v_installment_id,'line',p_actor_hash,'Owner confirmed slip summary');
  end if;
  if v_installment_id is not null then
    update public.owner_project_installments set paid_amount=paid_amount+v_amount,
      status=case when amount is not null and paid_amount+v_amount>=amount then 'paid' else 'due' end,
      paid_on=v_date,owner_expense_intake_id=v_row.id,updated_at=now() where id=v_installment_id;
    insert into public.owner_project_audit_events(entity_type,entity_id,action,source,actor_hash,before_data,after_data)
    select 'installment',id,'updated','line',p_actor_hash,to_jsonb(v_installment),to_jsonb(i) from public.owner_project_installments i where id=v_installment_id;
  end if;
  return jsonb_build_object('ok',true,'state','confirmed','intake_id',v_row.id);
end $$;

-- Fail closed if an older text/project route accidentally tries to allocate a new draft.
create function public.financial_guard_owner_slip_review_v1() returns trigger
language plpgsql set search_path='' as $$
begin
  if old.review_state='draft' and new.review_state='draft' and (
    new.status in ('categorized','needs_review') or new.amount is distinct from old.amount
    or new.owner_project_id is distinct from old.owner_project_id
    or new.owner_project_task_id is distinct from old.owner_project_task_id
    or new.owner_project_installment_id is distinct from old.owner_project_installment_id
    or new.business_unit_code is distinct from old.business_unit_code
  ) then raise exception 'owner_slip_confirmation_required'; end if;
  return new;
end $$;
create trigger financial_owner_slip_review_guard before update on public.financial_owner_expense_intakes
for each row execute function public.financial_guard_owner_slip_review_v1();

revoke all on function public.financial_capture_owner_slip_review_v1(text,text,text,date,text,text,text,text,jsonb) from public,anon,authenticated;
revoke all on function public.financial_stage_owner_slip_review_v1(uuid,text,text,text,integer,jsonb) from public,anon,authenticated;
revoke all on function public.financial_confirm_owner_slip_review_v1(uuid,text,text,integer,text,boolean) from public,anon,authenticated;
revoke all on function public.financial_guard_owner_slip_review_v1() from public,anon,authenticated;
grant execute on function public.financial_capture_owner_slip_review_v1(text,text,text,date,text,text,text,text,jsonb) to service_role;
grant execute on function public.financial_stage_owner_slip_review_v1(uuid,text,text,text,integer,jsonb) to service_role;
grant execute on function public.financial_confirm_owner_slip_review_v1(uuid,text,text,integer,text,boolean) to service_role;

-- Draft evidence remains visible in the inbox, but contributes no dashboard totals.
create or replace view public.financial_owner_expense_summary_v1 with (security_invoker=true) as
select date_trunc('month',occurred_on)::date as month_start,owner_group_hash,
 coalesce(business_unit_code,'other') as business_unit_code,
 coalesce(expense_class,'uncategorized') as expense_class,
 coalesce(expense_category,'other') as expense_category,
 count(*)::integer as item_count,coalesce(sum(amount),0)::numeric(16,2) as total_amount,
 count(*) filter(where status='categorized')::integer as categorized_count,
 count(*) filter(where status in ('awaiting_purpose','awaiting_business','needs_review'))::integer as attention_count
from public.financial_owner_expense_intakes
where status<>'cancelled' and (review_state is null or review_state='confirmed') group by 1,2,3,4,5;

-- Preserve the separate payroll flow for an upload with no business note yet.
-- This changes routing metadata only; it does not create a payroll event or expense.
create function public.financial_handoff_owner_slip_payroll_v1(
 p_intake_id uuid,p_group_hash text,p_actor_hash text,p_revision integer
) returns jsonb language plpgsql security definer set search_path='' as $$
declare v_row public.financial_owner_expense_intakes%rowtype;
begin
 select * into v_row from public.financial_owner_expense_intakes where id=p_intake_id for update;
 if v_row.id is null or v_row.owner_group_hash is distinct from p_group_hash
   or nullif(trim(p_actor_hash),'') is null or v_row.source_user_hash is distinct from p_actor_hash
   then raise exception 'owner_review_identity_mismatch'; end if;
 if v_row.review_state is distinct from 'draft' or v_row.review_revision is distinct from p_revision
   or nullif(trim(v_row.review_data->>'purpose'),'') is not null
   or v_row.review_data->>'project_id' is not null then return jsonb_build_object('conflict',true); end if;
 update public.financial_owner_expense_intakes set review_state=null,
   amount=coalesce((review_data->>'amount')::numeric,(extraction_data->>'amount_total')::numeric),
   updated_at=now() where id=p_intake_id;
 insert into public.financial_owner_expense_audit_events(intake_id,action,source,actor_hash,reason,before_data,after_data)
 values(p_intake_id,'purpose_staged','line',p_actor_hash,'Unclassified evidence handed to existing payroll conversation',
   jsonb_build_object('review_state','draft'),jsonb_build_object('review_state',null));
 return jsonb_build_object('ok',true);
end $$;
revoke all on function public.financial_handoff_owner_slip_payroll_v1(uuid,text,text,integer) from public,anon,authenticated;
grant execute on function public.financial_handoff_owner_slip_payroll_v1(uuid,text,text,integer) to service_role;

-- END UPSTREAM supabase/migrations/20261011052544_owner_slip_review_v1.sql:L1-L203

