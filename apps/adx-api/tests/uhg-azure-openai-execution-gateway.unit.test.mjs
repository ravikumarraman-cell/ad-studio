import assert from 'node:assert/strict'
import test from 'node:test'
import { createUhgAzureOpenAiExecutionGateway, uhgAzureOpenAiExecutionGatewayConfigurationMessage } from '../uhg-azure-openai-execution-gateway.mjs'

const base = {
  ADX_CODING_MODEL_PROVIDER: 'uhg_azure_openai',
  ADX_CODING_MODEL_ENDPOINT: 'https://gateway.example.test/ai',
  ADX_CODING_MODEL_API_VERSION: '2025-01-01-preview',
  ADX_CODING_MODEL_DEPLOYMENT: 'gpt-5.6-terra_2026-07-09',
  ADX_CODING_MODEL_NAME: 'gpt-5.6-terra',
  ADX_CODING_MODEL_PROJECT_ID: 'project-1'
}

test('UHG model executor defaults to a workload identity gateway', () => {
  const gateway = createUhgAzureOpenAiExecutionGateway(base)
  assert.equal(gateway.status().configured, true)
  assert.equal(gateway.status().model, 'gpt-5.6-terra')
})

test('interactive executor authentication requires an explicit non-production opt-in', () => {
  assert.equal(createUhgAzureOpenAiExecutionGateway({ ...base, ADX_CODING_MODEL_AUTH_MODE: 'interactive' }), null)
  const gateway = createUhgAzureOpenAiExecutionGateway({ ...base, ADX_CODING_MODEL_AUTH_MODE: 'interactive', ADX_CODING_MODEL_ALLOW_INTERACTIVE_LOCAL: '1' })
  assert.equal(gateway.status().configured, true)
  assert.match(uhgAzureOpenAiExecutionGatewayConfigurationMessage({ ...base, ADX_CODING_MODEL_AUTH_MODE: 'interactive' }), /denied/)
})
