# Independent verifier

## Purpose

The local independent verifier creates signed, digest-bound evidence for Gate D. It is intentionally distinct from the implementer and from the person who completes the gate decision.

The verifier does not accept a browser-supplied command, runtime image, secret, or filesystem path. A local administrator configures the candidate directory on the API server, then an authorized workspace contributor can request the fixed suite from the Evidence Review page.

## Local setup

The configured directory must be a checked-out candidate that can be copied by the API process. It must not contain `.env` or `.npmrc`; the baseline security check rejects either file.

Add this to the private root `.env.local` file:

```dotenv
ADX_LOCAL_VERIFIER_CANDIDATE_ROOT=/absolute/path/to/checked-out-candidate
```

Optionally set a different immutable verifier image. The value must include an image digest.

```dotenv
ADX_LOCAL_VERIFIER_IMAGE=alpine:3.20@sha256:d9e853e87e55526f6b2917df91a2115c36dd7c696a35be12163d44e6e2a4b6bc
```

Restart `npm run api:dev` after changing configuration. Docker must be running and able to obtain the pinned image before the first verification run.

## Workflow

1. Move a Change Case to `AWAITING_VERIFICATION` through the governed execution path.
2. Open its **Evidence Review** page.
3. An authorized contributor selects **Run independent verification**.
4. ADX copies the configured candidate into a disposable directory and runs the fixed suite in Docker with no network, a read-only candidate mount, dropped capabilities, a non-root user, and CPU, memory, process, output, and time limits.
5. ADX retains signed evidence containing the candidate, runtime, configuration, command, and output digests. The requesting human is not the evidence writer; the retained identity is the independent verifier service.
6. A different authorized reviewer selects **Complete Gate D** for the displayed passing candidate digest. ADX then moves that exact candidate to `READY_FOR_DELIVERY`.

The baseline suite checks for a candidate marker (`package.json` or `candidate.txt`), a usable directory, no symbolic links, no `.env` or `.npmrc`, and a deterministic file inventory. It is a portable local baseline, not a substitute for a repository-specific build, test, static-analysis, security, and SBOM policy.

## Design influences

The implementation uses the following established CI/CD patterns. These are reference points for controls, not claims of compatibility or certification.

| Platform | Pattern used by ADX | Official reference |
| --- | --- | --- |
| GitHub Actions | Least-privilege execution, immutable dependencies, and caution with untrusted checkout. | [Security hardening](https://docs.github.com/en/actions/security-for-github-actions/security-guides/security-hardening-for-github-actions) |
| GitLab CI/CD | Explicit, job-scoped secret access and short-lived identity tokens. | [External secrets](https://docs.gitlab.com/ci/secrets/) |
| Azure DevOps Pipelines | Separate pipeline authorization, environment controls, and approvals. | [Pipelines security](https://learn.microsoft.com/en-us/azure/devops/pipelines/security/security-overview?view=azure-devops) |
| CircleCI | Ephemeral sandboxed job environments and separated build artifacts. | [Security model](https://circleci.com/docs/guides/security/security/) |
| Buildkite | A clear control-plane/agent data flow and artifact ownership boundary. | [Security overview](https://buildkite.com/docs/pipelines/security) |
| Jenkins | Controller/agent separation so untrusted build work cannot control the orchestrator. | [Controller isolation](https://www.jenkins.io/doc/book/security/controller-isolation/) |
| Harness CI | Structured test and code-coverage reporting rather than an unqualified green result. | [Test and coverage reports](https://developer.harness.io/docs/continuous-integration/use-ci/run-tests/code-coverage/) |
| Argo Workflows | Explicit artifact handoff, scoped artifact storage, and lifecycle management. | [Artifacts](https://argo-workflows.readthedocs.io/en/latest/walk-through/artifacts/) |
| Snyk | Security scanning as an explicit CI input with reportable findings. | [Snyk CLI](https://docs.snyk.io/snyk-cli) |
| SonarQube | Quality gates as an explicit pass/fail decision instead of a visual status inference. | [Understanding quality gates](https://docs.sonarsource.com/sonarqube-server/quality-standards-administration/managing-quality-gates/introduction-to-quality-gates.md) |

## Boundary

This feature does not grant production deployment authority, run arbitrary project commands from a browser, upload secrets to the verifier, or replace a real repository-specific verification policy. It is a local integration bridge that makes the existing isolated-verification and signed-evidence model usable in the authenticated control plane.