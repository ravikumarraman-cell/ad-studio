import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { api, ChangeCase, Membership, Session } from './adx-api-client'
import { CreateCaseModal } from './create-case-modal'
import { GuidedDemo } from './guided-demo'
import { ImportFeaturesModal } from './import-features-modal'
import { ImportGitHubMilestoneModal } from './import-github-milestone-modal'
import { ModeChooser } from './mode-chooser'
import { RealWorkspace } from './real-workspace'
import './feature-delivery.css'
import './feature-overrides.css'

export function FeatureDelivery() {
  const queryClient = useQueryClient(); const [mode, setMode] = useState<'choose' | 'real' | 'demo'>(() => new URLSearchParams(window.location.search).get('mode') === 'real' ? 'real' : 'choose'); const [workspaceId, setWorkspaceId] = useState(''); const [showCreate, setShowCreate] = useState(false); const [showImport, setShowImport] = useState(false); const [showGitHubImport, setShowGitHubImport] = useState(false); const [createError, setCreateError] = useState('')
  const session = useQuery({ queryKey: ['adx-session'], queryFn: () => api<Session>('/v1/me'), retry: false, enabled: mode === 'real' })
  const memberships: Membership[] = session.data?.memberships ?? []; const activeWorkspace = workspaceId || memberships[0]?.workspaceId || ''
  const changeCases = useQuery({ queryKey: ['adx-change-cases', activeWorkspace], queryFn: () => api<{ changeCases: ChangeCase[] }>(`/v1/workspaces/${activeWorkspace}/change-cases`), enabled: Boolean(activeWorkspace), retry: false })
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['adx-change-cases'] }); const workspace = memberships.find((item) => item.workspaceId === activeWorkspace)
  if (mode === 'choose') return <ModeChooser onChoose={setMode}/>
  if (mode === 'demo') return <GuidedDemo onExit={() => setMode('choose')} onReal={() => setMode('real')}/>
  if (session.isLoading) return <main className="adx-app adx-loading"><p>Loading your ADX workspace…</p></main>
  if (session.error || !session.data) return <main className="adx-app adx-sign-in"><section className="adx-hero"><p className="adx-eyebrow">ADX CONTROL PLANE</p><h1>Governed delivery, with real records.</h1><p>Sign in to view the Change Cases you are authorized to access.</p><a className="adx-primary" href="/auth/login">Sign in with your configured identity provider</a></section></main>
  const modal = showCreate ? <CreateCaseModal workspace={workspace} error={createError} onClose={() => { setShowCreate(false); setCreateError('') }} onError={setCreateError} onCreated={() => { setShowCreate(false); refresh() }}/> : showImport ? <ImportFeaturesModal workspace={workspace} onClose={() => setShowImport(false)} onDone={() => { setShowImport(false); refresh() }}/> : showGitHubImport ? <ImportGitHubMilestoneModal workspace={workspace} onClose={() => setShowGitHubImport(false)} onDone={() => { setShowGitHubImport(false); refresh() }}/> : null
  return <RealWorkspace principal={session.data.principal} memberships={memberships} activeWorkspace={activeWorkspace} setWorkspaceId={setWorkspaceId} changeCases={changeCases.data?.changeCases ?? []} loading={changeCases.isFetching} error={Boolean(changeCases.error)} onRefresh={refresh} onCreate={() => setShowCreate(true)} onImport={() => setShowImport(true)} onImportGitHub={() => setShowGitHubImport(true)} modal={modal}/>
}
