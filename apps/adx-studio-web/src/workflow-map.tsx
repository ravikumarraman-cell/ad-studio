import { gates, gateState } from './workflow'

export function WorkflowMap({ current }: { current: number }) {
  return <section className="adx-workflow-map" aria-label="Change Case workflow">
    <div>
      <p className="adx-eyebrow">WORKFLOW</p>
      <h2>From feature to governed delivery</h2>
      <p>Story generation is a deliberate authoring step before independent approval.</p>
      <p aria-label="Workflow state legend">Complete: finished. Do this now: your current gate. Later: locked until earlier evidence is retained.</p>
    </div>
    <ol>
      {gates.map((gate, index) => {
        const status = gateState(index, current)
        return <li key={gate.id} className={status}>
          <span>{gate.id}</span>
          <div><strong>{gate.name}</strong><small>{status === 'complete' ? 'Complete' : status === 'current' ? 'Do this now' : 'Later'}</small></div>
        </li>
      })}
    </ol>
  </section>
}
