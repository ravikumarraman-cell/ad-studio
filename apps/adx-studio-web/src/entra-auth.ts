import { PublicClientApplication } from '@azure/msal-browser'

const clientId = import.meta.env.VITE_AZURE_CLIENTID
const authority = import.meta.env.VITE_AZURE_AUTHORITY
const scopes = (import.meta.env.VITE_AZURE_SCOPES || 'openid profile email').split(/[ ,]+/).filter(Boolean)
let instance: PublicClientApplication | null = null
let ready: Promise<PublicClientApplication | null> | null = null
const workspaceAfterSignInKey = 'adx.optum.open-workspace-after-sign-in'

async function getInstance() {
  if (!clientId || !authority) return null
  if (!ready) ready = (async () => {
    instance = new PublicClientApplication({ auth: { clientId, authority, redirectUri: window.location.origin, postLogoutRedirectUri: window.location.origin, navigateToLoginRequestUrl: false }, cache: { cacheLocation: 'sessionStorage', storeAuthStateInCookie: false } })
    await instance.initialize()
    const result = await instance.handleRedirectPromise()
    if (result?.account) instance.setActiveAccount(result.account)
    else if (!instance.getActiveAccount() && instance.getAllAccounts()[0]) instance.setActiveAccount(instance.getAllAccounts()[0])
    return instance
  })()
  return ready
}

export async function signInWithOptum() {
  const msal = await getInstance()
  if (!msal) throw new Error('Optum SSO is not configured. Set VITE_AZURE_CLIENTID and VITE_AZURE_AUTHORITY.')
  sessionStorage.setItem(workspaceAfterSignInKey, '1')
  await msal.loginRedirect({ scopes })
}

export function consumeWorkspaceAfterOptumSignIn() {
  const shouldOpen = sessionStorage.getItem(workspaceAfterSignInKey) === '1'
  if (shouldOpen) sessionStorage.removeItem(workspaceAfterSignInKey)
  return shouldOpen
}

export async function optumAccessToken() {
  const msal = await getInstance()
  const account = msal?.getActiveAccount() || msal?.getAllAccounts()[0]
  if (!msal || !account) return null
  const result = await msal.acquireTokenSilent({ scopes, account })
  // ADX validates the user identity itself. The ID token is issued to this SPA
  // client ID, unlike Cloud Asset Inventory's API access token, whose audience
  // is its separate gateway API.
  return result.idToken
}
