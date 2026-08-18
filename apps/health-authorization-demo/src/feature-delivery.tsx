import { ChangeEvent, useState } from 'react'
import './feature-delivery.css'
import './feature-overrides.css'

type DeliveryState = 'BACKLOG' | 'CLARIFY' | 'DESIGN' | 'EXECUTION' | 'VERIFY' | 'RELEASE' | 'COMPLETED'
type Feature = { id: string; title: string; description: string; priority: 'P0' | 'P1' | 'P2'; owner: string; repository: string; acceptanceCriteria: string; riskTier: 'R0' | 'R1' | 'R2' | 'R3' | 'R4'; state: DeliveryState; events: string[] }

const seedFeatures: Feature[] = [
  { id: 'HI-1001', title: 'Provider prior-authorization intake', description: 'Allow providers to submit a complete, traceable prior-authorization request.', priority: 'P0', owner: 'Provider Operations', repository: 'health-auth-service', acceptanceCriteria: 'Submission is validated, idempotent, and creates an evidence-bound Change Case.', riskTier: 'R2', state: 'BACKLOG', events: [] },
  { id: 'HI-1002', title: 'Evidence packet and human review', description: 'Assemble coverage, clinical-document, and policy evidence for licensed reviewer consideration.', priority: 'P0', owner: 'Clinical Operations', repository: 'health-auth-service', acceptanceCriteria: 'Evidence is versioned and a licensed human records the determination.', riskTier: 'R3', state: 'BACKLOG', events: [] },
  { id: 'HI-1003', title: 'Reversible authorization-release canary', description: 'Release the portal workflow progressively with telemetry-driven pause and rollback.', priority: 'P1', owner: 'Platform Reliability', repository: 'member-portal', acceptanceCriteria: 'Promotion has provenance, telemetry gates, and a tested rollback path.', riskTier: 'R4', state: 'BACKLOG', events: [] },
]

const stageNames: Record<DeliveryState, string> = { BACKLOG: 'Backlog', CLARIFY: 'Clarify', DESIGN: 'Design review', EXECUTION: 'Bounded execution', VERIFY: 'Independent verification', RELEASE: 'Controlled release', COMPLETED: 'Outcome recorded' }
const actions: Partial<Record<DeliveryState, { next: DeliveryState; label: string; proof: string }>> = {
  BACKLOG: { next: 'CLARIFY', label: 'Create Change Case', proof: 'Source feature is immutable, deduplicated, and linked to a Change Case.' },
  CLARIFY: { next: 'DESIGN', label: 'Approve scope', proof: 'Acceptance criteria, owner, repository, and risk tier are acknowledged.' },
  DESIGN: { next: 'EXECUTION', label: 'Authorize execution lease', proof: 'Design and policy gate approved; bounded agent authority issued.' },
  EXECUTION: { next: 'VERIFY', label: 'Submit implementation evidence', proof: 'Candidate change, tool receipts, and build inputs are sealed.' },
  VERIFY: { next: 'RELEASE', label: 'Approve verified candidate', proof: 'Independent tests, security checks, and provenance satisfy release gate.' },
  RELEASE: { next: 'COMPLETED', label: 'Record outcome', proof: 'Progressive release observed; outcome and recovery evidence recorded.' },
}

function parseCsv(text: string): Feature[] {
  const [header, ...rows] = text.trim().split(/\r?\n/)
  const columns = header.split(',').map((value) => value.trim().toLowerCase())
  const required = ['feature_id', 'title', 'description', 'priority', 'owner', 'target_repository', 'acceptance_criteria', 'risk_tier']
  const missing = required.find((name) => !columns.includes(name))
  if (missing) throw new Error(`Missing required column: ${missing}`)
  const cell = (values: string[], name: string) => values[columns.indexOf(name)]?.trim() ?? ''
  return rows.filter(Boolean).map((row, index) => {
    const values = row.split(',')
    const priority = cell(values, 'priority') as Feature['priority']
    const riskTier = cell(values, 'risk_tier') as Feature['riskTier']
    if (!['P0', 'P1', 'P2'].includes(priority) || !['R0', 'R1', 'R2', 'R3', 'R4'].includes(riskTier)) throw new Error(`Row ${index + 2} has an invalid priority or risk tier`)
    return { id: cell(values, 'feature_id'), title: cell(values, 'title'), description: cell(values, 'description'), priority, owner: cell(values, 'owner'), repository: cell(values, 'target_repository'), acceptanceCriteria: cell(values, 'acceptance_criteria'), riskTier, state: 'BACKLOG', events: [`Imported source row ${index + 2}`] }
  })
}

