import assert from 'node:assert/strict'
import test from 'node:test'
import { createUhgClaudeStoryGateway, uhgClaudeStoryGatewayConfigurationMessage } from '../uhg-claude-story-gateway.mjs'

const configuredEnvironment = {
  ADX_STORY_AI_PROVIDER: 'claude',
  ADX_STORY_AI_MODEL: 'us.anthropic.claude-opus-4-8',
  ADX_UHG_CLAUDE_AUTH_MODE: 'interactive',
  ADX_UHG_CLAUDE_TENANT_ID: 'db05faca-c82a-4b9d-b9c5-0f64b6755421',
  ADX_UHG_CLAUDE_GATEWAY_ORIGIN: 'https://api.example.test',
  ADX_UHG_CLAUDE_REQUEST_PATH: '/gateway/v1/messages',
  ADX_UHG_CLAUDE_PROJECT_ID: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  ADX_UHG_CLAUDE_ROUTING_HEADERS_JSON: '{"projectId":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa","x-idp":"azuread"}'
}

test('UHG Claude story gateway configures one local interactive credential path', () => {
  const gateway = createUhgClaudeStoryGateway(configuredEnvironment)
  assert.equal(gateway.status().configured, true)
  assert.equal(gateway.status().deployment, 'us.anthropic.claude-opus-4-8')
})

test('UHG Claude story gateway requires confirmed routing headers', () => {
  const missing = { ...configuredEnvironment, ADX_UHG_CLAUDE_ROUTING_HEADERS_JSON: '{}' }
  assert.equal(createUhgClaudeStoryGateway(missing), null)
  assert.match(uhgClaudeStoryGatewayConfigurationMessage(missing), /routing-header object/)
})

test('non-Claude story providers do not create a Claude gateway', () => {
  assert.equal(createUhgClaudeStoryGateway({ ADX_STORY_AI_PROVIDER: 'uhg' }), null)
})