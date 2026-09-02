import { escapeHtml, htmlScriptConfig } from './review-page-utils.mjs';
import { adxPageThemeCss } from './adx-page-theme.mjs';

function outcomeCount(records, key) {
  return records.filter((item) => item.outcome === key).length
}

function shortOutcomeLabel(record) {
  return `${record.outcome} · ${record.taxonomy} · ${record.releaseCandidateId}`
}

function outcomeOption(record, index, selected) {
  return `<option value="${escapeHtml(record.outcomeDigest)}"${selected ? ' selected' : ''}>${escapeHtml(`${index + 1}. ${shortOutcomeLabel(record)}`)}</option>`
}

function outcomeListItem(record) {
  return `<li><strong>${escapeHtml(record.outcome)}</strong> · ${escapeHtml(record.taxonomy)}<br>Release candidate: <code>${escapeHtml(record.releaseCandidateId)}</code><br>Outcome digest: <code>${escapeHtml(record.outcomeDigest)}</code></li>`
}

export function outcomeReviewPage(changeCase, records, options = {}) {
  const {
    canComplete = false,
    completionEndpoint = '/outcome-completion',
    deliveryReviewUrl = '',
    expectedVersion = changeCase.projectionVersion,
  } = options
  const latestRecord = records[0] ?? null
  const selectedOutcomeDigest = latestRecord?.outcomeDigest ?? ''
  const state = changeCase.state
  const isReadyForDelivery = state === 'READY_FOR_DELIVERY'
  const isOutcomeRecorded = state === 'OUTCOME_RECORDED'
  const counts = {
    SUCCESS: outcomeCount(records, 'SUCCESS'),
    FAILURE: outcomeCount(records, 'FAILURE'),
    ROLLED_BACK: outcomeCount(records, 'ROLLED_BACK'),
  }
  const next =
    isReadyForDelivery && records.length
      ? 'Your action: select the outcome that describes what happened, then click Complete Gate F.'
      : isReadyForDelivery
        ? 'Your action right now: none. Gate F is waiting for the outcome record.'
      : isOutcomeRecorded
        ? 'Review the retained outcome and compare it with the frozen evaluation baseline.'
        : 'A release outcome may be recorded only after delivery readiness.'
  const completionPanel = isReadyForDelivery
    ? records.length
      ? `<section class="action-panel ready"><p class="panel-label">GATE F · YOUR ACTION</p><h2>Select an outcome, then complete Gate F</h2><p>Choose the retained record that matches the real result of the release. Then select <strong>Complete Gate F</strong> once.</p><label for="outcome-digest">1. Choose the retained outcome</label><select id="outcome-digest" ${canComplete ? '' : 'disabled'}>${records.map((record, index) => outcomeOption(record, index, record.outcomeDigest === selectedOutcomeDigest)).join('')}</select><div class="decision-points"><p><strong>2. Confirm:</strong> this record is the factual result you want attached to the Change Case.</p><p><strong>3. Submit:</strong> click Complete Gate F.</p></div>${canComplete ? `<button id="complete-gate-f" class="button primary" type="button" data-endpoint="${escapeHtml(completionEndpoint)}" data-expected-version="${escapeHtml(String(expectedVersion))}">Complete Gate F</button><p id="completion-status" class="live-status" role="status" aria-live="polite"></p>` : '<p class="muted">You can view the retained outcome history, but an authorized reviewer is required to complete Gate F.</p>'}</section>`
      : `<section class="action-panel blocked"><p class="panel-label">GATE F · NO ACTION YET</p><h2>Wait for the outcome record</h2><p>There is nothing to select or submit yet. ADX has not received a retained result for this Change Case.</p><ol class="next-steps"><li><strong>Finish Gate E</strong> — review and approve the exact delivery preview${deliveryReviewUrl ? ` <a class="text-link" href="${escapeHtml(deliveryReviewUrl)}">Open Gate E</a>` : ''}.</li><li><strong>Run the approved change</strong> in the authorized environment.</li><li><strong>Return here after the result is retained.</strong> Gate F will then show the outcome selector and completion button.</li></ol><p class="muted">Activity, transcripts, and unverified release claims cannot be used to complete Gate F.</p></section>`
    : isOutcomeRecorded
      ? `<section class="success-panel"><p class="panel-label">GATE F COMPLETE</p><h2>Outcome recorded</h2><p>The retained outcome is now bound to this Change Case and compared against the frozen evaluation baseline.</p></section>`
      : `<section class="action-panel blocked"><p class="panel-label">GATE F · NOT YET AVAILABLE</p><h2>Outcome recording is waiting on delivery readiness</h2><p>A release outcome may be recorded only after Gate E marks the case ready for delivery.</p></section>`
  const config = htmlScriptConfig({
    completionEndpoint,
    deliveryReviewUrl,
    selectedOutcomeDigest,
    expectedVersion,
  })
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>ADX Outcome Review</title>${adxPageThemeCss}<style>
    :root{color:#16282c;background:#edf3ef;font:16px/1.5 "Avenir Next","Segoe UI",sans-serif}*{box-sizing:border-box}body{margin:0;background:linear-gradient(135deg,#edf3ef 0%,#f7f5ed 46%,#eef4f1 100%)}main{max-width:1260px;margin:auto;padding:28px clamp(18px,4vw,64px) 64px}.page{display:grid;gap:18px}header,section{margin:0;padding:24px;border:1px solid #d4e0e1;border-radius:18px;background:rgba(255,255,255,.9);box-shadow:0 2px 9px #14213d0a}header{padding:32px 32px 28px}.eyebrow,.panel-label{margin:0 0 8px;color:#27715e;font-size:.72rem;font-weight:800;letter-spacing:.11em;text-transform:uppercase}.next{background:linear-gradient(180deg,rgba(255,255,255,.96),rgba(241,248,245,.94));border-left:5px solid var(--adx-brand)}.summary-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:14px}.metric-card{padding:16px;border:1px solid #d5e0da;border-radius:16px;background:#fff;box-shadow:0 1px 2px rgb(16 42 67 / 7%)}.metric-card strong{display:block;margin-bottom:6px;color:#102b43}.metric-card p{margin:0;color:#36566c;font-size:1.4rem;font-weight:800}.history{display:grid;grid-template-columns:minmax(0,1fr) minmax(280px,.56fr);gap:16px;align-items:start}.history aside{padding:18px;border:1px solid #d5e0da;border-radius:16px;background:#fbfdfc}.history ul{margin:0;padding-left:20px}code{overflow-wrap:anywhere}.button{display:inline-flex;align-items:center;justify-content:center;margin-top:8px;border:1px solid transparent;padding:10px 14px;border-radius:999px;cursor:pointer;font:800 .9rem "Avenir Next","Segoe UI",sans-serif}.button.primary{background:var(--adx-brand-deep);color:#fff}.button.primary:hover{background:#115645}.action-panel,.success-panel{padding:20px;border:1px solid #bdcec4;background:#fbfcf9}.action-panel.ready{border-top:4px solid #27715e}.action-panel.blocked{border-top:4px solid #b2662b;background:#fffaf0}.success-panel{border-top:4px solid #176e58;background:#f0fbf4}.decision-points{display:grid;gap:6px;margin:14px 0 0;padding:0;color:#425e63}.decision-points p{margin:0}.next-steps{display:grid;gap:12px;margin:18px 0;padding-left:24px;color:#294c59}.next-steps li{padding-left:4px}.next-steps strong{color:#173f52}.text-link{color:#0b6b5a;font-weight:750;text-decoration:underline;text-underline-offset:3px}.muted{color:#647c7d;font-size:.88rem}label{display:block;margin:12px 0 6px;font-weight:700}select{display:block;width:100%;min-height:48px;border:1px solid #91a8ad;border-radius:14px;padding:10px 12px;font:inherit;background:#fff}.live-status{min-height:1.5em;margin:12px 0 0;font-weight:750}.live-status.error{color:#a13b27}ul{padding-left:20px}@media(max-width:900px){.summary-grid,.history{grid-template-columns:1fr}}@media(max-width:580px){main{padding:22px 16px 44px}.history{grid-template-columns:1fr}}
  </style><style id="adx-family-tuning">h1,h2,h3{font-family:var(--adx-display);font-weight:500;letter-spacing:-.025em;line-height:1.05}header,section,article,form,.panel,.card,.notice,.action-panel,.decision-panel,.step,.story-card,.metric-card,.evidence-row,.intent-card,.readiness,.evidence-card,.rail-card{border-radius:var(--adx-radius-lg);box-shadow:var(--adx-shadow-soft)}button,.button,.button.secondary,.review-link,.workspace-return-link,.candidate-link a,.text-link{border-radius:999px}.eyebrow,.panel-label,.artifact-kicker,.workflow-kicker,.case-state,.state{letter-spacing:.12em}</style></head><body><main><div class="page"><header><p class="eyebrow">AUTHORITATIVE CHANGE CASE · OUTCOME REVIEW</p><h1>${escapeHtml(changeCase.title)}</h1><p>State: ${escapeHtml(state)} · ${escapeHtml(changeCase.riskTier)} risk</p></header><section class="next"><p class="eyebrow">ONE SAFE NEXT ACTION</p><h2>${escapeHtml(next)}</h2><p>Only retained outcomes count. Activity, transcripts, and unverified release claims are not outcomes.</p></section><section><h2>Outcome summary</h2><div class="summary-grid"><div class="metric-card"><strong>Success: ${escapeHtml(counts.SUCCESS)}</strong><p>Retained successes</p></div><div class="metric-card"><strong>Failure: ${escapeHtml(counts.FAILURE)}</strong><p>Retained failures</p></div><div class="metric-card"><strong>Rolled back: ${escapeHtml(counts.ROLLED_BACK)}</strong><p>Rolled back outcomes</p></div></div></section><section class="history">${completionPanel}<aside><p class="eyebrow">IMMUTABLE HISTORY</p><h2>Outcome records</h2><p>Recorded outcomes stay append-only and remain tied to the exact release candidate and digest.</p><ul>${records.map(outcomeListItem).join('') || '<li>No retained outcome record.</li>'}</ul></aside></section></div></main><script>(function(){const config=${config};const button=document.getElementById('complete-gate-f');const status=document.getElementById('completion-status');const select=document.getElementById('outcome-digest');if(!button||!status||!select)return;button.addEventListener('click',async()=>{button.disabled=true;status.textContent='Recording Gate F outcome...';try{const response=await fetch(config.completionEndpoint,{method:'POST',credentials:'same-origin',headers:{'content-type':'application/json','idempotency-key':crypto.randomUUID()},body:JSON.stringify({outcomeDigest:select.value,expectedVersion:config.expectedVersion})});const result=await response.json().catch(()=>({}));if(!response.ok)throw new Error(result?.error?.message||result?.message||'Request failed.');status.textContent='Gate F completed. Refreshing outcome review...';location.reload()}catch(error){status.textContent=error.message;status.className='live-status error';button.disabled=false}})})();</script></body></html>`;
}
