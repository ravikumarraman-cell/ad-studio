#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Usage: scripts/create-github-demo-milestones.sh OWNER/REPOSITORY [--apply]

Creates two public-GitHub milestones, each with three feature issues for the ADX
milestone-import workflow. The default is a dry run. Pass --apply to create only
the milestones and issues that do not already exist.

Prerequisites:
  - GitHub CLI installed: https://cli.github.com/
  - gh auth login completed for an account with Issues write access to the repository

Examples:
  scripts/create-github-demo-milestones.sh ravikumarraman-cell/ad-studio
  scripts/create-github-demo-milestones.sh ravikumarraman-cell/ad-studio --apply
EOF
}

repository="${1:-}"
apply="${2:-}"
if [[ -z "$repository" || "$repository" == "--help" || "$repository" == "-h" ]]; then usage; exit 0; fi
if [[ ! "$repository" =~ ^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$ ]]; then echo "Repository must be OWNER/REPOSITORY." >&2; exit 2; fi
if [[ -n "$apply" && "$apply" != "--apply" ]]; then usage >&2; exit 2; fi
if ! command -v gh >/dev/null; then echo "GitHub CLI (gh) is required." >&2; exit 1; fi
if ! gh auth status --hostname github.com >/dev/null 2>&1; then echo "Sign in first with: gh auth login" >&2; exit 1; fi

ensure_milestone() {
  local title="$1" description="$2" number
  number="$(gh api --paginate "repos/$repository/milestones?state=all&per_page=100" --jq ".[] | select(.title == \"$title\") | .number" | head -n 1 || true)"
  if [[ -n "$number" ]]; then echo "Milestone exists: $title (#$number)" >&2; printf '%s' "$number"; return; fi
  if [[ "$apply" != "--apply" ]]; then echo "Would create milestone: $title" >&2; printf '%s' "DRY_RUN"; return; fi
  number="$(gh api --method POST "repos/$repository/milestones" -f title="$title" -f description="$description" --jq '.number')"
  echo "Created milestone: $title (#$number)" >&2
  printf '%s' "$number"
}

ensure_feature_issue() {
  local milestone="$1" title="$2" body="$3" existing
  if [[ "$milestone" == "DRY_RUN" ]]; then echo "  Would create feature: $title" >&2; return; fi
  existing="$(gh api --paginate "repos/$repository/issues?state=all&milestone=$milestone&per_page=100" --jq ".[] | select(.pull_request == null and .title == \"$title\") | .number" | head -n 1 || true)"
  if [[ -n "$existing" ]]; then echo "  Feature exists: #$existing $title" >&2; return; fi
  if [[ "$apply" != "--apply" ]]; then echo "  Would create feature: $title" >&2; return; fi
  local issue
  issue="$(gh api --method POST "repos/$repository/issues" -f title="$title" -f body="$body" -F milestone="$milestone" --jq '.number')"
  echo "  Created feature: #$issue $title" >&2
}

intake="$(ensure_milestone "ADX Demo: Connected Care Intake" "Three connected features for consented referral intake, document reconciliation, and visible referral status.")"
ensure_feature_issue "$intake" "Feature: Submit a consented specialist referral" $'As a referral coordinator, I need to submit a complete specialist referral with consent and a clinical reason, so that the receiving team can begin review.\n\nAcceptance context:\n- Validate required referral details and consent state.\n- Return a traceable referral reference.\n- Reject duplicates without creating another referral.'
ensure_feature_issue "$intake" "Feature: Reconcile requested clinical documents" $'As a specialty intake coordinator, I need to request and reconcile missing clinical documents against a referral, so that it becomes ready for review.\n\nAcceptance context:\n- Track missing-document requests and due dates.\n- Version accepted documents against the referral.\n- Quarantine mismatched or unsafe uploads.'
ensure_feature_issue "$intake" "Feature: View referral status and next action" $'As a patient or referring practice, I need to see the current referral status and next required action, so that I can complete the referral journey without repeated calls.\n\nAcceptance context:\n- Show a clear status and next action.\n- Restrict access to the authorized organization and patient context.\n- Retain status changes for audit.'

decisions="$(ensure_milestone "ADX Demo: Connected Care Decisions" "Three connected features for accountable referral decisions, patient communication, and operational follow-up.")"
ensure_feature_issue "$decisions" "Feature: Record an accountable referral decision" $'As a specialist reviewer, I need to record an accepted, needs-information, or not-appropriate referral decision, so that the referral has an accountable clinical outcome.\n\nAcceptance context:\n- Bind the decision to the reviewed referral version.\n- Require an appropriate rationale and next step.\n- Prevent a submitter from deciding their own referral.'
ensure_feature_issue "$decisions" "Feature: Notify patients and referring practices" $'As a patient and referring practice, I need a safe notification when a referral decision is recorded, so that I know to open the authenticated portal for next steps.\n\nAcceptance context:\n- Honor communication preferences.\n- Keep notifications minimum-necessary.\n- Record delivery outcome without including sensitive clinical detail.'
ensure_feature_issue "$decisions" "Feature: Coordinate accepted referral follow-up" $'As a care operations coordinator, I need to track the next operational action after an accepted referral, so that accepted referrals do not stall before scheduling or follow-up.\n\nAcceptance context:\n- Show ownership and outstanding next action.\n- Escalate overdue follow-up.\n- Retain a traceable handoff history.'

if [[ "$apply" != "--apply" ]]; then echo "Dry run complete. Re-run with --apply to create missing milestones and issues." >&2; fi