-- Stage 9: immutable, tenant-scoped outcome records and redacted evaluation rows.
CREATE TABLE IF NOT EXISTS adx_outcome_record (
  id uuid PRIMARY KEY, organization_id uuid NOT NULL, workspace_id uuid NOT NULL,
  change_case_id uuid NOT NULL REFERENCES adx_change_case(id), release_candidate_id text NOT NULL,
  outcome jsonb NOT NULL, outcome_digest text NOT NULL, outcome_type text NOT NULL CHECK (outcome_type IN ('SUCCESS','FAILURE','ROLLED_BACK')),
  taxonomy text NOT NULL, recorded_by text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id,workspace_id,id), UNIQUE (change_case_id,outcome_digest)
);
CREATE TABLE IF NOT EXISTS adx_outcome_evaluation_export (
  id uuid PRIMARY KEY, organization_id uuid NOT NULL, workspace_id uuid NOT NULL,
  outcome_record_id uuid NOT NULL REFERENCES adx_outcome_record(id), evaluation_version text NOT NULL,
  payload jsonb NOT NULL, export_digest text NOT NULL, exported_by text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (outcome_record_id,evaluation_version,export_digest), UNIQUE (organization_id,workspace_id,id)
);
CREATE INDEX IF NOT EXISTS adx_outcome_record_case_idx ON adx_outcome_record (change_case_id,created_at DESC);
CREATE OR REPLACE FUNCTION adx_reject_outcome_record_mutation() RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'ADX_IMMUTABLE_OUTCOME_RECORD'; END; $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS adx_outcome_record_immutable ON adx_outcome_record;
CREATE TRIGGER adx_outcome_record_immutable BEFORE UPDATE OR DELETE ON adx_outcome_record FOR EACH ROW EXECUTE FUNCTION adx_reject_outcome_record_mutation();
CREATE OR REPLACE FUNCTION adx_reject_outcome_export_mutation() RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'ADX_IMMUTABLE_OUTCOME_EVALUATION_EXPORT'; END; $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS adx_outcome_evaluation_export_immutable ON adx_outcome_evaluation_export;
CREATE TRIGGER adx_outcome_evaluation_export_immutable BEFORE UPDATE OR DELETE ON adx_outcome_evaluation_export FOR EACH ROW EXECUTE FUNCTION adx_reject_outcome_export_mutation();
ALTER TABLE adx_outcome_record ENABLE ROW LEVEL SECURITY; ALTER TABLE adx_outcome_record FORCE ROW LEVEL SECURITY;
ALTER TABLE adx_outcome_evaluation_export ENABLE ROW LEVEL SECURITY; ALTER TABLE adx_outcome_evaluation_export FORCE ROW LEVEL SECURITY;
DO $$ DECLARE table_name text; BEGIN FOREACH table_name IN ARRAY ARRAY['adx_outcome_record','adx_outcome_evaluation_export'] LOOP EXECUTE format('DROP POLICY IF EXISTS %I ON %I', table_name || '_tenant_isolation', table_name); EXECUTE format('CREATE POLICY %I ON %I USING (organization_id=current_setting(''adx.organization_id'',true)::uuid AND workspace_id=current_setting(''adx.workspace_id'',true)::uuid) WITH CHECK (organization_id=current_setting(''adx.organization_id'',true)::uuid AND workspace_id=current_setting(''adx.workspace_id'',true)::uuid)', table_name || '_tenant_isolation', table_name); END LOOP; END $$;
