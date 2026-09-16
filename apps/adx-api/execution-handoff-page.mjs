import { adxPageThemeCss } from './adx-page-theme.mjs';
import { buildExecutionLiveScript, buildExecutionStatusScript, describeExecutionFailure } from './execution-run-components.mjs';

export { describeExecutionFailure };

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[character]));
}

function executionBlockerMessage(changeCase) {
  switch (changeCase?.state) {
    case 'INTAKE':
    case 'RISK_REVIEW':
    case 'AWAITING_STORY_APPROVAL':
      return 'Complete Gate B and Gate C before starting bounded implementation.';
    case 'DESIGN_REVIEW':
      return 'Approve the retained design package to move the case into READY_FOR_EXECUTION.';
    case 'AWAITING_VERIFICATION':
      return 'This case already left execution and is waiting for Gate D verification.';
    case 'READY_FOR_DELIVERY':
    case 'READY_FOR_RELEASE':
    case 'RELEASED':
      return 'Execution is no longer available for this case because it has already moved beyond Gate D.';
    default:
      return 'The current Change Case is not ready for execution, so ADX cannot start a bounded implementation run yet.';
  }
}

function liveRunHeadline(execution) {
  const run = Array.isArray(execution?.runs) ? execution.runs[0] ?? null : null;
  const status = String(run?.status ?? '').toUpperCase();
  if (status === 'COMPLETED') return 'Coding agent completed. Review the candidate, then verify it here.';
  if (status === 'FAILED' || status === 'CANCELLED') return 'Coding agent stopped before producing a candidate.';
  if (status === 'RUNNING' || status === 'LEASED') return 'Coding agent is still running. Waiting for the workspace to finish.';
  return 'Recording your request...';
}

function liveRunPhase(execution) {
  const run = Array.isArray(execution?.runs) ? execution.runs[0] ?? null : null;
  const status = String(run?.status ?? '').toUpperCase();
  if (status === 'COMPLETED') return 'Phase: candidate ready for Gate D review';
  if (status === 'FAILED' || status === 'CANCELLED') return 'Phase: run stopped';
  if (status === 'RUNNING' || status === 'LEASED') return 'Phase: workspace preparing';
  return 'Phase: coding agent is working';
}

function liveRunCommentary(execution) {
  const run = Array.isArray(execution?.runs) ? execution.runs[0] ?? null : null;
  const status = String(run?.status ?? '').toUpperCase();
  if (status === 'COMPLETED') return 'Live commentary: the coding agent finished and the candidate is ready for review.';
  if (status === 'FAILED' || status === 'CANCELLED') return 'Live commentary: the coding agent stopped after validation failed or the run was cancelled.';
  if (status === 'RUNNING' || status === 'LEASED') return 'Live commentary: the coding agent is running and the workspace is still in progress.';
  return 'Live commentary: waiting for the coding agent to return a snapshot.';
}

function liveRunIdentity(execution) {
  const run = Array.isArray(execution?.runs) ? execution.runs[0] ?? null : null;
  const adapterId = String(run?.adapterId ?? 'waiting for the coding agent snapshot').trim();
  const updatedAt = String(run?.updatedAt ?? run?.createdAt ?? '').trim();
  if (!updatedAt) return 'Run identity: waiting for the coding agent snapshot.';
  const timestamp = new Date(updatedAt);
  const renderedAt = Number.isNaN(timestamp.getTime())
    ? updatedAt
    : timestamp.toLocaleString([], {
        month: 'numeric',
        day: 'numeric',
        year: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
        second: '2-digit',
      });
  return `Run identity: ${adapterId} · Updated ${renderedAt}`;
}

