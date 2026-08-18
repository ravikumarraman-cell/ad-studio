-- Stage 2: authoritative Change Case projection, append-only ledger,
-- idempotency, outbox/inbox, and integrity checkpoints. Run after 001_tenant_rls.sql.

CREATE TABLE IF NOT EXISTS adx_change_case (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL,
  workspace_id uuid NOT NULL,
  title text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 240),
  state text NOT NULL,
  risk_tier text NOT NULL CHECK (risk_tier IN ('R0','R1','R2','R3','R4')),
  projection_version integer NOT NULL DEFAULT 0 CHECK (projection_version >= 0),
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, workspace_id, id)
);

CREATE INDEX IF NOT EXISTS adx_change_case_workspace_updated_idx ON adx_change_case (workspace_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS adx_change_case_workspace_state_updated_idx ON adx_change_case (workspace_id, state, updated_at DESC);
CREATE INDEX IF NOT EXISTS adx_change_case_workspace_risk_updated_idx ON adx_change_case (workspace_id, risk_tier, updated_at DESC);

CREATE TABLE IF NOT EXISTS adx_change_case_event (
  event_id uuid PRIMARY KEY,
  organization_id uuid NOT NULL,
  workspace_id uuid NOT NULL,
  change_case_id uuid NOT NULL REFERENCES adx_change_case(id),
  sequence integer NOT NULL CHECK (sequence > 0),
  event_type text NOT NULL,
  event_version integer NOT NULL DEFAULT 1,
  occurred_at timestamptz NOT NULL,
  actor jsonb NOT NULL,
  correlation_id uuid NOT NULL,
  causation_id uuid,
  idempotency_key text NOT NULL,
  policy_version text NOT NULL,
  payload jsonb NOT NULL,
  payload_digest text NOT NULL,
  previous_event_digest text,
  event_digest text NOT NULL,
  signature text NOT NULL,
  signature_key_id text NOT NULL,
  UNIQUE (change_case_id, sequence),
  UNIQUE (change_case_id, event_digest)
);

CREATE INDEX IF NOT EXISTS adx_change_case_event_case_sequence_idx ON adx_change_case_event (change_case_id, sequence);

CREATE TABLE IF NOT EXISTS adx_change_case_idempotency (
  organization_id uuid NOT NULL,
  workspace_id uuid NOT NULL,
  idempotency_key text NOT NULL CHECK (char_length(idempotency_key) BETWEEN 16 AND 128),
  request_digest text NOT NULL,
  command_id uuid NOT NULL,
  response jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, idempotency_key)
);

CREATE TABLE IF NOT EXISTS adx_outbox_message (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL,
  workspace_id uuid NOT NULL,
  change_case_id uuid NOT NULL REFERENCES adx_change_case(id),
  event_id uuid NOT NULL REFERENCES adx_change_case_event(event_id),
  message_type text NOT NULL,
  provider_idempotency_key text NOT NULL,
  payload jsonb NOT NULL,
  status text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','DELIVERING','DELIVERED','RECONCILIATION_REQUIRED','DEAD_LETTER')),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  delivered_at timestamptz,
  UNIQUE (provider_idempotency_key)
);

CREATE INDEX IF NOT EXISTS adx_outbox_pending_idx ON adx_outbox_message (status, next_attempt_at) WHERE status IN ('PENDING','RECONCILIATION_REQUIRED');

CREATE TABLE IF NOT EXISTS adx_provider_inbox (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL,
  workspace_id uuid NOT NULL,
  provider text NOT NULL,
  provider_delivery_id text NOT NULL,
  change_case_id uuid REFERENCES adx_change_case(id),
  occurred_at timestamptz NOT NULL,
  payload_digest text NOT NULL,
  payload jsonb NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider, provider_delivery_id)
);

CREATE TABLE IF NOT EXISTS adx_change_case_checkpoint (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL,
  workspace_id uuid NOT NULL,
  change_case_id uuid NOT NULL REFERENCES adx_change_case(id),
  through_sequence integer NOT NULL CHECK (through_sequence > 0),
  merkle_root text NOT NULL,
  signature text NOT NULL,
  signature_key_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (change_case_id, through_sequence)
);

CREATE OR REPLACE FUNCTION adx_reject_change_case_ledger_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'ADX_APPEND_ONLY_LEDGER';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS adx_change_case_event_append_only ON adx_change_case_event;
CREATE TRIGGER adx_change_case_event_append_only BEFORE UPDATE OR DELETE ON adx_change_case_event FOR EACH ROW EXECUTE FUNCTION adx_reject_change_case_ledger_mutation();
DROP TRIGGER IF EXISTS adx_change_case_checkpoint_append_only ON adx_change_case_checkpoint;
CREATE TRIGGER adx_change_case_checkpoint_append_only BEFORE UPDATE OR DELETE ON adx_change_case_checkpoint FOR EACH ROW EXECUTE FUNCTION adx_reject_change_case_ledger_mutation();

ALTER TABLE adx_change_case ENABLE ROW LEVEL SECURITY;
ALTER TABLE adx_change_case FORCE ROW LEVEL SECURITY;
ALTER TABLE adx_change_case_event ENABLE ROW LEVEL SECURITY;
ALTER TABLE adx_change_case_event FORCE ROW LEVEL SECURITY;
ALTER TABLE adx_change_case_idempotency ENABLE ROW LEVEL SECURITY;
ALTER TABLE adx_change_case_idempotency FORCE ROW LEVEL SECURITY;
ALTER TABLE adx_outbox_message ENABLE ROW LEVEL SECURITY;
ALTER TABLE adx_outbox_message FORCE ROW LEVEL SECURITY;
ALTER TABLE adx_provider_inbox ENABLE ROW LEVEL SECURITY;
ALTER TABLE adx_provider_inbox FORCE ROW LEVEL SECURITY;
ALTER TABLE adx_change_case_checkpoint ENABLE ROW LEVEL SECURITY;
ALTER TABLE adx_change_case_checkpoint FORCE ROW LEVEL SECURITY;

DO $$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['adx_change_case','adx_change_case_event','adx_change_case_idempotency','adx_outbox_message','adx_provider_inbox','adx_change_case_checkpoint'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', table_name || '_tenant_isolation', table_name);
    EXECUTE format('CREATE POLICY %I ON %I USING (organization_id = current_setting(''adx.organization_id'', true)::uuid AND workspace_id = current_setting(''adx.workspace_id'', true)::uuid) WITH CHECK (organization_id = current_setting(''adx.organization_id'', true)::uuid AND workspace_id = current_setting(''adx.workspace_id'', true)::uuid)', table_name || '_tenant_isolation', table_name);
  END LOOP;
END;
$$;
