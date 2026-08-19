-- Stage 6: immutable, tenant-scoped independent-verification evidence and artifact bindings.
CREATE TABLE IF NOT EXISTS adx_evidence_bundle (
  id uuid PRIMARY KEY, organization_id uuid NOT NULL, workspace_id uuid NOT NULL,
  change_case_id uuid NOT NULL REFERENCES adx_change_case(id), evidence jsonb NOT NULL,
  evidence_digest text NOT NULL, verifier_id text NOT NULL, verifier_version text NOT NULL,
  status text NOT NULL CHECK (status IN ('PASS','FAIL')), candidate_digest text NOT NULL,
  runtime_image_digest text NOT NULL, config_digest text NOT NULL, command_digest text NOT NULL,
  signature text NOT NULL, signature_key_id text NOT NULL, recorded_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, workspace_id, id), UNIQUE (change_case_id, evidence_digest)
);
CREATE TABLE IF NOT EXISTS adx_evidence_artifact (
  id uuid PRIMARY KEY, organization_id uuid NOT NULL, workspace_id uuid NOT NULL,
  evidence_id uuid NOT NULL REFERENCES adx_evidence_bundle(id), artifact_digest text NOT NULL,
  object_key text NOT NULL, media_type text NOT NULL, byte_length bigint NOT NULL CHECK (byte_length >= 0), metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, workspace_id, id), UNIQUE (evidence_id, artifact_digest)
);
CREATE INDEX IF NOT EXISTS adx_evidence_bundle_case_idx ON adx_evidence_bundle (change_case_id, created_at DESC);
CREATE INDEX IF NOT EXISTS adx_evidence_artifact_evidence_idx ON adx_evidence_artifact (evidence_id, created_at);
CREATE OR REPLACE FUNCTION adx_reject_evidence_bundle_mutation() RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'ADX_IMMUTABLE_EVIDENCE_BUNDLE'; END; $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS adx_evidence_bundle_immutable ON adx_evidence_bundle;
CREATE TRIGGER adx_evidence_bundle_immutable BEFORE UPDATE OR DELETE ON adx_evidence_bundle FOR EACH ROW EXECUTE FUNCTION adx_reject_evidence_bundle_mutation();
CREATE OR REPLACE FUNCTION adx_reject_evidence_artifact_mutation() RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'ADX_IMMUTABLE_EVIDENCE_ARTIFACT'; END; $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS adx_evidence_artifact_immutable ON adx_evidence_artifact;
CREATE TRIGGER adx_evidence_artifact_immutable BEFORE UPDATE OR DELETE ON adx_evidence_artifact FOR EACH ROW EXECUTE FUNCTION adx_reject_evidence_artifact_mutation();
ALTER TABLE adx_evidence_bundle ENABLE ROW LEVEL SECURITY; ALTER TABLE adx_evidence_bundle FORCE ROW LEVEL SECURITY;
ALTER TABLE adx_evidence_artifact ENABLE ROW LEVEL SECURITY; ALTER TABLE adx_evidence_artifact FORCE ROW LEVEL SECURITY;
DO $$ DECLARE table_name text; BEGIN FOREACH table_name IN ARRAY ARRAY['adx_evidence_bundle','adx_evidence_artifact'] LOOP EXECUTE format('DROP POLICY IF EXISTS %I ON %I', table_name || '_tenant_isolation', table_name); EXECUTE format('CREATE POLICY %I ON %I USING (organization_id = current_setting(''adx.organization_id'', true)::uuid AND workspace_id = current_setting(''adx.workspace_id'', true)::uuid) WITH CHECK (organization_id = current_setting(''adx.organization_id'', true)::uuid AND workspace_id = current_setting(''adx.workspace_id'', true)::uuid)', table_name || '_tenant_isolation', table_name); END LOOP; END $$;
