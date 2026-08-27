import { escapeHtml, htmlScriptConfig } from "./review-page-utils.mjs";

export function renderApplicationPreviewPage(
  changeCase,
  {
    profiles,
    evidence,
    previews,
    spotlight,
    canManage,
    startEndpoint,
    stopEndpoint,
  },
) {
  const passingCandidates = [
    ...new Set(
      evidence
        .filter((item) => item.status === "PASS")
        .map((item) => item.candidateDigest),
    ),
  ];
  const options = htmlScriptConfig({
    startEndpoint,
    stopEndpoint,
    expectedVersion: changeCase.projectionVersion,
  });
  const manager =
    canManage && profiles.length && passingCandidates.length
      ? `<section class="card action"><p class="eyebrow">LOCAL MANUAL PREVIEW</p><h2>Start a verified candidate preview</h2><p>ADX builds and starts only the selected server-registered profile after confirming that the configured source still hashes to the retained passing candidate. No command, filesystem path, or external URL is accepted from this screen.</p><form id="preview-start"><label>Application profile<select name="profileId">${profiles.map((profile) => `<option value="${escapeHtml(profile.id)}">${escapeHtml(profile.label)}</option>`).join("")}</select></label><label>Verified candidate<select name="candidateDigest">${passingCandidates.map((digest) => `<option value="${escapeHtml(digest)}">${escapeHtml(digest)}</option>`).join("")}</select></label><button type="submit">Start local preview</button><p id="preview-status" class="status" role="status" aria-live="polite"></p></form></section>`
      : `<section class="card notice"><h2>Manual preview is not ready</h2><p>${!profiles.length ? "No server-managed application preview profile is configured." : !passingCandidates.length ? "A retained passing independent evidence bundle is required before a manual preview can start." : "An authorized contributor must start the preview."}</p></section>`;
  const beforePreview = previews.find(
    (preview) => preview.comparisonRole === "BEFORE",
  );
  const afterPreview = previews.find(
    (preview) => preview.comparisonRole === "AFTER",
  );
  const afterUrl =
    afterPreview && spotlight
      ? `${afterPreview.url}${afterPreview.url.includes("?") ? "&" : "?"}adx-feature=${encodeURIComponent(spotlight.featureId)}`
      : afterPreview?.url;
  const spotlightCard = spotlight
    ? `<section class="card spotlight"><p class="eyebrow">FEATURE SPOTLIGHT</p><h2>${escapeHtml(spotlight.title)}</h2><p>${escapeHtml(spotlight.summary)}</p><p>In the after view, ADX highlights the element explicitly marked for this candidate feature. This visual guide does not replace independent verification.</p></section>`
    : "";
  const comparison =
    beforePreview && afterPreview
      ? `<section class="card comparison"><p class="eyebrow">BEFORE / AFTER COMPARISON</p><h2>Compare the feature in context</h2><p>Left is the registered source baseline. Right is the exact independently verified candidate.</p><div class="comparison-grid"><article><strong>Before implementation</strong><a class="open" href="${escapeHtml(beforePreview.url)}" target="_blank" rel="noopener noreferrer">Open before</a><iframe title="Before implementation" src="${escapeHtml(beforePreview.url)}"></iframe></article><article><strong>After implementation</strong><a class="open" href="${escapeHtml(afterUrl)}" target="_blank" rel="noopener noreferrer">Open after</a><iframe title="After implementation" src="${escapeHtml(afterUrl)}"></iframe></article></div></section>`
      : "";
  const active = previews.length
    ? `<section class="card"><p class="eyebrow">ACTIVE PREVIEWS</p><h2>Test the exact verified candidate</h2>${previews.map((preview) => `<article class="preview"><div><strong>${escapeHtml(preview.label)}</strong><p><a class="open" href="${escapeHtml(preview.url)}" target="_blank" rel="noopener noreferrer">Open preview</a></p><p>Candidate <code>${escapeHtml(preview.candidateDigest)}</code><br>Started ${escapeHtml(preview.startedAt)}</p></div>${canManage ? `<button class="stop" data-preview-id="${escapeHtml(preview.id)}">Stop preview</button>` : ""}</article>`).join("")}</section>`
    : "";
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>ADX Manual Preview</title><style>:root{color:#172033;background:#f5f7fb;font:16px/1.5 system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}*{box-sizing:border-box}body{margin:0}main{max-width:900px;margin:auto;padding:34px 20px 56px}.card,header{background:#fff;border:1px solid #dce3ee;border-radius:8px;padding:22px;margin:16px 0;box-shadow:0 2px 9px #14213d0a}.eyebrow{margin:0 0 6px;color:#52657f;font-size:.75rem;font-weight:750;letter-spacing:.12em}h1{margin:.2rem 0;font-size:2rem}h2{margin:0;font-size:1.2rem}p{color:#52657f}.action{border:2px solid #2d74c4}.notice{background:#fff8e9;border-color:#f0cc7b}.comparison-grid{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-top:16px}.comparison-grid article{display:grid;gap:10px}.comparison-grid iframe{width:100%;height:540px;border:1px solid #dce3ee;border-radius:6px;background:#fff}.preview{display:flex;justify-content:space-between;gap:16px;align-items:flex-start;border-top:1px solid #dce3ee;padding:16px 0}.preview:first-of-type{border-top:0}label{display:block;font-weight:700;margin:14px 0}select{display:block;width:100%;margin-top:5px;padding:9px;border:1px solid #8da0b7;border-radius:6px;background:#fff;color:#172033;font:inherit}button,.open{display:inline-block;border:0;border-radius:6px;padding:10px 14px;background:#11519b;color:#fff;text-decoration:none;cursor:pointer;font:700 1rem inherit}.stop{background:#8d2f2f}.status{min-height:1.5em;font-weight:650}.error{color:#a92e2e}code{overflow-wrap:anywhere}@media(max-width:600px){.comparison-grid{grid-template-columns:1fr}.comparison-grid iframe{height:440px}.preview{display:block}.stop{margin-top:10px}}</style></head><body><main><header><p class="eyebrow">GATE D · MANUAL ACCEPTANCE PREVIEW</p><h1>${escapeHtml(changeCase.title)}</h1><p>State: ${escapeHtml(changeCase.state)} · Change Case version ${escapeHtml(changeCase.projectionVersion)}</p></header><section class="card"><p class="eyebrow">MANUAL TESTING BOUNDARY</p><h2>Preview is evidence-bound, not delivery approval</h2><p>Use the preview link to assess the exact verified candidate. A manual visit never advances Gate D or publishes a release by itself.</p></section>${manager}${spotlightCard}${comparison}${active}</main><script>const config=${options};document.getElementById('preview-start')?.addEventListener('submit',async(event)=>{event.preventDefault();const form=event.currentTarget,button=form.querySelector('button'),status=document.getElementById('preview-status');button.disabled=true;status.className='status';status.textContent='Building and starting the local preview…';try{const values=new FormData(form),response=await fetch(config.startEndpoint,{method:'POST',credentials:'same-origin',headers:{'content-type':'application/json'},body:JSON.stringify({profileId:values.get('profileId'),candidateDigest:values.get('candidateDigest'),expectedVersion:config.expectedVersion})}),body=await response.json().catch(()=>({}));if(!response.ok)throw new Error(body.error?.message||body.code||'Unable to start preview.');status.textContent='Preview is ready. Refreshing this workbench…';window.location.reload()}catch(error){status.className='status error';status.textContent=error.message;button.disabled=false}});document.querySelectorAll('.stop').forEach((button)=>button.addEventListener('click',async()=>{button.disabled=true;try{const response=await fetch(config.stopEndpoint,{method:'POST',credentials:'same-origin',headers:{'content-type':'application/json'},body:JSON.stringify({previewId:button.dataset.previewId})}),body=await response.json().catch(()=>({}));if(!response.ok)throw new Error(body.error?.message||body.code||'Unable to stop preview.');window.location.reload()}catch(error){button.disabled=false;alert(error.message)}}));</script></body></html>`;
}
