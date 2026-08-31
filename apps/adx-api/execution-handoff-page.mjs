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
    ? `<section class="request-panel"><p class="eyebrow">BOUNDED IMPLEMENTATION</p><h2>Start a controlled implementation run</h2><p>ADX issues a signed lease, creates a disposable workspace, requests a constrained patch, validates it, and retains a candidate only after the checks pass.</p><form id="dispatch-form"><fieldset><legend>Implementation runner</legend><p class="field-help">Story decomposition models are configured separately and cannot run or approve implementation.</p>${providerChoices}</fieldset><label class="select-label">Implementation specification<select id="coding-spec-template">${templateChoices}</select><small>A reviewed specification is bound to the signed task. It cannot expand the lease scope.</small></label><label class="confirm"><input id="confirmation" type="checkbox"> I understand this run can modify only its disposable candidate workspace. A successful run is not approval or delivery.</label><button id="submit" class="button primary" type="submit" disabled><span class="busy-indicator" aria-hidden="true"></span>Run bounded implementation</button><p id="status" class="status" role="status" aria-live="polite" aria-busy="false"></p>${blockedNotice}</form>${roleNotice}</section><section id="progress-console" class="run-console" hidden aria-live="polite"><header class="console-header"><div class="run-heading"><p class="eyebrow">LIVE BOUNDED RUN</p><h2>Implementation activity</h2><p id="run-headline">Recording your request...</p></div><p id="run-clock" class="run-clock">00:00</p></header><ol class="run-steps"><li data-stage="leased"><span>1</span><div><strong>Lease issued</strong><small>Scope and limits are signed.</small></div></li><li data-stage="started"><span>2</span><div><strong>Sandbox working</strong><small>Preparing a bounded patch.</small></div></li><li data-stage="validated"><span>3</span><div><strong>Candidate validated</strong><small>Fixed tests determine promotion.</small></div></li><li data-stage="verified"><span>4</span><div><strong>Ready for verification</strong><small>A code preview becomes available only after the candidate passes validation.</small></div></li></ol><section class="engagement-note"><strong>What ADX can show safely</strong><p>Live status reflects durable run events instead of untrusted console output. The code preview becomes available only after the candidate passes validation, so incomplete or untrusted model output is never presented as generated code.</p></section><ul id="progress-events" class="event-log"></ul><section id="failure-details" class="failure-details" hidden><h3>Run stopped</h3><p id="failure-message"></p><dl><dt>Diagnostic code</dt><dd id="failure-code"></dd><dt>Provider stage</dt><dd id="failure-provider-stage"></dd><dt>Validation hint</dt><dd id="failure-validation-hint"></dd></dl><p id="failure-reason" hidden></p><p id="failure-validation-excerpt" hidden></p><p class="candidate-link"><a id="generated-candidate-link" href="${escapeHtml(candidateUrl ?? '')}">View generated candidate</a><a id="verification-link" href="${escapeHtml(evidenceReviewUrl ?? '')}" hidden>Open independent verification</a></p></section></section>${buildExecutionStatusScript({ dispatchEndpoint, statusEndpoint, changeCaseVersion: changeCase.projectionVersion })}${buildExecutionLiveScript({ statusEndpoint })}`
    : `<section class="request-panel"><p class="eyebrow">BOUNDED IMPLEMENTATION</p><h2>Implementation is not available</h2><p>The current Change Case is not ready for execution, so ADX cannot start a bounded implementation run yet.</p></section>`;
  const headStyles = `<style>:root{--bg:#eef4f1;--surface:rgba(255,255,255,.84);--surface-strong:#ffffff;--surface-soft:#f7fbf9;--text:#173041;--muted:#5e737d;--muted-2:#6f858f;--line:#d6e2dc;--line-strong:#bfd0c7;--accent:#1f7a67;--accent-strong:#155d50;--accent-ink:#0f453d;--accent-soft:rgba(31,122,103,.1);--blue:#2f6fda;--blue-soft:rgba(47,111,218,.12);--warn:#c86a40;--warn-soft:rgba(200,106,64,.12);--shadow:0 18px 48px rgba(16,44,38,.08),0 2px 10px rgba(16,44,38,.04);--shadow-soft:0 10px 32px rgba(16,44,38,.07),0 1px 0 rgba(16,44,38,.03)}*{box-sizing:border-box}body{margin:0;min-height:100vh;background:radial-gradient(circle at top left, rgba(47,111,218,.08), transparent 26%),radial-gradient(circle at top right, rgba(31,122,103,.08), transparent 32%),linear-gradient(180deg,#f4f8f6 0%,#eef4f1 46%,#edf4f0 100%);color:var(--text);font:16px/1.55 "Avenir Next","Segoe UI",system-ui,sans-serif;overflow-x:hidden}main{max-width:1200px;margin:0 auto;padding:28px clamp(18px,4vw,56px) 64px;min-width:0}.topbar{display:flex;justify-content:space-between;align-items:center;gap:18px;padding-bottom:18px}.brand{display:flex;gap:10px;align-items:center;font-size:.78rem;font-weight:800;letter-spacing:.09em;text-transform:uppercase;color:var(--accent-ink)}.brand b{display:grid;place-items:center;width:34px;height:26px;border-radius:9px;background:linear-gradient(135deg,var(--accent-strong),var(--accent));color:#f4fbf9;font-size:.68rem;box-shadow:0 8px 20px rgba(21,93,80,.18)}.state{margin:0;padding:10px 14px;border:1px solid var(--line);border-radius:999px;background:rgba(255,255,255,.82);color:#52646b;font:700 .76rem ui-monospace,SFMono-Regular,monospace;box-shadow:var(--shadow-soft)}.hero{display:grid;grid-template-columns:minmax(0,1.25fr) minmax(270px,.75fr);gap:26px;align-items:end;padding:18px 0 32px}.eyebrow{margin:0 0 8px;color:var(--accent);font-size:.74rem;font-weight:800;letter-spacing:.12em;text-transform:uppercase}.hero h1{margin:0;max-width:760px;font-family:Georgia,"Times New Roman",serif;font-size:clamp(2.4rem,5vw,4.45rem);font-weight:500;line-height:.98;letter-spacing:-.03em;overflow-wrap:anywhere}.hero-copy{max-width:700px;margin:14px 0 0;color:var(--muted);font-size:1.05rem}.hero-pills{display:flex;flex-wrap:wrap;gap:10px;margin-top:18px}.pill{display:inline-flex;align-items:center;gap:8px;padding:9px 13px;border:1px solid var(--line);border-radius:999px;background:rgba(255,255,255,.78);box-shadow:var(--shadow-soft);color:var(--accent-ink);font-size:.84rem;font-weight:700}.pill::before{content:'';width:8px;height:8px;border-radius:999px;background:linear-gradient(135deg,var(--blue),#8dc5ff)}.assurance{position:relative;padding:24px 22px;border:1px solid color-mix(in srgb,var(--accent) 18%, var(--line));border-radius:24px;background:linear-gradient(180deg,rgba(255,255,255,.92),rgba(244,250,247,.96));box-shadow:var(--shadow)}.assurance::before{content:'';position:absolute;inset:0 auto 0 0;width:6px;border-radius:24px 0 0 24px;background:linear-gradient(180deg,var(--blue),var(--accent))}.assurance strong,.assurance span{display:block}.assurance strong{font-size:1rem;color:var(--accent-ink)}.assurance p{margin:12px 0 0;color:var(--muted);font-size:.92rem}.request-panel,.notice,.run-console{position:relative;padding:28px;border:1px solid rgba(191,208,199,.9);border-radius:28px;background:var(--surface);backdrop-filter:blur(12px);box-shadow:var(--shadow);min-width:0}.request-panel::before,.run-console::before{content:'';position:absolute;inset:0 0 auto 0;height:4px;border-radius:28px 28px 0 0;background:linear-gradient(90deg,var(--accent),var(--blue))}.request-panel{overflow:hidden}.request-panel h2,.run-console h2,.notice h2{margin:0;font-family:Georgia,"Times New Roman",serif;font-size:1.72rem;font-weight:500;line-height:1.12;letter-spacing:-.02em}.request-panel>p,.notice p{color:var(--muted);margin-bottom:0}.request-panel form{display:grid;gap:17px;margin-top:20px;min-width:0}.request-panel fieldset{margin:0;padding:0;border:0;min-width:0}.request-panel legend{font-weight:800;color:var(--accent-ink)}.field-help{margin:5px 0 9px;color:var(--muted-2);font-size:.88rem;overflow-wrap:anywhere}.runner-choice{display:flex;gap:12px;margin:10px 0;padding:14px;border:1px solid var(--line);border-radius:18px;background:rgba(255,255,255,.95);cursor:pointer;min-width:0;transition:transform .18s ease,border-color .18s ease,box-shadow .18s ease}.runner-choice:hover{transform:translateY(-1px);border-color:#b8c9c1;box-shadow:0 10px 24px rgba(16,44,38,.05)}.runner-choice input{margin-top:2px;accent-color:var(--accent)}.runner-choice strong{display:block;color:var(--text)}.runner-choice small{display:block;color:var(--muted);overflow-wrap:anywhere}.select-label{display:grid;gap:6px;font-weight:800;color:var(--accent-ink);min-width:0}.select-label select{width:100%;max-width:100%;min-width:0;min-height:3rem;padding:10px 14px;border:1px solid var(--line-strong);border-radius:16px;background:rgba(255,255,255,.95);box-shadow:inset 0 1px 0 rgba(255,255,255,.88);box-sizing:border-box;font:inherit;color:var(--text)}.select-label small{font-weight:500;color:var(--muted)}.confirm{display:flex;gap:10px;align-items:flex-start;min-width:0;color:var(--text)}.confirm input{margin-top:.25rem;accent-color:var(--accent)}.button{appearance:none;border:1px solid transparent;background:linear-gradient(135deg,var(--accent-strong),var(--accent));color:#f8fffd;border-radius:14px;padding:12px 18px;font-weight:800;cursor:pointer;box-shadow:0 10px 24px rgba(31,122,103,.18);transition:transform .18s ease,box-shadow .18s ease,filter .18s ease}.button:hover{transform:translateY(-1px);box-shadow:0 14px 28px rgba(31,122,103,.22);filter:saturate(1.02)}.button:disabled{opacity:.45;cursor:not-allowed;transform:none;box-shadow:none}.status{margin:0;font-size:.94rem;color:var(--muted)}.status.error{color:#a9443a}.run-console{margin-top:20px;overflow:hidden}.console-header{display:flex;justify-content:space-between;gap:16px;align-items:flex-start;padding-bottom:18px}.run-heading{max-width:760px}.run-clock{margin:0;padding:10px 14px;border:1px solid var(--line);border-radius:999px;background:rgba(255,255,255,.8);font:800 1rem ui-monospace,SFMono-Regular,monospace;color:var(--accent);box-shadow:var(--shadow-soft);white-space:nowrap}.run-steps{list-style:none;display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:14px;margin:24px 0 0;padding:0}.run-steps li{display:grid;grid-template-columns:auto 1fr;gap:12px;align-items:start;padding:16px;border:1px solid var(--line);border-radius:20px;background:linear-gradient(180deg,rgba(255,255,255,.98),rgba(246,250,248,.92));box-shadow:var(--shadow-soft)}.run-steps li span{display:grid;place-items:center;width:34px;height:34px;border-radius:999px;background:linear-gradient(135deg,rgba(47,111,218,.12),rgba(31,122,103,.12));color:var(--accent-ink);font:800 .92rem ui-monospace,SFMono-Regular,monospace;flex:0 0 auto}.run-steps li strong{display:block;font-size:1rem;color:var(--text)}.run-steps li small{display:block;margin-top:5px;color:var(--muted);line-height:1.45}.run-steps li.done{border-color:rgba(31,122,103,.24)}.run-steps li.active{border-color:rgba(47,111,218,.36);box-shadow:0 14px 32px rgba(47,111,218,.11)}.run-steps li.failed{border-color:rgba(200,106,64,.42);background:linear-gradient(180deg,rgba(255,248,244,.98),rgba(255,244,239,.94))}.run-steps li.done span{background:linear-gradient(135deg,rgba(31,122,103,.22),rgba(47,111,218,.14));color:var(--accent-strong)}.run-steps li.active span{background:linear-gradient(135deg,rgba(47,111,218,.18),rgba(31,122,103,.16));color:#2154ae}.run-steps li.failed span{background:linear-gradient(135deg,rgba(200,106,64,.18),rgba(248,183,152,.16));color:#8f4f31}.engagement-note{margin-top:18px;padding:18px 18px 18px 20px;border:1px solid rgba(31,122,103,.18);border-left:5px solid var(--accent);border-radius:20px;background:linear-gradient(180deg,rgba(244,252,249,.98),rgba(248,253,251,.92));box-shadow:var(--shadow-soft)}.engagement-note strong{display:block;margin-bottom:6px;font-size:.92rem;letter-spacing:.04em;text-transform:uppercase;color:var(--accent-ink)}.engagement-note p{margin:0;color:var(--muted)}.event-log{list-style:none;display:grid;gap:12px;margin:18px 0 0;padding:0}.event-log li{display:grid;grid-template-columns:auto 1fr;gap:12px;align-items:start;padding:14px 16px;border:1px solid var(--line);border-radius:18px;background:rgba(255,255,255,.94);box-shadow:var(--shadow-soft)}.event-log time{display:inline-flex;align-items:center;justify-content:center;min-width:82px;padding:8px 11px;border-radius:999px;background:rgba(31,122,103,.09);color:var(--accent-strong);font:800 .78rem ui-monospace,SFMono-Regular,monospace;letter-spacing:.03em}.event-log strong{display:block;font-size:1rem;color:var(--text)}.event-log span{display:block;margin-top:5px;color:var(--muted);line-height:1.45}.failure-details{margin-top:18px;padding:22px;border:1px solid color-mix(in srgb,var(--warn) 24%, var(--line));border-radius:22px;background:linear-gradient(180deg,rgba(255,251,248,.98),rgba(255,245,240,.94));box-shadow:var(--shadow-soft)}.failure-details h3{margin:0 0 10px;font-family:Georgia,"Times New Roman",serif;font-size:1.2rem;font-weight:500;color:#8d3f25}.failure-details>p:first-of-type{margin:0;color:var(--muted)}.failure-callout{display:grid;gap:4px;margin:14px 0 16px;padding:14px 16px;border:1px solid rgba(200,106,64,.2);border-left:5px solid var(--warn);border-radius:16px;background:rgba(255,248,243,.96)}.failure-callout strong{font-size:.95rem;color:#8f4f31}.failure-callout span{color:#7b5b51;font-size:.93rem}.failure-details dl{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:14px;margin:16px 0 0}.failure-details dt{margin:0 0 6px;font-size:.75rem;font-weight:800;letter-spacing:.08em;text-transform:uppercase;color:var(--muted-2)}.failure-details dd{margin:0;padding:12px 14px;border:1px solid var(--line);border-radius:14px;background:rgba(255,255,255,.88);color:var(--text);overflow-wrap:anywhere;box-shadow:var(--shadow-soft)}.failure-details .failure-output{margin:0;font:inherit;line-height:1.45;white-space:pre-wrap;max-height:14rem;overflow:auto;padding:12px 14px;border:1px solid var(--line);border-radius:14px;background:rgba(255,255,255,.92)}.candidate-link{display:flex;flex-wrap:wrap;gap:12px;margin-top:18px}.candidate-link a{display:inline-flex;align-items:center;gap:8px;padding:10px 14px;border-radius:999px;border:1px solid var(--line);color:var(--accent-ink);text-decoration:none;background:rgba(255,255,255,.9);box-shadow:var(--shadow-soft)}.candidate-link a:hover{text-decoration:none;border-color:#b9cbc2}.busy-indicator{display:none;width:1em;height:1em;border:2px solid currentColor;border-right-color:transparent;border-radius:50%;animation:busy-spin .7s linear infinite}.is-busy .busy-indicator{display:inline-block}.button.is-busy{display:inline-flex;align-items:center;gap:.55em}.sr-only{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}@keyframes busy-spin{to{transform:rotate(360deg)}}@media (prefers-reduced-motion:reduce){.busy-indicator{animation:none}.runner-choice,.button{transition:none}}@media (max-width:1080px){.hero{grid-template-columns:1fr}.run-steps,.failure-details dl{grid-template-columns:1fr 1fr}}@media (max-width:760px){main{padding-inline:14px}.topbar{align-items:flex-start;flex-direction:column}.console-header{flex-direction:column}.run-steps,.failure-details dl{grid-template-columns:1fr}.run-steps li,.event-log li{grid-template-columns:1fr}.event-log time{width:max-content}}</style>`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>ADX Implementation - ${escapeHtml(changeCase.title)}</title>${headStyles}</head><body><main><header class="topbar"><div class="brand"><b>ADX</b><span>Delivery control</span></div><p class="state">${escapeHtml(changeCase.state)} · Version ${escapeHtml(changeCase.projectionVersion)}</p></header><section class="hero"><div><p class="eyebrow">Between Gate C and Gate D</p><h1>${escapeHtml(changeCase.title)}</h1><p class="hero-copy">A live, bounded implementation run. ADX retains facts about the run and only opens verification after a candidate has passed its fixed validation.</p><div class="hero-pills"><span class="pill">Signed lease</span><span class="pill">Disposable workspace</span><span class="pill">Fixed validation</span></div></div><aside class="assurance"><strong>Controlled execution</strong><p>Bounded, audited, and recoverable</p><span>Signed lease · Disposable workspace · Fixed validation</span></aside></section>${readyView}</main></body></html>`;
}
