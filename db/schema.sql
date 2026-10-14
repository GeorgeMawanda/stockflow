-- All money is stored as integer UGX (no decimals). Every table is scoped by tenant_id.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS tenants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  district text,
  business_phone text,
  logo_data bytea,
  logo_type text,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS district text;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS business_phone text;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS logo_data bytea;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS logo_type text;
CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants ON DELETE CASCADE,
  email text NOT NULL UNIQUE,
  pass_hash text NOT NULL,
  role text NOT NULL DEFAULT 'owner' CHECK (role IN ('owner','staff')),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants ON DELETE CASCADE,
  name text NOT NULL,
  qty integer NOT NULL DEFAULT 0 CHECK (qty >= 0),
  cost bigint NOT NULL DEFAULT 0 CHECK (cost >= 0),
  price bigint NOT NULL DEFAULT 0 CHECK (price >= 0),
  min_qty integer NOT NULL DEFAULT 5,
  photo_data bytea,
  photo_type text,
  UNIQUE (tenant_id, name)
);
ALTER TABLE items ADD COLUMN IF NOT EXISTS photo_data bytea;
ALTER TABLE items ADD COLUMN IF NOT EXISTS photo_type text;
CREATE TABLE IF NOT EXISTS customers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants ON DELETE CASCADE,
  name text NOT NULL,
  phone text
);
CREATE UNIQUE INDEX IF NOT EXISTS customers_phone_uq ON customers (tenant_id, phone) WHERE phone IS NOT NULL;
CREATE TABLE IF NOT EXISTS sales (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants ON DELETE CASCADE,
  customer_id uuid REFERENCES customers,
  total bigint NOT NULL CHECK (total >= 0),
  created_by uuid REFERENCES users,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sales_tenant_idx ON sales (tenant_id, created_at DESC);
CREATE TABLE IF NOT EXISTS sale_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sale_id uuid NOT NULL REFERENCES sales ON DELETE CASCADE,
  item_id uuid NOT NULL REFERENCES items,
  name text NOT NULL,
  qty integer NOT NULL CHECK (qty > 0),
  price bigint NOT NULL,
  cost bigint NOT NULL
);
CREATE TABLE IF NOT EXISTS payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants ON DELETE CASCADE,
  sale_id uuid NOT NULL REFERENCES sales ON DELETE CASCADE,
  amount bigint NOT NULL CHECK (amount > 0),
  method text NOT NULL CHECK (method IN ('cash','mtn_momo','airtel_money')),
  ref text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS payments_sale_idx ON payments (sale_id);
CREATE UNIQUE INDEX IF NOT EXISTS payments_ref_uq ON payments (tenant_id, ref, sale_id) WHERE ref IS NOT NULL;

-- Subscription billing
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS plan text;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS trial_ends_at timestamptz DEFAULT now() + interval '14 days';
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS paid_until timestamptz;
CREATE TABLE IF NOT EXISTS billing_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  flw_id bigint NOT NULL UNIQUE,            -- Flutterwave transaction id: makes webhooks idempotent
  tenant_id uuid NOT NULL REFERENCES tenants ON DELETE CASCADE,
  plan text NOT NULL,
  amount bigint NOT NULL,
  tx_ref text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- SMS reminders
CREATE TABLE IF NOT EXISTS reminder_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants ON DELETE CASCADE,
  customer_id uuid NOT NULL REFERENCES customers ON DELETE CASCADE,
  status text NOT NULL CHECK (status IN ('sent','failed')),
  sent_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS reminder_log_customer_idx ON reminder_log (customer_id, sent_at DESC);
