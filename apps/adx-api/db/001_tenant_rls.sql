CREATE TABLE IF NOT EXISTS adx_tenant_resource (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL,
  workspace_id uuid NOT NULL,
  resource_type text NOT NULL,
  owner_principal_id text NOT NULL,
  risk_tier text NOT NULL CHECK (risk_tier IN ('R0','R1','R2','R3','R4')),
  resource_version integer NOT NULL DEFAULT 1,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, workspace_id, id)
);
ALTER TABLE adx_tenant_resource ENABLE ROW LEVEL SECURITY;
ALTER TABLE adx_tenant_resource FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS adx_tenant_resource_isolation ON adx_tenant_resource;
CREATE POLICY adx_tenant_resource_isolation ON adx_tenant_resource
  USING (organization_id = current_setting('adx.organization_id', true)::uuid AND workspace_id = current_setting('adx.workspace_id', true)::uuid)
  WITH CHECK (organization_id = current_setting('adx.organization_id', true)::uuid AND workspace_id = current_setting('adx.workspace_id', true)::uuid);

CREATE TABLE IF NOT EXISTS adx_auth_audit_event (
  id uuid PRIMARY KEY,
  organization_id uuid,
  workspace_id uuid,
  event_type text NOT NULL,
  principal_id text NOT NULL,
  decision jsonb NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT now()
);
