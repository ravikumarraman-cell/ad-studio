import { createAnthropicGatewayAdapter } from './anthropic-gateway-adapter.mjs'
import { createDefaultAzureAdTokenProvider, createInteractiveAzureAdTokenProvider } from './azure-openai-gateway-adapter.mjs'

const azureScope = 'https://cognitiveservices.azure.com/.default'
const supportedModes = new Set(['interactive', 'aml'])

export function createUhgClaudeStoryGateway(env = process.env) {
  if (!isClaudeProvider(env.ADX_STORY_AI_PROVIDER)) return null
  const authMode = String(env.ADX_UHG_CLAUDE_AUTH_MODE ?? '').trim().toLowerCase()
  const routingHeaders = parseRoutingHeaders(env.ADX_UHG_CLAUDE_ROUTING_HEADERS_JSON)
  if (!supportedModes.has(authMode) || !routingHeaders) return null
  const tokenProvider = authMode === 'interactive'
    ? createInteractiveAzureAdTokenProvider({ tenantId: optionalValue(env.ADX_UHG_CLAUDE_TENANT_ID) })
    : createDefaultAzureAdTokenProvider()
  return createAnthropicGatewayAdapter({
    endpoint: env.ADX_UHG_CLAUDE_GATEWAY_ORIGIN,
    requestPath: env.ADX_UHG_CLAUDE_REQUEST_PATH,
    deployment: env.ADX_STORY_AI_MODEL,
    projectId: env.ADX_UHG_CLAUDE_PROJECT_ID,
    routingHeaders,
    credentialForRequest: async (request) => ({ headerName: 'authorization', value: `Bearer ${await tokenProvider({ scope: azureScope, ...request })}` })
  })
}

export function uhgClaudeStoryGatewayConfigurationMessage(env = process.env) {
  if (!isClaudeProvider(env.ADX_STORY_AI_PROVIDER)) return null
  const authMode = String(env.ADX_UHG_CLAUDE_AUTH_MODE ?? '').trim().toLowerCase()
  if (!supportedModes.has(authMode)) return 'Set ADX_UHG_CLAUDE_AUTH_MODE to interactive for local ADX or aml for a UAIS AML workload. Do not combine both modes.'
  if (!parseRoutingHeaders(env.ADX_UHG_CLAUDE_ROUTING_HEADERS_JSON)) return 'Set ADX_UHG_CLAUDE_ROUTING_HEADERS_JSON to the confirmed UHG routing-header object before enabling Claude.'
  return 'Set the approved Claude gateway origin, Messages request path, deployment, project ID, routing headers, and one credential mode on the ADX API server.'
}

function isClaudeProvider(value) { return ['claude', 'uhg_claude', 'uhg_anthropic'].includes(String(value ?? '').trim().toLowerCase()) }
function optionalValue(value) { const normalized = String(value ?? '').trim(); return normalized || undefined }
function parseRoutingHeaders(value) {
  try {
    const parsed = JSON.parse(String(value ?? ''))
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) || !Object.keys(parsed).length) return null
    return parsed
  } catch { return null }
}