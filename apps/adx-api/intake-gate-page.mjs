import { escapeHtml, htmlScriptConfig } from './review-page-utils.mjs';
import { adxPageThemeCss } from './adx-page-theme.mjs';

function importedGitHubIssueDetails(sources = []) {
  for (const source of sources) {
    try {
      const retained = JSON.parse(source?.sourceContent ?? '');
      const issue = retained?.issue;
      if (!String(retained?.source ?? '').startsWith('github-') || !issue?.title) continue;
      const labels = Array.isArray(issue.labels) ? issue.labels.filter((label) => typeof label === 'string' && label.trim()) : [];
      const milestone = retained?.milestone?.title ? `${retained.milestone.title} (#${retained.milestone.number})` : 'Not recorded';
      const url = typeof issue.htmlUrl === 'string' && /^https:\/\/github\.com\//.test(issue.htmlUrl) ? issue.htmlUrl : null;
      return `<section class="source-card"><p class="eyebrow">RETAINED GITHUB SOURCE</p><details><summary>Imported GitHub issue #${escapeHtml(String(issue.number ?? '—'))} · ${escapeHtml(issue.title)}</summary><div class="source-details"><p><strong>Repository:</strong> ${escapeHtml(String(retained.repository ?? 'Not recorded'))}</p><p><strong>Milestone:</strong> ${escapeHtml(milestone)}</p><p><strong>Labels:</strong> ${escapeHtml(labels.join(', ') || 'None')}</p>${url ? `<p><a href="${escapeHtml(url)}" rel="noreferrer">Open original issue</a></p>` : ''}<h3>Issue details</h3><div class="issue-body">${escapeHtml(String(issue.body ?? 'No issue body was provided.'))}</div><p class="source-note">This is the immutable GitHub source retained at import time. Later GitHub edits do not change this Change Case.</p></div></details></section>`;
    } catch { /* A non-GitHub source remains represented by its digest elsewhere. */ }
  }
  return '';
}

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
  const githubIssueDetails = importedGitHubIssueDetails(governance.sources);
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>ADX Intake & Risk</title>${adxPageThemeCss}<style>main{max-width:1040px}.page-shell{display:grid;gap:18px}.overview{display:grid;grid-template-columns:minmax(0,1.12fr) minmax(260px,.88fr);gap:18px;align-items:start;padding:32px}.section-shell{padding:24px}section.next{border-left:5px solid var(--adx-brand);background:linear-gradient(180deg,rgba(255,255,255,.96),rgba(241,248,245,.94))}.next h2{max-width:22ch}section .eyebrow{margin-bottom:10px}.action-card{display:grid;gap:10px;padding:16px 18px;border:1px solid var(--adx-line);border-radius:18px;background:rgba(255,255,255,.88);box-shadow:var(--adx-shadow-soft)}.button{min-height:44px;padding:10px 16px}.meta-stack{display:grid;gap:10px}.meta-stack p{margin:0}.intake-grid{display:grid;grid-template-columns:1.2fr .8fr;gap:18px;align-items:start}.intent-card,.source-card{padding:18px;border:1px solid var(--adx-line);border-radius:18px;background:rgba(255,255,255,.9);box-shadow:var(--adx-shadow-soft)}.intent-card strong{display:block;color:var(--adx-ink)}.source-card{margin-top:18px}.source-card summary{cursor:pointer;font-weight:750;color:var(--adx-ink)}.source-details{display:grid;gap:10px;margin-top:16px}.source-details p{margin:0}.source-details h3{margin:6px 0 0}.issue-body{white-space:pre-wrap;overflow-wrap:anywhere;padding:14px;border:1px solid var(--adx-line);border-radius:12px;background:var(--adx-surface-muted)}.source-note{color:var(--adx-muted);font-size:.92rem}@media (max-width:860px){.overview,.intake-grid{grid-template-columns:1fr}}@media (max-width:600px){main{padding-inline:14px}.overview{padding:22px 18px}}</style><style id="adx-family-tuning">h1,h2,h3{font-family:var(--adx-display);font-weight:500;letter-spacing:-.025em;line-height:1.05}header,section,article,form,.panel,.card,.notice,.action-panel,.decision-panel,.step,.story-card,.metric-card,.evidence-row,.intent-card,.source-card,.readiness,.evidence-card,.rail-card{border-radius:var(--adx-radius-lg);box-shadow:var(--adx-shadow-soft)}button,.button,.button.secondary,.review-link,.workspace-return-link,.candidate-link a,.text-link{border-radius:999px}.eyebrow,.panel-label,.artifact-kicker,.workflow-kicker,.case-state,.state{letter-spacing:.12em}</style></head><body><main><div class="page-shell"><section class="overview"><section class="section-shell"><p class="eyebrow">GATE A · DEFINE THE WORK</p><h1>${escapeHtml(changeCase.title)}</h1><p>State: ${escapeHtml(changeCase.state)} · ${escapeHtml(changeCase.riskTier)} declared risk</p></section><section class="action-card"><p class="eyebrow">ONE SAFE NEXT ACTION</p><h2>${ready ? "Risk classification is complete." : "Confirm the retained intake before generating stories."}</h2><p>Story generation starts only after this check, so every suggested or manual story carries the right risk context.</p>${action}</section></section><section class="intake-grid"><section><p class="eyebrow">RETAINED FEATURE INTENT</p><div class="intent-card meta-stack"><p><strong>Outcome:</strong> ${escapeHtml(governance.intent?.outcome ?? "Not captured")}</p><p><strong>Owner:</strong> ${escapeHtml(governance.intent?.owner ?? "Not captured")}</p><p><strong>Acceptance criteria:</strong> ${escapeHtml(governance.intent?.acceptanceCriteria ?? "Not captured")}</p></div>${githubIssueDetails}</section></section></div></main><script>const config=${config};document.getElementById('classify')?.addEventListener('click',async()=>{const button=document.getElementById('classify');const status=document.getElementById('status');button.disabled=true;button.textContent='Classifying…';try{const response=await fetch(config.classifyEndpoint,{method:'POST',credentials:'same-origin',headers:{'content-type':'application/json','idempotency-key':crypto.randomUUID()},body:JSON.stringify({expectedVersion:config.expectedVersion})});const body=await response.json().catch(()=>({}));if(!response.ok)throw new Error(body.error?.message||'Unable to classify risk.');status.textContent='Risk classified. Opening story generation…';window.setTimeout(()=>window.location.href=config.storyWorkshopUrl,400)}catch(error){status.textContent=error.message;status.className='error';button.disabled=false;button.textContent='Confirm intake and classify risk'}})</script></body></html>`;
}
