import { useEffect, useRef, useState } from 'react'

const steps = [
  ['1', 'Define the work', 'Gate A'],
  ['2', 'Generate & curate stories', 'Gate A.5'],
  ['3', 'Approve the story set', 'Gate B'],
  ['4', 'Review the design', 'Gate C'],
  ['5', 'Choose an agent', 'Execution planning'],
  ['6', 'Run in a bounded sandbox', 'Execution'],
  ['7', 'Verify the candidate', 'Gate D'],
  ['8', 'Review delivery', 'Gate E'],
  ['9', 'Record the outcome', 'Gate F'],
] as const

const suggestions = [
  'Submit a complete prior-authorization request',
  'See request status and the next required action',
  'Retain a reviewer-ready decision trail',
]

const guidance = [
  {
    why: 'Capture a bounded request before the team writes stories or plans implementation.',
    next: 'Describe the feature, its desired outcome, and the declared risk, then continue to story curation.',
    authority: 'The requester supplies the intent. This step does not approve work or authorize execution.',
  },
  {
    why: 'Turn the request into small, observable outcomes that a reviewer can evaluate.',
    next: 'Select the stories that describe the desired behavior, then continue to independent review.',
    authority: 'Selecting a story prepares it for review. It is not an approval.',
  },
  {
    why: 'An independent reviewer confirms the expected behavior before design begins.',
    next: 'Review the selected story contracts and record an independent decision.',
    authority: 'The story author cannot approve their own revision.',
  },
  {
    why: 'Design, security, risk, and exceptions must be understood before implementation is allowed.',
    next: 'Review the design evidence and confirm that the risk controls are sufficient.',
    authority: 'An authorized independent reviewer makes the decision.',
  },
  {
    why: 'Choose a proposed implementation provider without granting it authority.',
    next: 'Choose a provider for the simulated plan, then inspect its bounded execution context.',
    authority: 'Provider selection does not grant credentials or execution authority.',
  },
  {
    why: 'Implementation must operate under an explicit, bounded lease.',
    next: 'Review the simulated lease scope and continue to independent verification.',
    authority: 'The bounded runner may not approve, deploy, or change policy.',
  },
  {
    why: 'A fresh verifier must evaluate the exact candidate independently of the implementer.',
    next: 'Review the verifier record and continue only when its retained checks pass.',
    authority: 'The verifier reads evidence; it does not modify the candidate.',
  },
  {
    why: 'Delivery review evaluates the exact preview and findings without treating review as release.',
    next: 'Review the simulated preview evidence before recording the outcome.',
    authority: 'No merge, rollout, or release occurs in this guided demo.',
  },
  {
    why: 'A factual outcome lets later work learn from what actually happened.',
    next: 'Review the observed outcome and complete the guided walkthrough.',
    authority: 'Outcome recording does not change a real system in demo mode.',
  },
] as const

