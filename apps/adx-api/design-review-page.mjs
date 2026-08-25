function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&gt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character])
}

function renderValue(value) {
  if (Array.isArray(value)) return value.length ? `<ul>${value.map((item) => `<li>${renderValue(item)}</li>`).join('')}</ul>` : '<span class="muted">None recorded</span>'
  if (value && typeof value === 'object') return `<dl>${Object.entries(value).map(([key, item]) => `<dt>${escapeHtml(key.replace(/([A-Z])/g, ' $1'))}</dt><dd>${renderValue(item)}</dd>`).join('')}</dl>`
  return escapeHtml(value || 'Not specified')
}

function artifact(title, description, value) {
  return `<article class="artifact"><p class="eyebrow">RETAINED ARTIFACT</p><h3>${escapeHtml(title)}</h3><p class="muted">${escapeHtml(description)}</p><div class="artifact-body">${renderValue(value)}</div></article>`
}

export function renderDesignReviewPage(changeCase, view, { canReview, canWrite, isDesignAuthor, decisionEndpoint, designCaptureUrl }) {
  const design = view.design
  const artifacts = design?.artifacts ?? {}
  const threats = Array.isArray(artifacts.threatModel?.threats) ? artifacts.threatModel.threats : []
  const testLayers = Array.isArray(artifacts.testStrategy?.layers) ? artifacts.testStrategy.layers : []
  const exceptions = (view.exceptions ?? []).filter((item) => item.designDigest === design?.designDigest)
  const activeExceptions = exceptions.filter((item) => item.status === 'ACTIVE')
  const hasExpiredException = exceptions.some((item) => item.status === 'EXPIRED')
  const approval = (view.approvals ?? []).find((item) => item.status === 'ACTIVE' && item.designDigest === design?.designDigest)
  const approved = approval?.decision === 'APPROVED'
  const rejected = approval?.decision === 'REJECTED'
  const packageComplete = Boolean(design) && threats.length > 0 && testLayers.length > 0
  const reviewerBlocked = !canReview || isDesignAuthor
  const nextAction = approved
    ? 'Open the execution handoff only when execution-ready controls are available.'
    : rejected
      ? canWrite ? 'Capture a revised design package that addresses the retained review rationale.' : 'Ask an authorized design author to capture a revised package.'
      : !design
        ? canWrite ? 'Capture the complete design package for independent review.' : 'Ask an authorized contributor to capture the design package.'
        : hasExpiredException
          ? 'Resolve the expired exception with a revised package or a current, bounded exception.'
          : !packageComplete
            ? canWrite ? 'Revise the package to document threats and at least one verification layer.' : 'Ask the design author to complete the missing design evidence.'
            : isDesignAuthor
              ? 'Ask an independent reviewer to record the design decision.'
              : !canReview
                ? 'Ask an authorized independent reviewer to record the design decision.'
                : 'Review the retained evidence and record one digest-bound decision.'
  const canDecide = Boolean(design) && packageComplete && !hasExpiredException && !approved && !rejected && canReview && !isDesignAuthor
  const config = JSON.stringify({ decisionEndpoint, designDigest: design?.designDigest, expectedVersion: changeCase.projectionVersion }).replace(/</g, '\\u003c')
  const readiness = [
    ['Design package', design ? `Revision ${design.revision}` : 'Not captured', Boolean(design)],
    ['Threat treatment', threats.length ? `${threats.length} threat${threats.length === 1 ? '' : 's'} retained` : 'No threats retained', threats.length > 0],
    ['Verification plan', testLayers.length ? testLayers.join(' · ') : 'No verification layers', testLayers.length > 0],
    ['Exception status', hasExpiredException ? 'Expired exception blocks review' : activeExceptions.length ? `${activeExceptions.length} active exception${activeExceptions.length === 1 ? '' : 's'}` : 'No active exceptions', !hasExpiredException],
    ['Independent decision', approved ? 'Approved for this exact digest' : rejected ? 'Changes requested for this exact digest' : 'Not recorded', approved || rejected],
  ]
  const decision = approved
    ? `<section class="decision success"><p class="eyebrow">GATE C COMPLETE</p><h2>Design approved</h2><p>${escapeHtml(approval.rationale)}</p><small>Recorded by ${escapeHtml(approval.reviewedBy)} against ${escapeHtml(design.designDigest)}.</small></section>`
    : rejected
      ? `<section class="decision blocked"><p class="eyebrow">CHANGES REQUESTED</p><h2>This package needs revision</h2><p>${escapeHtml(approval.rationale)}</p>${canWrite ? `<a class="button" href="${escapeHtml(designCaptureUrl)}">Capture revised package</a>` : ''}</section>`
      : canDecide
        ? `<section class="decision"><p class="eyebrow">INDEPENDENT REVIEW DECISION</p><h2>Record the outcome</h2><p>Your rationale is immutable and bound to the retained design digest.</p><form id="design-decision-form"><label><input type="radio" name="decision" value="APPROVED" required> Approve design</label><label><input type="radio" name="decision" value="REJECTED"> Request changes</label><label for="design-rationale">Review rationale</label><textarea id="design-rationale" required placeholder="State the evidence verified or the specific changes required."></textarea><p id="decision-status" class="status" role="status" aria-live="polite"></p><button type="submit">Record design decision</button></form></section>`
        : `<section class="decision blocked"><p class="eyebrow">DECISION STATUS</p><h2>Decision not available yet</h2><p>${escapeHtml(nextAction)}</p>${!design && canWrite ? `<a class="button" href="${escapeHtml(designCaptureUrl)}">Capture design package</a>` : ''}</section>`
  const artifactMarkup = design ? [
    artifact('Architecture decision', 'Chosen system boundary, approach, and trade-offs.', artifacts.architectureDecision),
    artifact('Interface and schema delta', 'Contracts and compatibility impacts.', artifacts.interfaceDelta),
    artifact('Migration plan', 'Ordered implementation, rollout, and rollback steps.', artifacts.migrationPlan),
    artifact('Dependencies and licenses', 'External dependencies and licensing impact.', artifacts.dependencies),
    artifact('Verification strategy', 'Independent evidence expected before delivery.', artifacts.testStrategy),
    artifact('Package identity', 'Immutable authoring and digest binding.', { revision: design.revision, authoredBy: design.authoredBy, designDigest: design.designDigest }),
  ].join('') : ''
  const riskMarkup = threats.length
    ? `<section class="risks"><p class="eyebrow">RESIDUAL RISK</p><h2>Threat treatment retained with this package</h2>${threats.map((threat) => `<article><strong>${escapeHtml(threat.id)}</strong><div><b>Mitigation</b><p>${escapeHtml(threat.mitigation)}</p></div><div><b>Residual risk</b><p class="risk">${escapeHtml(threat.residualRisk)}</p></div></article>`).join('')}</section>`
    : `<section class="risks blocked"><p class="eyebrow">RESIDUAL RISK</p><h2>Threat model unavailable</h2><p>No retained threat treatment or residual-risk statement is available for review.</p></section>`
  const exceptionMarkup = exceptions.length ? `<section class="exceptions"><p class="eyebrow">DESIGN EXCEPTIONS</p><h2>Exceptions bound to this package</h2>${exceptions.map((item) => `<article><strong>${escapeHtml(item.status)}</strong><p>${escapeHtml(item.reason)}</p><small>Requested by ${escapeHtml(item.requestedBy)} · expires ${escapeHtml(item.expiresAt)}</small></article>`).join('')}</section>` : ''
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>ADX Design Review</title><style>:root{color:#17313c;background:#f3f7f5;font:16px/1.5 system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}*{box-sizing:border-box}body{margin:0}main{max-width:1120px;margin:auto;padding:32px 20px 64px}header,section,.artifact{background:#fff;border:1px solid #cbdcd5;border-radius:9px;padding:20px;margin:16px 0}.eyebrow{margin:0 0 6px;color:#207169;font-size:.73rem;font-weight:800;letter-spacing:.1em}.muted,small{color:#557078}h1{margin:0;font:500 clamp(2rem,4vw,3.2rem)/1.1 Georgia,serif}h2{margin:0;font:500 1.35rem/1.2 Georgia,serif}h3{margin:4px 0;font-size:1.05rem}.next{border:2px solid #28766c;background:#eaf7f2}.checklist{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:9px;padding:0;list-style:none}.checklist li{padding:11px;border-radius:6px;background:#edf5f1}.checklist li.fail{background:#fff2e5}.checklist strong,.checklist small{display:block;font-size:.8rem}.artifacts{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px}.artifact{margin:0}.artifact-body{margin-top:14px;overflow-wrap:anywhere}.artifact-body dl{display:grid;grid-template-columns:minmax(100px,.7fr) minmax(0,1.3fr);gap:7px 12px;margin:0}.artifact-body dt{font-size:.78rem;font-weight:750;text-transform:capitalize}.artifact-body dd{margin:0}.artifact-body ul{margin:0;padding-left:18px}.risks article{display:grid;grid-template-columns:110px 1fr 180px;gap:15px;padding:14px 0;border-top:1px solid #dce7e2}.risks article:first-of-type{margin-top:12px}.risks article p{margin:3px 0}.risks b{font-size:.75rem;text-transform:uppercase;color:#527169}.risk{font-weight:750;color:#8d4a13}.exceptions article{padding:12px 0;border-top:1px solid #dce7e2}.exceptions p{margin:4px 0}.decision{border:2px solid #28766c}.decision.success{border-color:#70aa83;background:#effaf1}.decision.blocked,.blocked{border-color:#d2a26d;background:#fff8ed}label{display:block;margin:13px 0;font-weight:700}textarea{display:block;width:100%;min-height:100px;margin-top:6px;padding:10px;border:1px solid #9db8ad;border-radius:6px;font:inherit}.button,button{display:inline-block;padding:10px 14px;border:0;border-radius:6px;background:#17675f;color:#fff;font:700 .92rem inherit;text-decoration:none;cursor:pointer}.status{min-height:1.4em;color:#a23d23;font-weight:700}@media(max-width:800px){.checklist{grid-template-columns:repeat(2,minmax(0,1fr))}.artifacts{grid-template-columns:1fr}.risks article{grid-template-columns:1fr;gap:4px}}@media(max-width:480px){main{padding:24px 14px}.checklist{grid-template-columns:1fr}}</style></head><body><main><header><p class="eyebrow">GATE C · DESIGN REVIEW</p><h1>${escapeHtml(changeCase.title)}</h1><p class="muted">${escapeHtml(changeCase.state)} · ${escapeHtml(changeCase.riskTier)} declared risk · ${escapeHtml(design?.designDigest ?? 'No design digest')}</p></header><section class="next"><p class="eyebrow">ONE SAFE NEXT ACTION</p><h2>${escapeHtml(nextAction)}</h2></section><section><p class="eyebrow">REVIEW READINESS</p><h2>What is retained and what remains blocked</h2><ul class="checklist">${readiness.map(([title, detail, passed]) => `<li class="${passed ? '' : 'fail'}"><strong>${escapeHtml(title)}</strong><small>${escapeHtml(detail)}</small></li>`).join('')}</ul></section>${design ? `<section><p class="eyebrow">ALL DESIGN ARTIFACTS</p><h2>Retained package evidence</h2><div class="artifacts">${artifactMarkup}</div></section>` : ''}${riskMarkup}${exceptionMarkup}${decision}</main><script>const config=${config};document.getElementById('design-decision-form')?.addEventListener('submit',async(event)=>{event.preventDefault();const form=event.currentTarget;const decision=form.querySelector('input[name="decision"]:checked')?.value;const rationale=document.getElementById('design-rationale').value.trim();const status=document.getElementById('decision-status');const button=form.querySelector('button');if(!decision||!rationale){status.textContent='Choose a decision and provide a review rationale.';return}button.disabled=true;status.textContent='Recording decision…';try{const response=await fetch(config.decisionEndpoint,{method:'POST',credentials:'same-origin',headers:{'content-type':'application/json','idempotency-key':crypto.randomUUID()},body:JSON.stringify({designDigest:config.designDigest,decision,rationale,expectedVersion:config.expectedVersion})});const body=await response.json().catch(()=>null);if(!response.ok)throw new Error(body?.error?.message||body?.message||'Unable to record the design decision.');window.location.reload()}catch(error){button.disabled=false;status.textContent=error.message}})</script></body></html>`
}
