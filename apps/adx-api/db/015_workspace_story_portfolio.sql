CREATE TABLE IF NOT EXISTS adx_workspace_story_portfolio (
  id uuid PRIMARY KEY, organization_id uuid NOT NULL, workspace_id uuid NOT NULL,
  portfolio_digest text NOT NULL, entries jsonb NOT NULL, planned_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(), UNIQUE (organization_id, workspace_id, portfolio_digest)
);
ALTER TABLE adx_workspace_story_portfolio ADD COLUMN IF NOT EXISTS publication_override jsonb;
ALTER TABLE adx_workspace_story_portfolio ENABLE ROW LEVEL SECURITY; ALTER TABLE adx_workspace_story_portfolio FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS adx_workspace_story_portfolio_tenant_isolation ON adx_workspace_story_portfolio;
CREATE POLICY adx_workspace_story_portfolio_tenant_isolation ON adx_workspace_story_portfolio USING (organization_id=current_setting('adx.organization_id',true)::uuid AND workspace_id=current_setting('adx.workspace_id',true)::uuid) WITH CHECK (organization_id=current_setting('adx.organization_id',true)::uuid AND workspace_id=current_setting('adx.workspace_id',true)::uuid);
