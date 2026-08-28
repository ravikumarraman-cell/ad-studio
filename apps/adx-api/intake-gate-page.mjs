import { escapeHtml, htmlScriptConfig } from './review-page-utils.mjs';

export function intakeGatePage(
  changeCase,
  governance,
  { canWrite, classifyEndpoint, storyWorkshopUrl },
) {
  const ready = changeCase.state === "RISK_REVIEW";
  const action = ready
    ? `<a class="button" href="${escapeHtml(storyWorkshopUrl)}">Continue to Generate & curate stories</a>`
    : changeCase.state === "INTAKE" && canWrite
      ? `<button class="button" id="classify">Confirm intake, then continue to stories</button><p id="status" role="status" aria-live="polite"></p>`
      : `<p>This Change Case must have complete retained intake before ADX can classify risk and open story generation.</p>`;
  const config = htmlScriptConfig({
    classifyEndpoint,
    expectedVersion: changeCase.projectionVersion,
    storyWorkshopUrl,
  });
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>ADX Intake & Risk</title><style>body{margin:0;background:#f6f8fb;color:#172033;font:16px/1.5 system-ui,sans-serif}main{max-width:760px;margin:auto;padding:32px 20px}section{background:#fff;border:1px solid #dce3ee;border-radius:14px;padding:24px;margin:16px 0}.eyebrow{font-size:.75rem;font-weight:750;letter-spacing:.12em;color:#52657f}.next{background:#e9f4ff;border-color:#9dcef8}.button{border:0;border-radius:9px;background:#11519b;color:#fff;padding:10px 14px;text-decoration:none;font:inherit;font-weight:750;cursor:pointer}#status{font-weight:650}.error{color:#a92e2e}</style></head><body><main><section><p class="eyebrow">GATE A · DEFINE THE WORK</p><h1>${escapeHtml(changeCase.title)}</h1><p>State: ${escapeHtml(changeCase.state)} · ${escapeHtml(changeCase.riskTier)} declared risk</p></section><section class="next"><p class="eyebrow">ONE SAFE NEXT ACTION</p><h2>${ready ? "Risk classification is complete." : "Confirm the retained intake before generating stories."}</h2><p>Story generation starts only after this check, so every suggested or manual story carries the right risk context.</p>${action}</section><section><p class="eyebrow">RETAINED FEATURE INTENT</p><p><strong>Outcome:</strong> ${escapeHtml(governance.intent?.outcome ?? "Not captured")}</p><p><strong>Owner:</strong> ${escapeHtml(governance.intent?.owner ?? "Not captured")}</p><p><strong>Acceptance criteria:</strong> ${escapeHtml(governance.intent?.acceptanceCriteria ?? "Not captured")}</p></section></main><script>const config=${config};document.getElementById('classify')?.addEventListener('click',async()=>{const button=document.getElementById('classify');const status=document.getElementById('status');button.disabled=true;button.textContent='Classifying…';try{const response=await fetch(config.classifyEndpoint,{method:'POST',credentials:'same-origin',headers:{'content-type':'application/json','idempotency-key':crypto.randomUUID()},body:JSON.stringify({expectedVersion:config.expectedVersion})});const body=await response.json().catch(()=>({}));if(!response.ok)throw new Error(body.error?.message||'Unable to classify risk.');status.textContent='Risk classified. Opening story generation…';window.setTimeout(()=>window.location.href=config.storyWorkshopUrl,400)}catch(error){status.textContent=error.message;status.className='error';button.disabled=false;button.textContent='Confirm intake and classify risk'}})</script></body></html>`;
}
