import { ReactNode, useState } from 'react'
import { ChangeCase, Membership, Principal } from './adx-api-client'
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
  loading: boolean
  error: boolean
  onRefresh: () => void
  onCreate: () => void
  onImport: () => void
  onImportGitHub: () => void
  modal: ReactNode
}

export function RealWorkspace({ principal, memberships, activeWorkspace, setWorkspaceId, changeCases, loading, error, onRefresh, onCreate, onImport, onImportGitHub, modal }: Props) {
  const [selectedId, setSelectedId] = useState('')
  const [cancellationMode, setCancellationMode] = useState<'selected' | 'all' | null>(null)
  const activeCases = changeCases.filter((item) => item.state !== 'CANCELLED')
  const cancellableCases = activeCases.filter((item) => item.state !== 'OUTCOME_RECORDED')
  const selected = activeCases.find((item) => item.id === selectedId) ?? activeCases[0]
  const current = selected ? workflowPosition(selected.state) : 0
  const gate = gates[Math.min(current, gates.length - 1)]
  const path = selected ? `/v1/workspaces/${activeWorkspace}/change-cases/${selected.id}/${gate.review}` : ''
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
        <details className="adx-workspace-tools">
          <summary>Workspace tools</summary>
          <div className="adx-workspace-tools-menu">
            <p>Bring planned work into this workspace, or remove open cases.</p>
            <button className="adx-secondary" onClick={onImport}>Import feature CSV</button>
            <button className="adx-secondary" onClick={onImportGitHub}>Import GitHub milestone</button>
            <button className="adx-danger" disabled={!cancellableCases.length} onClick={() => setCancellationMode('all')}>Clear open cases</button>
          </div>
        </details>
        <button className="adx-primary" onClick={onCreate}>New Change Case</button>
      </section>
      {selected && <WorkflowMap current={current} />}
      {error ? <p className="adx-error">Unable to load Change Cases. Confirm the API and database are running.</p> : <section id="current-work" className="adx-focus-layout">
        <aside className="adx-case-rail">
          <p className="adx-eyebrow">CHANGE CASES · {activeCases.length}</p>
          {activeCases.map((item) => <button key={item.id} className={item.id === selected?.id ? 'selected' : ''} onClick={() => setSelectedId(item.id)}><span>{item.riskTier}</span><strong>{item.title}</strong><small>{item.state.replaceAll('_', ' ')}</small></button>)}
          {!activeCases.length && <p>No active Change Cases yet.</p>}
        </aside>
        <section className="adx-focus-card">
          {loading ? <p>Refreshing workspace…</p> : selected ? <>
            <p className="adx-eyebrow">NOW · GATE {gate.id}</p>
            <h2>{selected.title}</h2>
            <p className="adx-focus-question">{gate.purpose}</p>
            <section className="adx-next-action"><div><p className="adx-eyebrow">YOUR NEXT ACTION</p><strong>{current === gates.length ? 'Review the recorded outcome.' : `Open Gate ${gate.id} review`}</strong></div><a className="adx-primary" href={path}>{current === gates.length ? 'Open outcome' : `Open Gate ${gate.id}`}</a></section>
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
