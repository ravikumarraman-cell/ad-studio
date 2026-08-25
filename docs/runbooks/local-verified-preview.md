# Local Verified Preview Runbook

## Purpose

Use this runbook to start a locally reachable application preview for manual testing after ADX has retained passing independent verification evidence. The preview is bound to one Change Case and one candidate digest. It is not a release, does not complete Gate D, and does not create a remote branch, pull request, merge, or deployment.

The first registered application profile is Health-X. The preview subsystem is profile-driven, so additional applications can be registered without accepting browser-supplied commands, paths, ports, or container definitions.

## Security boundaries

- A contributor starts a preview only while the Change Case is `AWAITING_VERIFICATION`.
- ADX requires a retained independent evidence bundle with `PASS` status for the requested candidate digest.
- Before building, ADX recomputes the filtered candidate digest. Dependency directories, build output, VCS metadata, `.env`, `.npmrc`, and key files do not participate in this digest.
- The profile defines the Dockerfile, build context, container port, readiness path, and npm registry on the server.
- The browser submits only a profile identifier, retained digest, and Change Case version. It cannot supply a shell command, filesystem path, port, registry, or external URL.
- The preview listens on an allocated `127.0.0.1` port and is removed through the ADX-managed stop action.
- Starting or visiting a preview does not record a verification approval. Gate D remains an independent, digest-bound reviewer decision.

## Prerequisites

1. Docker Desktop is running and can build local images.
2. The ADX API has its normal database, signer, candidate-root, and independent-verifier configuration.
3. The candidate root contains the exact source that independent verification hashed.
4. The API host can resolve and reach the approved corporate Artifactory npm virtual registry:

   ```text
   https://edgeinternal1uhg.optum.com/artifactory/api/npm/tenant-compass-npm-vir/
   ```

5. An authenticated corporate npm configuration file is available on the API host. It must authorize the Artifactory endpoint above.

Do not commit that file, paste its token into a Change Case, put its contents in browser configuration, or copy it into the candidate tree.

## Configure the API process

Set `ADX_PREVIEW_NPMRC_FILE` to the absolute path of the authenticated npm configuration before starting the API:

```bash
export ADX_PREVIEW_NPMRC_FILE="$HOME/.npmrc"
npm run api:dev
```

Use a dedicated service-owned npm configuration file when ADX runs outside a developer workstation. The path is read by the server only. During a preview build, ADX passes it to Docker as a BuildKit secret named `npmrc`.

The Dockerfile uses that secret only for `npm ci`. The credential file is not copied into the image, final filesystem, candidate, evidence record, or UI response.

## Prepare a draft-PR export

Before ADX can retain a delivery preview plan for a draft pull request, configure two server-only paths in addition to the registered Git provider values:

```bash
export ADX_PREVIEW_SOURCE_ROOT="/absolute/path/to/clean/source-checkout"
export ADX_PREVIEW_CANDIDATE_ROOT="/absolute/path/to/verified/candidate"
```

The source checkout must be clean, have an `origin` matching the registered canonical HTTPS repository, and remain separate from the candidate checkout. ADX recomputes the candidate digest and refuses the plan if it differs from the independently verified candidate, the Git base is dirty, or secret files would be exported.

To create a remote **draft** pull request from a retained preview plan, set a server-only GitHub credential with repository contents and pull-request write permission. ADX never exposes it to the browser:

```bash
export ADX_GITHUB_DRAFT_PR_TOKEN="server-only-github-token"
```

The command recomputes the source export and requires its base commit and export digest to match the retained plan exactly. It creates only the deterministic `adx/preview/<change-case-id>` branch and a provenance-marked draft PR. It has no merge, deployment, environment, or administration action.

## Start a verified preview

1. Open the target Change Case in ADX.
2. Complete the preceding gates until the Change Case is `AWAITING_VERIFICATION`.
3. Run independent verification.
4. Confirm that retained evidence shows `PASS` and the intended candidate digest.
5. On the Independent Verification page, select **Open manual preview**.
6. In the manual preview workbench, choose the registered application profile and the passing candidate digest.
7. Select **Start local preview**.
8. Wait for ADX to build the image, start the container, and confirm the configured readiness endpoint.
9. Select **Open preview**. ADX presents a link similar to:

   ```text
   http://127.0.0.1:<allocated-port>/
   ```

10. Test the user flow against that page. For Health-X, use the check-in, medication, and care-plan interactions and refresh the page to confirm session-only state resets.
11. Select **Stop preview** when manual testing is complete.

## Record the correct decision

Manual testing is supporting review information, not a verification pass. After manual testing, an authorized independent reviewer must separately complete Gate D for the exact passing candidate digest. Do not treat a successful page visit as delivery approval or production authorization.

## Troubleshooting

| Symptom | Cause | Action |
| --- | --- | --- |
| `PREVIEW_EVIDENCE_REQUIRED` | No retained passing verifier bundle matches the requested digest. | Run independent verification again for the current candidate, then choose its retained passing digest. |
| `LOCAL_PREVIEW_CANDIDATE_MISMATCH` | The candidate root changed after verification. | Restore the verified candidate or create fresh evidence for the current source. |
| `E401 Incorrect or missing password` during `npm ci` | Docker reached Artifactory, but the BuildKit secret lacks valid corporate credentials. | Refresh the authenticated corporate npm configuration file and restart the API with `ADX_PREVIEW_NPMRC_FILE` pointing to it. |
| `ENOTFOUND` for a package registry | Docker Desktop cannot resolve the corporate registry or is using an unsupported registry. | Check Docker Desktop DNS, VPN/proxy policy, and confirm the profile registry endpoint is the approved Artifactory virtual repository. |
| `LOCAL_PREVIEW_START_FAILED` | The container did not serve the profile readiness path within 30 seconds. | Inspect the bounded preview command error, then check the Dockerfile, container startup command, and profile readiness path. |
| No **Open preview** link | The preview did not become ready or was stopped. | Start the profile again from the workbench; ADX allocates a new loopback port. |

## Operator cleanup

Use **Stop preview** in ADX for normal cleanup. It removes the managed container and the in-memory preview record. If the API process is interrupted before cleanup, an operator may identify preview containers by the `com.adx.preview=true` Docker label and remove only those containers after confirming they belong to the intended local ADX session.

Never use broad container deletion commands as part of preview cleanup.
