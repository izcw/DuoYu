-- PostgreSQL schema proposal. Run only in the dedicated business database.
-- Runtime role and grants must be provisioned separately; no secrets here.
BEGIN;
CREATE SCHEMA IF NOT EXISTS duoyu_sync;

CREATE TABLE duoyu_sync.accounts (
  id uuid PRIMARY KEY,
  issuer text NOT NULL,
  subject text NOT NULL,
  head_revision bigint NOT NULL DEFAULT 0 CHECK (head_revision >= 0),
  min_retained_revision bigint NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (issuer, subject),
  CHECK (min_retained_revision BETWEEN 0 AND head_revision)
);

CREATE TABLE duoyu_sync.entities (
  account_id uuid NOT NULL REFERENCES duoyu_sync.accounts(id),
  entity_type text NOT NULL CHECK (entity_type IN (
    'page', 'item', 'space', 'collection', 'saved_tab', 'shortcut', 'preference'
  )),
  entity_id text NOT NULL CHECK (length(entity_id) BETWEEN 1 AND 200),
  revision bigint NOT NULL CHECK (revision > 0),
  payload jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
  deleted_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (account_id, entity_type, entity_id)
);
CREATE INDEX entities_revision ON duoyu_sync.entities(account_id, revision);

-- Account row lock MUST be held before allocating the next revision.
-- One complete operation per row: pagination must never split a layout batch.
CREATE TABLE duoyu_sync.changes (
  account_id uuid NOT NULL REFERENCES duoyu_sync.accounts(id),
  revision bigint NOT NULL CHECK (revision > 0),
  operation_id uuid NOT NULL,
  changes jsonb NOT NULL CHECK (jsonb_typeof(changes) = 'array'),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (account_id, revision),
  UNIQUE (account_id, operation_id)
);

-- Keep receipts independently of changes retention for safe uncertain retries.
CREATE TABLE duoyu_sync.operation_receipts (
  account_id uuid NOT NULL REFERENCES duoyu_sync.accounts(id),
  operation_id uuid NOT NULL,
  device_id uuid NOT NULL,
  request_hash text NOT NULL CHECK (request_hash ~ '^[0-9a-f]{64}$'),
  result jsonb NOT NULL CHECK (jsonb_typeof(result) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (account_id, operation_id)
);

CREATE TABLE duoyu_sync.devices (
  account_id uuid NOT NULL REFERENCES duoyu_sync.accounts(id),
  device_id uuid NOT NULL,
  acknowledged_revision bigint NOT NULL DEFAULT 0 CHECK (acknowledged_revision >= 0),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (account_id, device_id)
);

CREATE TABLE duoyu_sync.conflicts (
  id uuid PRIMARY KEY,
  account_id uuid NOT NULL REFERENCES duoyu_sync.accounts(id),
  operation_id uuid NOT NULL,
  entity_type text NOT NULL,
  entity_id text NOT NULL,
  base_payload jsonb NOT NULL,
  local_patch jsonb NOT NULL,
  remote_payload jsonb NOT NULL,
  resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX conflicts_by_account ON duoyu_sync.conflicts(account_id, created_at);

CREATE TABLE duoyu_sync.assets (
  account_id uuid NOT NULL REFERENCES duoyu_sync.accounts(id),
  sha256 text NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  media_type text NOT NULL,
  byte_size bigint NOT NULL CHECK (byte_size > 0),
  storage_key text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (account_id, sha256)
);

-- Deny access without transaction-local app.account_id.
-- Runtime must not be a superuser, table owner, or hold BYPASSRLS.
DO $$
DECLARE relation text;
BEGIN
  FOREACH relation IN ARRAY ARRAY['entities','changes','operation_receipts','devices','conflicts','assets'] LOOP
    EXECUTE format('ALTER TABLE duoyu_sync.%I ENABLE ROW LEVEL SECURITY', relation);
    EXECUTE format('ALTER TABLE duoyu_sync.%I FORCE ROW LEVEL SECURITY', relation);
    EXECUTE format(
      'CREATE POLICY account_isolation ON duoyu_sync.%I USING (account_id = nullif(current_setting(''app.account_id'', true), '''')::uuid) WITH CHECK (account_id = nullif(current_setting(''app.account_id'', true), '''')::uuid)', relation
    );
  END LOOP;
END $$;
ALTER TABLE duoyu_sync.accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE duoyu_sync.accounts FORCE ROW LEVEL SECURITY;
CREATE POLICY account_isolation ON duoyu_sync.accounts
  USING (id = nullif(current_setting('app.account_id', true), '')::uuid)
  WITH CHECK (id = nullif(current_setting('app.account_id', true), '')::uuid);
-- Account bootstrap needs a separate tightly scoped trusted path after OIDC
-- validation; do not grant unrestricted account discovery to the runtime role.
COMMIT;
