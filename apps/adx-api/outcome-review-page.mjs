import { escapeHtml } from './review-page-utils.mjs';

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
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>ADX Outcome Review</title><style>body{margin:0;background:#f6f8fb;color:#172033;font:16px system-ui,sans-serif;line-height:1.5}main{max-width:960px;margin:auto;padding:32px 20px}header,section{background:#fff;border:1px solid #dce3ee;border-radius:14px;padding:24px;margin:16px 0}.next{background:#e9f4ff}.metric{display:inline-block;margin-right:20px;font-weight:700}code{overflow-wrap:anywhere}ul{padding-left:20px}</style></head><body><main><header><p>AUTHORITATIVE CHANGE CASE · OUTCOME REVIEW</p><h1>${escapeHtml(changeCase.title)}</h1><p>State: ${escapeHtml(changeCase.state)} · ${escapeHtml(changeCase.riskTier)} risk</p></header><section class="next"><h2>One safe next action</h2><p>${escapeHtml(next)}</p><p>Only retained outcomes count. Activity, transcripts, and unverified release claims are not outcomes.</p></section><section><h2>Outcome summary</h2><p><span class="metric">Success: ${escapeHtml(counts.SUCCESS ?? 0)}</span><span class="metric">Failure: ${escapeHtml(counts.FAILURE ?? 0)}</span><span class="metric">Rolled back: ${escapeHtml(counts.ROLLED_BACK ?? 0)}</span></p></section><section><h2>Immutable outcome history</h2><ul>${records.map((item) => `<li><strong>${escapeHtml(item.outcome)}</strong> · ${escapeHtml(item.taxonomy)}<br>Release candidate: <code>${escapeHtml(item.releaseCandidateId)}</code><br>Outcome: <code>${escapeHtml(item.outcomeDigest)}</code></li>`).join("") || "<li>No retained outcome record.</li>"}</ul></section></main></body></html>`;
}
