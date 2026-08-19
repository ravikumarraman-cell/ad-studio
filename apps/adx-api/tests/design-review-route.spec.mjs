import { test, expect } from '@playwright/test'
import { randomUUID } from 'node:crypto'

const workspace = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const design = { architectureDecision: { decision: 'Use a tenant-scoped boundary.' }, interfaceDelta: { changes: ['POST /design'] }, migrationPlan: { steps: ['apply migration'] }, threatModel: { threats: [{ id: 'T1', mitigation: 'authorize', residualRisk: 'low' }] }, dependencies: { items: [{ name: 'pg', license: 'MIT' }] }, testStrategy: { layers: ['unit', 'integration', 'browser'] } }

test('design review deep link explains retained artifacts, residual risk, and the safe next action', async ({ page, request }) => {
  const token = async (as) => (await (await request.get(`/__test/session?as=${as}`)).json()).token
  const alice = await token('alice'); const approver = await token('approver'); const reviewer = await token('designReviewer')
  const headers = (value) => ({ authorization: `Bearer ${value}`, 'content-type': 'application/json', 'idempotency-key': `stage4-ui-${randomUUID()}` })
  const created = await request.post(`/v1/workspaces/${workspace}/change-cases`, { headers: headers(alice), data: { title: 'Design review deep link', riskTier: 'R2' } }); const { changeCaseId, projectionVersion: createVersion } = await created.json()
  const intake = await request.post(`/v1/workspaces/${workspace}/change-cases/${changeCaseId}/transitions`, { headers: headers(alice), data: { toState: 'INTAKE', expectedVersion: createVersion } }); let { projectionVersion: version } = await intake.json()
  const captured = await request.post(`/v1/workspaces/${workspace}/change-cases/${changeCaseId}/intake`, { headers: headers(alice), data: { expectedVersion: version, intent: { outcome: 'Review a retained design package', owner: 'Security', acceptanceCriteria: 'A reviewer can see all design artifacts, residual risk, and the next safe action.', targetRepository: 'adx-api', assets: [], sourceContent: 'Stage 4 browser evidence', sourceName: 'stage4.md' } } }); ({ projectionVersion: version } = await captured.json())
  const classified = await request.post(`/v1/workspaces/${workspace}/change-cases/${changeCaseId}/classify`, { headers: headers(alice), data: { expectedVersion: version } }); ({ projectionVersion: version } = await classified.json())
  const stories = await request.post(`/v1/workspaces/${workspace}/change-cases/${changeCaseId}/stories`, { headers: headers(alice), data: { expectedVersion: version, stories: [{ title: 'Review design', narrative: 'As a reviewer, I need a retained design package.', scenarios: [{ given: 'a classified Change Case', when: 'I open design review', then: 'I see the security decision context' }] }] } }); const story = await stories.json(); version = story.projectionVersion
  const storyApproval = await request.post(`/v1/workspaces/${workspace}/change-cases/${changeCaseId}/story-decision`, { headers: headers(approver), data: { expectedVersion: version, storyDigest: story.storyDigest, decision: 'APPROVED', rationale: 'Story contract is sufficient.' } }); ({ projectionVersion: version } = await storyApproval.json())
  const packageCapture = await request.post(`/v1/workspaces/${workspace}/change-cases/${changeCaseId}/design`, { headers: headers(alice), data: { expectedVersion: version, design } }); const packageBody = await packageCapture.json(); version = packageBody.projectionVersion
  await page.context().addCookies([{ name: 'adx_session', value: reviewer, url: 'http://127.0.0.1:3111' }]); await page.goto(`/v1/workspaces/${workspace}/change-cases/${changeCaseId}/design-review`)
  await expect(page.getByRole('heading', { name: 'Design review deep link' })).toBeVisible(); await expect(page.getByText('ONE SAFE NEXT ACTION')).toBeVisible(); await expect(page.getByText('Threat model & residual risk')).toBeVisible(); await expect(page.getByText(packageBody.designDigest)).toBeVisible(); await page.reload(); await expect(page.getByText('Architecture decision')).toBeVisible()
})
