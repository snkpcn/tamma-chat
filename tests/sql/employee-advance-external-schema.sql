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

