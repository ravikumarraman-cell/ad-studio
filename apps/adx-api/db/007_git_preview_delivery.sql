-- Stage 7: immutable preview-only branch, commit, and pull-request delivery plans.
CREATE TABLE IF NOT EXISTS adx_git_preview_plan (
  id uuid PRIMARY KEY, organization_id uuid NOT NULL, workspace_id uuid NOT NULL,
  change_case_id uuid NOT NULL REFERENCES adx_change_case(id), plan jsonb NOT NULL,
  provider_id text NOT NULL, repository_id text NOT NULL, canonical_remote text NOT NULL,
  base_ref text NOT NULL, branch text NOT NULL, candidate_digest text NOT NULL,
  evidence_digest text NOT NULL, commit_digest text NOT NULL, pull_request_digest text NOT NULL,
  status text NOT NULL CHECK (status IN ('PREVIEWED')), recorded_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id,workspace_id,id), UNIQUE (change_case_id,pull_request_digest)
);
CREATE INDEX IF NOT EXISTS adx_git_preview_plan_case_idx ON adx_git_preview_plan (change_case_id,created_at DESC);
CREATE OR REPLACE FUNCTION adx_reject_git_preview_plan_mutation() RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'ADX_IMMUTABLE_GIT_PREVIEW_PLAN'; END; $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS adx_git_preview_plan_immutable ON adx_git_preview_plan;
CREATE TRIGGER adx_git_preview_plan_immutable BEFORE UPDATE OR DELETE ON adx_git_preview_plan FOR EACH ROW EXECUTE FUNCTION adx_reject_git_preview_plan_mutation();
ALTER TABLE adx_git_preview_plan ENABLE ROW LEVEL SECURITY; ALTER TABLE adx_git_preview_plan FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS adx_git_preview_plan_tenant_isolation ON adx_git_preview_plan;
CREATE POLICY adx_git_preview_plan_tenant_isolation ON adx_git_preview_plan USING (organization_id=current_setting('adx.organization_id',true)::uuid AND workspace_id=current_setting('adx.workspace_id',true)::uuid) WITH CHECK (organization_id=current_setting('adx.organization_id',true)::uuid AND workspace_id=current_setting('adx.workspace_id',true)::uuid);
