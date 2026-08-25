/** Route metadata is kept separate from the HTTP server so adding a gate does
 * not require editing authorization and regex logic in multiple places. */
const operations = ['timeline', 'draft', 'transitions', 'intake', 'classify', 'stories', 'story-suggestions', 'story-decision', 'governance', 'intake-workshop', 'story-workshop', 'story-review', 'design', 'design-workbench', 'design-review', 'design-exception', 'design-decision', 'evidence', 'execution-handoff', 'generated-candidate', 'evidence-review', 'verification-run', 'verification-decision', 'application-preview', 'application-preview-start', 'application-preview-stop', 'delivery-preview', 'delivery-preview-prepare', 'delivery-draft-pr', 'delivery-ci-refresh', 'delivery-review', 'delivery-decision', 'outcomes', 'outcome-review', 'outcome-completion']
const pattern = new RegExp(`^/v1/workspaces/([0-9a-f-]+)/change-cases/([0-9a-f-]+)(?:/(${operations.join('|')}))?$`, 'i')

export function matchChangeCaseRoute(pathname) { return pathname.match(pattern) }
export function authorizationAction(method, operation) {
  if (method === 'GET') return 'resource.read'
  return ['design-decision', 'verification-decision', 'delivery-decision', 'outcome-completion'].includes(operation) ? 'resource.review' : 'resource.write'
}
export const changeCaseOperations = Object.freeze([...operations])
