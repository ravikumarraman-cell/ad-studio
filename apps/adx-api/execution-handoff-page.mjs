function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[character]));
}

function buildExecutionStatusScript({ dispatchEndpoint, statusEndpoint, changeCaseVersion }) {
  return `
<script>
const submitBlocked = false;
const dispatchEndpoint = ${JSON.stringify(dispatchEndpoint)};
const form = document.getElementById('dispatch-form');
const button = document.getElementById('submit');
const status = document.getElementById('status');
const confirmation = document.getElementById('confirmation');
const providers = [...document.querySelectorAll('input[name="provider"]')];

if (form && button && status) {
  button.setAttribute("aria-busy","false");
  const syncControls = () => {
    const providerSelected = providers.some((input) => input.checked);
    button.disabled = submitBlocked || !providerSelected || !confirmation?.checked;
  };

  confirmation?.addEventListener('change', syncControls);
  providers.forEach((input) => input.addEventListener('change', syncControls));
  syncControls();

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    button.disabled = true;
    status.setAttribute("aria-busy","true");
    status.textContent = 'Requesting a signed lease… this can take a moment.';
    button.classList.add('is-busy');
    try {
      const response = await fetch(dispatchEndpoint, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'idempotency-key': crypto.randomUUID(),
        },
        body: JSON.stringify({
          provider: document.querySelector('input[name="provider"]:checked')?.value,
          templateId: document.getElementById('coding-spec-template')?.value,
          expectedVersion: ${JSON.stringify(changeCaseVersion)},
        }),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) throw new Error(body?.error?.message || body?.code || 'Implementation request failed.');
      status.textContent = 'Run accepted. Showing recorded activity...';
      beginRun(body?.runId || body?.lease?.runId);
      button.classList.remove('is-busy');
      status.setAttribute("aria-busy","false");
    } catch (error) {
      status.className = 'status error';
      status.textContent = error.message;
      status.setAttribute("aria-busy","false");
      button.disabled = false;
      button.classList.remove('is-busy');
    }
  });
}
</script>`;
}

