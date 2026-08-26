export const adxPageThemeCss = `<style id="adx-page-theme">
  :root{
    --adx-ink:#102b43;
    --adx-copy:#36566c;
    --adx-muted:#587487;
    --adx-canvas:#eef4f1;
    --adx-surface:#ffffff;
    --adx-surface-soft:#f4f9fb;
    --adx-line:#bfd0dc;
    --adx-brand:#0a6b8f;
    --adx-brand-deep:#074e70;
    --adx-mint:#0c7c62;
    --adx-mint-soft:#e2f5ed;
    --adx-gold:#bd7900;
    --adx-gold-soft:#fff2cf;
    --adx-danger:#a33232;
    --adx-danger-soft:#fff0f0;
    --adx-focus:#d98a00;
    --adx-shadow:0 18px 42px rgb(16 43 67 / 12%);
    --adx-radius:10px;
    --adx-display:Georgia,"Times New Roman",serif;
    --adx-body:"Avenir Next","Segoe UI",sans-serif;
    color:var(--adx-ink);
    background:var(--adx-canvas);
    font-family:var(--adx-body);
  }
  *{box-sizing:border-box}
  body{color:var(--adx-ink);background:var(--adx-canvas)}
  button:focus-visible,a:focus-visible,input:focus-visible,select:focus-visible,textarea:focus-visible{outline:3px solid var(--adx-focus);outline-offset:3px}
  button:disabled{cursor:not-allowed;opacity:.62}
  .adx-page-brand{display:inline-flex;align-items:center;gap:9px;color:var(--adx-ink);font-size:.75rem;font-weight:850;letter-spacing:.1em;text-transform:uppercase}
  .adx-page-brand b{display:grid;place-items:center;width:34px;height:27px;border-radius:6px;background:var(--adx-ink);color:#f5fbf8;font-size:.69rem}
  @media (prefers-reduced-motion:reduce){*,*::before,*::after{scroll-behavior:auto!important;transition-duration:.01ms!important;animation-duration:.01ms!important;animation-iteration-count:1!important}}
</style>`