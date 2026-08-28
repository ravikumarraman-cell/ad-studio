import { useState } from 'react'
import { useQueries, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, ChangeCase, ExecutionStatus, getExecutionStatus, Membership, Session } from './adx-api-client'
import { CreateCaseModal } from './create-case-modal'
import { GuidedDemo } from './guided-demo'
import { ImportFeaturesModal } from './import-features-modal'
import { ImportGitHubMilestoneModal } from './import-github-milestone-modal'
import { ModeChooser } from './mode-chooser'
import { RealWorkspace } from './real-workspace'
import './feature-delivery.css'
import './feature-overrides.css'
import './responsive-audit.css'

export function FeatureDelivery() {
  const queryClient = useQueryClient(); const [mode, setMode] = useState<'choose' | 'real' | 'demo'>(() => new URLSearchParams(window.location.search).get('mode') === 'real' ? 'real' : 'choose'); const [workspaceId, setWorkspaceId] = useState(''); const [showCreate, setShowCreate] = useState(false); const [showImport, setShowImport] = useState(false); const [showGitHubImport, setShowGitHubImport] = useState(false); const [createError, setCreateError] = useState('')
  const session = useQuery({ queryKey: ['adx-session'], queryFn: () => api<Session>('/v1/me'), retry: false, enabled: mode !== 'demo' })
  const memberships: Membership[] = session.data?.memberships ?? []; const activeWorkspace = workspaceId || memberships[0]?.workspaceId || ''
  const changeCases = useQuery({ queryKey: ['adx-change-cases', activeWorkspace], queryFn: () => api<{ changeCases: ChangeCase[] }>(`/v1/workspaces/${activeWorkspace}/change-cases`), enabled: mode === 'real' && Boolean(activeWorkspace), retry: false })
  const executionQueries = useQueries({ queries: (changeCases.data?.changeCases ?? []).map((changeCase) => ({ queryKey: ['adx-execution', activeWorkspace, changeCase.id], queryFn: (): Promise<ExecutionStatus> => getExecutionStatus(activeWorkspace, changeCase.id), enabled: mode === 'real' && Boolean(activeWorkspace), retry: false, refetchInterval: (query: unknown) => isActiveRun(((query as { state: { data?: ExecutionStatus } }).state.data)?.runs[0]?.status) ? 1500 : false })) }) as { data?: ExecutionStatus }[]
  const executionsByCase: Record<string, ExecutionStatus | undefined> = Object.fromEntries((changeCases.data?.changeCases ?? []).map((changeCase, index) => [changeCase.id, executionQueries[index]?.data]))
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['adx-change-cases'] }); const workspace = memberships.find((item) => item.workspaceId === activeWorkspace)
  if (mode === 'choose') return <ModeChooser onChoose={setMode} workspaceReady={Boolean(session.data)}/>
  if (mode === 'demo') return <GuidedDemo onExit={() => setMode('choose')} onReal={() => setMode('real')}/>
  if (session.isLoading) return <main className="adx-app adx-loading"><p>Loading your ADX workspace…</p></main>
  if (session.error || !session.data) return <main className="adx-app adx-sign-in"><section className="adx-hero"><p className="adx-eyebrow">REAL WORKSPACE</p><h1>Sign-in is required.</h1><p>Your session has expired or this workspace link was opened directly.</p><a className="adx-primary" href="/auth/login">Sign in</a><button className="adx-secondary" onClick={() => setMode('choose')}>Return to start</button></section></main>
  const modal = showCreate ? <CreateCaseModal workspace={workspace} error={createError} onClose={() => { setShowCreate(false); setCreateError('') }} onError={setCreateError} onCreated={() => { setShowCreate(false); refresh() }}/> : showImport ? <ImportFeaturesModal workspace={workspace} onClose={() => setShowImport(false)} onDone={() => { setShowImport(false); refresh() }}/> : showGitHubImport ? <ImportGitHubMilestoneModal workspace={workspace} onClose={() => setShowGitHubImport(false)} onDone={() => { setShowGitHubImport(false); refresh() }}/> : null
  return <RealWorkspace principal={session.data.principal} memberships={memberships} activeWorkspace={activeWorkspace} setWorkspaceId={setWorkspaceId} changeCases={changeCases.data?.changeCases ?? []} executionsByCase={executionsByCase} loading={changeCases.isFetching} error={Boolean(changeCases.error)} onRefresh={refresh} onCreate={() => setShowCreate(true)} onImport={() => setShowImport(true)} onImportGitHub={() => setShowGitHubImport(true)} modal={modal}/>
}

function isActiveRun(status: string | undefined) { return status === 'LEASED' || status === 'RUNNING' }

