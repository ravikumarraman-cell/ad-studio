import { ReactNode, useState } from 'react'
import { ChangeCase, ExecutionStatus, Membership, Principal } from './adx-api-client'
import { CancelChangeCasesModal } from './cancel-change-cases-modal'
import { gates, gateState, workflowPosition } from './workflow'
import { WorkflowMap } from './workflow-map'
import './workspace-cleanup.css'

type Props = {
  principal: Principal
  memberships: Membership[]
  activeWorkspace: string
  setWorkspaceId: (value: string) => void
  changeCases: ChangeCase[]
  executionsByCase: Record<string, ExecutionStatus | undefined>
  loading: boolean
  error: boolean
  onRefresh: () => void
  onCreate: () => void
  onImport: () => void
  onImportGitHub: () => void
  modal: ReactNode
}

export function RealWorkspace({ principal, memberships, activeWorkspace, setWorkspaceId, changeCases, executionsByCase, loading, error, onRefresh, onCreate, onImport, onImportGitHub, modal }: Props) {
  const [selectedId, setSelectedId] = useState('')
  const [cancellationMode, setCancellationMode] = useState<'selected' | 'all' | null>(null)
  const [workspaceToolsOpen, setWorkspaceToolsOpen] = useState(false)
  const activeCases = changeCases.filter((item) => item.state !== 'CANCELLED')
  const cancellableCases = activeCases.filter((item) => item.state !== 'OUTCOME_RECORDED')
  const selected = activeCases.find((item) => item.id === selectedId) ?? activeCases[0]
  const current = selected ? workflowPosition(selected.state) : 0
  const gate = gates[Math.min(current, gates.length - 1)]
  const path = selected ? `/v1/workspaces/${activeWorkspace}/change-cases/${selected.id}/${gate.review}` : ''
  const nextActionLabel =
    current === gates.length
      ? 'Review the recorded outcome.'
      : gate.id === 'F'
        ? 'Complete Gate F'
        : `Open Gate ${gate.id} review`
  const nextActionButton =
    current === gates.length
      ? 'Open outcome review'
      : gate.id === 'F'
        ? 'Complete Gate F'
        : `Open Gate ${gate.id}`
  const latestRun = selected ? executionsByCase[selected.id]?.runs[0] : undefined
  const latestEvent = selected && latestRun ? [...(executionsByCase[selected.id]?.events ?? [])].reverse().find((event) => event.runId === latestRun.id) : undefined
  const workspace = memberships.find((item) => item.workspaceId === activeWorkspace)
  const cancellationModal = cancellationMode ? <CancelChangeCasesModal workspace={workspace} selected={selected} changeCases={cancellableCases} mode={cancellationMode} onClose={() => setCancellationMode(null)} onCompleted={() => { setSelectedId(''); setCancellationMode(null); onRefresh() }} /> : null

  return <main className="adx-app">
    <aside className="adx-sidebar">
      <div className="adx-brand"><span>Ａ</span><div><strong>ADX</strong><small>Real workspace</small></div></div>
      <nav aria-label="Workspace navigation"><a className="active" href="#current-work">Current work</a><a href="/control-plane">All review pages</a></nav>
      <div className="adx-user"><strong>{principal.displayName ?? principal.id}</strong><small>Authenticated session</small></div>
    </aside>
    <section className="adx-content adx-focus-content">
      <header className="adx-header"><div><p className="adx-eyebrow">REAL MODE · YOUR WORKSPACE</p><h1>One clear next step.</h1><p>Choose a Change Case. ADX shows only what matters now.</p></div><button className="adx-secondary" onClick={onRefresh}>Refresh</button></header>
      <section className="adx-workspace">
        <label htmlFor="workspace">Workspace</label>
        <select id="workspace" value={activeWorkspace} onChange={(event) => setWorkspaceId(event.target.value)}>{memberships.map((membership) => <option key={membership.workspaceId} value={membership.workspaceId}>{membership.workspaceId}</option>)}</select>
        <details className="adx-workspace-tools" open={workspaceToolsOpen} onToggle={(event) => setWorkspaceToolsOpen(event.currentTarget.open)}>
          <summary>Workspace tools</summary>
          <div className="adx-workspace-tools-menu">
            <p>Bring planned work into this workspace, or remove open cases.</p>
            <button className="adx-secondary" onClick={() => { setWorkspaceToolsOpen(false); onImport() }}>Import feature CSV</button>
            <button className="adx-secondary" onClick={() => { setWorkspaceToolsOpen(false); onImportGitHub() }}>Import GitHub milestone</button>
            <button className="adx-danger" disabled={!cancellableCases.length} onClick={() => { setWorkspaceToolsOpen(false); setCancellationMode('all') }}>Clear open cases</button>
          </div>
        </details>
        <button className="adx-primary" onClick={onCreate}>New Change Case</button>
      </section>
      {selected && <WorkflowMap current={current} />}
      {error ? <section className="adx-error" role="alert"><strong>Unable to load Change Cases.</strong><p>Confirm the API and database are running, then try again.</p><button className="adx-secondary" onClick={onRefresh}>Retry</button></section> : <section id="current-work" className="adx-focus-layout">
        <aside className="adx-case-rail">
          <p className="adx-eyebrow">CHANGE CASES · {activeCases.length}</p>
          {activeCases.map((item) => <button key={item.id} className={item.id === selected?.id ? 'selected' : ''} onClick={() => setSelectedId(item.id)}><span>{item.riskTier}</span><strong>{item.title}</strong><small>{item.state.replaceAll('_', ' ')}</small>{executionsByCase[item.id]?.runs[0] && <small className={`adx-run-state adx-run-${executionsByCase[item.id]?.runs[0].status.toLowerCase()}`}>Agent {executionsByCase[item.id]?.runs[0].status.toLowerCase()}</small>}</button>)}
          {!activeCases.length && <p>No active Change Cases yet.</p>}
        </aside>
        <section className="adx-focus-card">
          {loading ? <p>Refreshing workspace…</p> : selected ? <>
            <p className="adx-eyebrow">NOW · GATE {gate.id}</p>
            <h2>{selected.title}</h2>
            <p className="adx-focus-question">{gate.purpose}</p>
            {latestRun && <section className={`adx-run-status adx-run-${latestRun.status.toLowerCase()}`} aria-live="polite"><p className="adx-eyebrow">CODING AGENT</p><strong>{runLabel(latestRun.status)}</strong><span>{latestEvent?.errorCode ? `Diagnostic: ${latestEvent.errorCode}` : latestRun.adapterId}</span><small>Updated {new Date(latestRun.updatedAt).toLocaleString()}</small></section>}
            <section className="adx-next-action"><div><p className="adx-eyebrow">YOUR NEXT ACTION</p><strong>{nextActionLabel}</strong><small>Available through your {workspace?.roles.join(', ') ?? 'current'} workspace role.</small></div><a className="adx-primary" href={path}>{nextActionButton}</a></section>
            {selected.state !== 'OUTCOME_RECORDED' && <button className="adx-danger adx-delete-case" onClick={() => setCancellationMode('selected')}>Delete Change Case</button>}
            <details className="adx-journey"><summary>Show the full journey</summary><ol>{gates.map((item, index) => <li key={item.id} className={gateState(index, current)}><strong>Gate {item.id} · {item.name}</strong><span>{item.purpose}</span></li>)}</ol></details>
          </> : <><h2>Start with a Change Case</h2><button className="adx-primary" onClick={onCreate}>Create Change Case</button></>}
        </section>
      </section>}
      {modal}
      {cancellationModal}
    </section>
  </main>
}

function runLabel(status: string) {
  return ({ LEASED: 'Agent run queued', RUNNING: 'Agent is running', COMPLETED: 'Candidate ready for verification', FAILED: 'Agent run stopped', CANCELLED: 'Agent run cancelled' } as Record<string, string>)[status] ?? 'Agent run status unavailable'
}
