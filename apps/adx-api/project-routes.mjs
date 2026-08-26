const pattern = /^\/v1\/workspaces\/([0-9a-f-]+)\/projects(?:\/([0-9a-f-]+)(?:\/(installations|snapshots)(?:\/([0-9a-f-]+))?)?)?$/i

export function matchProjectRoute(pathname) { return pathname.match(pattern) }
export function authorizationAction(method) { return method === 'GET' ? 'workspace.read' : null }
