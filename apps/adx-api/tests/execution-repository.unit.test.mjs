import assert from 'node:assert/strict'
import test from 'node:test'
import { PostgresExecutionRepository } from '../execution-repository.mjs'

const scope = { organizationId: 'org-1', workspaceId: 'workspace-1' }

function createRepository({ leases, runs, events, changeCaseState = 'READY_FOR_EXECUTION' }) {
  const queries = []
  const client = {
    query: async (text, params) => {
      queries.push({ text, params })
      if (text.includes('FROM adx_change_case WHERE id=$1')) return { rowCount: 1, rows: [{ state: changeCaseState }] }
      if (text.includes("FROM adx_agent_run WHERE change_case_id=$1 AND organization_id=$2 AND workspace_id=$3 AND status IN ('LEASED','RUNNING')")) return { rowCount: runs.length, rows: runs.filter((run) => run.status === 'LEASED' || run.status === 'RUNNING') }
      if (text.startsWith("UPDATE adx_execution_lease SET status='EXPIRED'")) {
        const expired = leases.filter((lease) => lease.status === 'ACTIVE' && Date.parse(lease.expiresAt) <= Date.now())
        expired.forEach((lease) => {
          lease.status = 'EXPIRED'
        })
        return { rowCount: expired.length, rows: expired.map((lease) => ({ id: lease.id })) }
      }
      if (text.startsWith("UPDATE adx_agent_run SET status='FAILED'") && text.includes('RETURNING id')) {
        const run = runs.find((item) => item.id === params[0] && ['LEASED', 'RUNNING'].includes(item.status))
        if (run) run.status = 'FAILED'
        return { rowCount: run ? 1 : 0, rows: run ? [{ id: run.id }] : [] }
      }
      if (text.startsWith("UPDATE adx_agent_run SET status='FAILED'")) {
        const leaseIds = Array.isArray(params?.[0]) ? params[0] : []
        runs.forEach((run) => {
          if (leaseIds.includes(run.leaseId) && (run.status === 'LEASED' || run.status === 'RUNNING')) run.status = 'FAILED'
        })
        return { rowCount: runs.length, rows: [] }
      }
      if (text.startsWith('SELECT run.id,run.lease_id AS "leaseId",lease.expires_at AS "leaseExpiredAt"')) {
        const terminalTypes = new Set(['AgentRunCompleted.v1', 'AgentRunFailed.v1', 'AgentRunQuotaExceeded.v1', 'AgentRunCancellationObserved.v1'])
        const missing = runs.filter((run) => {
          const lease = leases.find((item) => item.id === run.leaseId)
          return run.status === 'FAILED' && lease?.status === 'EXPIRED' && !events.some((event) => event.runId === run.id && terminalTypes.has(event.eventType))
        })
        return { rowCount: missing.length, rows: missing.map((run) => ({ id: run.id, leaseId: run.leaseId, leaseExpiredAt: leases.find((lease) => lease.id === run.leaseId)?.expiresAt })) }
      }
      if (text.startsWith('SELECT 1 FROM adx_agent_run_event')) {
        const terminalTypes = new Set(['AgentRunCompleted.v1', 'AgentRunFailed.v1', 'AgentRunQuotaExceeded.v1', 'AgentRunCancellationObserved.v1'])
        const found = events.some((event) => event.runId === params[0] && terminalTypes.has(event.eventType))
        return { rowCount: found ? 1 : 0, rows: found ? [{ '?column?': 1 }] : [] }
      }
      if (text.startsWith('SELECT run.id,run.lease_id AS "leaseId"')) {
        const cutoff = Date.now() - Number(params[3]) * 1000
        const interrupted = runs.filter((run) => {
          const lease = leases.find((item) => item.id === run.leaseId)
          return lease?.status === 'ACTIVE' && ['LEASED', 'RUNNING'].includes(run.status) && Date.parse(run.updatedAt) <= cutoff
        })
        return { rowCount: interrupted.length, rows: interrupted.map((run) => ({ id: run.id, leaseId: run.leaseId })) }
      }
      if (text.startsWith("UPDATE adx_execution_lease SET status='REVOKED'")) {
        const lease = leases.find((item) => item.id === params[0] && item.status === 'ACTIVE')
        if (lease) lease.status = 'REVOKED'
        return { rowCount: lease ? 1 : 0, rows: [] }
      }
      if (text.startsWith('SELECT COALESCE(MAX(sequence),0)+1 AS sequence')) return { rowCount: 1, rows: [{ sequence: events.length + 1 }] }
      if (text.startsWith('SELECT event_digest AS "eventDigest"')) return { rowCount: 0, rows: [] }
      if (text.startsWith('INSERT INTO adx_agent_run_event')) {
        events.push({ runId: params[3], sequence: params[4], eventType: params[5], payload: params[6], occurredAt: params[10] })
        return { rowCount: 1, rows: [] }
      }
      if (text.includes('FROM adx_execution_lease WHERE change_case_id=$1')) return { rowCount: leases.length, rows: leases }
      if (text.includes('FROM adx_agent_run WHERE change_case_id=$1')) return { rowCount: runs.length, rows: runs }
      if (text.includes('FROM adx_agent_run_event event JOIN adx_agent_run run')) return { rowCount: events.length, rows: events }
      throw new Error(`Unexpected query: ${text}`)
    },
  }
  const repository = new PostgresExecutionRepository({
    connectionString: 'postgres://example',
    signer: { privateKey: 'private-key', publicKey: 'public-key', keyId: 'key-1' },
  })
  repository.scoped = async (_scope, work) => work(client)
  return { repository, queries }
}

