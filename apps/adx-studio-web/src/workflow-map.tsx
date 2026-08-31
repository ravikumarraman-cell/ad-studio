import { gates, gateState } from './workflow'

export function WorkflowMap({ current }: { current: number }) {
  const currentGate = gates[Math.min(current, gates.length - 1)]
  const counts = gates.reduce(
    (acc, _, index) => {
      const status = gateState(index, current)
      if (status === 'complete') acc.complete += 1
      else if (status === 'current') acc.current += 1
      else acc.waiting += 1
      return acc
    },
    { complete: 0, current: 0, waiting: 0 },
  )

  return <details className="adx-workflow-map" aria-label="Change Case workflow">
    <summary className="adx-workflow-summary-toggle">
      <div>
        <p className="adx-eyebrow">WORKFLOW</p>
        <h2>From feature to governed delivery</h2>
      </div>
      <div className="adx-workflow-summary-copy">
        <strong>Gate {currentGate.id} · {currentGate.name}</strong>
        <span>{counts.complete} complete · {counts.current} now · {counts.waiting} locked</span>
      </div>
    </summary>
    <div className="adx-workflow-body">
      <div className="adx-workflow-intro">
        <p className="adx-workflow-summary">One current gate, earlier gates complete, and later gates locked until the required evidence exists.</p>
        <dl className="adx-workflow-stats" aria-label="Workflow progress summary">
          <div><dt>Complete</dt><dd>{counts.complete}</dd></div>
          <div><dt>Current</dt><dd>{counts.current}</dd></div>
          <div><dt>Locked</dt><dd>{counts.waiting}</dd></div>
        </dl>
      </div>
      <ol className="adx-workflow-steps">
        {gates.map((gate, index) => {
          const status = gateState(index, current)
          const stateText = status === 'complete' ? 'Complete' : status === 'current' ? 'Do this now' : 'Locked'
          return <li key={gate.id} className={`adx-workflow-step ${status === 'waiting' ? 'later' : status}`}>
            <span className="adx-workflow-step-index">{gate.id}</span>
            <div>
              <strong>{gate.name}</strong>
              <small>{gate.purpose}</small>
            </div>
            <em>{stateText}</em>
          </li>
        })}
      </ol>
    </div>
  </details>
}