export function FeatureDelivery({ onOpenWorkbench }: { onOpenWorkbench: () => void }) {
  const [features, setFeatures] = useState(seedFeatures)
  const [selectedId, setSelectedId] = useState(seedFeatures[0].id)
  const [notice, setNotice] = useState('Three fictional health-insurance features are ready for governed delivery.')
  const selected = features.find((feature) => feature.id === selectedId) ?? features[0]
  const action = actions[selected.state]

  const advance = () => {
    if (!action) return
    const entry = `${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} · ${action.proof}`
    setFeatures((items) => items.map((item) => item.id === selected.id ? { ...item, state: action.next, events: [...item.events, entry] } : item))
    setNotice(`${selected.id}: ${action.label} accepted.`)
  }

  const importFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return
    if (!file.name.toLowerCase().endsWith('.csv')) { setNotice('Import rejected: this verified pilot currently supports CSV files only.'); return }
    try {
      const imported = parseCsv(await file.text())
      if (!imported.length) throw new Error('No feature rows found')
      setFeatures(imported); setSelectedId(imported[0].id); setNotice(`${imported.length} features imported and awaiting governed Change Cases.`)
    } catch (error) { setNotice(`Import rejected: ${error instanceof Error ? error.message : 'unknown validation error'}`) }
  }

  return <main className="feature-shell">
    <aside className="sidebar">
      <div className="brand"><span className="brand-mark">A</span><div><strong>ADX</strong><small>Feature delivery</small></div></div>
      <nav aria-label="ADX views"><button type="button" className="active" aria-current="page">Your features</button><button type="button" onClick={onOpenWorkbench}>Authorization demo</button></nav>
      <div className="sidebar-note"><span>●</span> Demonstration mode<br/><small>Fictional features only. Coding agents never receive authority without an approved lease.</small></div>
    </aside>
    <section className="shell">
      <header><div><p className="eyebrow">FEATURE LIST → VERIFIED DELIVERY</p><h1>Choose a feature. ADX guides the rest.</h1><p className="lede">Start with a list, pick one feature, and take one safe next step at a time.</p></div><div className="header-actions"><a className="secondary download" href="/samples/adx-health-insurance-features.csv" download>Download CSV sample</a><label className="primary upload">Import CSV<input type="file" accept=".csv,text/csv" onChange={importFile}/></label></div></header>
      <div className="notice" role="status" aria-live="polite">✓ {notice}<button type="button" onClick={() => setNotice('')}>Dismiss</button></div>
      <section className="metrics" aria-label="Feature delivery overview"><Metric value={features.length} label="Features in your list" tone="blue"/><Metric value={features.filter((feature) => feature.state !== 'BACKLOG').length} label="Features in progress" tone="green"/><Metric value={features.filter((feature) => feature.state === 'COMPLETED').length} label="Outcomes recorded" tone="gold"/></section>
      <div className="feature-layout">
        <section className="card feature-list"><div className="section-heading"><div><p className="eyebrow">YOUR FEATURES</p><h2>Choose one to begin</h2></div><span className="count">{features.length}</span></div>{features.map((feature) => <button type="button" key={feature.id} className={`feature-row ${selected.id === feature.id ? 'selected' : ''}`} aria-pressed={selected.id === feature.id} onClick={() => setSelectedId(feature.id)}><div><strong>{feature.id}</strong><span>{feature.title}</span></div><em>{feature.riskTier}</em><small>{stageNames[feature.state]}</small></button>)}</section>
        <section className="feature-detail">
          <section className="card feature-hero"><div><p className="eyebrow">{selected.id} · {selected.priority} · {selected.riskTier}</p><h2>{selected.title}</h2><p>{selected.description}</p></div><span className="delivery-state">Now: {stageNames[selected.state]}</span></section>
          <Timeline state={selected.state}/>
          <div className="two-col"><section className="card feature-spec"><p className="eyebrow">WHAT ADX WILL USE</p><h2>Feature details</h2><dl><div><dt>Owner</dt><dd>{selected.owner}</dd></div><div><dt>Target repository</dt><dd>{selected.repository}</dd></div><div><dt>Done when</dt><dd>{selected.acceptanceCriteria}</dd></div><div><dt>Review level</dt><dd>{selected.riskTier} · required safeguards apply</dd></div></dl></section><section className="card actions"><p className="eyebrow">YOUR NEXT STEP</p><h2>{action?.label ?? 'This cycle is complete'}</h2><p>{action?.proof ?? 'The outcome is recorded. Any new work begins as a new linked Change Case.'}</p>{action && <button type="button" className="primary full" onClick={advance}>{action.label}</button>}<small className="action-note">ADX records the required proof before it can continue.</small></section></div>
          <section className="card ledger"><div className="section-heading"><div><p className="eyebrow">ACTIVITY</p><h2>What has happened</h2></div><span className="integrity">● Source linked</span></div>{selected.events.length ? <ol>{selected.events.map((event, index) => <li key={`${event}-${index}`}><time>{index + 1}</time><span className="event-dot"/><div><strong>{event}</strong><p>Feature {selected.id} · required proof recorded</p></div></li>)}</ol> : <div className="empty">Nothing has happened yet. Start with “Create Change Case” when you are ready.</div>}</section>
        </section>
      </div>
    </section>
  </main>
}

function Metric({ value, label, tone }: { value: string | number; label: string; tone: string }) { return <div className={`metric ${tone}`}><strong>{value}</strong><span>{label}</span></div> }
function Timeline({ state }: { state: DeliveryState }) { const steps: DeliveryState[] = ['BACKLOG', 'CLARIFY', 'DESIGN', 'EXECUTION', 'VERIFY', 'RELEASE', 'COMPLETED']; const current = steps.indexOf(state); return <section className="delivery-timeline" aria-label="Feature delivery workflow">{steps.map((step, index) => <div key={step} className={index <= current ? 'done' : ''}><span>{index < current ? '✓' : index + 1}</span><strong>{stageNames[step]}</strong></div>)}</section> }
