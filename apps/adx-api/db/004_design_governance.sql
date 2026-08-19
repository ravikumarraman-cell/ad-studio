-- Stage 4: immutable design package, bounded exceptions, and digest-bound design approval.
CREATE TABLE IF NOT EXISTS adx_design_package (
  id uuid PRIMARY KEY, organization_id uuid NOT NULL, workspace_id uuid NOT NULL, change_case_id uuid NOT NULL REFERENCES adx_change_case(id),
  revision integer NOT NULL, artifacts jsonb NOT NULL, design_digest text NOT NULL, authored_by text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (change_case_id, revision), UNIQUE (change_case_id, design_digest)
);
CREATE TABLE IF NOT EXISTS adx_design_exception (
  id uuid PRIMARY KEY, organization_id uuid NOT NULL, workspace_id uuid NOT NULL, change_case_id uuid NOT NULL REFERENCES adx_change_case(id),
  design_digest text NOT NULL, reason text NOT NULL, expires_at timestamptz NOT NULL, requested_by text NOT NULL, status text NOT NULL CHECK (status IN ('ACTIVE','EXPIRED','SUPERSEDED')), created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS adx_design_approval (
  id uuid PRIMARY KEY, organization_id uuid NOT NULL, workspace_id uuid NOT NULL, change_case_id uuid NOT NULL REFERENCES adx_change_case(id),
  design_digest text NOT NULL, decision text NOT NULL CHECK (decision IN ('APPROVED','REJECTED')), rationale text NOT NULL, reviewed_by text NOT NULL, status text NOT NULL CHECK (status IN ('ACTIVE','INVALIDATED')), created_at timestamptz NOT NULL DEFAULT now(), invalidated_at timestamptz
);
CREATE INDEX IF NOT EXISTS adx_design_approval_active_idx ON adx_design_approval (change_case_id, design_digest) WHERE status='ACTIVE';
ALTER TABLE adx_design_package ENABLE ROW LEVEL SECURITY; ALTER TABLE adx_design_package FORCE ROW LEVEL SECURITY;
ALTER TABLE adx_design_exception ENABLE ROW LEVEL SECURITY; ALTER TABLE adx_design_exception FORCE ROW LEVEL SECURITY;
ALTER TABLE adx_design_approval ENABLE ROW LEVEL SECURITY; ALTER TABLE adx_design_approval FORCE ROW LEVEL SECURITY;
DO $$ DECLARE table_name text; BEGIN FOREACH table_name IN ARRAY ARRAY['adx_design_package','adx_design_exception','adx_design_approval'] LOOP EXECUTE format('DROP POLICY IF EXISTS %I ON %I', table_name || '_tenant_isolation', table_name); EXECUTE format('CREATE POLICY %I ON %I USING (organization_id = current_setting(''adx.organization_id'', true)::uuid AND workspace_id = current_setting(''adx.workspace_id'', true)::uuid) WITH CHECK (organization_id = current_setting(''adx.organization_id'', true)::uuid AND workspace_id = current_setting(''adx.workspace_id'', true)::uuid)', table_name || '_tenant_isolation', table_name); END LOOP; END $$;
