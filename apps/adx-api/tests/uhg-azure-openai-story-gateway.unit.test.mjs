import assert from 'node:assert/strict'
import test from 'node:test'
import { createUhgAzureOpenAiStoryGateway, uhgAzureOpenAiStoryGatewayConfigurationMessage } from '../uhg-azure-openai-story-gateway.mjs'

const configuredEnvironment = {
  ADX_STORY_AI_PROVIDER: 'uhg',
  ADX_STORY_AI_MODEL: 'gpt-5.6-terra',
  ADX_UHG_AZURE_AUTH_MODE: 'interactive',
  ADX_UHG_AZURE_TENANT_ID: 'db05faca-c82a-4b9d-b9c5-0f64b6755421',
  ADX_UHG_AZURE_OPENAI_ENDPOINT: 'https://api.example.test/gateway',
  ADX_UHG_AZURE_OPENAI_DEPLOYMENT: 'gpt-5.6-terra_2026-07-09',
  ADX_UHG_AZURE_OPENAI_PROJECT_ID: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
}

test('UHG Azure OpenAI story gateway configures one local interactive credential path', () => {
  const gateway = createUhgAzureOpenAiStoryGateway(configuredEnvironment)
  assert.equal(gateway.status().configured, true)
  assert.equal(gateway.status().model, 'gpt-5.6-terra')
  assert.equal(gateway.status().deployment, 'gpt-5.6-terra_2026-07-09')
})

test('UHG Azure OpenAI story gateway requires an explicit single credential mode', () => {
  const environment = { ...configuredEnvironment, ADX_UHG_AZURE_AUTH_MODE: '' }
  assert.equal(createUhgAzureOpenAiStoryGateway(environment), null)
  assert.match(uhgAzureOpenAiStoryGatewayConfigurationMessage(environment), /interactive.*aml/)
})

test('non-UHG story providers do not create a UHG gateway', () => {
  assert.equal(createUhgAzureOpenAiStoryGateway({ ADX_STORY_AI_PROVIDER: 'ollama' }), null)
})