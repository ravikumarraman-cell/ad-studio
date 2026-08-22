import { ChangeCaseError, sha256 } from './change-case-ledger.mjs'
import { validateAdapterDeclaration, verifyExecutionLease } from './execution-governance.mjs'

/**
 * Provider declarations for coding agents.  They intentionally describe a
 * dispatch without executing it: a real executor must be separately wired to
 * the Stage 5 sandbox and a brokered, run-scoped provider credential.
 */
export const codingAgentProviders = Object.freeze(['CODEX', 'CLAUDE_CODE', 'GITHUB_COPILOT', 'UHG_AZURE_OPENAI'])
export const codingAgentAdapterMode = 'DECLARATION_ONLY'

const providerDefinitions = Object.freeze({
  CODEX: Object.freeze({ adapterId: 'codex-cli', executionKind: 'CLI', executable: 'codex', arguments: Object.freeze(['exec', '--json']), documentationUrl: 'https://developers.openai.com/codex/' }),
  CLAUDE_CODE: Object.freeze({ adapterId: 'claude-code-cli', executionKind: 'CLI', executable: 'claude', arguments: Object.freeze(['--print', '--verbose', '--output-format', 'stream-json']), documentationUrl: 'https://docs.anthropic.com/en/docs/claude-code' }),
  GITHUB_COPILOT: Object.freeze({ adapterId: 'github-copilot-cli', executionKind: 'CLI', executable: 'copilot', arguments: Object.freeze([]), documentationUrl: 'https://docs.github.com/en/copilot' }),
  UHG_AZURE_OPENAI: Object.freeze({ adapterId: 'uhg-azure-openai-patch', executionKind: 'MODEL_PATCH', executable: null, arguments: Object.freeze([]), documentationUrl: 'https://learn.microsoft.com/azure/ai-services/openai/' })
})

export function createCodingAgentAdapter({ provider, version, capabilities = defaultCapabilities, enabled = false }) {
  if (!codingAgentProviders.includes(provider)) throw new ChangeCaseError('CODING_AGENT_PROVIDER_INVALID', 'A supported coding-agent provider is required.')
  if (typeof version !== 'string' || !version.trim()) throw new ChangeCaseError('CODING_AGENT_VERSION_REQUIRED', 'A pinned provider version is required.')
  const definition = providerDefinitions[provider]
  const declaration = validateAdapterDeclaration({
    adapterId: definition.adapterId,
    version: version.trim(),
    tier: 'GOVERNED_EXECUTION',
    capabilities,
    supportsCancellation: true,
    supportsArtifactCollection: true,
    supportsToolReceipts: true,
    supportsIdempotency: true,
    supportsReconciliation: true
  })
  return Object.freeze({
    ...declaration,
    provider,
    mode: codingAgentAdapterMode,
    executionKind: definition.executionKind,
    enabled: Boolean(enabled),
    executable: definition.executable,
    arguments: definition.arguments,
    taskTransport: 'STDIN_JSON',
    documentationUrl: definition.documentationUrl,
    configurationDigest: sha256({ schema: 'adx-coding-agent-adapter-v1', provider, declaration, mode: codingAgentAdapterMode })
  })
}

export const createCodexAdapter = (options) => createCodingAgentAdapter({ provider: 'CODEX', ...options })
export const createClaudeCodeAdapter = (options) => createCodingAgentAdapter({ provider: 'CLAUDE_CODE', ...options })
export const createCopilotAdapter = (options) => createCodingAgentAdapter({ provider: 'GITHUB_COPILOT', ...options })

/**
 * Creates an immutable launch preview for a lease.  It contains no provider
 * credential and cannot start a process.  The future dispatch broker must
 * consume this only after it has checked enabled runtime configuration.
 */
