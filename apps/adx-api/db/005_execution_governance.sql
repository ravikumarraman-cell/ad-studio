-- Stage 5: tenant-scoped execution leases, runs, revocations, and gateway receipts.
CREATE TABLE IF NOT EXISTS adx_execution_lease (
  id uuid PRIMARY KEY, organization_id uuid NOT NULL, workspace_id uuid NOT NULL,
  change_case_id uuid NOT NULL REFERENCES adx_change_case(id), lease jsonb NOT NULL,
  lease_digest text NOT NULL, signature text NOT NULL, signature_key_id text NOT NULL,
  status text NOT NULL CHECK (status IN ('ACTIVE','REVOKED','EXPIRED')), issued_by text NOT NULL,
  issued_at timestamptz NOT NULL, expires_at timestamptz NOT NULL, tool_calls integer NOT NULL DEFAULT 0 CHECK (tool_calls >= 0), network_bytes bigint NOT NULL DEFAULT 0 CHECK (network_bytes >= 0), cost_usd numeric(12,4) NOT NULL DEFAULT 0 CHECK (cost_usd >= 0), revoked_at timestamptz, revoked_by text, revoke_reason text,
  UNIQUE (organization_id, workspace_id, id), UNIQUE (change_case_id, lease_digest)
);
CREATE TABLE IF NOT EXISTS adx_agent_run (
  id uuid PRIMARY KEY, organization_id uuid NOT NULL, workspace_id uuid NOT NULL,
  change_case_id uuid NOT NULL REFERENCES adx_change_case(id), lease_id uuid NOT NULL REFERENCES adx_execution_lease(id),
  adapter_id text NOT NULL, adapter_version text NOT NULL, status text NOT NULL CHECK (status IN ('LEASED','RUNNING','CANCELLED','FAILED','COMPLETED')),
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, workspace_id, id)
);
CREATE TABLE IF NOT EXISTS adx_agent_run_event (
  id uuid PRIMARY KEY, organization_id uuid NOT NULL, workspace_id uuid NOT NULL,
  run_id uuid NOT NULL REFERENCES adx_agent_run(id), sequence integer NOT NULL CHECK (sequence > 0), event_type text NOT NULL,
  payload jsonb NOT NULL, payload_digest text NOT NULL, previous_event_digest text, event_digest text NOT NULL, occurred_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (run_id, sequence), UNIQUE (run_id, event_digest)
);
CREATE TABLE IF NOT EXISTS adx_gateway_receipt (
  id uuid PRIMARY KEY, organization_id uuid NOT NULL, workspace_id uuid NOT NULL,
  lease_id uuid NOT NULL REFERENCES adx_execution_lease(id), run_id uuid REFERENCES adx_agent_run(id), action text NOT NULL,
  allowed boolean NOT NULL, request_digest text NOT NULL, receipt jsonb NOT NULL, receipt_digest text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, workspace_id, id), UNIQUE (lease_id, request_digest)
);
CREATE INDEX IF NOT EXISTS adx_execution_lease_case_idx ON adx_execution_lease (change_case_id, issued_at DESC);
CREATE INDEX IF NOT EXISTS adx_agent_run_case_idx ON adx_agent_run (change_case_id, created_at DESC);
CREATE INDEX IF NOT EXISTS adx_gateway_receipt_lease_idx ON adx_gateway_receipt (lease_id, created_at);
ALTER TABLE adx_execution_lease ADD COLUMN IF NOT EXISTS tool_calls integer NOT NULL DEFAULT 0 CHECK (tool_calls >= 0);
ALTER TABLE adx_execution_lease ADD COLUMN IF NOT EXISTS network_bytes bigint NOT NULL DEFAULT 0 CHECK (network_bytes >= 0);
ALTER TABLE adx_execution_lease ADD COLUMN IF NOT EXISTS cost_usd numeric(12,4) NOT NULL DEFAULT 0 CHECK (cost_usd >= 0);
CREATE OR REPLACE FUNCTION adx_reject_agent_run_event_mutation() RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'ADX_APPEND_ONLY_AGENT_RUN_EVENT'; END; $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS adx_agent_run_event_append_only ON adx_agent_run_event;
CREATE TRIGGER adx_agent_run_event_append_only BEFORE UPDATE OR DELETE ON adx_agent_run_event FOR EACH ROW EXECUTE FUNCTION adx_reject_agent_run_event_mutation();
CREATE OR REPLACE FUNCTION adx_reject_gateway_receipt_mutation() RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'ADX_IMMUTABLE_GATEWAY_RECEIPT'; END; $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS adx_gateway_receipt_immutable ON adx_gateway_receipt;
CREATE TRIGGER adx_gateway_receipt_immutable BEFORE UPDATE OR DELETE ON adx_gateway_receipt FOR EACH ROW EXECUTE FUNCTION adx_reject_gateway_receipt_mutation();
ALTER TABLE adx_execution_lease ENABLE ROW LEVEL SECURITY; ALTER TABLE adx_execution_lease FORCE ROW LEVEL SECURITY;
ALTER TABLE adx_agent_run ENABLE ROW LEVEL SECURITY; ALTER TABLE adx_agent_run FORCE ROW LEVEL SECURITY;
ALTER TABLE adx_agent_run_event ENABLE ROW LEVEL SECURITY; ALTER TABLE adx_agent_run_event FORCE ROW LEVEL SECURITY;
ALTER TABLE adx_gateway_receipt ENABLE ROW LEVEL SECURITY; ALTER TABLE adx_gateway_receipt FORCE ROW LEVEL SECURITY;
DO $$ DECLARE table_name text; BEGIN FOREACH table_name IN ARRAY ARRAY['adx_execution_lease','adx_agent_run','adx_agent_run_event','adx_gateway_receipt'] LOOP EXECUTE format('DROP POLICY IF EXISTS %I ON %I', table_name || '_tenant_isolation', table_name); EXECUTE format('CREATE POLICY %I ON %I USING (organization_id = current_setting(''adx.organization_id'', true)::uuid AND workspace_id = current_setting(''adx.workspace_id'', true)::uuid) WITH CHECK (organization_id = current_setting(''adx.organization_id'', true)::uuid AND workspace_id = current_setting(''adx.workspace_id'', true)::uuid)', table_name || '_tenant_isolation', table_name); END LOOP; END $$;
