-- Stage 7: exact-commit CI/review provider observations for preview delivery only.
CREATE TABLE IF NOT EXISTS adx_ci_preview_run (
  id uuid PRIMARY KEY, organization_id uuid NOT NULL, workspace_id uuid NOT NULL, preview_plan_id uuid NOT NULL REFERENCES adx_git_preview_plan(id), provider_id text NOT NULL, external_run_id text NOT NULL, commit_digest text NOT NULL, status text NOT NULL CHECK (status IN ('QUEUED','RUNNING','PASSED','FAILED')), updated_at timestamptz NOT NULL DEFAULT now(), created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider_id,external_run_id), UNIQUE (organization_id,workspace_id,id)
);
CREATE TABLE IF NOT EXISTS adx_ci_preview_event (
  id uuid PRIMARY KEY, organization_id uuid NOT NULL, workspace_id uuid NOT NULL, ci_run_id uuid NOT NULL REFERENCES adx_ci_preview_run(id), provider_id text NOT NULL, delivery_id text NOT NULL, status text NOT NULL CHECK (status IN ('QUEUED','RUNNING','PASSED','FAILED')), commit_digest text NOT NULL, payload jsonb NOT NULL, payload_digest text NOT NULL, occurred_at timestamptz NOT NULL, received_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider_id,delivery_id), UNIQUE (organization_id,workspace_id,id)
);
CREATE TABLE IF NOT EXISTS adx_preview_review_finding (
  id uuid PRIMARY KEY, organization_id uuid NOT NULL, workspace_id uuid NOT NULL, preview_plan_id uuid NOT NULL REFERENCES adx_git_preview_plan(id), provider_id text NOT NULL, delivery_id text NOT NULL, commit_digest text NOT NULL, finding jsonb NOT NULL, finding_digest text NOT NULL, occurred_at timestamptz NOT NULL, received_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider_id,delivery_id), UNIQUE (organization_id,workspace_id,id)
);
CREATE OR REPLACE FUNCTION adx_reject_ci_preview_event_mutation() RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'ADX_APPEND_ONLY_CI_PREVIEW_EVENT'; END; $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS adx_ci_preview_event_append_only ON adx_ci_preview_event; CREATE TRIGGER adx_ci_preview_event_append_only BEFORE UPDATE OR DELETE ON adx_ci_preview_event FOR EACH ROW EXECUTE FUNCTION adx_reject_ci_preview_event_mutation();
CREATE OR REPLACE FUNCTION adx_reject_preview_review_finding_mutation() RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'ADX_IMMUTABLE_PREVIEW_REVIEW_FINDING'; END; $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS adx_preview_review_finding_immutable ON adx_preview_review_finding; CREATE TRIGGER adx_preview_review_finding_immutable BEFORE UPDATE OR DELETE ON adx_preview_review_finding FOR EACH ROW EXECUTE FUNCTION adx_reject_preview_review_finding_mutation();
ALTER TABLE adx_ci_preview_run ENABLE ROW LEVEL SECURITY; ALTER TABLE adx_ci_preview_run FORCE ROW LEVEL SECURITY; ALTER TABLE adx_ci_preview_event ENABLE ROW LEVEL SECURITY; ALTER TABLE adx_ci_preview_event FORCE ROW LEVEL SECURITY; ALTER TABLE adx_preview_review_finding ENABLE ROW LEVEL SECURITY; ALTER TABLE adx_preview_review_finding FORCE ROW LEVEL SECURITY;
DO $$ DECLARE table_name text; BEGIN FOREACH table_name IN ARRAY ARRAY['adx_ci_preview_run','adx_ci_preview_event','adx_preview_review_finding'] LOOP EXECUTE format('DROP POLICY IF EXISTS %I ON %I', table_name || '_tenant_isolation', table_name); EXECUTE format('CREATE POLICY %I ON %I USING (organization_id=current_setting(''adx.organization_id'',true)::uuid AND workspace_id=current_setting(''adx.workspace_id'',true)::uuid) WITH CHECK (organization_id=current_setting(''adx.organization_id'',true)::uuid AND workspace_id=current_setting(''adx.workspace_id'',true)::uuid)', table_name || '_tenant_isolation', table_name); END LOOP; END $$;
