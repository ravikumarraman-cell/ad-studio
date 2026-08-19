-- Stage 3: retained intake, ambiguity, classification, story graph, and digest-bound approval.
CREATE TABLE IF NOT EXISTS adx_intake_source (
  id uuid PRIMARY KEY, organization_id uuid NOT NULL, workspace_id uuid NOT NULL,
  change_case_id uuid NOT NULL REFERENCES adx_change_case(id), source_name text NOT NULL,
  content_type text NOT NULL DEFAULT 'text/plain', source_content text NOT NULL,
  source_digest text NOT NULL, created_by text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (change_case_id, source_digest)
);
CREATE TABLE IF NOT EXISTS adx_change_case_intent (
  change_case_id uuid PRIMARY KEY REFERENCES adx_change_case(id), organization_id uuid NOT NULL, workspace_id uuid NOT NULL,
  outcome text NOT NULL, owner text NOT NULL, acceptance_criteria text NOT NULL, target_repository text NOT NULL, assets jsonb NOT NULL,
  intent_digest text NOT NULL, updated_by text NOT NULL, updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS adx_intake_ambiguity (
  id uuid PRIMARY KEY, organization_id uuid NOT NULL, workspace_id uuid NOT NULL, change_case_id uuid NOT NULL REFERENCES adx_change_case(id),
  code text NOT NULL, question text NOT NULL, status text NOT NULL CHECK (status IN ('OPEN','RESOLVED')), resolved_by text, resolved_at timestamptz, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS adx_risk_assessment (
  id uuid PRIMARY KEY, organization_id uuid NOT NULL, workspace_id uuid NOT NULL, change_case_id uuid NOT NULL REFERENCES adx_change_case(id),
  risk_tier text NOT NULL CHECK (risk_tier IN ('R0','R1','R2','R3','R4')), explanation jsonb NOT NULL, assessment_digest text NOT NULL, assessed_by text NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS adx_story_revision (
  id uuid PRIMARY KEY, organization_id uuid NOT NULL, workspace_id uuid NOT NULL, change_case_id uuid NOT NULL REFERENCES adx_change_case(id),
  revision integer NOT NULL, stories jsonb NOT NULL, story_digest text NOT NULL, authored_by text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE (change_case_id, revision), UNIQUE (change_case_id, story_digest)
);
CREATE TABLE IF NOT EXISTS adx_story_approval (
  id uuid PRIMARY KEY, organization_id uuid NOT NULL, workspace_id uuid NOT NULL, change_case_id uuid NOT NULL REFERENCES adx_change_case(id),
  story_digest text NOT NULL, decision text NOT NULL CHECK (decision IN ('APPROVED','REJECTED')), rationale text NOT NULL, approved_by text NOT NULL, status text NOT NULL CHECK (status IN ('ACTIVE','INVALIDATED')), created_at timestamptz NOT NULL DEFAULT now(), invalidated_at timestamptz
);
CREATE INDEX IF NOT EXISTS adx_intake_ambiguity_open_idx ON adx_intake_ambiguity (change_case_id) WHERE status = 'OPEN';
CREATE INDEX IF NOT EXISTS adx_story_approval_active_idx ON adx_story_approval (change_case_id, story_digest) WHERE status = 'ACTIVE';
ALTER TABLE adx_intake_source ENABLE ROW LEVEL SECURITY; ALTER TABLE adx_intake_source FORCE ROW LEVEL SECURITY;
ALTER TABLE adx_change_case_intent ENABLE ROW LEVEL SECURITY; ALTER TABLE adx_change_case_intent FORCE ROW LEVEL SECURITY;
ALTER TABLE adx_intake_ambiguity ENABLE ROW LEVEL SECURITY; ALTER TABLE adx_intake_ambiguity FORCE ROW LEVEL SECURITY;
ALTER TABLE adx_risk_assessment ENABLE ROW LEVEL SECURITY; ALTER TABLE adx_risk_assessment FORCE ROW LEVEL SECURITY;
ALTER TABLE adx_story_revision ENABLE ROW LEVEL SECURITY; ALTER TABLE adx_story_revision FORCE ROW LEVEL SECURITY;
ALTER TABLE adx_story_approval ENABLE ROW LEVEL SECURITY; ALTER TABLE adx_story_approval FORCE ROW LEVEL SECURITY;
DO $$ DECLARE table_name text; BEGIN FOREACH table_name IN ARRAY ARRAY['adx_intake_source','adx_change_case_intent','adx_intake_ambiguity','adx_risk_assessment','adx_story_revision','adx_story_approval'] LOOP EXECUTE format('DROP POLICY IF EXISTS %I ON %I', table_name || '_tenant_isolation', table_name); EXECUTE format('CREATE POLICY %I ON %I USING (organization_id = current_setting(''adx.organization_id'', true)::uuid AND workspace_id = current_setting(''adx.workspace_id'', true)::uuid) WITH CHECK (organization_id = current_setting(''adx.organization_id'', true)::uuid AND workspace_id = current_setting(''adx.workspace_id'', true)::uuid)', table_name || '_tenant_isolation', table_name); END LOOP; END $$;
