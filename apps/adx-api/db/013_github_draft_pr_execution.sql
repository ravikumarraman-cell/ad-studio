-- Stage 11: durable record of a server-created, draft-only GitHub pull request.
CREATE TABLE IF NOT EXISTS adx_github_draft_pr_execution (
  id uuid PRIMARY KEY, organization_id uuid NOT NULL, workspace_id uuid NOT NULL,
  preview_plan_id uuid NOT NULL REFERENCES adx_git_preview_plan(id), commit_digest text NOT NULL,
  provider_id text NOT NULL, export_digest text NOT NULL, pull_request_number integer NOT NULL,
  pull_request_url text NOT NULL, pull_request_node_id text, recorded_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (preview_plan_id, commit_digest), UNIQUE (organization_id,workspace_id,id)
);
CREATE OR REPLACE FUNCTION adx_reject_github_draft_pr_execution_mutation() RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'ADX_IMMUTABLE_GITHUB_DRAFT_PR_EXECUTION'; END; $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS adx_github_draft_pr_execution_immutable ON adx_github_draft_pr_execution;
CREATE TRIGGER adx_github_draft_pr_execution_immutable BEFORE UPDATE OR DELETE ON adx_github_draft_pr_execution FOR EACH ROW EXECUTE FUNCTION adx_reject_github_draft_pr_execution_mutation();
ALTER TABLE adx_github_draft_pr_execution ENABLE ROW LEVEL SECURITY; ALTER TABLE adx_github_draft_pr_execution FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS adx_github_draft_pr_execution_tenant_isolation ON adx_github_draft_pr_execution;
CREATE POLICY adx_github_draft_pr_execution_tenant_isolation ON adx_github_draft_pr_execution USING (organization_id=current_setting('adx.organization_id',true)::uuid AND workspace_id=current_setting('adx.workspace_id',true)::uuid) WITH CHECK (organization_id=current_setting('adx.organization_id',true)::uuid AND workspace_id=current_setting('adx.workspace_id',true)::uuid);