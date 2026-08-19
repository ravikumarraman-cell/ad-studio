import assert from 'node:assert/strict'
import { ChangeCaseError } from '../apps/adx-api/change-case-ledger.mjs'
import { loadNonProductionReleaseProfile } from '../apps/adx-api/release-integration-config.mjs'

const profile = loadNonProductionReleaseProfile({ ADX_RELEASE_INTEGRATION_ENABLED: 'true', ADX_RELEASE_ENVIRONMENT: 'staging', ADX_RELEASE_DEPLOYMENT_PROVIDER: 'example-deployer', ADX_RELEASE_DEPLOYMENT_ENDPOINT: 'https://deploy.example.test/v1', ADX_RELEASE_FLAG_PROVIDER: 'example-flags', ADX_RELEASE_FLAG_KEY: 'adx-stage8', ADX_RELEASE_TELEMETRY_PROVIDER: 'example-metrics', ADX_RELEASE_TELEMETRY_ENDPOINT: 'https://metrics.example.test/api', ADX_RELEASE_TELEMETRY_QUERY: 'release_slo{service="adx"}', ADX_RELEASE_WEBHOOK_SECRET: 'test-only-secret', ADX_RELEASE_ROLLBACK_ARTIFACT_DIGEST: 'sha256:rollback-artifact' })
assert.equal(profile.environment, 'staging')
assert.equal(profile.capabilities.deploy, false)
assert.throws(() => loadNonProductionReleaseProfile({}), (error) => error instanceof ChangeCaseError && error.code === 'RELEASE_INTEGRATION_DISABLED')
assert.throws(() => loadNonProductionReleaseProfile({ ...process.env, ADX_RELEASE_INTEGRATION_ENABLED: 'true', ADX_RELEASE_ENVIRONMENT: 'production', ADX_RELEASE_DEPLOYMENT_PROVIDER: 'x', ADX_RELEASE_DEPLOYMENT_ENDPOINT: 'https://x.example', ADX_RELEASE_FLAG_PROVIDER: 'x', ADX_RELEASE_FLAG_KEY: 'x', ADX_RELEASE_TELEMETRY_PROVIDER: 'x', ADX_RELEASE_TELEMETRY_ENDPOINT: 'https://x.example', ADX_RELEASE_TELEMETRY_QUERY: 'x', ADX_RELEASE_WEBHOOK_SECRET: 'x', ADX_RELEASE_ROLLBACK_ARTIFACT_DIGEST: 'sha256:x' }), (error) => error instanceof ChangeCaseError && error.code === 'RELEASE_PRODUCTION_PROFILE_DENIED')
console.log('Stage 8 non-production release integration profile validation passed.')