export function createCodingAgentDispatchPreview({ adapter, lease, resolvePublicKey, task, now = new Date() }) {
  const validAdapter = validateCodingAgentAdapter(adapter)
  verifyExecutionLease(lease, resolvePublicKey, { now })
  if (lease.adapter.adapterId !== validAdapter.adapterId || lease.adapter.version !== validAdapter.version) throw new ChangeCaseError('CODING_AGENT_LEASE_ADAPTER_MISMATCH', 'The signed lease is not bound to this coding-agent adapter.')
  if (!lease.capabilities.shell || !lease.capabilities.gitRead || !lease.capabilities.gitWrite) throw new ChangeCaseError('CODING_AGENT_CAPABILITY_DENIED', 'A coding-agent dispatch requires shell, repository read, and repository write capabilities.')
  const normalizedTask = normalizeTask(task)
  return Object.freeze({
    mode: codingAgentAdapterMode,
    provider: validAdapter.provider,
    adapterId: validAdapter.adapterId,
    adapterVersion: validAdapter.version,
    leaseId: lease.leaseId,
    leaseDigest: lease.leaseDigest,
    command: Object.freeze({ executable: validAdapter.executable, arguments: validAdapter.arguments, taskTransport: validAdapter.taskTransport }),
    task: normalizedTask,
    dispatchDigest: sha256({ schema: 'adx-coding-agent-dispatch-preview-v1', adapterDigest: validAdapter.configurationDigest, leaseDigest: lease.leaseDigest, task: normalizedTask })
  })
}

/** Fails closed so a declaration cannot accidentally become a live executor. */
export function dispatchCodingAgent() {
  throw new ChangeCaseError('CODING_AGENT_EXECUTOR_DISABLED', 'Coding-agent adapters are declared but no live provider executor is enabled.')
}

export function validateCodingAgentAdapter(adapter) {
  const declaration = validateAdapterDeclaration(adapter)
  if (!codingAgentProviders.includes(adapter?.provider) || adapter.mode !== codingAgentAdapterMode || !['CLI', 'MODEL_PATCH'].includes(adapter.executionKind) || !Array.isArray(adapter.arguments) || adapter.taskTransport !== 'STDIN_JSON' || typeof adapter.configurationDigest !== 'string' || !adapter.configurationDigest.startsWith('sha256:')) throw new ChangeCaseError('CODING_AGENT_ADAPTER_INVALID', 'A complete declaration-only coding-agent adapter is required.')
  const definition = providerDefinitions[adapter.provider]
  if (declaration.adapterId !== definition.adapterId || adapter.executionKind !== definition.executionKind || adapter.executable !== definition.executable || adapter.arguments.join('\u0000') !== definition.arguments.join('\u0000')) throw new ChangeCaseError('CODING_AGENT_ADAPTER_TAMPERED', 'Coding-agent provider launch metadata does not match its registered adapter.')
  const expected = sha256({ schema: 'adx-coding-agent-adapter-v1', provider: adapter.provider, declaration, mode: codingAgentAdapterMode })
  if (expected !== adapter.configurationDigest) throw new ChangeCaseError('CODING_AGENT_ADAPTER_TAMPERED', 'Coding-agent adapter configuration digest does not match its declaration.')
  return adapter
}

const defaultCapabilities = Object.freeze({ shell: true, gitRead: true, gitWrite: true, browser: false, network: true, secrets: true, deploy: false })
function normalizeTask(task) {
  if (!task || typeof task.objective !== 'string' || !task.objective.trim() || typeof task.changeDigest !== 'string' || !task.changeDigest.startsWith('sha256:')) throw new ChangeCaseError('CODING_AGENT_TASK_INVALID', 'A coding-agent task requires an objective and an immutable change digest.')
  const allowedCommands = Array.isArray(task.allowedCommands) ? [...new Set(task.allowedCommands)] : []
  if (!allowedCommands.length || !allowedCommands.every((command) => typeof command === 'string' && command.trim() && command.length <= 200)) throw new ChangeCaseError('CODING_AGENT_TASK_INVALID', 'A coding-agent task requires a bounded allowlist of commands.')
  return Object.freeze({ objective: task.objective.trim(), changeDigest: task.changeDigest, allowedCommands: Object.freeze(allowedCommands.map((command) => command.trim()).sort()) })
}
