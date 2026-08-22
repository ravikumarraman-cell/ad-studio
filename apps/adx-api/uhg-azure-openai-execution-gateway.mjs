import { createAzureOpenAiGatewayAdapter, createDefaultAzureAdTokenProvider, createInteractiveAzureAdTokenProvider } from './azure-openai-gateway-adapter.mjs'

const supportedModes = new Set(['aml', 'interactive'])

export function createUhgAzureOpenAiExecutionGateway(env = process.env) {
  if (String(env.ADX_CODING_MODEL_PROVIDER ?? '').trim().toLowerCase() !== 'uhg_azure_openai') return null
  const authMode = String(env.ADX_CODING_MODEL_AUTH_MODE ?? 'aml').trim().toLowerCase()
  if (!supportedModes.has(authMode)) return null
  if (authMode === 'interactive' && (env.NODE_ENV === 'production' || env.ADX_CODING_MODEL_ALLOW_INTERACTIVE_LOCAL !== '1')) return null
  const tokenProvider = authMode === 'aml'
    ? createDefaultAzureAdTokenProvider()
    : createInteractiveAzureAdTokenProvider({ tenantId: optionalValue(env.ADX_CODING_MODEL_TENANT_ID ?? env.ADX_UHG_AZURE_TENANT_ID) })
  return createAzureOpenAiGatewayAdapter({
    endpoint: env.ADX_CODING_MODEL_ENDPOINT ?? env.ADX_UHG_AZURE_OPENAI_ENDPOINT,
    apiVersion: env.ADX_CODING_MODEL_API_VERSION ?? env.ADX_UHG_AZURE_OPENAI_API_VERSION ?? '2025-01-01-preview',
    deployment: env.ADX_CODING_MODEL_DEPLOYMENT ?? env.ADX_UHG_AZURE_OPENAI_DEPLOYMENT,
    model: env.ADX_CODING_MODEL_NAME ?? env.ADX_STORY_AI_MODEL,
    projectId: env.ADX_CODING_MODEL_PROJECT_ID ?? env.ADX_UHG_AZURE_OPENAI_PROJECT_ID,
    tokenProvider
  })
}

export function uhgAzureOpenAiExecutionGatewayConfigurationMessage(env = process.env) {
  if (String(env.ADX_CODING_MODEL_PROVIDER ?? '').trim().toLowerCase() !== 'uhg_azure_openai') return null
  const authMode = String(env.ADX_CODING_MODEL_AUTH_MODE ?? 'aml').trim().toLowerCase()
  if (!supportedModes.has(authMode)) return 'Set ADX_CODING_MODEL_AUTH_MODE to aml, or explicitly enable interactive only for a local non-production pilot.'
  if (authMode === 'interactive' && (env.NODE_ENV === 'production' || env.ADX_CODING_MODEL_ALLOW_INTERACTIVE_LOCAL !== '1')) return 'Interactive coding-model authentication is denied unless ADX_CODING_MODEL_ALLOW_INTERACTIVE_LOCAL=1 in a non-production environment.'
  return 'Set the approved UHG Azure OpenAI endpoint, deployment, project ID, model name, and server-owned workload identity for the coding-model executor.'
}

function optionalValue(value) {
  const normalized = String(value ?? '').trim()
  return normalized || undefined
}
