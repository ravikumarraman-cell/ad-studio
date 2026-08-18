import React, { FormEvent, useMemo, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query'
import { FeatureDelivery } from './feature-delivery'
import './styles.css'

type CaseState = 'INTAKE' | 'CLINICAL_REVIEW' | 'PENDING_HUMAN_REVIEW' | 'APPROVED' | 'DENIED'
type Risk = 'STANDARD' | 'ELEVATED' | 'HIGH'
type EventKind = 'REQUEST' | 'ELIGIBILITY' | 'EVIDENCE' | 'GATE' | 'DECISION'

type LedgerEvent = { id: string; at: string; actor: string; kind: EventKind; label: string; digest: string }
type AuthorizationCase = {
  id: string
  member: string
  service: string
  provider: string
  state: CaseState
  risk: Risk
  due: string
  confidence: number
  explanation: string
  events: LedgerEvent[]
}

const today = '2026-08-18'
const seededCases: AuthorizationCase[] = [
  {
    id: 'PA-20481', member: 'Avery K. · DEMO', service: 'MRI, lower extremity', provider: 'Northlake Orthopedics', state: 'PENDING_HUMAN_REVIEW', risk: 'ELEVATED', due: 'Today, 3:30 PM', confidence: 92,
    explanation: 'Coverage criteria and the submitted clinical notes are complete. A licensed reviewer must make the determination.',
    events: [
      { id: 'evt-01', at: '09:12', actor: 'Provider portal', kind: 'REQUEST', label: 'Prior-authorization request submitted', digest: 'a91f…74c2' },
      { id: 'evt-02', at: '09:13', actor: 'Eligibility service', kind: 'ELIGIBILITY', label: 'Active coverage and benefit verified', digest: 'd117…8bb4' },
      { id: 'evt-03', at: '09:16', actor: 'Evidence service', kind: 'EVIDENCE', label: 'Clinical documentation completeness verified', digest: '04a8…e091' },
      { id: 'evt-04', at: '09:17', actor: 'ADX policy', kind: 'GATE', label: 'Escalated: licensed reviewer required', digest: 'bc21…56fe' },
    ],
  },
  {
    id: 'PA-20478', member: 'Jordan M. · DEMO', service: 'Physical therapy, 8 visits', provider: 'Riverbend Rehab', state: 'CLINICAL_REVIEW', risk: 'STANDARD', due: 'Today, 5:00 PM', confidence: 84,
    explanation: 'Intake is complete. ADX is assembling a structured evidence packet for reviewer consideration.', events: [],
  },
  {
    id: 'PA-20470', member: 'Sam R. · DEMO', service: 'Specialty medication continuation', provider: 'Harbor Specialty', state: 'APPROVED', risk: 'HIGH', due: 'Completed', confidence: 97,
    explanation: 'Demonstration record only. The recorded determination is available with its evidence trail.', events: [],
  },
]

const stateLabel: Record<CaseState, string> = {
  INTAKE: 'Intake', CLINICAL_REVIEW: 'Evidence review', PENDING_HUMAN_REVIEW: 'Human review', APPROVED: 'Determination recorded', DENIED: 'Determination recorded',
}

const riskLabel: Record<Risk, string> = { STANDARD: 'Standard', ELEVATED: 'Elevated', HIGH: 'High' }

function digest(seed: string) { return `${seed.slice(0, 4).padEnd(4, '0')}…${Math.abs(seed.split('').reduce((n, c) => n * 31 + c.charCodeAt(0), 7)).toString(16).slice(0, 4)}` }

function App() {
  const [view, setView] = useState<'features' | 'authorization'>('features')
  const [cases, setCases] = useState(seededCases)
  const [selectedId, setSelectedId] = useState(seededCases[0].id)
  const [showCreate, setShowCreate] = useState(false)
  const [notice, setNotice] = useState('')
  const casesQuery = useQuery({ queryKey: ['authorization-cases', cases], queryFn: async () => cases, initialData: cases })
  const selected = casesQuery.data.find((item) => item.id === selectedId) ?? casesQuery.data[0]
  const openCases = cases.filter((item) => !['APPROVED', 'DENIED'].includes(item.state)).length
  const completed = cases.filter((item) => ['APPROVED', 'DENIED'].includes(item.state)).length

  if (view === 'features') return <FeatureDelivery onOpenWorkbench={() => setView('authorization')} />

  const mutateCase = (next: CaseState, label: string, actor = 'Licensed reviewer') => {
    if (!selected) return
    const at = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    const event: LedgerEvent = { id: crypto.randomUUID(), at, actor, kind: 'DECISION', label, digest: digest(`${selected.id}-${next}-${Date.now()}`) }
    setCases((items) => items.map((item) => item.id === selected.id ? { ...item, state: next, events: [...item.events, event] } : item))
    setNotice(`${selected.id}: ${label}`)
  }

  const createCase = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const data = new FormData(event.currentTarget)
    const service = String(data.get('service'))
    const provider = String(data.get('provider'))
    const created: AuthorizationCase = {
      id: `PA-${20482 + cases.length}`, member: `${String(data.get('member'))} · DEMO`, service, provider, state: 'INTAKE', risk: 'STANDARD', due: 'Next business day', confidence: 0,
      explanation: 'Request created. It awaits eligibility verification and evidence intake.',
      events: [{ id: crypto.randomUUID(), at: 'Now', actor: 'Intake coordinator', kind: 'REQUEST', label: 'Prior-authorization request created', digest: digest(service + provider) }],
    }
    setCases((items) => [created, ...items]); setSelectedId(created.id); setShowCreate(false); setNotice(`${created.id} created and queued for governed intake.`)
  }

  if (!selected) return null
  return <main>
    <aside className="sidebar">
      <div className="brand"><span className="brand-mark">A</span><div><strong>ADX</strong><small>Health operations demo</small></div></div>
      <nav><button className="active">Authorization workbench</button><button onClick={() => setView('features')}>Feature delivery</button><button>Evidence ledger</button><button>Policy controls</button></nav>
      <div className="sidebar-note"><span>●</span> Demonstration mode<br/><small>No protected health information. No clinical or coverage decision is automated.</small></div>
    </aside>
    <section className="shell">
      <header><div><p className="eyebrow">HEALTH INSURANCE · PRIOR AUTHORIZATION</p><h1>A decision workflow people can trust.</h1><p className="lede">ADX organizes evidence, enforces policy gates, and preserves a verifiable record. Licensed humans make determinations.</p></div><button className="primary" onClick={() => setShowCreate(true)}>+ New request</button></header>
      {notice && <div className="notice" role="status">✓ {notice}<button onClick={() => setNotice('')}>Dismiss</button></div>}
      <section className="metrics" aria-label="Operational overview"><Metric value={openCases} label="Open requests" tone="blue"/><Metric value="100%" label="Evidence-bound gates" tone="green"/><Metric value={completed} label="Recorded outcomes" tone="purple"/><Metric value="0" label="Automated determinations" tone="gold"/></section>
      <div className="workbench">
        <section className="case-list card"><div className="section-heading"><div><p className="eyebrow">QUEUE</p><h2>Authorization cases</h2></div><span className="count">{cases.length}</span></div><div className="case-items">{cases.map((item) => <button key={item.id} className={`case-item ${item.id === selected.id ? 'selected' : ''}`} onClick={() => setSelectedId(item.id)}><div><strong>{item.id}</strong><span>{item.member}</span></div><span className={`pill ${item.state.toLowerCase()}`}>{stateLabel[item.state]}</span><p>{item.service}</p><small>{item.due}</small></button>)}</div></section>
        <section className="detail"><div className="case-hero card"><div><p className="eyebrow">{selected.id} · {riskLabel[selected.risk]} review</p><h2>{selected.service}</h2><p>{selected.member} · {selected.provider}</p></div><span className={`pill large ${selected.state.toLowerCase()}`}>{stateLabel[selected.state]}</span></div><Lifecycle state={selected.state}/><div className="two-col"><section className="card evidence"><p className="eyebrow">EVIDENCE SUMMARY</p><h2>Reviewer-ready, not decision-making</h2><p>{selected.explanation}</p><div className="confidence"><div><span>Evidence completeness</span><strong>{selected.confidence}%</strong></div><div className="bar"><i style={{ width: `${selected.confidence}%` }}/></div></div><div className="evidence-grid"><Evidence label="Coverage eligibility" value="Verified"/><Evidence label="Clinical records" value={selected.confidence > 0 ? 'Complete' : 'Awaiting intake'}/><Evidence label="Policy version" value="PA-2026.08"/><Evidence label="Decision authority" value="Licensed reviewer"/></div></section><section className="card actions"><p className="eyebrow">GOVERNED ACTIONS</p><h2>What can happen now</h2><p>Every action checks role, policy version, evidence freshness, and a tamper-evident ledger.</p>{selected.state === 'INTAKE' && <button className="primary full" onClick={() => mutateCase('CLINICAL_REVIEW', 'Eligibility verification requested', 'ADX workflow')}>Start governed intake</button>}{selected.state === 'CLINICAL_REVIEW' && <button className="primary full" onClick={() => mutateCase('PENDING_HUMAN_REVIEW', 'Evidence packet sealed; human review required', 'ADX evidence service')}>Seal evidence packet</button>}{selected.state === 'PENDING_HUMAN_REVIEW' && <><button className="primary full" onClick={() => mutateCase('APPROVED', 'Coverage determination recorded: approved')}>Record approval</button><button className="secondary full" onClick={() => mutateCase('DENIED', 'Coverage determination recorded: denied')}>Record denial</button></>}{['APPROVED', 'DENIED'].includes(selected.state) && <button className="secondary full" onClick={() => setNotice('The outcome record, evidence digests, and reviewer attestation are preserved in the ledger.')}>View outcome record</button>}<small className="action-note">Human authority is required for a determination.</small></section></div><section className="card ledger"><div className="section-heading"><div><p className="eyebrow">TAMPER-EVIDENT LEDGER</p><h2>Case activity</h2></div><span className="integrity">● Integrity verified</span></div>{selected.events.length ? <ol>{selected.events.map((event) => <li key={event.id}><time>{event.at}</time><span className={`event-dot ${event.kind.toLowerCase()}`}/><div><strong>{event.label}</strong><p>{event.actor} · <code>{event.digest}</code></p></div></li>)}</ol> : <div className="empty">No activity recorded yet. Start governed intake to create the first auditable event.</div>}</section></section>
      </div>
    </section>
    {showCreate && <div className="modal-backdrop" role="presentation"><form className="modal" onSubmit={createCase}><div className="section-heading"><div><p className="eyebrow">DEMONSTRATION INTAKE</p><h2>Create a request</h2></div><button type="button" className="icon-button" onClick={() => setShowCreate(false)}>×</button></div><p>Use fictional data only. This demonstration does not issue health-insurance determinations.</p><label>Member display name<input name="member" required placeholder="Taylor S."/></label><label>Requested service<input name="service" required placeholder="e.g., MRI, lower extremity"/></label><label>Requesting provider<input name="provider" required placeholder="e.g., Northlake Orthopedics"/></label><div className="modal-actions"><button type="button" className="secondary" onClick={() => setShowCreate(false)}>Cancel</button><button className="primary" type="submit">Create governed request</button></div></form></div>}
  </main>
}

function Metric({ value, label, tone }: { value: string | number; label: string; tone: string }) { return <div className={`metric ${tone}`}><strong>{value}</strong><span>{label}</span></div> }
function Evidence({ label, value }: { label: string; value: string }) { return <div><span>{label}</span><strong>{value}</strong></div> }
function Lifecycle({ state }: { state: CaseState }) { const steps = ['INTAKE', 'CLINICAL_REVIEW', 'PENDING_HUMAN_REVIEW', 'APPROVED'] as const; const current = state === 'DENIED' ? 3 : Math.max(0, steps.indexOf(state as typeof steps[number])); return <section className="lifecycle" aria-label="Workflow status">{steps.map((step, index) => <div key={step} className={index <= current ? 'done' : ''}><span>{index < current ? '✓' : index + 1}</span><strong>{index === 0 ? 'Intake' : index === 1 ? 'Evidence review' : index === 2 ? 'Human decision' : 'Outcome'}</strong></div>)}</section> }

const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity } } })
createRoot(document.getElementById('root')!).render(<React.StrictMode><QueryClientProvider client={queryClient}><App /></QueryClientProvider></React.StrictMode>)
