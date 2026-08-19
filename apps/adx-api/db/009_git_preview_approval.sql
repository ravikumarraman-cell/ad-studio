-- Stage 7: commit-bound review approval for preview delivery plans.
CREATE TABLE IF NOT EXISTS adx_git_preview_approval (
  id uuid PRIMARY KEY, organization_id uuid NOT NULL, workspace_id uuid NOT NULL,
  preview_plan_id uuid NOT NULL REFERENCES adx_git_preview_plan(id), commit_digest text NOT NULL,
  decision text NOT NULL CHECK (decision IN ('APPROVED','REJECTED')), rationale text NOT NULL,
  reviewed_by text NOT NULL, status text NOT NULL CHECK (status IN ('ACTIVE','INVALIDATED')),
  invalidated_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (preview_plan_id,reviewed_by,commit_digest), UNIQUE (organization_id,workspace_id,id)
);
CREATE INDEX IF NOT EXISTS adx_git_preview_approval_plan_idx ON adx_git_preview_approval (preview_plan_id,created_at DESC);
CREATE OR REPLACE FUNCTION adx_reject_git_preview_approval_delete() RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'ADX_IMMUTABLE_GIT_PREVIEW_APPROVAL'; END; $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS adx_git_preview_approval_no_delete ON adx_git_preview_approval; CREATE TRIGGER adx_git_preview_approval_no_delete BEFORE DELETE ON adx_git_preview_approval FOR EACH ROW EXECUTE FUNCTION adx_reject_git_preview_approval_delete();
ALTER TABLE adx_git_preview_approval ENABLE ROW LEVEL SECURITY; ALTER TABLE adx_git_preview_approval FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS adx_git_preview_approval_tenant_isolation ON adx_git_preview_approval;
CREATE POLICY adx_git_preview_approval_tenant_isolation ON adx_git_preview_approval USING (organization_id=current_setting('adx.organization_id',true)::uuid AND workspace_id=current_setting('adx.workspace_id',true)::uuid) WITH CHECK (organization_id=current_setting('adx.organization_id',true)::uuid AND workspace_id=current_setting('adx.workspace_id',true)::uuid);
