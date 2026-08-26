# Health-X Externalization Runbook

## Status

The private repository [ravikumarraman-cell/health-x](https://github.com/ravikumarraman-cell/health-x) contains the standalone Health-X source and its committed dependency lockfile. A fresh clone completed `npm ci` through the corporate Artifactory registry and `npm run verify:production` passed on Node 22.19.0. ADX cannot yet parse or register a Delivery Passport file.

## Preconditions

1. The scoped preview-export guardrail is green.
2. `npm --prefix apps/health-x run verify:production` passes from the current checkout.
3. The private `ravikumarraman-cell/health-x` repository contains the verified standalone source and lockfile.
4. The maintainer has an approved mechanism for the required private npm registry credential. Do not commit `.npmrc`, tokens, or secret values.

## Copy, Verify, Then Cut Over

1. Keep `apps/health-x` in ADX Studio until all verification gates below pass.
2. Copy only Health-X source, `package.json`, a generated standalone `package-lock.json`, `.nvmrc`, `Dockerfile.standalone`, `scripts/verify-production.mjs`, this project's README content, and the passport template.
3. Rename `Dockerfile.standalone` to `Dockerfile` in the external repository. Do not change the current ADX Studio Dockerfile during this copy step.
4. Rename the passport template to `adx.project.yaml`, and validate its parsed object with `validateDeliveryPassport` once parser/registration support exists.
5. From a clean external clone, run `npm ci`, `npm run build`, and `npm run verify:production`. This was verified through the corporate Artifactory registry on Node 22.19.0; repeat it after dependency or build changes.
6. Build the external Docker image with the approved npm secret mounted only for dependency installation; verify the production container locally.
7. Register the external repository as preview-only only after the catalog persistence and Passport registration path are implemented and independently reviewed.
8. Run a shadow Change Case. Compare source commit, candidate digest, verification evidence, export scope, and preview-plan digest against the current path.
9. Retire the ADX Studio Health-X path only in a later approved change after the shadow run passes. Preserve historical ADX records; do not rewrite artifact references.

## Stop Conditions

Stop and keep the current monorepo path if the clean-clone install, browser acceptance, container build, passport validation, catalog registration, or shadow evidence comparison fails. This runbook does not authorize merge, production deployment, or secret migration.
