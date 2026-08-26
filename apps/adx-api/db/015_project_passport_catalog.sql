-- Stage 13: tenant-scoped project catalog and immutable Passport snapshots.
CREATE TABLE IF NOT EXISTS adx_project (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL,
  workspace_id uuid NOT NULL,
  project_key text NOT NULL,
  display_name text NOT NULL,
  owner text NOT NULL,
  state text NOT NULL CHECK (state IN ('ACTIVE','SUSPENDED')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, workspace_id, project_key),
  UNIQUE (organization_id, workspace_id, id)
);

CREATE TABLE IF NOT EXISTS adx_project_installation (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL,
  workspace_id uuid NOT NULL,
  project_id uuid NOT NULL,
  canonical_remote text NOT NULL CHECK (canonical_remote ~ '^https://'),
  default_base_ref text NOT NULL CHECK (default_base_ref ~ '^refs/heads/'),
  manifest_digest text NOT NULL CHECK (manifest_digest ~ '^sha256:'),
  state text NOT NULL CHECK (state IN ('REGISTERED','SUSPENDED')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, workspace_id, canonical_remote),
  UNIQUE (organization_id, workspace_id, id),
  FOREIGN KEY (organization_id, workspace_id, project_id)
    REFERENCES adx_project (organization_id, workspace_id, id)
);

CREATE TABLE IF NOT EXISTS adx_passport_snapshot (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL,
  workspace_id uuid NOT NULL,
  installation_id uuid NOT NULL,
  schema_version text NOT NULL,
  passport jsonb NOT NULL,
  passport_digest text NOT NULL CHECK (passport_digest ~ '^sha256:'),
  effective_policy jsonb NOT NULL,
  effective_policy_digest text NOT NULL CHECK (effective_policy_digest ~ '^sha256:'),
  captured_by text NOT NULL,
  captured_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, workspace_id, installation_id, passport_digest),
  UNIQUE (organization_id, workspace_id, id),
  FOREIGN KEY (organization_id, workspace_id, installation_id)
    REFERENCES adx_project_installation (organization_id, workspace_id, id)
);

CREATE INDEX IF NOT EXISTS adx_project_installation_project_idx
  ON adx_project_installation (organization_id, workspace_id, project_id, created_at DESC);
CREATE INDEX IF NOT EXISTS adx_passport_snapshot_installation_idx
  ON adx_passport_snapshot (organization_id, workspace_id, installation_id, captured_at DESC);

CREATE OR REPLACE FUNCTION adx_reject_passport_snapshot_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'ADX_IMMUTABLE_PASSPORT_SNAPSHOT';
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS adx_passport_snapshot_immutable ON adx_passport_snapshot;
CREATE TRIGGER adx_passport_snapshot_immutable
  BEFORE UPDATE OR DELETE ON adx_passport_snapshot
  FOR EACH ROW EXECUTE FUNCTION adx_reject_passport_snapshot_mutation();

ALTER TABLE adx_project ENABLE ROW LEVEL SECURITY;
ALTER TABLE adx_project FORCE ROW LEVEL SECURITY;
ALTER TABLE adx_project_installation ENABLE ROW LEVEL SECURITY;
ALTER TABLE adx_project_installation FORCE ROW LEVEL SECURITY;
ALTER TABLE adx_passport_snapshot ENABLE ROW LEVEL SECURITY;
ALTER TABLE adx_passport_snapshot FORCE ROW LEVEL SECURITY;
DO $$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['adx_project','adx_project_installation','adx_passport_snapshot']
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', table_name || '_tenant_isolation', table_name);
    EXECUTE format(
      'CREATE POLICY %I ON %I USING (organization_id = current_setting(''adx.organization_id'', true)::uuid AND workspace_id = current_setting(''adx.workspace_id'', true)::uuid) WITH CHECK (organization_id = current_setting(''adx.organization_id'', true)::uuid AND workspace_id = current_setting(''adx.workspace_id'', true)::uuid)',
      table_name || '_tenant_isolation',
      table_name
    );
  END LOOP;
END $$;
