import { createAzureOpenAiGatewayAdapter, createDefaultAzureAdTokenProvider, createInteractiveAzureAdTokenProvider } from './azure-openai-gateway-adapter.mjs'

const supportedModes = new Set(['interactive', 'aml'])

export function createUhgAzureOpenAiStoryGateway(env = process.env) {
  if (!isUhgProvider(env.ADX_STORY_AI_PROVIDER)) return null
  const authMode = String(env.ADX_UHG_AZURE_AUTH_MODE ?? '').trim().toLowerCase()
  if (!supportedModes.has(authMode)) return null
  const model = String(env.ADX_STORY_AI_MODEL ?? '').trim()
  const tokenProvider = authMode === 'interactive'
    ? createInteractiveAzureAdTokenProvider({ tenantId: optionalValue(env.ADX_UHG_AZURE_TENANT_ID) })
    : createDefaultAzureAdTokenProvider()
  return createAzureOpenAiGatewayAdapter({
    endpoint: env.ADX_UHG_AZURE_OPENAI_ENDPOINT,
    apiVersion: env.ADX_UHG_AZURE_OPENAI_API_VERSION ?? '2025-01-01-preview',
    deployment: env.ADX_UHG_AZURE_OPENAI_DEPLOYMENT,
    model,
    projectId: env.ADX_UHG_AZURE_OPENAI_PROJECT_ID,
    tokenProvider
  })
}

export function uhgAzureOpenAiStoryGatewayConfigurationMessage(env = process.env) {
  if (!isUhgProvider(env.ADX_STORY_AI_PROVIDER)) return null
  const authMode = String(env.ADX_UHG_AZURE_AUTH_MODE ?? '').trim().toLowerCase()
  if (!supportedModes.has(authMode)) return 'Set ADX_UHG_AZURE_AUTH_MODE to interactive for local ADX or aml for a UAIS AML workload. Do not combine both modes.'
  return 'Set ADX_STORY_AI_MODEL plus the approved UHG Azure OpenAI endpoint, deployment, project ID, and selected credential mode on the ADX API server.'
}

function isUhgProvider(value) { return ['uhg', 'uhg_azure_openai'].includes(String(value ?? '').trim().toLowerCase()) }
function optionalValue(value) { const normalized = String(value ?? '').trim(); return normalized || undefined }