export function GuidedDemo({ onExit, onReal }: { onExit: () => void; onReal: () => void }) {
  const [step, setStep] = useState(0)
  const [title, setTitle] = useState('Provider prior-authorization intake and status')
  const [outcome, setOutcome] = useState(
    'Allow provider staff to submit a complete prior-authorization request, correct validation issues, and track the next required action.',
  )
  const [risk, setRisk] = useState('R3')
  const [selected, setSelected] = useState<string[]>([])
  const [agent, setAgent] = useState('Codex')
  const [completed, setCompleted] = useState(false)
  const stageHeadingRef = useRef<HTMLHeadingElement>(null)
  const completionHeadingRef = useRef<HTMLHeadingElement>(null)
  const previousStepRef = useRef(step)

  useEffect(() => {
    if (completed) {
      completionHeadingRef.current?.focus()
      return
    }
    if (previousStepRef.current !== step) stageHeadingRef.current?.focus()
    previousStepRef.current = step
  }, [completed, step])

  const current = steps[step]
  const currentGuidance = guidance[step]
  const needsIntakeDetails = step === 0 && (!title.trim() || !outcome.trim())
  const needsStorySelection = step === 1 && !selected.length
  const cannotContinue = needsIntakeDetails || needsStorySelection

  const toggle = (story: string) => {
    setSelected((items) =>
      items.includes(story) ? items.filter((item) => item !== story) : [...items, story],
    )
  }

  const next = () => {
    if (cannotContinue) return
    if (step === steps.length - 1) {
      setCompleted(true)
      return
    }
    setStep((value) => Math.min(steps.length - 1, value + 1))
  }

  const startOver = () => {
    setStep(0)
    setSelected([])
    setCompleted(false)
  }

  const artifact: [string, string[]] | null =
    step === 2
      ? [
          'Independent story approval',
          [
            `${selected.length} selected story contracts`,
            'Reviewer rationale is bound to the story digest',
            'The author cannot approve their own revision',
          ],
        ]
      : step === 3
        ? [
            'Design and security review',
            [
              'Architecture: tenant-scoped provider request workflow',
              `Risk: ${risk} control evidence and exception handling`,
              'Tests: authorization, validation, and audit coverage',
            ],
          ]
        : step === 5
          ? [
              `Simulated bounded ${agent} run`,
              [
                'Signed lease and disposable worktree',
                'Approved paths and egress only',
                'Illustrative patch receipt only; no agent is invoked',
              ],
            ]
          : step === 6
            ? [
                'Simulated independent verification record',
                [
                  'Exact candidate digest and verifier version',
                  'Build and authorization checks: PASS',
                  'Security and SBOM evidence retained',
                ],
              ]
            : step === 7
              ? [
                  'Simulated delivery review',
                  [
                    'Preview commit and CI observations are commit-bound',
                    'No merge, feature flag change, or release occurs here',
                    'Independent reviewer decision required before delivery',
                  ],
                ]
              : step === 8
                ? [
                    'Simulated observed outcome',
                    [
                      'Controlled rollout completed without rollback',
                      'Measure: complete request submissions increased',
                      'Learning: validation criteria were clarified before execution',
                    ],
                  ]
                : null

  return (
    <main className="adx-app">
      <aside className="adx-sidebar">
        <div className="adx-brand">
          <span>A</span>
          <div>
            <strong>ADX</strong>
            <small>Guided demo</small>
          </div>
        </div>
        <nav>
          <button className="adx-mode-link" onClick={onExit}>Choose mode</button>
          <button className="adx-mode-link" onClick={onReal}>Open real mode</button>
        </nav>
        <div className="adx-user">
          <strong>Demo only</strong>
          <small>No data is stored or sent.</small>
        </div>
      </aside>

      <section className="adx-content">
        <header className="adx-header">
          <div>
            <p className="adx-eyebrow">GUIDED DEMO - FICTIONAL - NO ACTIONS RUN</p>
            <h1>Run a feature through ADX.</h1>
            <p>Enter a realistic feature, then make the same decisions a delivery team would make.</p>
          </div>
          <button className="adx-secondary" onClick={startOver}>Start over</button>
        </header>

        <section className="adx-demo-steps" aria-label="Demo progress">
          {steps.map((item, index) => (
            <button
              key={item[0]}
              className={index === step ? 'current' : index < step ? 'complete' : ' '}
              onClick={() => setStep(index)}
              disabled={index > step}
              aria-current={index === step ? 'step' : undefined}
            >
              <span>{index < step ? 'Done' : item[0]}</span>
              <strong>{item[1]}</strong>
              <small>{item[2]}</small>
            </button>
          ))}
        </section>

        <section className="adx-demo-workbench">
          <div className="adx-demo-copy">
            <p className="adx-eyebrow">STEP {current[0]} - {current[2]}</p>
            <h2 ref={stageHeadingRef} tabIndex={-1}>{current[1]} - {title || 'New feature'}</h2>
            <p>{outcome || 'Describe the outcome to begin.'}</p>
          </div>

          <section className="adx-demo-detail" aria-labelledby="decision-frame-heading">
            <h3 id="decision-frame-heading">Decision frame</h3>
            <p><strong>Why this stage:</strong> {currentGuidance.why}</p>
            <p><strong>Next safe action:</strong> {currentGuidance.next}</p>
            <p><strong>Authority:</strong> {currentGuidance.authority}</p>
          </section>

          {step === 0 && (
            <section className="adx-demo-detail">
              <h3>Feature intake</h3>
              <label className="adx-demo-input">
                Feature title
                <input value={title} onChange={(event) => setTitle(event.target.value)} />
              </label>
              <label className="adx-demo-input">
                Desired outcome
                <textarea value={outcome} onChange={(event) => setOutcome(event.target.value)} />
              </label>
              <label className="adx-demo-input">
                Declared risk
                <select value={risk} onChange={(event) => setRisk(event.target.value)}>
                  {['R1', 'R2', 'R3', 'R4'].map((value) => <option key={value}>{value}</option>)}
                </select>
              </label>
              <p className="adx-demo-proof">ADX would retain this feature, classify its risk, and request clarification if needed.</p>
              {needsIntakeDetails && <small>Enter a feature title and desired outcome to continue.</small>}
            </section>
          )}

          {step === 1 && (
            <section className="adx-demo-detail">
              <h3>Story suggestions for this feature</h3>
              {suggestions.map((story) => (
                <label key={story} className="adx-agent-choices">
                  <input type="checkbox" checked={selected.includes(story)} onChange={() => toggle(story)} />
                  <span>
                    <strong>{story}</strong>
                    <small>Given an authorized user; when they complete the action; then the observable outcome is retained.</small>
                  </span>
                </label>
              ))}
              <p className="adx-demo-proof">{selected.length} selected. No story is approved by selecting it.</p>
            </section>
          )}

          {step === 4 && (
            <section className="adx-demo-detail">
              <h3>Choose an implementation provider</h3>
              {['Codex', 'Claude Code', 'GitHub Copilot'].map((provider) => (
                <label key={provider} className="adx-agent-choices">
                  <input type="radio" name="agent" checked={agent === provider} onChange={() => setAgent(provider)} />
                  <span>
                    <strong>{provider}</strong>
                    <small>Planning only; it grants no credential or execution authority.</small>
                  </span>
                </label>
              ))}
            </section>
          )}

          {artifact && (
            <section className="adx-demo-detail">
              <h3>{artifact[0]}</h3>
              <div className="adx-demo-grid">
                {artifact[1].map((item) => <span key={item}>{item}</span>)}
              </div>
              <p className="adx-demo-proof">Realistic artifact preview only; no live command runs in demo mode.</p>
            </section>
          )}

          {completed ? (
            <section className="adx-demo-actions" aria-labelledby="demo-complete-heading">
              <p className="adx-eyebrow">GUIDED DEMO COMPLETE</p>
              <h3 ref={completionHeadingRef} id="demo-complete-heading" tabIndex={-1}>No records were created or changed.</h3>
              <p>Return to the delivery paths when you are ready to choose a real workspace or restart this walkthrough.</p>
              <button className="adx-primary" onClick={onExit}>Choose a delivery path</button>
            </section>
          ) : (
            <section className="adx-demo-actions">
              <p className="adx-eyebrow">SAFE DEMO ACTION</p>
              <button className="adx-primary" onClick={next} disabled={cannotContinue}>
                {step === 1 ? 'Accept selected stories' : step === steps.length - 1 ? 'Finish guided demo' : 'Continue walkthrough'}
              </button>
              {needsStorySelection && <small>Select at least one story to continue.</small>}
            </section>
          )}

          <footer>
            <button className="adx-secondary" onClick={() => setStep((value) => Math.max(0, value - 1))} disabled={!step}>Back</button>
          </footer>
        </section>
      </section>
    </main>
  )
}
