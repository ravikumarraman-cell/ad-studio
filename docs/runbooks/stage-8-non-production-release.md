# Stage 8 non-production release integration runbook

This runbook prepares one named non-production environment. It does not authorize a deployment. The profile is deny-by-default and rejects `production`/`prod`.

## 1. Configure local secrets

Copy the Stage 8 block from `.env.example` into the ignored `.env.local`, replacing every placeholder with approved non-production values. Do not commit this file or place a provider token in it without the environment owner’s approval.

## 2. Validate the profile

```bash
npm run validate:stage8:integration
```

The command prints only provider names, environment, mode, and declared capabilities. It must report `NON_PRODUCTION_PREPARED` and all capabilities remain `false`.

## 3. Before enabling any provider executor

- Confirm the environment is non-production and has an isolated rollback target.
- Register the feature flag and the read-only telemetry query with their owners.
- Give the webhook endpoint a rotating secret and replay-protection delivery ID.
- Run `npm run verify:stage8:game-day` and document the environment-specific exercise results.
- Obtain explicit approval before implementing or enabling a provider executor; this repository currently has no deploy capability.
