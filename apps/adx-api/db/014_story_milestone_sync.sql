-- Stage 12: immutable ranked-story plans and GitHub milestone publication receipts.
CREATE TABLE IF NOT EXISTS adx_story_priority_plan (
  id uuid PRIMARY KEY, organization_id uuid NOT NULL, workspace_id uuid NOT NULL,
  change_case_id uuid NOT NULL REFERENCES adx_change_case(id), story_digest text NOT NULL,
  plan_digest text NOT NULL, priorities jsonb NOT NULL, planned_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (change_case_id, story_digest, plan_digest), UNIQUE (organization_id, workspace_id, id)
);
CREATE TABLE IF NOT EXISTS adx_github_milestone_story_sync (
  id uuid PRIMARY KEY, organization_id uuid NOT NULL, workspace_id uuid NOT NULL,
  change_case_id uuid NOT NULL REFERENCES adx_change_case(id), story_digest text NOT NULL,
  story_key text NOT NULL, priority integer NOT NULL, owner text NOT NULL, repository text NOT NULL,
  milestone_number integer NOT NULL, issue_number integer NOT NULL, issue_url text NOT NULL,
  sync_digest text NOT NULL, recorded_by text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (change_case_id, story_digest, story_key, owner, repository, milestone_number),
  UNIQUE (organization_id, workspace_id, id)
);
CREATE INDEX IF NOT EXISTS adx_story_priority_plan_case_idx ON adx_story_priority_plan(change_case_id, created_at DESC);
CREATE OR REPLACE FUNCTION adx_reject_story_milestone_sync_mutation() RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'ADX_IMMUTABLE_STORY_MILESTONE_SYNC'; END; $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS adx_story_priority_plan_immutable ON adx_story_priority_plan;
CREATE TRIGGER adx_story_priority_plan_immutable BEFORE UPDATE OR DELETE ON adx_story_priority_plan FOR EACH ROW EXECUTE FUNCTION adx_reject_story_milestone_sync_mutation();
DROP TRIGGER IF EXISTS adx_github_milestone_story_sync_immutable ON adx_github_milestone_story_sync;
CREATE TRIGGER adx_github_milestone_story_sync_immutable BEFORE UPDATE OR DELETE ON adx_github_milestone_story_sync FOR EACH ROW EXECUTE FUNCTION adx_reject_story_milestone_sync_mutation();
ALTER TABLE adx_story_priority_plan ENABLE ROW LEVEL SECURITY; ALTER TABLE adx_story_priority_plan FORCE ROW LEVEL SECURITY;
ALTER TABLE adx_github_milestone_story_sync ENABLE ROW LEVEL SECURITY; ALTER TABLE adx_github_milestone_story_sync FORCE ROW LEVEL SECURITY;
DO $$ DECLARE table_name text; BEGIN FOREACH table_name IN ARRAY ARRAY['adx_story_priority_plan','adx_github_milestone_story_sync'] LOOP EXECUTE format('DROP POLICY IF EXISTS %I ON %I', table_name || '_tenant_isolation', table_name); EXECUTE format('CREATE POLICY %I ON %I USING (organization_id=current_setting(''adx.organization_id'',true)::uuid AND workspace_id=current_setting(''adx.workspace_id'',true)::uuid) WITH CHECK (organization_id=current_setting(''adx.organization_id'',true)::uuid AND workspace_id=current_setting(''adx.workspace_id'',true)::uuid)', table_name || '_tenant_isolation', table_name); END LOOP; END $$;