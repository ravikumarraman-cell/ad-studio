# ADR-006 — Execution substrate and threat model

- **Status:** Accepted for Stage 0; implementation begins in Stage 5
- **Decision:** Agent prompts are untrusted input. The execution substrate and tool gateway—not a prompt—enforce filesystem, process, network, secret, cloud, cost, and execution-time boundaries.
- **Why:** Prompt-based constraints cannot reliably contain an agent or a compromised tool chain.
- **Consequence:** Stage 5 must demonstrate lease expiry, forced cancellation, denied secret access, denied unauthorised egress, and immutable tool receipts before agent execution is broadened.