test('view expires stale active leases and marks their runs failed before returning the snapshot', async () => {
  const staleExpiresAt = new Date(Date.now() - 60_000).toISOString()
  const events = []
  const { repository, queries } = createRepository({
    leases: [
      {
        id: 'lease-1',
        status: 'ACTIVE',
        leaseDigest: 'sha256:lease-1',
        issuedAt: new Date(Date.now() - 20 * 60_000).toISOString(),
        expiresAt: staleExpiresAt,
        revokedAt: null,
        revokeReason: null,
      },
    ],
    runs: [
      {
        id: 'run-1',
        leaseId: 'lease-1',
        adapterId: 'adapter-1',
        adapterVersion: '1.0.0',
        status: 'RUNNING',
        createdAt: new Date(Date.now() - 20 * 60_000).toISOString(),
        updatedAt: new Date(Date.now() - 10 * 60_000).toISOString(),
      },
    ],
    events,
  })

  const snapshot = await repository.view(scope, 'case-1')
  await repository.view(scope, 'case-1')

  assert.equal(snapshot.leases[0].status, 'EXPIRED')
  assert.equal(snapshot.runs[0].status, 'FAILED')
  const terminalEvents = events.filter((event) => event.eventType === 'AgentRunFailed.v1')
  assert.equal(terminalEvents.length, 1)
  assert.equal(terminalEvents[0].payload.errorCode, 'EXECUTION_LEASE_EXPIRED')
  assert.equal(terminalEvents[0].payload.errorDetails.leaseExpiredAt, staleExpiresAt)
  assert.match(queries[0].text, /UPDATE adx_execution_lease SET status='EXPIRED'/)
  assert.match(queries[1].text, /UPDATE adx_agent_run SET status='FAILED'/)
})

