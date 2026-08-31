import { expect, test } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { cancelChangeCase } from './change-case-test-utils.mjs'

const workspace = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const appUrl = 'http://127.0.0.1:3112'
const apiUrl = appUrl

const design = {
  architectureDecision: { decision: 'Use a tenant-scoped boundary.' },
  interfaceDelta: { changes: ['POST /design'] },
  migrationPlan: { steps: ['apply migration'] },
  threatModel: { threats: [{ id: 'T1', mitigation: 'authorize', residualRisk: 'low' }] },
  dependencies: { items: [{ name: 'pg', license: 'MIT' }] },
  testStrategy: { layers: ['unit', 'integration', 'browser'] },
}

async function createSession(request, as = 'alice') {
  return (await (await request.get(`${apiUrl}/__test/session?as=${as}`)).json()).token
}

function headers(token, idempotencyKey) {
  return {
    authorization: `Bearer ${token}`,
    'content-type': 'application/json',
    'idempotency-key': idempotencyKey,
  }
}

async function createReadyChangeCase(request, token, title) {
  const approver = await createSession(request, 'approver')
  const reviewer = await createSession(request, 'designReviewer')
  const createResponse = await request.post(`/v1/workspaces/${workspace}/change-cases`, {
    headers: headers(token, `execution-handoff-create-${randomUUID()}`),
    data: { title, riskTier: 'R2' },
  })
  expect(createResponse.status()).toBe(201)
  const created = await createResponse.json()

  const intakeResponse = await request.post(`/v1/workspaces/${workspace}/change-cases/${created.changeCaseId}/transitions`, {
    headers: headers(token, `execution-handoff-intake-${randomUUID()}`),
    data: { toState: 'INTAKE', expectedVersion: created.projectionVersion },
  })
  expect(intakeResponse.status()).toBe(200)
  const { projectionVersion: intakeVersion } = await intakeResponse.json()

  const captureResponse = await request.post(`/v1/workspaces/${workspace}/change-cases/${created.changeCaseId}/intake`, {
    headers: headers(token, `execution-handoff-capture-${randomUUID()}`),
    data: {
      expectedVersion: intakeVersion,
      intent: {
        outcome: 'Classify a retained change request',
        owner: 'Product operations',
        acceptanceCriteria: 'Risk classification opens story authoring.',
        targetRepository: 'adx-api',
        assets: [],
        sourceContent: 'Controlled browser test',
        sourceName: 'intake.md',
      },
    },
  })
  expect(captureResponse.status()).toBe(200)
  const { projectionVersion: captureVersion } = await captureResponse.json()

  const classifyResponse = await request.post(`/v1/workspaces/${workspace}/change-cases/${created.changeCaseId}/classify`, {
    headers: headers(token, `execution-handoff-classify-${randomUUID()}`),
    data: { expectedVersion: captureVersion },
  })
  expect(classifyResponse.status()).toBe(200)
  const { projectionVersion: classifyVersion } = await classifyResponse.json()

  const storiesResponse = await request.post(`/v1/workspaces/${workspace}/change-cases/${created.changeCaseId}/stories`, {
    headers: headers(token, `execution-handoff-stories-${randomUUID()}`),
    data: {
      expectedVersion: classifyVersion,
      stories: [
        {
          title: 'Enable bounded implementation',
          narrative: 'As a workspace admin, I want a ready execution handoff so I can launch a bounded run.',
          scenarios: [{ given: 'a ready change case', when: 'I open execution handoff', then: 'I can enable and submit the run' }],
        },
      ],
    },
  })
  expect(storiesResponse.status()).toBe(200)
  const { projectionVersion: storiesVersion, storyDigest } = await storiesResponse.json()

  const storyDecisionResponse = await request.post(`/v1/workspaces/${workspace}/change-cases/${created.changeCaseId}/story-decision`, {
    headers: headers(approver, `execution-handoff-story-decision-${randomUUID()}`),
    data: {
      expectedVersion: storiesVersion,
      storyDigest,
      decision: 'APPROVED',
      rationale: 'The story is ready for design packaging.',
    },
  })
  expect(storyDecisionResponse.status()).toBe(200)
  const { projectionVersion: storyDecisionVersion } = await storyDecisionResponse.json()

  const designResponse = await request.post(`/v1/workspaces/${workspace}/change-cases/${created.changeCaseId}/design`, {
    headers: headers(token, `execution-handoff-design-${randomUUID()}`),
    data: {
      expectedVersion: storyDecisionVersion,
      design,
    },
  })
  expect(designResponse.status()).toBe(200)
  const { projectionVersion: designVersion, designDigest } = await designResponse.json()

  const designDecisionResponse = await request.post(`/v1/workspaces/${workspace}/change-cases/${created.changeCaseId}/design-decision`, {
    headers: headers(reviewer, `execution-handoff-design-decision-${randomUUID()}`),
    data: {
      expectedVersion: designVersion,
      designDigest,
      decision: 'APPROVED',
      rationale: 'The package is safe to hand off for implementation.',
    },
  })
  expect(designDecisionResponse.status()).toBe(200)

  return created.changeCaseId
}

test('execution handoff rejects unauthenticated browser requests', async ({ page }) => {
  const response = await page.goto(new URL(`/v1/workspaces/${workspace}/change-cases/bd4b1b6b-e6cf-47a2-bf1a-72a45c5dbeb6/execution-handoff`, appUrl).toString())
  expect(response?.status()).toBe(401)
  await expect(page.locator('body')).toContainText('AUTHENTICATION_REQUIRED')
})

test('execution handoff enables a ready bounded implementation after authentication and confirmation', async ({ page, context, request }) => {
  const pageErrors = []
  page.on('pageerror', (error) => pageErrors.push(error.message))
  const token = await createSession(request)
  await context.addCookies([{ name: 'adx_session', value: token, url: appUrl }])
  let changeCaseId
  try {
    changeCaseId = await createReadyChangeCase(request, token, `Execution handoff route ${randomUUID()}`)

    await page.goto(new URL(`/v1/workspaces/${workspace}/change-cases/${changeCaseId}/execution-handoff`, appUrl).toString())
    await expect(pageErrors).toEqual([])
    await expect(page.getByRole('heading', { name: 'Start a controlled implementation run' })).toBeVisible()
    await expect(page.getByRole('radio', { name: /gpt-5\.6-terra/ })).toBeChecked()
    const submit = page.getByRole('button', { name: 'Run bounded implementation' })
    await expect(submit).toBeDisabled()
    await page.getByLabel('I understand this run can modify only its disposable candidate workspace. A successful run is not approval or delivery.').check()
    await expect(submit).toBeEnabled()
  } finally {
    await cancelChangeCase(request, workspace, token, changeCaseId)
  }
})