function buildExecutionLiveScript({ statusEndpoint }) {
  return `
<script>
const config = ${JSON.stringify({ dispatchEndpoint: '/execution/dispatch', statusEndpoint, evidenceReviewUrl: '/evidence-review', candidateUrl: '/generated-candidate' }).replace(/</g, '\u003c')};
const describeExecutionFailure = ${describeExecutionFailure.toString()};
const stageOrder = ['leased', 'started', 'validated', 'verified'];
let pollTimer = null;
let clockTimer = null;
let runStartedAt = null;
let lastEventKey = '';
let pollFailures = 0;
let currentRunId = null;
const byId = (id) => document.getElementById(id);
const eventLabels = {
  AgentRunLeased: { title: 'Lease issued', detail: 'Signed scope and policy limits have been recorded.', stage: 'leased' },
  AgentRunStarted: { title: 'Building the bounded Health-X candidate', detail: 'ADX is preparing the disposable workspace, requesting the constrained patch, then will run the fixed Health-X verification.', stage: 'started' },
  AgentRunCompleted: { title: 'Candidate validated', detail: 'The run completed and the candidate is ready for independent verification.', stage: 'verified' },
  AgentRunFailed: { title: 'Runner stopped', detail: 'The candidate was not promoted.', stage: 'started', failed: true },
  AgentRunQuotaExceeded: { title: 'Runner limit reached', detail: 'The bounded run reached a configured limit.', stage: 'started', failed: true },
  AgentRunCancellationObserved: { title: 'Run cancelled', detail: 'The run was cancelled before promotion.', stage: 'started', failed: true },
  AgentRunLeaseRevoked: { title: 'Lease revoked', detail: 'The execution lease was revoked.', stage: 'leased', failed: true },
};

function clock() {
  if (!runStartedAt) return;
  const seconds = Math.max(0, Math.floor((Date.now() - runStartedAt) / 1000));
  byId('run-clock').textContent = String(Math.floor(seconds / 60)).padStart(2, '0') + ':' + String(seconds % 60).padStart(2, '0');
}

function stopLiveTimers() {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
  if (clockTimer) {
    clearInterval(clockTimer);
    clockTimer = null;
  }
}

function eventTime(value) {
  try {
    return new Date(value).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  } catch {
    return '--:--:--';
  }
}

function setStages(stage, failed) {
  const active = stageOrder.indexOf(stage);
  document.querySelectorAll('.run-steps li').forEach((item, index) => {
    item.classList.toggle('done', !failed && index < active);
    item.classList.toggle('active', !failed && index === active);
    item.classList.toggle('failed', Boolean(failed) && index === active);
  });
}

function renderEvents(events) {
  const log = byId('progress-events');
  if (!log) return;
  log.innerHTML = events.map((event) => {
    const type = String(event.eventType||'').replace(/\\.v\\d+$/,'');
    const info = eventLabels[type] || { title: event.eventType, detail: 'Durably recorded execution event.', stage: 'started' };
    return '<li><time>' + eventTime(event.occurredAt) + '</time><div><strong>' + info.title + '</strong><span>' + info.detail + '</span></div></li>';
  }).join('');
}

function showFailure(event) {
  const panel = byId('failure-details');
  if (!panel) return;
  const details = event.errorDetails || {};
  const code = event.errorCode || 'CODING_AGENT_EXECUTION_FAILED';
  const timings = event.timings || {};
  const failure = describeExecutionFailure(details, code);
  const validationCommand = details.validationCommand || 'unknown validation command';
  const validationCategory = details.validationCategory || 'UNKNOWN';
  panel.hidden = false;
  const mismatchDetected = Boolean(details.validationOutputExcerpt || details.validationFailureReason || validationCategory !== 'UNKNOWN' || validationCommand !== 'unknown validation command');
  panel.innerHTML =
    '<h3>' + (mismatchDetected ? 'Validation mismatch' : 'Run stopped') + '</h3><p>The bounded runner stopped before producing a candidate. ADX retained this failure and did not promote a candidate.</p>' +
    (mismatchDetected
      ? '<div class="failure-callout"><strong>Validation mismatch</strong><span>The candidate was built, but validation did not pass. The verifier output below is the best debugging signal.</span></div>'
      : '') +
    '<dl><dt>Diagnostic code</dt><dd>' +
    code +
    '</dd><dt>Actual issue</dt><dd>' +
    escapeHtml(failure.summary) +
    '</dd><dt>Next action</dt><dd>' +
    escapeHtml(failure.nextAction) +
    '</dd><dt>Validation command</dt><dd><code>' +
    escapeHtml(validationCommand) +
    '</code></dd><dt>Validation category</dt><dd>' +
    escapeHtml(validationCategory) +
    '</dd>' +
    (details.validationOutputExcerpt
      ? '<dt>Validation output</dt><dd><pre class="failure-output" style="white-space:pre-wrap;max-height:14rem;overflow:auto;margin:.5rem 0 0;padding:.75rem;border:1px solid #d9c5bd;background:#fff7f2;font:inherit">' +
        escapeHtml(details.validationOutputExcerpt) +
        '</pre></dd>'
      : '') +
    (details.validationFailureReason
      ? '<dt>Validation reason</dt><dd>' + escapeHtml(details.validationFailureReason) + '</dd>'
      : '') +
    (details.providerStatus
      ? '<dt>Provider status</dt><dd>HTTP ' + details.providerStatus + '</dd>'
      : '') +
    (details.providerRequestId
      ? '<dt>Request ID</dt><dd>' + details.providerRequestId + '</dd>'
      : '') +
    (timings.totalMs
      ? '<dt>Total runtime</dt><dd>' + (timings.totalMs / 1000).toFixed(1) + ' seconds</dd>'
      : '') +
    '</dl>';

  const failureMessage = byId('failure-message');
  const failureCode = byId('failure-code');
  const failureProviderStage = byId('failure-provider-stage');
  const failureValidationHint = byId('failure-validation-hint');
  const failureReason = byId('failure-reason');
  const failureValidationExcerpt = byId('failure-validation-excerpt');
  if (failureMessage) failureMessage.textContent = failure.summary;
  if (failureCode) failureCode.textContent = code;
  if (failureProviderStage) failureProviderStage.textContent = details.failureStage || 'UNKNOWN';
  if (failureValidationHint) failureValidationHint.textContent = failure.hint;
  if (failureReason) {
    failureReason.hidden = !failure.reason;
    failureReason.textContent = failure.reason ? 'Possible reason: ' + failure.reason : '';
  }
  if (failureValidationExcerpt) {
    failureValidationExcerpt.hidden = !details.validationOutputExcerpt;
    failureValidationExcerpt.textContent = details.validationOutputExcerpt || '';
  }
}

async function poll(runId) {
  try {
    const response = await fetch(config.statusEndpoint);
    if (!response.ok) throw new Error('Unable to read run status.');
    const data = await response.json().catch(() => ({}));
    const events = Array.isArray(data?.events) ? data.events.filter((event) => event && event.runId === runId) : [];
    renderEvents(events);
    const latest = events.at(-1);
    if (!latest) return;
    const type = String(latest.eventType||'').replace(/\\.v\\d+$/,'');
    const info = eventLabels[type] || { title: 'Implementation activity', detail: 'Run state updated.', stage: 'started' };
    byId('run-headline').textContent = info.title + ' - ' + info.detail;
    setStages(info.stage, info.failed);
    const key = latest.runId + ':' + latest.sequence;
    if (key !== lastEventKey) {
      lastEventKey = key;
      clock();
    }
    if (['AgentRunCompleted', 'AgentRunFailed', 'AgentRunQuotaExceeded', 'AgentRunCancellationObserved', 'AgentRunLeaseRevoked'].includes(type)) {
      stopLiveTimers();
      currentRunId = null;
      if (type === 'AgentRunCompleted') {
        byId('generated-candidate-link').hidden = false;
        byId('verification-link').hidden = false;
      } else {
        showFailure(latest);
      }
    }
  } catch (error) {
    pollFailures += 1;
    const headline = byId('run-headline');
    if (headline) {
      headline.textContent = pollFailures > 1
        ? error.message + ' Retrying automatically...'
        : error.message;
    }
    if (pollFailures >= 3) {
      const status = byId('status');
      if (status) {
        status.textContent = 'Status updates are temporarily unavailable. The run can continue, and ADX will keep trying to reconnect.';
        status.setAttribute('aria-busy', 'false');
      }
    }
  }
}

function beginRun(runId) {
  if (!runId) {
    const status = byId('status');
    if (status) {
      status.className = 'status error';
      status.setAttribute('aria-busy', 'false');
      status.textContent = 'The runner did not return a run ID, so ADX cannot track this execution safely.';
    }
    return;
  }
  stopLiveTimers();
  currentRunId = runId;
  pollFailures = 0;
  runStartedAt = Date.now();
  lastEventKey = '';
  byId('progress-console').hidden = false;
  byId('run-headline').textContent = 'Lease issued - recording bounded execution.';
  setStages('leased', false);
  clock();
  poll(runId);
  pollTimer = setInterval(()=>poll(runId),1500);
  clockTimer = setInterval(clock, 1000);
  byId('confirmation')?.addEventListener('change', (event) => {
    byId('submit').disabled = submitBlocked || !event.currentTarget.checked;
  });
}
</script>`;
}