test('issueLease rejects a second bounded implementation while a run is already active', async () => {
  const { repository } = createRepository({
    leases: [],
    runs: [
      {
        id: 'run-1',
        leaseId: 'lease-1',
        adapterId: 'adapter-1',
        adapterVersion: '1.0.0',
        status: 'RUNNING',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ],
    events: [],
    changeCaseState: 'AWAITING_VERIFICATION',
  })

  await assert.rejects(
    () => repository.issueLease({
      scope,
      principal: { id: 'principal-1' },
      changeCaseId: 'case-1',
      request: {
        agentPrincipal: { id: 'agent-1' },
        repositories: [{ repositoryId: 'repo', ref: 'refs/heads/main', writePaths: ['apps/**'] }],
        requestedCapabilities: { shell: true, gitRead: true, gitWrite: true, browser: false, network: false, secrets: false, deploy: false },
        requestedEgress: [],
        policyEgress: [],
        requestedSecrets: [],
        policySecrets: [],
        adapter: { adapterId: 'adapter-1', version: '1.0.0' },
        policyCapabilities: { shell: true, gitRead: true, gitWrite: true, browser: false, network: false, secrets: false, deploy: false },
        limits: { maxDurationSeconds: 60, maxToolCalls: 2, maxCostUsd: 0, maxNetworkBytes: 0, maxOutputBytes: 1024, maxWorkspaceBytes: 1024 * 1024 },
        policyVersion: 'policy-1',
        durationSeconds: 60,
      },
    }),
    (error) => error.code === 'EXECUTION_RUN_ALREADY_IN_PROGRESS',
  )
})

test('view fails an active run whose worker heartbeat stopped and revokes its lease', async () => {
  const events = []
  const leases = [{
    id: 'lease-interrupted',
    status: 'ACTIVE',
    leaseDigest: 'sha256:lease-interrupted',
    issuedAt: new Date(Date.now() - 2 * 60_000).toISOString(),
    expiresAt: new Date(Date.now() + 10 * 60_000).toISOString(),
  }]
  const runs = [{
    id: 'run-interrupted',
    leaseId: 'lease-interrupted',
    adapterId: 'adapter-1',
    adapterVersion: '1.0.0',
    status: 'RUNNING',
    createdAt: new Date(Date.now() - 2 * 60_000).toISOString(),
    updatedAt: new Date(Date.now() - 60_000).toISOString(),
  }]
  const { repository } = createRepository({ leases, runs, events })

  const snapshot = await repository.view(scope, 'case-1')

  assert.equal(snapshot.leases[0].status, 'REVOKED')
  assert.equal(snapshot.runs[0].status, 'FAILED')
  assert.equal(events[0].eventType, 'AgentRunFailed.v1')
  assert.equal(events[0].payload.errorCode, 'EXECUTION_RUNNER_HEARTBEAT_LOST')
})

test('view preserves an existing terminal cause after its lease expires', async () => {
  const events = [{
    runId: 'run-quota',
    sequence: 4,
    eventType: 'AgentRunQuotaExceeded.v1',
    payload: { errorCode: 'EXECUTION_TOOL_QUOTA_EXCEEDED' },
    occurredAt: new Date(Date.now() - 60_000).toISOString(),
  }]
  const { repository } = createRepository({
    leases: [{
      id: 'lease-quota',
      status: 'EXPIRED',
      leaseDigest: 'sha256:lease-quota',
      issuedAt: new Date(Date.now() - 20 * 60_000).toISOString(),
      expiresAt: new Date(Date.now() - 5 * 60_000).toISOString(),
    }],
    runs: [{
      id: 'run-quota',
      leaseId: 'lease-quota',
      adapterId: 'adapter-1',
      adapterVersion: '1.0.0',
      status: 'FAILED',
      createdAt: new Date(Date.now() - 20 * 60_000).toISOString(),
      updatedAt: new Date(Date.now() - 6 * 60_000).toISOString(),
    }],
    events,
  })

  await repository.view(scope, 'case-1')

  assert.equal(events.length, 1)
  assert.equal(events[0].eventType, 'AgentRunQuotaExceeded.v1')
  assert.equal(events[0].payload.errorCode, 'EXECUTION_TOOL_QUOTA_EXCEEDED')
})