-- Stage 13: retain the GitHub milestone that supplied an imported feature.
CREATE TABLE IF NOT EXISTS adx_github_source_milestone (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL,
  workspace_id uuid NOT NULL,
  change_case_id uuid NOT NULL REFERENCES adx_change_case(id),
  owner text NOT NULL,
  repository text NOT NULL,
  milestone_number integer NOT NULL,
  milestone_title text NOT NULL,
  source_digest text NOT NULL,
  recorded_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (change_case_id),
  UNIQUE (organization_id, workspace_id, id)
);

ALTER TABLE adx_github_milestone_story_sync ADD COLUMN IF NOT EXISTS source_milestone jsonb;
ALTER TABLE adx_github_milestone_story_sync ADD COLUMN IF NOT EXISTS destination_override jsonb;

ALTER TABLE adx_github_source_milestone ENABLE ROW LEVEL SECURITY;
ALTER TABLE adx_github_source_milestone FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS adx_github_source_milestone_tenant_isolation ON adx_github_source_milestone;
CREATE POLICY adx_github_source_milestone_tenant_isolation ON adx_github_source_milestone
  USING (organization_id=current_setting('adx.organization_id',true)::uuid AND workspace_id=current_setting('adx.workspace_id',true)::uuid)
  WITH CHECK (organization_id=current_setting('adx.organization_id',true)::uuid AND workspace_id=current_setting('adx.workspace_id',true)::uuid);