export function renderExecutionHandoffPage(changeCase, options) {
  const {
    canSubmit,
    submitReason = null,
    signedInRoles = [],
    dispatchEndpoint,
    statusEndpoint,
    evidenceReviewUrl,
    candidateUrl,
    handoffUrl = '',
    providers = [],
    templates = [],
    projectRepository = null,
    execution = null,
  } = options;

  const ready = changeCase.state === 'READY_FOR_EXECUTION';
  const enabled = providers.filter((provider) => provider.enabled);
  const latestRun = Array.isArray(execution?.runs) ? execution.runs[0] ?? null : null;
  const latestRunStatus = String(latestRun?.status ?? '').toUpperCase();
  const hasRun = Boolean(latestRun?.id && latestRunStatus);
  const activeRun = latestRunStatus === 'LEASED' || latestRunStatus === 'RUNNING';
  const submissionAvailable = Boolean(ready && canSubmit && enabled.length && !activeRun);
  const liveConsoleHidden = hasRun ? '' : ' hidden';
  const liveHeadline = liveRunHeadline(execution);
  const livePhase = liveRunPhase(execution);
  const liveCommentary = liveRunCommentary(execution);
  const liveIdentity = liveRunIdentity(execution);
  const projectLabel = projectRepository ? ` for ${escapeHtml(projectRepository)}` : '';

  const submitBlockedReason = !ready
    ? null
    : canSubmit && enabled.length
      ? activeRun
        ? 'A bounded implementation is already in progress for this Change Case.'
        : null
      : !canSubmit
        ? submitReason || 'You do not have permission to submit this implementation run.'
        : 'No enabled implementation providers are configured for this server.';

  const providerChoices = enabled
    .map((provider, index) => `<label class="runner-choice"><input type="radio" name="provider" value="${escapeHtml(provider.id)}"${index ? '' : ' checked'}><span><strong>${escapeHtml(provider.label)}</strong><small>${escapeHtml(provider.description)}</small></span></label>`)
    .join('');

  const templateChoices = templates
    .map((template, index) => `<option value="${escapeHtml(template.id)}" title="${escapeHtml(template.guidance ?? '')}"${index ? '' : ' selected'}>${escapeHtml(template.label)} - ${escapeHtml(template.description)} ${escapeHtml(template.guidance ?? '')}</option>`)
    .join('');

  const blockedNotice = submitBlockedReason ? `<p class="field-help error">Submission disabled: ${escapeHtml(submitBlockedReason)}</p>` : '';
  const roleNotice = ready && !canSubmit
    ? `<section class="notice"><strong>Your current workspace role: <strong>${escapeHtml(signedInRoles[0] ?? 'unknown')}</strong></strong><p>The contributor-capable roles are <strong>contributor</strong> or <strong>workspace_admin</strong>; the <strong>${escapeHtml(signedInRoles[0] ?? 'unknown')}</strong> role remains read-and-review only.</p></section>`
    : '';

  const scripts = ready
    ? `${buildExecutionStatusScript({ dispatchEndpoint, changeCaseVersion: changeCase.projectionVersion, submissionAvailable })}${buildExecutionLiveScript({ statusEndpoint, projectRepository: projectRepository || 'selected project', initialSnapshot: hasRun ? execution : null })}`
    : '';

  const readyView = ready
    ? `<section class="request-panel"><div class="request-intro"><div><p class="eyebrow">BOUNDED IMPLEMENTATION</p><h2>Start a controlled implementation run${projectLabel}</h2><p>ADX issues a signed lease, creates a disposable workspace, requests a constrained patch, validates it, and retains a candidate only after the checks pass.</p></div><p id="run-url" class="run-url">Execution-handoff URL: <a href="${escapeHtml(handoffUrl)}">${escapeHtml(handoffUrl)}</a></p></div><form id="dispatch-form"><fieldset><legend>Implementation runner</legend><p class="field-help">Story decomposition models are configured separately and cannot run or approve implementation.</p>${providerChoices}</fieldset><label class="select-label">Implementation specification<select id="coding-spec-template">${templateChoices}</select><small>A reviewed specification is bound to the signed task. It cannot expand the lease scope.</small></label><label class="confirm"><input id="confirmation" type="checkbox"> I understand this run can modify only its disposable candidate workspace. A successful run is not approval or delivery.</label><button id="submit" class="button primary" type="submit" disabled><span class="busy-indicator" aria-hidden="true"></span>Run bounded implementation</button><p id="status" class="status" role="status" aria-live="polite" aria-busy="false"></p>${blockedNotice}</form>${roleNotice}</section><section id="progress-console" class="run-console"${liveConsoleHidden} aria-live="polite"${activeRun ? ' data-phase="running"' : ''}><header class="console-header"><div class="run-heading"><p class="eyebrow">LIVE BOUNDED RUN</p><h2>Implementation activity</h2><p id="run-headline">${escapeHtml(liveHeadline)}</p><p id="run-phase" class="run-phase">Phase: waiting for the lease.</p><p id="run-provider" class="run-provider">${escapeHtml(liveIdentity)}</p><p id="run-commentary" class="run-commentary">${escapeHtml(liveCommentary)}</p></div><p id="run-clock" class="run-clock">00:00</p></header><p id="run-warning" class="run-warning" hidden></p><section id="run-summary" class="run-summary"><ol class="run-steps"><li class="done"><strong>Lease issued</strong><small>Scope and limits are signed.</small></li><li><strong>Workspace preparing</strong><small>The disposable workspace is being set up.</small></li><li><strong>Validation in progress</strong><small>The bounded patch is being checked.</small></li><li><strong>Independent verification pending</strong><small>The candidate will be exposed only after validation.</small></li></ol><div id="failure-details" class="failure-card" hidden><h4 id="failure-title"></h4><p id="failure-message"></p><div id="failure-action"></div></div></section><article class="run-panel"><h3>Live events</h3><ul id="progress-events" class="event-feed"><li><time>--:--:--</time><strong>Waiting for the lease</strong><p>The coding agent has not produced a snapshot yet.</p></li></ul></article><div class="run-links"><a id="generated-candidate-link" class="button secondary" href="${escapeHtml(candidateUrl)}" hidden>View generated candidate</a><a id="verification-link" class="button secondary" href="${escapeHtml(evidenceReviewUrl)}" hidden>Open independent verification</a></div></section>`
    : `<section class="request-panel"><p class="eyebrow">BOUNDED IMPLEMENTATION</p><h2>Implementation is not available</h2><p>${escapeHtml(executionBlockerMessage(changeCase))}</p><p class="field-help">Current state: <strong>${escapeHtml(changeCase.state)}</strong>.</p></section>`;

  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>ADX Implementation - ${escapeHtml(changeCase.title)}</title>${adxPageThemeCss}<style>
    main{padding-top:clamp(88px,7vw,116px);padding-bottom:48px}
    .topbar{padding-bottom:12px}
    .hero{position:relative;display:grid;grid-template-columns:minmax(0,1fr) minmax(300px,360px);gap:clamp(26px,4vw,56px);align-items:stretch;margin:12px 0 28px;padding:clamp(24px,3.2vw,44px);border:1px solid rgba(191,208,220,.92);border-radius:28px;background:linear-gradient(122deg,rgba(255,255,255,.94),rgba(246,251,249,.82));box-shadow:var(--adx-shadow);overflow:hidden}
    .hero::after{content:"";position:absolute;inset:auto -8% -55% 42%;height:260px;border-radius:50%;background:radial-gradient(ellipse,rgba(12,124,98,.12),transparent 68%);pointer-events:none}
    .hero > div,.assurance{min-width:0}
    .hero > div{position:relative;z-index:1}
    .hero h1{max-width:19ch;font-size:clamp(2.7rem,4.3vw,4.5rem);line-height:.97}
    .hero-copy{max-width:62ch;margin:20px 0 0;font-size:1rem;line-height:1.6}
    .hero-pills{display:flex;flex-wrap:wrap;gap:8px;margin-top:22px}
    .hero-pills .pill{display:inline-flex;align-items:center;padding:7px 11px;border-radius:999px;background:rgba(10,107,143,.07);border:1px solid rgba(10,107,143,.16);color:var(--adx-brand-deep);font:800 .72rem/1.2 var(--adx-body);letter-spacing:.045em;white-space:nowrap}
    .assurance{position:relative;z-index:1;display:grid;align-content:start;gap:14px;padding:22px;border:1px solid rgba(10,107,143,.22);border-radius:20px;background:linear-gradient(155deg,rgba(255,255,255,.96),rgba(231,244,241,.92));box-shadow:0 14px 30px rgba(16,43,67,.08)}
    .assurance::before{content:"CONTROL ENVELOPE";color:var(--adx-brand-strong);font:800 .68rem/1.2 var(--adx-body);letter-spacing:.11em}
    .assurance strong{font-size:1.08rem;line-height:1.2}
    .assurance p{margin:0;color:var(--adx-copy);line-height:1.45}
    .assurance span{padding-top:14px;border-top:1px solid rgba(10,107,143,.16);color:var(--adx-brand-deep);font:750 .78rem/1.55 var(--adx-body)}
    .request-panel,.run-console{display:grid;gap:22px;padding:clamp(24px,3.2vw,40px);margin-top:18px}
    .request-panel > :is(p,h2,form,.notice),.run-console > :is(header,article,section,.run-links){margin:0}
    .request-intro{display:grid;grid-template-columns:minmax(0,1fr) minmax(240px,330px);gap:24px;align-items:end;padding-bottom:22px;border-bottom:1px solid rgba(191,208,220,.72)}
    .request-intro h2{max-width:26ch}
    .request-intro > div > p:not(.eyebrow){max-width:64ch;margin:10px 0 0;line-height:1.55}
    .run-url{align-self:stretch;margin:0;padding:14px 16px;border:1px solid rgba(10,107,143,.18);border-radius:14px;background:rgba(10,107,143,.06);color:var(--adx-brand-deep);font:750 .75rem/1.45 ui-monospace,SFMono-Regular,monospace;overflow-wrap:anywhere}
    .run-url a{display:block;margin-top:5px;color:inherit;font-weight:800}
    .request-panel form{display:grid;gap:16px}
    .request-panel fieldset{margin:0;padding:18px;border:1px solid rgba(191,208,220,.92);border-radius:18px;background:rgba(255,255,255,.76)}
    .request-panel legend{padding:0 8px;font:800 .78rem/1.2 var(--adx-body);letter-spacing:.11em;text-transform:uppercase;color:var(--adx-brand-strong)}
    .runner-choice{display:grid;grid-template-columns:auto 1fr;gap:12px;align-items:start;margin-top:10px;padding:12px 14px;border:1px solid rgba(191,208,220,.72);border-radius:14px;background:rgba(244,249,251,.96)}
    .runner-choice input{margin-top:4px}
    .runner-choice strong,.runner-choice small{display:block}
    .runner-choice strong{color:var(--adx-ink);line-height:1.35}
    .runner-choice small{margin-top:2px;color:var(--adx-copy);line-height:1.45}
    .select-label,.confirm{display:grid;gap:10px;line-height:1.5;margin:0}
    .select-label select{max-width:100%;min-height:56px;padding:14px 16px;line-height:1.35}
    .select-label small,.field-help{color:var(--adx-copy)}
    .confirm{grid-template-columns:auto 1fr;align-items:start;gap:12px}
    .confirm input{margin-top:4px}
    .request-panel button#submit{justify-self:start;min-height:48px;padding-inline:22px}
    #dispatch-form[data-running="true"] > :not(#status):not(.verification-control){display:none}
    #dispatch-form[data-running="true"] .verification-control{display:grid;opacity:.72;pointer-events:none}
    #dispatch-form[data-running="true"] #status{min-height:0;padding:12px 14px;border-left:3px solid #17744f;background:rgba(23,116,79,.08);color:#0f5439;font-weight:700}
    #status{margin:0;min-height:1.5em}
    .console-header{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:18px;align-items:start}
    .run-heading{display:grid;gap:10px}
    .run-heading > p{margin:0}
    .run-clock{justify-self:end;min-width:112px;text-align:center;font-variant-numeric:tabular-nums}
    .run-phase{display:inline-flex;width:fit-content;max-width:100%;margin:0;padding:10px 12px;border-radius:999px;background:rgba(31,122,103,.1);color:#0f453d;font:700 .82rem/1 ui-monospace,SFMono-Regular,monospace;align-items:center;gap:8px}
    .run-provider{margin:0;color:#5e737d;font:600 .78rem/1.4 ui-monospace,SFMono-Regular,monospace}
    .run-steps{display:grid;gap:10px;margin:0;padding-left:1.5rem}
    .run-steps li{padding:12px 14px;border-left:3px solid var(--adx-line);background:rgba(247,250,249,.7)}
    .run-steps li.done{border-left-color:var(--adx-mint)}
    .run-steps li.active{border-left-color:var(--adx-gold)}
    .run-steps li.failed{border-left-color:var(--adx-danger);background:var(--adx-danger-soft)}
    .run-steps strong,.run-steps small{display:block}
    .run-steps small{margin-top:4px;color:var(--adx-copy);line-height:1.45}
    .event-header{display:flex;align-items:end;justify-content:space-between;gap:16px;margin-bottom:12px}
    .event-header h3,.event-header p{margin:0}
    .event-tools{display:flex;align-items:center;gap:10px;flex-wrap:wrap}
    .follow-live{display:inline-flex;align-items:center;gap:7px;color:var(--adx-copy);font:700 .78rem/1.2 var(--adx-body)}
    .event-jump{min-height:34px;padding:7px 11px;border:1px solid rgba(10,107,143,.22);border-radius:6px;background:#fff;color:var(--adx-brand-deep);font:800 .75rem/1 var(--adx-body);cursor:pointer}
    .event-feed{display:grid;align-content:start;gap:8px;height:360px;min-height:0;margin:0;padding:8px;overflow-x:hidden;overflow-y:scroll;overscroll-behavior:contain;overflow-anchor:none;scrollbar-gutter:stable;scrollbar-color:#6b8798 #e5edf0;scrollbar-width:auto;list-style:none;border:1px solid rgba(191,208,220,.82);border-radius:8px;background:#f7faf9;contain:layout paint}
    .event-feed::-webkit-scrollbar{width:12px}
    .event-feed::-webkit-scrollbar-track{background:#e5edf0;border-left:1px solid #c4d3da}
    .event-feed::-webkit-scrollbar-thumb{min-height:40px;border:3px solid #e5edf0;border-radius:6px;background:#6b8798}
    .event-feed::-webkit-scrollbar-thumb:hover{background:#476879}
    .event-feed li{display:grid;grid-template-columns:74px minmax(0,1fr) auto;gap:4px 12px;padding:11px 12px;border-left:3px solid var(--adx-line);background:#fff}
    .event-feed li.current{border-left-color:#0c7c62;background:#f2faf7}
    .event-feed time{grid-row:1 / span 2;color:var(--adx-muted);font:700 .72rem/1.4 ui-monospace,SFMono-Regular,monospace}
    .event-feed strong,.event-feed p{margin:0}
    .event-feed p{grid-column:2 / 4;color:var(--adx-copy);line-height:1.45}
    .event-duration{color:var(--adx-brand-strong);font:800 .72rem/1.4 ui-monospace,SFMono-Regular,monospace;font-variant-numeric:tabular-nums}
    .run-console[data-phase="running"] #run-phase::before{content:"";width:8px;height:8px;margin:auto 8px auto 0;border-radius:50%;background:#0c7c62;box-shadow:0 0 0 0 rgba(12,124,98,.34);animation:live-pulse 1.8s ease-out infinite}
    .run-console[data-phase="running"] .run-steps li.active{animation:active-step 2.4s ease-in-out infinite}
    .run-console[data-phase="settled"] #run-clock{border-color:rgba(16,43,67,.16);box-shadow:none;color:var(--adx-copy)}
    @keyframes live-pulse{0%{box-shadow:0 0 0 0 rgba(12,124,98,.34)}70%,100%{box-shadow:0 0 0 9px rgba(12,124,98,0)}}
    @keyframes active-step{0%,100%{background:rgba(255,255,255,.72)}50%{background:rgba(226,245,237,.92)}}
    .run-summary{padding:18px 0 0}
    .run-links{display:flex;gap:12px;flex-wrap:wrap;margin-top:18px}
    .run-links .button.secondary{display:inline-flex;align-items:center;justify-content:center}
    .run-warning{margin:12px 0 0;padding:10px 12px;border-radius:12px;background:rgba(200,106,64,.12);color:#7b3d20;font:600 0.8rem/1.45 ui-monospace,SFMono-Regular,monospace}
    .run-history{margin-top:16px;border:1px solid rgba(191,208,220,.92);border-radius:14px;background:rgba(247,250,249,.82);overflow:hidden}
    .history-toggle{display:flex;gap:16px;align-items:center;justify-content:space-between;padding:16px 18px;cursor:pointer;list-style:none}
    .history-toggle::-webkit-details-marker{display:none}
    .history-toggle:focus-visible{outline:3px solid rgba(10,107,143,.35);outline-offset:-3px}
    .history-toggle > span:first-child{display:grid;gap:3px;min-width:0}
    .history-toggle strong{color:var(--adx-ink);font-size:1rem}
    .history-toggle small{color:var(--adx-copy);line-height:1.4}
    .history-kicker{color:var(--adx-brand-strong);font:800 .68rem/1.2 var(--adx-body);letter-spacing:.08em}
    .run-history[open] .history-toggle{border-bottom:1px solid rgba(191,208,220,.75);background:#fff}
    .history-count{display:inline-flex;align-items:center;justify-content:center;gap:8px;padding:8px 12px;border-radius:999px;background:rgba(10,107,143,.08);border:1px solid rgba(10,107,143,.16);color:var(--adx-brand-deep);font:800 .75rem/1.2 var(--adx-body);letter-spacing:.08em;text-transform:uppercase;white-space:nowrap}
    .history-count::after{content:"›";font-size:1.15rem;line-height:.7;transform:rotate(90deg);transition:transform .18s ease}
    .run-history[open] .history-count::after{transform:rotate(-90deg)}
    .history-stack{display:grid;gap:10px;padding:14px}
    .attempt-card{overflow:hidden;border:1px solid rgba(191,208,220,.92);border-radius:8px;background:#fff;box-shadow:0 2px 8px rgba(16,42,67,.05)}
    .attempt-card summary{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:18px;align-items:center;padding:18px 20px;cursor:pointer;list-style:none}
    .attempt-card summary::-webkit-details-marker{display:none}
    .attempt-card.active summary{border-left:4px solid #17744f}
    .attempt-card.success summary{border-left:4px solid #17744f}
    .attempt-card.failure summary{border-left:4px solid #c86a40}
    .attempt-card.waiting summary{border-left:4px solid #7a8b99}
    .attempt-meta{display:grid;gap:6px;min-width:0}
    .attempt-pill{display:inline-flex;align-items:center;width:fit-content;padding:4px 10px;border-radius:999px;background:rgba(10,107,143,.08);color:var(--adx-brand-deep);font:800 .68rem/1.2 var(--adx-body);letter-spacing:.08em;text-transform:uppercase}
    .attempt-meta strong{color:var(--adx-ink);font-size:1rem;line-height:1.35}
    .attempt-meta small{color:var(--adx-copy);line-height:1.45}
    .attempt-summary{display:grid;justify-items:end;gap:6px;text-align:right;min-width:180px;max-width:260px}
    .attempt-summary span{color:var(--adx-copy);font-size:.9rem;line-height:1.35}
    .attempt-summary strong{color:var(--adx-ink);font:800 .86rem/1.2 var(--adx-body)}
    .attempt-body{display:grid;gap:18px;padding:0 20px 20px}
    .attempt-facts{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px;margin:0}
    .attempt-facts div{padding:12px 14px;border:1px solid rgba(191,208,220,.7);border-radius:14px;background:rgba(247,250,249,.98)}
    .attempt-facts dt{margin:0 0 4px;color:var(--adx-brand-strong);font:800 .7rem/1.2 var(--adx-body);letter-spacing:.08em;text-transform:uppercase}
    .attempt-facts dd{margin:0;color:var(--adx-ink);font:600 .92rem/1.45 var(--adx-body)}
    .attempt-events ul{margin:0;padding:0;list-style:none;display:grid;gap:10px}
    .attempt-events li{padding:12px 14px;border:1px solid rgba(191,208,220,.72);border-radius:14px;background:#fbfcfb}
    .attempt-events time{display:block;color:var(--adx-copy);font:700 .72rem/1.2 ui-monospace,SFMono-Regular,monospace;margin-bottom:5px}
    .attempt-events strong{display:block;color:var(--adx-ink);margin-bottom:4px}
    .attempt-events p{margin:0;color:var(--adx-copy);font-size:.92rem;line-height:1.45}
    @media (max-width:900px){.attempt-card summary{grid-template-columns:1fr}.attempt-summary{justify-items:start;text-align:left;min-width:0;max-width:none}}
    @media (max-width:600px){.history-toggle{align-items:flex-start}.history-count{white-space:normal;text-align:center}}
    @media (max-width:900px){.topbar{flex-wrap:wrap;align-items:flex-start;row-gap:12px;padding-bottom:12px}.state{margin-left:auto}.hero,.request-intro{grid-template-columns:1fr}.hero{gap:22px}.hero h1{max-width:none;font-size:clamp(2rem,8vw,3.7rem)}.assurance{grid-template-columns:1fr auto;align-items:center}.assurance::before{grid-column:1 / -1}.assurance span{padding-top:0;padding-left:14px;border-top:0;border-left:1px solid rgba(10,107,143,.16)}}
    @media (max-width:600px){main{padding-top:20px}.hero{margin-inline:-2px;padding:22px 18px;border-radius:22px}.request-panel,.run-console{padding:20px}.assurance{grid-template-columns:1fr}.assurance span{padding:14px 0 0;border-top:1px solid rgba(10,107,143,.16);border-left:0}.runner-choice,.confirm,.console-header{grid-template-columns:1fr}.confirm input{margin-top:0}.run-clock{justify-self:start}.event-header{align-items:flex-start;flex-direction:column}.event-feed{height:320px}.event-feed li{grid-template-columns:minmax(0,1fr) auto}.event-feed time{grid-row:auto}.event-feed p{grid-column:1 / 3}}
  </style></head><body><main><header class="topbar"><div class="brand"><b>ADX</b><span>Delivery control</span></div><p class="state">${escapeHtml(changeCase.state)} · Version ${escapeHtml(changeCase.projectionVersion)}</p></header><section class="hero"><div><p class="eyebrow">Between Gate C and Gate D</p><h1>${escapeHtml(changeCase.title)}</h1><p class="hero-copy">A live, bounded implementation run. ADX retains facts about the run and only opens verification after a candidate has passed its fixed validation.</p><div class="hero-pills"><span class="pill">Signed lease</span><span class="pill">Disposable workspace</span><span class="pill">Fixed validation</span></div></div><aside class="assurance"><strong>Controlled execution</strong><p>Bounded, audited, and recoverable</p><span>Signed lease · Disposable workspace · Fixed validation</span></aside></section>${readyView}${scripts}</main></body></html>`;
}
