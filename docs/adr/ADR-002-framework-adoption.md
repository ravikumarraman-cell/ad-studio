# ADR-002 — Framework adoption and compatibility canary

- **Status:** Accepted for Stage 0; exit evidence pending
- **Decision:** ADX will adopt TanStack Start only after a pinned-version compatibility canary verifies routing, authenticated loaders, error boundaries, CSP/CSRF behavior, streaming boundaries, and telemetry. The current React/Vite health-authorisation demo is a disposable development harness, not proof of the ADX production shell.
- **Why:** A framework choice must not become an unexamined security or availability dependency.
- **Consequence:** Stage 0 cannot exit until the canary is implemented and its result is attached to the Stage 0 conformance record. A Router-only fallback requires a separate ADR and equivalent proof.
