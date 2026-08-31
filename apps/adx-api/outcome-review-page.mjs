import { escapeHtml } from './review-page-utils.mjs';
import { adxPageThemeCss } from './adx-page-theme.mjs';

export function outcomeReviewPage(changeCase, records) {
  const counts = records.reduce(
    (summary, item) => ({
      ...summary,
      [item.outcome]: (summary[item.outcome] ?? 0) + 1,
    }),
    {},
  );
  const next =
    changeCase.state === "READY_FOR_DELIVERY"
      ? "Retain a final outcome before marking this Change Case complete."
      : changeCase.state === "OUTCOME_RECORDED"
        ? "Review the retained outcome and compare it with the frozen evaluation baseline."
        : "A release outcome may be recorded only after delivery readiness.";
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>ADX Outcome Review</title>${adxPageThemeCss}<style>body{margin:0;background:#f6f8fb;color:#172033;font:16px system-ui,sans-serif;line-height:1.5}main{max-width:1040px;margin:auto;padding:32px 20px}.page{display:grid;gap:18px}header,section{background:rgba(255,255,255,.88);border:1px solid #dce3ee;border-radius:18px;padding:24px;margin:0;box-shadow:0 2px 9px #14213d0a}header{padding:32px 32px 28px}.next{background:linear-gradient(180deg,rgba(255,255,255,.96),rgba(241,248,245,.94));border-left:5px solid var(--adx-brand)}.metric{display:inline-block;margin-right:20px;font-weight:700}.summary-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:14px}.summary-grid .metric-card{padding:14px 16px;border:1px solid #d5e0da;border-radius:16px;background:#fff;box-shadow:0 1px 2px rgb(16 42 67 / 7%)}.summary-grid .metric-card strong{display:block;margin-bottom:6px;color:#102b43}.summary-grid .metric-card p{margin:0;color:#36566c;font-size:1.4rem;font-weight:800}code{overflow-wrap:anywhere}ul{padding-left:20px}@media(max-width:820px){.summary-grid{grid-template-columns:1fr}}</style><style id="adx-family-tuning">h1,h2,h3{font-family:var(--adx-display);font-weight:500;letter-spacing:-.025em;line-height:1.05}header,section,article,form,.panel,.card,.notice,.action-panel,.decision-panel,.step,.story-card,.metric-card,.evidence-row,.intent-card,.readiness,.evidence-card,.rail-card{border-radius:var(--adx-radius-lg);box-shadow:var(--adx-shadow-soft)}button,.button,.button.secondary,.review-link,.workspace-return-link,.candidate-link a,.text-link{border-radius:999px}.eyebrow,.panel-label,.artifact-kicker,.workflow-kicker,.case-state,.state{letter-spacing:.12em}</style></head><body><main><div class="page"><header><p class="eyebrow">AUTHORITATIVE CHANGE CASE · OUTCOME REVIEW</p><h1>${escapeHtml(changeCase.title)}</h1><p>State: ${escapeHtml(changeCase.state)} · ${escapeHtml(changeCase.riskTier)} risk</p></header><section class="next"><p class="eyebrow">ONE SAFE NEXT ACTION</p><h2>${escapeHtml(next)}</h2><p>Only retained outcomes count. Activity, transcripts, and unverified release claims are not outcomes.</p></section><section><h2>Outcome summary</h2><div class="summary-grid"><div class="metric-card"><strong>Success: ${escapeHtml(counts.SUCCESS ?? 0)}</strong><p>Retained successes</p></div><div class="metric-card"><strong>Failure: ${escapeHtml(counts.FAILURE ?? 0)}</strong><p>Retained failures</p></div><div class="metric-card"><strong>Rolled back: ${escapeHtml(counts.ROLLED_BACK ?? 0)}</strong><p>Rolled back outcomes</p></div></div></section><section><h2>Immutable outcome history</h2><ul>${records.map((item) => `<li><strong>${escapeHtml(item.outcome)}</strong> · ${escapeHtml(item.taxonomy)}<br>Release candidate: <code>${escapeHtml(item.releaseCandidateId)}</code><br>Outcome: <code>${escapeHtml(item.outcomeDigest)}</code></li>`).join("") || "<li>No retained outcome record.</li>"}</ul></section></div></main></body></html>`;
}
