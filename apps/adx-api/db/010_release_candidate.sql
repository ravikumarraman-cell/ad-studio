-- Stage 8: immutable, tenant-scoped release candidates and human release decisions.
CREATE TABLE IF NOT EXISTS adx_release_candidate (
  id uuid PRIMARY KEY, organization_id uuid NOT NULL, workspace_id uuid NOT NULL,
  change_case_id uuid NOT NULL REFERENCES adx_change_case(id), preview_plan_id uuid NOT NULL REFERENCES adx_git_preview_plan(id),
  candidate jsonb NOT NULL, provenance_digest text NOT NULL, artifact_digest text NOT NULL,
  candidate_digest text NOT NULL, evidence_digest text NOT NULL, commit_digest text NOT NULL,
  approval_digest text NOT NULL, policy_version text NOT NULL, status text NOT NULL CHECK (status IN ('CANDIDATE')),
  recorded_by text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id,workspace_id,id), UNIQUE (change_case_id,provenance_digest)
);
CREATE TABLE IF NOT EXISTS adx_release_decision (
  id uuid PRIMARY KEY, organization_id uuid NOT NULL, workspace_id uuid NOT NULL,
  release_candidate_id uuid NOT NULL REFERENCES adx_release_candidate(id), provenance_digest text NOT NULL,
  decision text NOT NULL CHECK (decision IN ('APPROVED','REJECTED')), rationale text NOT NULL, reviewed_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (release_candidate_id,reviewed_by,provenance_digest), UNIQUE (organization_id,workspace_id,id)
);
CREATE INDEX IF NOT EXISTS adx_release_candidate_case_idx ON adx_release_candidate (change_case_id,created_at DESC);
CREATE INDEX IF NOT EXISTS adx_release_decision_candidate_idx ON adx_release_decision (release_candidate_id,created_at DESC);
CREATE OR REPLACE FUNCTION adx_reject_release_candidate_mutation() RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'ADX_IMMUTABLE_RELEASE_CANDIDATE'; END; $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS adx_release_candidate_immutable ON adx_release_candidate;
CREATE TRIGGER adx_release_candidate_immutable BEFORE UPDATE OR DELETE ON adx_release_candidate FOR EACH ROW EXECUTE FUNCTION adx_reject_release_candidate_mutation();
CREATE OR REPLACE FUNCTION adx_reject_release_decision_mutation() RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'ADX_IMMUTABLE_RELEASE_DECISION'; END; $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS adx_release_decision_immutable ON adx_release_decision;
CREATE TRIGGER adx_release_decision_immutable BEFORE UPDATE OR DELETE ON adx_release_decision FOR EACH ROW EXECUTE FUNCTION adx_reject_release_decision_mutation();
ALTER TABLE adx_release_candidate ENABLE ROW LEVEL SECURITY; ALTER TABLE adx_release_candidate FORCE ROW LEVEL SECURITY;
ALTER TABLE adx_release_decision ENABLE ROW LEVEL SECURITY; ALTER TABLE adx_release_decision FORCE ROW LEVEL SECURITY;
DO $$ DECLARE table_name text; BEGIN FOREACH table_name IN ARRAY ARRAY['adx_release_candidate','adx_release_decision'] LOOP EXECUTE format('DROP POLICY IF EXISTS %I ON %I', table_name || '_tenant_isolation', table_name); EXECUTE format('CREATE POLICY %I ON %I USING (organization_id=current_setting(''adx.organization_id'',true)::uuid AND workspace_id=current_setting(''adx.workspace_id'',true)::uuid) WITH CHECK (organization_id=current_setting(''adx.organization_id'',true)::uuid AND workspace_id=current_setting(''adx.workspace_id'',true)::uuid)', table_name || '_tenant_isolation', table_name); END LOOP; END $$;
