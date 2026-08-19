import { loadLocalEnv } from './load-local-env.mjs'
import { loadNonProductionReleaseProfile } from '../apps/adx-api/release-integration-config.mjs'

await loadLocalEnv()
const profile = loadNonProductionReleaseProfile(process.env)
console.log(JSON.stringify({ valid: true, mode: profile.mode, environment: profile.environment, deploymentProvider: profile.deploymentProvider, featureFlagProvider: profile.featureFlagProvider, telemetryProvider: profile.telemetryProvider, capabilities: profile.capabilities }))
