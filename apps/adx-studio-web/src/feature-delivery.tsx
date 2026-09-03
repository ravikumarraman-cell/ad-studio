import { useEffect, useState } from 'react'
import { useQueries, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, ChangeCase, ExecutionStatus, getExecutionStatus, Membership, Session } from './adx-api-client'
import { CreateCaseModal } from './create-case-modal'
import { GuidedDemo } from './guided-demo'
import { ImportFeaturesModal } from './import-features-modal'
import { ImportGitHubMilestoneModal } from './import-github-milestone-modal'
import { ModeChooser } from './mode-chooser'
import { RealWorkspace } from './real-workspace'
import { clearSelectedIdentityProvider, consumeWorkspaceAfterOptumSignIn, noteGoogleSignIn, shouldRecoverWithOptum, signInWithOptum } from './entra-auth'
import './feature-delivery.css'
import './feature-overrides.css'
import './responsive-audit.css'

const automaticOptumRecoveryKey = 'adx.optum.automatic-recovery-attempted'

export function FeatureDelivery() {
  const queryClient = useQueryClient(); const [mode, setMode] = useState<'choose' | 'real' | 'demo'>(() => new URLSearchParams(window.location.search).get('mode') === 'real' ? 'real' : 'choose'); const [workspaceId, setWorkspaceId] = useState(''); const [showCreate, setShowCreate] = useState(false); const [showImport, setShowImport] = useState(false); const [showGitHubImport, setShowGitHubImport] = useState(false); const [createError, setCreateError] = useState(''); const [signInError, setSignInError] = useState('')
  const session = useQuery({ queryKey: ['adx-session'], queryFn: () => api<Session>('/v1/me'), retry: false, enabled: mode !== 'demo' })
  useEffect(() => { if (mode === 'choose' && session.data && consumeWorkspaceAfterOptumSignIn()) setMode('real') }, [mode, session.data])
  useEffect(() => {
    if (mode !== 'real' || !session.error || !shouldRecoverWithOptum() || sessionStorage.getItem(automaticOptumRecoveryKey) === '1') return
    sessionStorage.setItem(automaticOptumRecoveryKey, '1')
    void signInWithOptum().catch((error) => setSignInError(error instanceof Error ? error.message : 'Unable to restore your Optum SSO session.'))
  }, [mode, session.error])
  useEffect(() => { if (session.data) { sessionStorage.removeItem(automaticOptumRecoveryKey); clearSelectedIdentityProvider() } }, [session.data])
  const memberships: Membership[] = session.data?.memberships ?? []; const activeWorkspace = workspaceId || memberships[0]?.workspaceId || ''
  const changeCases = useQuery({ queryKey: ['adx-change-cases', activeWorkspace], queryFn: () => api<{ changeCases: ChangeCase[] }>(`/v1/workspaces/${activeWorkspace}/change-cases`), enabled: mode === 'real' && Boolean(activeWorkspace), retry: false })
  const executionQueries = useQueries({ queries: (changeCases.data?.changeCases ?? []).map((changeCase) => ({ queryKey: ['adx-execution', activeWorkspace, changeCase.id], queryFn: (): Promise<ExecutionStatus> => getExecutionStatus(activeWorkspace, changeCase.id), enabled: mode === 'real' && Boolean(activeWorkspace), retry: false, refetchInterval: (query: unknown) => isActiveRun(((query as { state: { data?: ExecutionStatus } }).state.data)?.runs[0]?.status) ? 1500 : false })) }) as { data?: ExecutionStatus }[]
  const executionsByCase: Record<string, ExecutionStatus | undefined> = Object.fromEntries((changeCases.data?.changeCases ?? []).map((changeCase, index) => [changeCase.id, executionQueries[index]?.data]))
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['adx-change-cases'] }); const workspace = memberships.find((item) => item.workspaceId === activeWorkspace)
  if (mode === 'choose') return <ModeChooser onChoose={setMode} workspaceReady={Boolean(session.data)}/>
  if (mode === 'demo') return <GuidedDemo onExit={() => setMode('choose')} onReal={() => setMode('real')}/>
  const beginOptumSignIn = async () => {
    setSignInError('')
    try { await signInWithOptum() } catch (error) { setSignInError(error instanceof Error ? error.message : 'Unable to start Optum SSO.') }
  }
  if (session.isLoading) return <main className="adx-app adx-loading"><section className="adx-hero adx-status-card" aria-live="polite"><p className="adx-eyebrow">REAL WORKSPACE</p><h1>Opening your workspace…</h1><p>Checking your secure session and workspace access.</p></section></main>
  if (session.error || !session.data) return <main className="adx-app adx-sign-in"><section className="adx-hero adx-status-card"><p className="adx-eyebrow">REAL WORKSPACE</p><h1>Sign-in is required.</h1><p>Your session has expired or this workspace link was opened directly.</p><div className="adx-auth-actions"><button className="adx-primary" onClick={() => void beginOptumSignIn()}>Sign in with Optum SSO</button><a className="adx-secondary" href="/auth/login?provider=google" onClick={noteGoogleSignIn}>Sign in with Google</a><button className="adx-secondary" onClick={() => void session.refetch()}>Try again</button><button className="adx-secondary" onClick={() => setMode('choose')}>Return to start</button></div>{signInError && <p className="adx-auth-error" role="alert">{signInError}</p>}{session.error && <p className="adx-auth-error" role="alert">{session.error instanceof Error ? session.error.message : 'The ADX API could not validate this session.'}</p>}</section></main>
  if (!memberships.length) return <main className="adx-app adx-sign-in"><section className="adx-hero adx-status-card"><p className="adx-eyebrow">REAL WORKSPACE</p><h1>Workspace access is required.</h1><p>Optum SSO authenticated your identity, but it has not yet been granted an ADX workspace role. Ask an ADX administrator to provision this principal, then refresh this page.</p><code className="adx-principal-id">npm run provision:local-user -- '{session.data.principal.id}'</code><div className="adx-auth-actions"><button className="adx-secondary" onClick={() => queryClient.invalidateQueries({ queryKey: ['adx-session'] })}>Refresh access</button><button className="adx-secondary" onClick={() => setMode('choose')}>Return to start</button></div></section></main>
  const modal = showCreate ? <CreateCaseModal workspace={workspace} error={createError} onClose={() => { setShowCreate(false); setCreateError('') }} onError={setCreateError} onCreated={() => { setShowCreate(false); refresh() }}/> : showImport ? <ImportFeaturesModal workspace={workspace} onClose={() => setShowImport(false)} onDone={() => { setShowImport(false); refresh() }}/> : showGitHubImport ? <ImportGitHubMilestoneModal workspace={workspace} onClose={() => setShowGitHubImport(false)} onDone={() => { setShowGitHubImport(false); refresh() }}/> : null
  return <RealWorkspace principal={session.data.principal} memberships={memberships} activeWorkspace={activeWorkspace} setWorkspaceId={setWorkspaceId} changeCases={changeCases.data?.changeCases ?? []} executionsByCase={executionsByCase} loading={changeCases.isFetching} error={Boolean(changeCases.error)} onRefresh={refresh} onCreate={() => setShowCreate(true)} onImport={() => setShowImport(true)} onImportGitHub={() => setShowGitHubImport(true)} modal={modal}/>
}

function isActiveRun(status: string | undefined) { return status === 'LEASED' || status === 'RUNNING' }
