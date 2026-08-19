# Stage 5 conformance record — Execution lease and sandbox

- **Status:** `IN_PROGRESS`
- **Last updated:** 2026-08-19
- **Requirements in scope:** `STG-006`, `SEC-002`

## Delivery order

1. Define provider-neutral adapter capabilities and the signed execution-lease contract.
2. Retain tenant-scoped leases, runs, revocations, and gateway receipts.
3. Provision a disposable, substrate-enforced sandbox with repository and write-path boundaries.
4. Route privileged tools, egress, and brokered secrets through the gateway with quotas and a kill switch.
5. Retain run events and adversarial local/hosted-CI evidence.

## Acceptance matrix

| ID | Requirement | Required proof | Status |
| --- | --- | --- | --- |
| STG5-001 | Adapter capabilities are explicit and unsupported capabilities are not simulated. | Adapter contract test. | Verified locally |
| STG5-002 | Execution authority is signed, scope-bound, capability-intersected, and expiring. | Signed lease contract test. | Verified locally |
| STG5-003 | Runtime, gateway, secret, egress, quota, and revocation controls are substrate-enforced. | Adversarial sandbox and gateway suite. | Verified locally: lease-aware gateway quotas/revocation; exact egress allowlists with DNS-rebinding and private IPv6 denial; gateway-only secret grants; active lease revocation that stops a running Docker dispatch; signed output-byte limits; and Docker file-descriptor/PID/memory/CPU limits. Docker dispatch now uses a disposable copy-on-write worktree: only manifest-digested artifacts are retained and the source worktree stays unchanged. The adversarial suite permits only scoped writes and rejects policy writes, symlink/hard-link/mount/archive traversal, metadata/proxy/socket egress, Git and lifecycle hooks, host-secret access, output flooding, PID burst, and wall-clock overrun. Runtime disk-quota enforcement for the disposable worktree and hosted-CI evidence remain pending. |
| STG5-004 | Each capability-bearing action has a receipt and retained run evidence. | PostgreSQL/API test for lease, run, append-only events, gateway decisions, revocation, immutable receipt storage, and gateway-to-runtime dispatch. | Verified locally, including actual hardened-Docker dispatch receipt. |
