# UHG GPT Model-Patch Executor

ADX can use an approved UHG Azure OpenAI deployment, such as GPT-5.6 Terra, as a bounded implementation runner. It is not a shell agent and does not receive browser, Git hosting, deployment, or credential authority.

## Execution boundary

1. ADX issues a signed lease with one repository, a fixed ref, and writable paths.
2. The server sends only readable files under the writable-path allowlist to the UHG gateway.
3. The model must return JSON containing complete replacement content for a bounded set of allowed files.
4. ADX validates paths and size limits, applies changes in a disposable candidate, and runs only `node --test`.
5. A passing candidate still requires independent verification and reviewer approval.

The model cannot open a pull request, merge, deploy, access browser credentials, or expand its file scope.

## Server configuration

Set these values on the ADX API server. Do not place Azure tokens, client secrets, or API keys in this file.

```dotenv
ADX_CODING_MODEL_EXECUTOR_ENABLED=1
ADX_CODING_MODEL_PROVIDER=uhg_azure_openai
ADX_CODING_MODEL_AUTH_MODE=aml
ADX_CODING_MODEL_VERSION=gpt-5.6-terra_2026-07-09
ADX_CODING_MODEL_NAME=gpt-5.6-terra
ADX_CODING_MODEL_ENDPOINT=https://approved-uhg-gateway.example/ai
ADX_CODING_MODEL_API_VERSION=2025-01-01-preview
ADX_CODING_MODEL_DEPLOYMENT=gpt-5.6-terra_2026-07-09
ADX_CODING_MODEL_PROJECT_ID=approved-project-id
ADX_CODING_MODEL_REPOSITORY_ID=local:ad-studio
ADX_CODING_MODEL_REF=refs/heads/main
ADX_CODING_MODEL_WRITE_PATHS=apps/adx-api/**,packages/**
ADX_CODING_MODEL_SOURCE_ROOT=/absolute/path/to/source
ADX_CODING_MODEL_CANDIDATE_ROOT=/absolute/path/to/disposable-candidate
```

`aml` uses `DefaultAzureCredential` and is the required production mode. For a local development pilot only, `interactive` requires both `ADX_CODING_MODEL_AUTH_MODE=interactive` and `ADX_CODING_MODEL_ALLOW_INTERACTIVE_LOCAL=1`; production rejects that combination.

The executor may reuse the established `ADX_UHG_AZURE_OPENAI_*` gateway values when the equivalent `ADX_CODING_MODEL_*` values are absent, but the executor enablement, identity mode, version, repository scope, and write paths remain explicit.

## Operational checks

Before enabling a run, verify the workload identity has access only to the approved UHG project and deployment. Keep egress, secrets, browser access, and deployment authority disabled in the execution policy. A successful model response is not verification evidence.
