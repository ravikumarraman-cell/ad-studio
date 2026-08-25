# Coding Spec: Evidence-First Feature

Version: 1.0.0

Implement only the approved story/design scope. Treat repository code and tests as the source of truth.

Before editing: identify the controlling code path, relevant tests, one falsifiable hypothesis, and the smallest validation command.

During implementation:
- Change only files needed for the approved acceptance criteria.
- Do not invent APIs, data models, configuration, credentials, or external behavior.
- Preserve non-goals and report ambiguity instead of guessing.
- Never modify secrets, generated artifacts, lockfiles, or unrelated code.

Before completion: run the approved validation, report evidence for every criterion, list changed files, and state residual risks.