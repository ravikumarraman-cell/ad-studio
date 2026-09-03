export const adxPageThemeCss = `<style id="adx-page-theme">
  :root{
    --adx-ink:#102b43;
    --adx-copy:#36566c;
    --adx-muted:#587487;
    --adx-canvas:#eef4f1;
    --adx-surface:#ffffff;
    --adx-surface-soft:#f4f9fb;
    --adx-line:#bfd0dc;
    --adx-line-strong:#aebfca;
    --adx-brand:#0a6b8f;
    --adx-brand-deep:#074e70;
    --adx-brand-strong:#0e5f53;
    --adx-brand-soft:rgba(10,107,143,.12);
    --adx-mint:#0c7c62;
    --adx-mint-soft:#e2f5ed;
    --adx-gold:#bd7900;
    --adx-gold-soft:#fff2cf;
    --adx-danger:#a33232;
    --adx-danger-soft:#fff0f0;
    --adx-focus:#d98a00;
    --adx-shadow:0 18px 42px rgb(16 43 67 / 12%);
    --adx-shadow-soft:0 10px 28px rgb(16 43 67 / 8%);
    --adx-panel-inset:clamp(18px,2.2vw,28px);
    --adx-radius:16px;
    --adx-radius-lg:24px;
    --adx-display:Georgia,"Times New Roman",serif;
    --adx-body:"Avenir Next","Segoe UI",sans-serif;
    color:var(--adx-ink);
    background:
      radial-gradient(circle at top left, rgba(10,107,143,.08), transparent 24%),
      radial-gradient(circle at top right, rgba(12,124,98,.08), transparent 28%),
      linear-gradient(180deg,#f5f8f6 0%,#eef4f1 44%,#edf4ef 100%);
    font-family:var(--adx-body);
  }
  *{box-sizing:border-box}
  body{
    margin:0;
    min-height:100vh;
    color:var(--adx-ink);
    background:
      radial-gradient(circle at top left, rgba(10,107,143,.08), transparent 24%),
      radial-gradient(circle at top right, rgba(12,124,98,.08), transparent 28%),
      linear-gradient(180deg,#f5f8f6 0%,#eef4f1 44%,#edf4ef 100%);
  }
  main{
    max-width:1260px;
    margin:0 auto;
    padding:28px clamp(18px,4vw,64px) 64px;
    min-width:0;
  }
  main > header:not(.topbar):not(.hero):not(.section-head):not(.console-header):not(.case-head):not(.evidence-head),
  main > section,
  main > article,
  main > form,
  .panel,
  .card,
  .notice,
  .request-panel,
  .run-console,
  .failure-details,
  .action-panel,
  .decision-panel,
  .assurance,
  .gate-status,
  .next,
  .artifact,
  .preview,
  .workflow-card,
  .workspace-card{
    background:rgba(255,255,255,.88);
    border:1px solid rgba(191,208,220,.92);
    border-radius:var(--adx-radius-lg);
    box-shadow:var(--adx-shadow);
    backdrop-filter:blur(12px);
  }
  /* A review panel always has the same breathing room as its cards. */
  main > section.layout,
  main > section.workspace{
    padding:var(--adx-panel-inset);
  }
  .topbar,
  .hero,
  .section-head,
  .console-header,
  .case-head,
  .evidence-head{
    border:0!important;
    background:transparent!important;
    box-shadow:none!important;
    backdrop-filter:none!important;
  }
  .topbar{
    display:flex;
    justify-content:space-between;
    align-items:center;
    gap:18px;
    padding-bottom:18px;
  }
  .adx-page-brand,
  .brand{
    display:inline-flex;
    align-items:center;
    gap:9px;
    color:var(--adx-ink);
    font-size:.75rem;
    font-weight:850;
    letter-spacing:.1em;
    text-transform:uppercase;
  }
  .adx-page-brand b,
  .brand b{
    display:grid;
    place-items:center;
    width:34px;
    height:27px;
    border-radius:8px;
    background:linear-gradient(135deg,var(--adx-brand-deep),var(--adx-brand));
    color:#f5fbf8;
    font-size:.69rem;
    box-shadow:0 8px 20px rgb(7 78 112 / 16%);
  }
  .state,
  .case-state,
  .run-clock{
    margin:0;
    padding:10px 14px;
    border:1px solid var(--adx-line);
    border-radius:999px;
    background:rgba(255,255,255,.86);
    color:var(--adx-copy);
    font:700 .76rem ui-monospace,SFMono-Regular,monospace;
    box-shadow:var(--adx-shadow-soft);
    white-space:nowrap;
  }
  .eyebrow,
  .panel-label,
  .artifact-kicker,
  .workflow-kicker{
    margin:0 0 8px;
    color:var(--adx-brand-strong);
    font-size:.74rem;
    font-weight:800;
    letter-spacing:.12em;
    text-transform:uppercase;
  }
  h1{
    margin:0;
    font-family:var(--adx-display);
    font-size:clamp(2.3rem,5vw,4.4rem);
    font-weight:500;
    line-height:.98;
    letter-spacing:-.03em;
  }
  h2,h3{
    margin:0;
    font-family:var(--adx-display);
    font-weight:500;
    letter-spacing:-.02em;
    color:var(--adx-ink);
  }
  h2{font-size:1.7rem;line-height:1.12}
  h3{font-size:1.15rem;line-height:1.2}
  p{color:var(--adx-copy)}
  a{color:var(--adx-brand)}
  code,pre{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;overflow-wrap:anywhere;word-break:break-word}
  .identifier,
  .provenance,
  .decision-provenance{overflow-wrap:anywhere;word-break:break-word}
  button,
  .button,
  .review-link,
  .workspace-return-link,
  .candidate-link a,
  .text-link{
    border-radius:999px;
    transition:transform .18s ease,box-shadow .18s ease,filter .18s ease,border-color .18s ease,background-color .18s ease;
  }
  button:focus-visible,a:focus-visible,input:focus-visible,select:focus-visible,textarea:focus-visible{outline:3px solid var(--adx-focus);outline-offset:3px}
  button:disabled{cursor:not-allowed;opacity:.62}
  .button,
  button{
    border:1px solid transparent;
    background:linear-gradient(135deg,var(--adx-brand-deep),var(--adx-mint));
    color:#f9fffd;
    box-shadow:0 10px 24px rgb(12 124 98 / 18%);
    font-weight:800;
  }
  .button:hover,
  button:hover{
    transform:translateY(-1px);
    filter:saturate(1.03);
  }
  .button.secondary,
  .review-link,
  .workspace-return-link,
  .candidate-link a,
  .text-link{
    background:rgba(255,255,255,.88);
    border:1px solid var(--adx-line);
    color:var(--adx-brand-deep);
    box-shadow:var(--adx-shadow-soft);
    text-decoration:none;
  }
  .button.secondary:hover,
  .review-link:hover,
  .workspace-return-link:hover,
  .candidate-link a:hover,
  .text-link:hover{
    border-color:var(--adx-line-strong);
    transform:translateY(-1px);
    text-decoration:none;
  }
  input:not([type="checkbox"]):not([type="radio"]),
  select,
  textarea{
    width:100%;
    color:var(--adx-ink);
    background:rgba(255,255,255,.95);
    border:1px solid var(--adx-line-strong);
    border-radius:16px;
    box-shadow:inset 0 1px 0 rgba(255,255,255,.86);
    font:inherit;
  }
  input[type="checkbox"],
  input[type="radio"]{
    width:auto;
    min-width:0;
    padding:0;
    border-radius:50%;
    box-shadow:none;
    flex:0 0 auto;
  }
  input::placeholder,
  textarea::placeholder{color:var(--adx-muted);opacity:1}
  fieldset,
  form,
  label,
  [class*="grid"],
  [class*="column"],
  [class*="panel"],
  [class*="card"]{min-width:0}
  .status,
  .live-status,
  .muted,
  .field-help,
  .hero-copy,
  .assistant > p:not(.eyebrow),
  .notice-card > p:not(.eyebrow){
    color:var(--adx-copy);
  }
  .error{color:var(--adx-danger)}
  .workspace-return-link{
    position:fixed;
    top:12px;
    left:16px;
    z-index:10;
    display:inline-block;
    padding:6px 10px;
    font-size:.78rem;
    font-weight:700;
  }
  .signed-in-indicator{
    position:fixed;
    top:12px;
    right:16px;
    z-index:10;
    display:flex;
    gap:6px;
    align-items:baseline;
    max-width:calc(100vw - 32px);
    padding:6px 10px;
    background:rgba(255,255,255,.88);
    border:1px solid var(--adx-line);
    border-radius:999px;
    box-shadow:var(--adx-shadow-soft);
    color:var(--adx-copy);
    font-size:.78rem;
  }
  .signed-in-indicator strong{
    overflow:hidden;
    text-overflow:ellipsis;
    white-space:nowrap;
    color:var(--adx-ink);
    font-weight:700;
  }
  @media (max-width:600px){
    .workspace-return-link,
    .signed-in-indicator{
      position:static;
      width:max-content;
      max-width:calc(100% - 32px);
      margin:10px 16px 0;
    }
    .signed-in-indicator strong{max-width:14rem}
    main > section.layout,
    main > section.workspace{padding:16px}
    main{padding:22px 14px 44px}
  }
  @media (prefers-reduced-motion:reduce){*,*::before,*::after{scroll-behavior:auto!important;transition-duration:.01ms!important;animation-duration:.01ms!important;animation-iteration-count:1!important}}
</style>`
