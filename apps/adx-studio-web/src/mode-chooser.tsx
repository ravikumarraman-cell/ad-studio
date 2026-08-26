import './mode-chooser.css'

export function ModeChooser({ onChoose, workspaceReady }: { onChoose: (mode: 'real' | 'demo') => void; workspaceReady: boolean }) {
  return <main className="adx-mode-home">
    <header className="adx-home-header">
      <a className="adx-home-brand" href="/" aria-label="ADX home"><span>ADX</span><strong>Delivery control</strong></a>
      <p>Governed change management</p>
    </header>
    <section className="adx-home-stage" aria-labelledby="home-title">
      <div className="adx-home-intro">
        <p className="adx-home-kicker">A clear start for every change</p>
        <h1 id="home-title">Choose your delivery path.</h1>
        <p className="adx-home-summary">Open work assigned to you, or walk through a contained case before entering a workspace.</p>
        <dl className="adx-home-principles">
          <div><dt>Scope</dt><dd>Only authorized Change Cases are visible.</dd></div>
          <div><dt>Review</dt><dd>Every decision remains attributable.</dd></div>
          <div><dt>Control</dt><dd>Guided work has no delivery authority.</dd></div>
        </dl>
      </div>
      <section className="adx-home-paths" aria-label="Choose a delivery path">
        {workspaceReady ? <button className="adx-home-path adx-home-path-primary" onClick={() => onChoose('real')}>
          <span className="adx-home-path-index">01</span>
          <div className="adx-home-path-heading"><p>Authorized workspace</p><h2>Open my Change Cases</h2></div>
          <p>Sign in to continue work already assigned to your identity and workspace.</p>
          <strong>Open workspace <span aria-hidden="true">-&gt;</span></strong>
        </button> : <a className="adx-home-path adx-home-path-primary" href="/auth/login">
          <span className="adx-home-path-index">01</span>
          <div className="adx-home-path-heading"><p>Authorized workspace</p><h2>Open my Change Cases</h2></div>
          <p>Sign in to continue work already assigned to your identity and workspace.</p>
          <strong>Sign in to workspace <span aria-hidden="true">-&gt;</span></strong>
        </a>}
        <button className="adx-home-path adx-home-path-secondary" onClick={() => onChoose('demo')}>
          <span className="adx-home-path-index">02</span>
          <div className="adx-home-path-heading"><p>Guided case</p><h2>Explore a provider intake change</h2></div>
          <p>Follow a realistic R3 authorization scenario without creating records or invoking an agent.</p>
          <strong>Start guided case <span aria-hidden="true">-&gt;</span></strong>
        </button>
      </section>
    </section>
    <footer className="adx-home-footer"><span>Identity-gated workspaces</span><span>Evidence-bound review</span><span>Preview-only delivery</span></footer>
  </main>
}
