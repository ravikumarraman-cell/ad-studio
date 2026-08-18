# ADR-004 — Event, outbox, inbox, and reconciliation protocol

- **Status:** Accepted for Stage 0; implementation begins in Stage 2
- **Decision:** ADX persists an authoritative domain event and transactional outbox in the same database transaction. Incoming provider signals enter an idempotent inbox. External state is reconciled into the domain projection; request acknowledgement alone never advances a consequential state.
- **Why:** Git, CI, deployment, identity, and agent providers are eventually consistent dependencies.
- **Consequence:** Each integration adapter must define its idempotency key, observation evidence, retry category, and reconciliation authority before it may alter a Change Case.
