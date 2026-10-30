BEGIN;
CREATE TABLE IF NOT EXISTS sync_accounts(id uuid PRIMARY KEY,issuer text NOT NULL,subject text NOT NULL,head_revision bigint NOT NULL DEFAULT 0,UNIQUE(issuer,subject));
CREATE TABLE IF NOT EXISTS sync_entities(account_id uuid NOT NULL REFERENCES sync_accounts(id),entity_type text NOT NULL,entity_id text NOT NULL,payload jsonb NOT NULL,deleted boolean NOT NULL DEFAULT false,revision bigint NOT NULL,PRIMARY KEY(account_id,entity_type,entity_id));
CREATE TABLE IF NOT EXISTS sync_changes(account_id uuid NOT NULL REFERENCES sync_accounts(id),revision bigint NOT NULL,operation_id uuid NOT NULL,changes jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(account_id,revision));
CREATE TABLE IF NOT EXISTS sync_receipts(account_id uuid NOT NULL REFERENCES sync_accounts(id),operation_id uuid NOT NULL,request_hash text NOT NULL,result jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(account_id,operation_id));
CREATE TABLE IF NOT EXISTS sync_conflicts(id uuid PRIMARY KEY,account_id uuid NOT NULL REFERENCES sync_accounts(id),operation_id uuid NOT NULL,detail jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS sync_assets(account_id uuid NOT NULL REFERENCES sync_accounts(id),sha256 text NOT NULL,media_type text NOT NULL,body bytea NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(account_id,sha256));
CREATE INDEX IF NOT EXISTS sync_entity_revision ON sync_entities(account_id,revision);
DO $$
DECLARE relation text;
BEGIN
 FOREACH relation IN ARRAY ARRAY['sync_accounts','sync_entities','sync_changes','sync_receipts','sync_conflicts','sync_assets'] LOOP
  EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',relation);
  EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',relation);
  IF NOT EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename=relation AND policyname='account_isolation') THEN
   EXECUTE format('CREATE POLICY account_isolation ON %I USING (%I = nullif(current_setting(''app.account_id'', true), '''')::uuid) WITH CHECK (%I = nullif(current_setting(''app.account_id'', true), '''')::uuid)',relation,CASE WHEN relation='sync_accounts' THEN 'id' ELSE 'account_id' END,CASE WHEN relation='sync_accounts' THEN 'id' ELSE 'account_id' END);
  END IF;
 END LOOP;
END $$;
COMMIT;