export function describeExecutionFailure(details = {}, code = 'CODING_AGENT_EXECUTION_FAILED') {
  const providerStatus = Number.isInteger(details?.providerStatus) ? details.providerStatus : null;
  const gatewayCode = typeof details?.gatewayCode === 'string' && details.gatewayCode.trim() ? details.gatewayCode.trim() : null;
  const gatewayParam = typeof details?.gatewayParam === 'string' && details.gatewayParam.trim() ? details.gatewayParam.trim() : null;
  const responseIssue = typeof details?.responseIssue === 'string' && details.responseIssue.trim() ? details.responseIssue.trim() : null;
  const validationCommand = typeof details?.validationCommand === 'string' && details.validationCommand.trim() ? details.validationCommand.trim() : null;
  const validationCategory = typeof details?.validationCategory === 'string' && details.validationCategory.trim() ? details.validationCategory.trim() : null;
  const validationOutputExcerpt = typeof details?.validationOutputExcerpt === 'string' && details.validationOutputExcerpt.trim() ? details.validationOutputExcerpt.trim() : null;
  const validationFailureReason = typeof details?.validationFailureReason === 'string' && details.validationFailureReason.trim() ? details.validationFailureReason.trim() : null;

  if (code.startsWith('AZURE_OPENAI_GATEWAY_REQUEST_FAILED')) {
    if (providerStatus === 429) {
      return Object.freeze({
        summary: 'The Azure OpenAI gateway rate-limited the run.',
        reason: 'Wait briefly and retry after the gateway limit resets.',
        nextAction: 'Retry once after the gateway limit resets.',
        hint: 'Gateway retry recommended',
      });
    }
    if ([502, 503, 504].includes(providerStatus)) {
      return Object.freeze({
        summary: `The Azure OpenAI gateway returned HTTP ${providerStatus}.`,
        reason: 'This is usually a transient upstream gateway or proxy outage. Retry once.',
        nextAction: 'Retry once; if it repeats, check the gateway health and routing.',
        hint: 'Transient gateway failure',
      });
    }
    if (gatewayCode || gatewayParam) {
      return Object.freeze({
        summary: `The Azure OpenAI gateway rejected ${gatewayParam ? `parameter ${gatewayParam}` : 'the request'}.`,
        reason: gatewayCode === 'unsupported_value' && gatewayParam === 'temperature'
          ? 'The gateway only allows the default temperature for this model. Remove the temperature override.'
          : gatewayCode === 'unsupported_parameter' && gatewayParam
            ? `The gateway does not support ${gatewayParam} for this request shape.`
            : 'The gateway rejected one of the request fields.',
        nextAction: 'Adjust the request shape to match the gateway contract, then rerun the task.',
        hint: 'Gateway request rejected',
      });
    }
    return Object.freeze({
      summary: 'The Azure OpenAI gateway stopped the run before a candidate could be produced.',
      reason: 'The upstream model request failed before any candidate output was retained.',
      nextAction: 'Retry once; if the failure repeats, inspect the gateway and deployment configuration.',
      hint: 'Gateway execution failure',
    });
  }

  if (validationOutputExcerpt || validationFailureReason || validationCategory) {
    const validatorReason =
      validationFailureReason ||
      validationOutputExcerpt ||
      'The fixed validation command did not pass for the generated candidate.';
    return Object.freeze({
      summary: 'Validation failed after the candidate was built.',
      reason: validatorReason,
      nextAction: validationCommand
        ? `Inspect the output from ${validationCommand} and update the candidate to satisfy it.`
        : 'Inspect the validation output and update the candidate to satisfy it.',
      hint: validationCommand && validationCategory
        ? `${validationCategory} · ${validationCommand}`
        : validationCommand || validationCategory || 'Validation details unavailable',
    });
  }

  return Object.freeze({
    summary: 'The bounded runner stopped before producing a candidate.',
    reason: 'The available error details do not identify a more specific cause.',
    nextAction: 'Inspect the recorded diagnostic code and validation details, then retry once.',
    hint: 'No additional diagnostic details were recorded',
  });
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
    providers = [],
    templates = [],
  } = options;

  const ready = changeCase.state === 'READY_FOR_EXECUTION';
  const enabled = providers.filter((provider) => provider.enabled);
  const submitBlockedReason = !ready
    ? null
    : canSubmit && enabled.length
      ? null
      : !canSubmit
        ? submitReason || 'You do not have permission to submit this implementation run.'
        : 'No enabled implementation providers are configured for this server.';

  const providerChoices = enabled
    .map(
      (provider, index) =>
        `<label class="runner-choice"><input type="radio" name="provider" value="${escapeHtml(provider.id)}"${index ? '' : ' checked'}><span><strong>${escapeHtml(provider.label)}</strong><small>${escapeHtml(provider.description)}</small></span></label>`,
    )
    .join('');

  const templateChoices = templates
    .map(
      (template, index) =>
        `<option value="${escapeHtml(template.id)}" title="${escapeHtml(template.guidance ?? '')}"${index ? '' : ' selected'}>${escapeHtml(template.label)} - ${escapeHtml(template.description)} ${escapeHtml(template.guidance ?? '')}</option>`,
    )
    .join('');

  const blockedNotice = submitBlockedReason
    ? `<p class="field-help error">Submission disabled: ${escapeHtml(submitBlockedReason)}</p>`
    : '';
  const roleNotice =
    ready && !canSubmit
      ? `<section class="notice"><strong>Your current workspace role: <strong>${escapeHtml(signedInRoles[0] ?? 'unknown')}</strong></strong><p>The contributor-capable roles are <strong>contributor</strong> or <strong>workspace_admin</strong>; the <strong>${escapeHtml(signedInRoles[0] ?? 'unknown')}</strong> role remains read-and-review only.</p></section>`
      : '';

  const readyView = ready
    ? `<section class="request-panel"><p class="eyebrow">BOUNDED IMPLEMENTATION</p><h2>Start a controlled implementation run</h2><p>ADX issues a signed lease, creates a disposable workspace, requests a constrained patch, validates it, and retains a candidate only after the checks pass.</p><form id="dispatch-form"><fieldset><legend>Implementation runner</legend><p class="field-help">Story decomposition models are configured separately and cannot run or approve implementation.</p>${providerChoices}</fieldset><label class="select-label">Implementation specification<select id="coding-spec-template">${templateChoices}</select><small>A reviewed specification is bound to the signed task. It cannot expand the lease scope.</small></label><label class="confirm"><input id="confirmation" type="checkbox"> I understand this run can modify only its disposable candidate workspace. A successful run is not approval or delivery.</label><button id="submit" class="button primary" type="submit" disabled><span class="busy-indicator" aria-hidden="true"></span>Run bounded implementation</button><p id="status" class="status" role="status" aria-live="polite" aria-busy="false"></p>${blockedNotice}</form>${roleNotice}</section><section id="progress-console" class="run-console" hidden aria-live="polite"><header class="console-header"><div><p class="eyebrow">LIVE BOUNDED RUN</p><h2>Implementation activity</h2><p id="run-headline">Recording your request...</p></div><p id="run-clock" class="run-clock">00:00</p></header><ol class="run-steps"><li data-stage="leased"><span>1</span><div><strong>Lease issued</strong><small>Scope and limits are signed.</small></div></li><li data-stage="started"><span>2</span><div><strong>Sandbox working</strong><small>Preparing a bounded patch.</small></div></li><li data-stage="validated"><span>3</span><div><strong>Candidate validated</strong><small>Fixed tests determine promotion.</small></div></li><li data-stage="verified"><span>4</span><div><strong>Ready for verification</strong><small>A code preview becomes available only after the candidate passes validation.</small></div></li></ol><section class="engagement-note"><strong>What ADX can show safely</strong><p>Live status reflects durable run events instead of untrusted console output. The code preview becomes available only after the candidate passes validation, so incomplete or untrusted model output is never presented as generated code.</p></section><ul id="progress-events" class="event-log"></ul><section id="failure-details" class="failure-details" hidden><h3>Run stopped</h3><p id="failure-message"></p><dl><dt>Diagnostic code</dt><dd id="failure-code"></dd><dt>Provider stage</dt><dd id="failure-provider-stage"></dd><dt>Validation hint</dt><dd id="failure-validation-hint"></dd></dl><p id="failure-reason" hidden></p><p id="failure-validation-excerpt" hidden></p><p class="candidate-link"><a id="generated-candidate-link" href="${escapeHtml(candidateUrl ?? '')}">View generated candidate</a><a id="verification-link" href="${escapeHtml(evidenceReviewUrl ?? '')}" hidden>Open independent verification</a></p></section></section>${buildExecutionStatusScript({ dispatchEndpoint, statusEndpoint, changeCaseVersion: changeCase.projectionVersion })}${buildExecutionLiveScript({ statusEndpoint })}`
    : `<section class="request-panel"><p class="eyebrow">BOUNDED IMPLEMENTATION</p><h2>Implementation is not available</h2><p>The current Change Case is not ready for execution, so ADX cannot start a bounded implementation run yet.</p></section>`;
  const headStyles = `<style>body{margin:0;background:#eef4f1;color:#142b31;font:16px/1.5 "Avenir Next","Segoe UI",sans-serif;overflow-x:hidden}main{max-width:1120px;margin:0 auto;padding:30px clamp(18px,4vw,56px) 64px;min-width:0}.topbar{display:flex;justify-content:space-between;align-items:center;gap:18px;padding-bottom:20px;border-bottom:1px solid #bdd0c6}.brand{display:flex;gap:10px;align-items:center;font-size:.78rem;font-weight:800;letter-spacing:.09em;text-transform:uppercase}.brand b{display:grid;place-items:center;width:34px;height:26px;border-radius:5px;background:#153b3c;color:#f1f7f4;font-size:.68rem}.state{margin:0;color:#567074;font:800 .74rem ui-monospace,SFMono-Regular,monospace}.hero{display:grid;grid-template-columns:minmax(0,1fr) minmax(230px,.34fr);gap:28px;align-items:end;padding:44px 0 30px}.eyebrow{margin:0 0 7px;color:#28705d;font-size:.72rem;font-weight:800;letter-spacing:.1em;text-transform:uppercase}.hero h1{margin:0;max-width:760px;font-family:Georgia,"Times New Roman",serif;font-size:clamp(2.3rem,5vw,4.25rem);font-weight:500;line-height:1.02;overflow-wrap:anywhere}.hero-copy{max-width:660px;margin:14px 0 0;color:#577075;font-size:1.05rem}.assurance{padding:17px;border:1px solid #b8cdbf;border-left:5px solid #26705d;background:#fbfdfb}.assurance strong,.assurance span{display:block}.assurance span{color:#607a7b;font-size:.85rem}.request-panel,.notice{padding:24px;border:1px solid #c4d4ca;background:#fbfdfb;min-width:0}.request-panel{border-top:4px solid #28705d}.request-panel h2,.run-console h2,.notice h2{margin:0;font-family:Georgia,"Times New Roman",serif;font-size:1.7rem;font-weight:500;line-height:1.15}.request-panel>p,.notice p{color:#587176}.request-panel form{display:grid;gap:17px;margin-top:20px;min-width:0}.request-panel fieldset{margin:0;padding:0;border:0;min-width:0}.request-panel legend{font-weight:800}.field-help{margin:5px 0 9px;color:#607a7b;font-size:.87rem;overflow-wrap:anywhere}.runner-choice{display:flex;gap:10px;margin:8px 0;padding:11px;border:1px solid #d2ded7;background:#fff;cursor:pointer;min-width:0}.runner-choice input{margin-top:2px}.runner-choice strong{display:block}.runner-choice small{display:block;color:#607a7b;overflow-wrap:anywhere}.select-label{display:grid;gap:6px;font-weight:800;min-width:0}.select-label select{width:100%;max-width:100%;min-width:0;min-height:2.45rem;padding:8px 12px;box-sizing:border-box}.confirm{display:flex;gap:10px;align-items:flex-start;min-width:0}.confirm input{margin-top:.25rem}.button{appearance:none;border:1px solid #2c6f5c;background:#2c6f5c;color:#fff;border-radius:8px;padding:10px 16px;font-weight:800;cursor:pointer}.button:disabled{opacity:.45;cursor:not-allowed}.status{margin:0;font-size:.92rem;color:#607a7b}.status.error{color:#a9443a}.run-console{margin-top:20px;padding:24px;border:1px solid #c4d4ca;background:#fbfdfb}.console-header{display:flex;justify-content:space-between;gap:16px;align-items:flex-start;padding-bottom:14px;border-bottom:1px solid #dce8dd}.run-clock{margin:0;font:800 1rem ui-monospace,SFMono-Regular,monospace;color:#28705d}.run-steps,.event-log{padding-left:18px}.event-log{display:grid;gap:10px;margin:18px 0 0}.failure-details{margin-top:18px;padding:16px;border:1px solid #f0c9bf;background:#fff7f4}.failure-details h3{margin:0 0 8px}.failure-callout{display:grid;gap:4px;margin:10px 0 12px;padding:12px 14px;border:1px solid #ebbcaf;border-left:5px solid #d46d42;background:#fff1ec}.failure-callout strong{font-size:.95rem}.failure-callout span{color:#7b4e3f;font-size:.92rem}.candidate-link{display:flex;flex-wrap:wrap;gap:12px;margin-top:16px}.busy-indicator{display:none;width:1em;height:1em;border:2px solid currentColor;border-right-color:transparent;border-radius:50%;animation:busy-spin .7s linear infinite}.is-busy .busy-indicator{display:inline-block}.button.is-busy{display:inline-flex;align-items:center;gap:.55em}.sr-only{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}@keyframes busy-spin{to{transform:rotate(360deg)}}@media (prefers-reduced-motion:reduce){.busy-indicator{animation:none}}@media (max-width:800px){.hero{grid-template-columns:1fr}.console-header{flex-direction:column}}</style>`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>ADX Implementation - ${escapeHtml(changeCase.title)}</title>${headStyles}</head><body><main><header class="topbar"><div class="brand"><b>ADX</b><span>Delivery control</span></div><p class="state">${escapeHtml(changeCase.state)} · Version ${escapeHtml(changeCase.projectionVersion)}</p></header><section class="hero"><div><p class="eyebrow">Between Gate C and Gate D</p><h1>${escapeHtml(changeCase.title)}</h1><p class="hero-copy">A live, bounded implementation run. ADX retains facts about the run and only opens verification after a candidate has passed its fixed validation.</p></div><aside class="assurance"><strong>Controlled execution</strong><span>Signed lease · Disposable workspace · Fixed validation</span></aside></section>${readyView}</main></body></html>`;
}
