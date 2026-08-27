# Workspace story portfolio and GitHub publication status

Last updated: 2026-08-26

## Goal

Provide one workspace-level delivery portfolio that combines approved stories from multiple imported features, ranks them together, and publishes them to the correct GitHub milestone.

## Complete

- Local development Change Cases, stories, approvals, plans, evidence, and publication receipts were reset to a clean slate.
- `adx_workspace_story_portfolio` stores workspace-level priority snapshots, including the exact source binding for every story.
- The story-planning page reads approved stories across Change Cases in the workspace.
- Every portfolio story retains its originating Change Case, story digest, and feature label.
- GitHub source owner, repository, milestone number, and title are persisted at feature-import time in `adx_github_source_milestone`.
- Workspace publishing creates issues in the saved portfolio order and rejects a portfolio whose active stories or source bindings no longer match the saved snapshot.
- Publication receipts retain the source milestone and any confirmed destination override, including the stated rationale.
- Retry protection skips a story already published to the same GitHub owner, repository, and milestone.
- GitHub configuration uses the server-only `ADX_GITHUB_MILESTONE_TOKEN` setting.

## Publication behavior

1. If every story originated in the same GitHub milestone, the owner and repository are pre-filled and ADX selects that source milestone after lookup.
2. **Publish prioritized stories** remains disabled until a delivery order is saved and a valid milestone is selected.
3. A different selected destination opens the override panel. Publishing stays disabled until the user checks the acknowledgement and supplies a non-empty reason.
4. The API enforces the same rule independently of the browser, so a forged request cannot bypass the confirmation.
5. A mixed-source portfolio deliberately has no default destination and requires the same explicit override confirmation.

## Verification

- Applied the Stage 13 database migration (`016_github_source_milestone.sql`).
- Focused page and service tests: 9 passing.
- Full API unit suite: all portfolio-related tests passing. Two unrelated environment-sensitive tests fail in this sandbox because it blocks a loopback listener and normalizes a macOS temporary path through `/private`.

## Current safety boundary

The source-milestone publication flow is complete and safe to use for newly imported GitHub features. Older imports that predate this migration have no typed source milestone, so ADX will ask for a destination rather than claiming an unverified default.
