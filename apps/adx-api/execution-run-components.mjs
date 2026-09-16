function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"]/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[character]));
}

import { randomUUID } from "node:crypto";

export const executionUiRevision = randomUUID();

export function buildExecutionStatusScript({ dispatchEndpoint, changeCaseVersion, submissionAvailable }) {
  return `
<script>
const form = document.getElementById('dispatch-form');
const button = document.getElementById('submit');
const status = document.getElementById('status');
const confirmation = document.getElementById('confirmation');
const providers = [...document.querySelectorAll('input[name="provider"]')];
const submissionAvailable = ${JSON.stringify(Boolean(submissionAvailable))};

function syncRunningState(running) {
  if (!form || !button) return;
  form.dataset.running = running ? 'true' : 'false';
  button.dataset.running = running ? 'true' : 'false';
  button.setAttribute('aria-busy', running ? 'true' : 'false');
  button.disabled = running;
}

if (form && button && status) {
  const syncControls = () => {
    if (form.dataset.running === 'true' || form.dataset.executionComplete === 'true') {
      button.disabled = true;
      button.dataset.running = 'true';
      button.setAttribute('aria-busy', form.dataset.running === 'true' ? 'true' : 'false');
      return;
    }
    const providerSelected = providers.some((input) => input.checked);
    button.disabled = !submissionAvailable || !providerSelected || !confirmation?.checked;
    button.dataset.running = 'false';
    button.setAttribute('aria-busy', 'false');
  };

  confirmation?.addEventListener('change', syncControls);
  providers.forEach((input) => input.addEventListener('change', syncControls));
  window.syncDispatchControls = syncControls;
  syncControls();

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (form.dataset.running === 'true') return;
    syncRunningState(true);
    status.className = 'status loading';
    status.textContent = 'Requesting a signed lease… this can take a moment.';
    const consoleEl = document.getElementById('progress-console');
    const headline = document.getElementById('run-headline');
    if (consoleEl) consoleEl.hidden = false;
    if (headline) headline.textContent = 'Requesting the signed lease and preparing the disposable workspace...';
    try {
      const response = await fetch(${JSON.stringify(dispatchEndpoint)}, {
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
      status.className = 'status loading';
      status.textContent = 'Coding agent accepted the run and is still working...';
      const runId = body?.runId || body?.lease?.runId || null;
      window.primeAcceptedRun?.(runId);
      window.beginRun?.(runId);
    } catch (error) {
      status.className = 'status error';
      status.textContent = error.message;
      syncRunningState(false);
      syncControls();
    }
  });
}
</script>`;
}

export function buildExecutionLiveScript({ statusEndpoint, projectRepository, initialSnapshot = null }) {
  const projectLabel = projectRepository || 'selected project';
  const initialSnapshotJson = JSON.stringify(initialSnapshot ?? null).replace(/</g, '\u003c');
  return `
<script>
const config = ${JSON.stringify({ statusEndpoint, evidenceReviewUrl: '/evidence-review', candidateUrl: '/generated-candidate', uiRevision: executionUiRevision }).replace(/</g, '\u003c')};
const projectLabel = ${JSON.stringify(projectLabel)};
let initialSnapshot = ${initialSnapshotJson};
const stageOrder = ['leased', 'started', 'validated'];
let pollTimer = null;
let clockTimer = null;
let runStartedAt = null;
let runClockKey = null;
let currentRunId = null;
let eventConsoleInitialized = false;
let renderedEventSignature = '';
const eventFollowStorageKey = 'adx:follow-live:' + (typeof location === 'undefined' ? 'execution' : location.pathname);
let eventFollowLive = true;
try {
  eventFollowLive = sessionStorage.getItem(eventFollowStorageKey) !== 'false';
} catch {}

const byId = (id) => document.getElementById(id);
const escapeMarkup = (value) => String(value ?? '').replace(/[&<>"]/g, (character) => ({
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;'
}[character]));
const eventLabels = {
  AgentRunLeased: { title: 'Lease issued', detail: 'Signed scope and policy limits have been recorded.', stage: 'leased' },
  AgentRunStarted: { title: 'Building the bounded ' + projectLabel + ' candidate', detail: 'ADX is preparing the disposable workspace, requesting the constrained patch, then will run the fixed ' + projectLabel + ' verification.', stage: 'started' },
  AgentRunCompleted: { title: 'Candidate ready for Gate D', detail: 'The run finished and the exact candidate is ready for independent verification.', stage: 'validated' },
  AgentRunFailed: { title: 'Runner stopped', detail: 'The candidate was not promoted.', stage: 'started', failed: true },
  AgentRunQuotaExceeded: { title: 'Runner limit reached', detail: 'The bounded run reached a configured limit.', stage: 'started', failed: true },
  AgentRunCancellationObserved: { title: 'Run cancelled', detail: 'The run was cancelled before promotion.', stage: 'started', failed: true },
  AgentRunLeaseRevoked: { title: 'Lease revoked', detail: 'The execution lease was revoked.', stage: 'leased', failed: true },
};

const phaseStages = {
  CONTEXT_COLLECTION: 'leased',
  CONTEXT_READY: 'started',
  MODEL_REQUEST: 'started',
  MODEL_RESPONSE: 'started',
  PATCH_APPLIED: 'started',
  VALIDATION: 'validated',
  VALIDATION_RESULT: 'validated',
  CANDIDATE_PROMOTION: 'validated',
};

const statusLabels = {
  RUNNING: { label: 'Running', tone: 'active' },
  LEASED: { label: 'Preparing workspace', tone: 'active' },
  COMPLETED: { label: 'Completed', tone: 'success' },
  FAILED: { label: 'Failed', tone: 'failure' },
  CANCELLED: { label: 'Cancelled', tone: 'failure' },
};

function activityLabel(value) {
  return ({
    WORKSPACE_PREPARATION: 'Workspace preparation',
    IMPLEMENTATION: 'Feature implementation',
    EVIDENCE_REPAIR: 'Evidence repair',
    SEMANTIC_VERIFICATION: 'Semantic verification',
    SEMANTIC_REPAIR: 'Semantic repair',
    EXECUTABLE_VALIDATION: 'Executable validation',
  })[String(value || '').toUpperCase()] || 'Model operation';
}

function formatMilliseconds(value) {
  const milliseconds = Number(value);
  if (!Number.isFinite(milliseconds) || milliseconds < 0) return '00:00';
  const totalSeconds = Math.max(0, Math.round(milliseconds / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return String(minutes).padStart(2, '0') + ':' + String(seconds).padStart(2, '0');
}

function operationDetail(details) {
  const index = Number(details?.operationIndex || 0);
  const count = Number(details?.operationCount || 0);
  const stories = Array.isArray(details?.storyKeys) ? details.storyKeys : [];
  const position = index && count ? ' · ' + index + ' of ' + count : '';
  const strategy = details?.batchStrategy === 'AFFINITY_CAPACITY' ? ' · affinity batch' : '';
  const storyLabel = stories.length ? ' · ' + stories.join(', ') : '';
  return activityLabel(details?.activity) + position + strategy + storyLabel;
}

function progressEventLabel(phase, details = {}) {
  const normalized = String(phase || '').toUpperCase();
  if (normalized === 'MODEL_REQUEST') return { title: activityLabel(details.activity) + ' started', detail: operationDetail(details) + ' · waiting for the model gateway', stage: 'started' };
  if (normalized === 'MODEL_RESPONSE') return { title: activityLabel(details.activity) + ' response received', detail: operationDetail(details) + ' · ' + formatMilliseconds(details.durationMs), stage: 'started' };
  if (normalized === 'PATCH_APPLIED') return { title: 'Patch applied', detail: operationDetail(details) + ' · ' + String(details.patchCount || 0) + ' files · ' + formatMilliseconds(details.durationMs), stage: 'started' };
  if (normalized === 'VALIDATION') return { title: 'Executable validation started', detail: operationDetail(details) + ' · ' + String(details.commandCount || 0) + ' command groups', stage: 'validated' };
  if (normalized === 'VALIDATION_RESULT') return { title: Number(details.exitCode) === 0 ? 'Executable validation passed' : 'Executable validation failed', detail: operationDetail(details) + ' · ' + formatMilliseconds(details.durationMs), stage: 'validated' };
  if (normalized === 'CANDIDATE_PROMOTION') return { title: 'Candidate promotion recorded', detail: 'The validated candidate is being retained for review.', stage: 'validated' };
  if (normalized === 'CONTEXT_COLLECTION') return { title: 'Workspace preparing', detail: 'ADX is collecting the bounded context and preparing the disposable workspace.', stage: 'leased' };
  if (normalized === 'CONTEXT_READY') return { title: 'Workspace ready', detail: String(details.fileCount || 0) + ' files indexed · ' + formatMilliseconds(details.durationMs), stage: 'started' };
  return null;
}

function normalizeEventName(value) {
  return String(value ?? '').replace(/\.v\d+$/i, '');
}

function stopTimers() {
  if (pollTimer) clearInterval(pollTimer);
  if (clockTimer) clearInterval(clockTimer);
  pollTimer = null;
  clockTimer = null;
}

function eventTime(value) {
  try {
    return new Date(value).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  } catch {
    return '--:--:--';
  }
}

function formatDuration(startedAt, endedAt = null) {
  const startMs = Date.parse(startedAt || '');
  if (!Number.isFinite(startMs)) return 'Duration unavailable';
  const endMs = Date.parse(endedAt || '') || Date.now();
  const totalSeconds = Math.max(0, Math.round((endMs - startMs) / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return String(minutes).padStart(2, '0') + ':' + String(seconds).padStart(2, '0');
}

function summarizeEvent(event) {
  const eventName = normalizeEventName(event?.eventType || event?.kind);
  const phaseEntry = eventName === 'AgentRunProgressed' ? progressEventLabel(event?.phase, event?.details) : null;
  const entry = phaseEntry || eventLabels[eventName] || { title: eventName || 'Event', detail: event.detail || '', stage: phaseStages[String(event?.phase || '').toUpperCase()] || 'started' };
  const errorCode = String(event?.errorCode || '').trim();
  const errorDetails = event?.errorDetails && typeof event.errorDetails === 'object' ? event.errorDetails : null;
  return {
    title: entry.title,
    detail: entry.detail,
    stage: entry.stage || 'started',
    failed: Boolean(entry.failed),
    errorCode,
    validationCommand: String(errorDetails?.validationCommand || '').trim(),
    validationCategory: String(errorDetails?.validationCategory || '').trim(),
    validationReason: String(errorDetails?.validationFailureReason || '').trim(),
    phase: String(event?.phase || '').toUpperCase(),
  };
}

function groupRuns(snapshot) {
  const runs = Array.isArray(snapshot?.runs) ? snapshot.runs : [];
  const events = Array.isArray(snapshot?.events) ? snapshot.events : [];
  const groupedEvents = new Map();
  for (const event of events) {
    const runId = String(event?.runId || '').trim();
    if (!runId) continue;
    if (!groupedEvents.has(runId)) groupedEvents.set(runId, []);
    groupedEvents.get(runId).push(event);
  }
  return runs.map((run, index) => {
    const runEvents = groupedEvents.get(String(run?.id || '').trim()) || [];
    const latestEvent = runEvents.at(-1) || null;
    const status = String(run?.status || '').toUpperCase();
    const summary = latestEvent ? summarizeEvent(latestEvent) : null;
    return {
      run,
      index,
      status,
      label: statusLabels[status] || { label: status || 'Unknown', tone: 'waiting' },
      startedAt: run?.createdAt || runEvents[0]?.occurredAt || null,
      updatedAt: run?.updatedAt || latestEvent?.occurredAt || null,
      duration: formatDuration(run?.createdAt || runEvents[0]?.occurredAt || null, status === 'RUNNING' || status === 'LEASED' ? null : run?.updatedAt || latestEvent?.occurredAt || null),
      eventCount: runEvents.length,
      latestEvent,
      latestSummary: summary,
      events: runEvents,
    };
  });
}

function currentRunEvents(snapshot) {
  const runs = Array.isArray(snapshot?.runs) ? snapshot.runs : [];
  const currentRunId = String(runs[0]?.id || '').trim();
  const events = Array.isArray(snapshot?.events) ? snapshot.events : [];
  if (!currentRunId) return events;
  return events.filter((event) => String(event?.runId || '').trim() === currentRunId);
}

function setLivePhaseLabel(text) {
  const phase = byId('run-phase');
  if (phase) phase.textContent = text;
}

function describeLivePhase(snapshot) {
  const run = Array.isArray(snapshot?.runs) ? snapshot.runs[0] : null;
  const status = String(run?.status || '').toUpperCase();
  const latestEvent = currentRunEvents(snapshot).at(-1) || null;
  const latestKind = normalizeEventName(latestEvent?.eventType || latestEvent?.kind || '');
  const latestPhase = String(latestEvent?.phase || '').toUpperCase();

  if (status === 'COMPLETED') return 'Phase: candidate ready for Gate D review';
  if (status === 'FAILED' || status === 'CANCELLED') return 'Phase: run stopped';
  if (latestKind === 'AgentRunCompleted') return 'Phase: candidate ready for Gate D review';
  if (latestPhase === 'MODEL_REQUEST') return 'Phase: ' + activityLabel(latestEvent?.details?.activity).toLowerCase() + ' is waiting for the model';
  if (latestPhase === 'MODEL_RESPONSE' || latestPhase === 'PATCH_APPLIED') return 'Phase: applying and checking the generated change';
  if (latestKind === 'AgentRunLeased' || latestPhase === 'CONTEXT_COLLECTION') return 'Phase: workspace preparing';
  if (latestPhase === 'CONTEXT_READY') return 'Phase: workspace ready';
  if (latestPhase === 'VALIDATION') return 'Phase: validation is in progress';
  if (latestPhase === 'VALIDATION_RESULT') return 'Phase: validation result recorded';
  if (latestPhase === 'CANDIDATE_PROMOTION') return 'Phase: candidate promotion is being recorded';
  return 'Phase: coding agent is working';
}

function isNearBottom(element) {
  return element.scrollHeight - element.scrollTop - element.clientHeight < 48;
}

function setEventFollowLive(value) {
  eventFollowLive = Boolean(value);
  const follow = byId('follow-live');
  if (follow) follow.checked = eventFollowLive;
  try {
    sessionStorage.setItem(eventFollowStorageKey, String(eventFollowLive));
  } catch {}
}

function scrollEventLogToLatest(log) {
  if (!log) return;
  log.scrollTop = log.scrollHeight;
}

function ensureEventConsoleControls() {
  if (eventConsoleInitialized) return;
  const log = byId('progress-events');
  if (!log) return;
  let follow = byId('follow-live');
  let latest = byId('jump-latest');
  if (!follow || !latest) {
    const heading = log.parentNode?.querySelector('h3');
    const header = document.createElement('div');
    header.className = 'event-header';
    header.innerHTML = '<div><p class="eyebrow">LIVE TRACE</p><h3>Live events</h3></div><div class="event-tools"><label class="follow-live"><input id="follow-live" type="checkbox" checked> Follow live</label><button id="jump-latest" class="event-jump" type="button" title="Jump to latest event">Latest</button></div>';
    if (heading) heading.replaceWith(header);
    else log.insertAdjacentElement('beforebegin', header);
    follow = byId('follow-live');
    latest = byId('jump-latest');
  }
  if (!follow || !latest) return;
  eventConsoleInitialized = true;
  follow.checked = eventFollowLive;
  log.addEventListener('wheel', (event) => {
    if (eventFollowLive && event.deltaY < 0) setEventFollowLive(false);
  }, { passive: true });
  log.addEventListener('touchstart', () => {
    if (eventFollowLive) setEventFollowLive(false);
  }, { passive: true });
  log.addEventListener('pointerdown', () => {
    if (eventFollowLive) setEventFollowLive(false);
  }, { passive: true });
  log.addEventListener('keydown', (event) => {
    if (['ArrowUp', 'PageUp', 'Home'].includes(event.key)) setEventFollowLive(false);
  });
  follow.addEventListener('change', () => {
    setEventFollowLive(follow.checked);
    if (eventFollowLive) scrollEventLogToLatest(log);
  });
  latest.addEventListener('click', () => {
    setEventFollowLive(true);
    scrollEventLogToLatest(log);
  });
}

function renderEvents(events, emptyMessage = 'The coding agent has not produced a snapshot yet.') {
  const log = byId('progress-events');
  if (!log) return;
  ensureEventConsoleControls();
  const previousScrollTop = log.scrollTop;
  if (!Array.isArray(events) || !events.length) {
    renderedEventSignature = 'empty:' + emptyMessage;
    log.innerHTML = '<li><time>--:--:--</time><strong>No live events yet</strong><p>' + escapeMarkup(emptyMessage) + '</p></li>';
    return;
  }
  const eventSignature = JSON.stringify(events.map((event) => [event.id, event.sequence, event.eventType, event.kind, event.phase, event.occurredAt, event.details]));
  if (eventSignature === renderedEventSignature) {
    const currentDuration = log.querySelector('li.current .event-duration');
    const currentStartedAt = events.at(-1)?.occurredAt;
    if (currentDuration) currentDuration.textContent = formatDuration(currentStartedAt);
    if (eventFollowLive) scrollEventLogToLatest(log);
    return;
  }
  renderedEventSignature = eventSignature;
  log.innerHTML = events.map((event, index) => {
    const entry = summarizeEvent(event);
    const startMs = Date.parse(event.occurredAt || '');
    const nextMs = Date.parse(events[index + 1]?.occurredAt || '');
    const endMs = Number.isFinite(nextMs) ? nextMs : Date.now();
    const duration = Number.isFinite(startMs) ? formatMilliseconds(endMs - startMs) : '00:00';
    return '<li' + (index === events.length - 1 ? ' class="current"' : '') + '><time>' + eventTime(event.occurredAt) + '</time><strong>' + escapeMarkup(entry.title) + '</strong><span class="event-duration">' + duration + '</span><p>' + escapeMarkup(entry.detail) + '</p></li>';
  }).join('');
  if (eventFollowLive) scrollEventLogToLatest(log);
  else log.scrollTop = previousScrollTop;
}

function renderRunHistory(snapshot) {
  const summary = byId('run-summary');
  if (!summary) return;
  const attempts = groupRuns(snapshot).slice(1);
  const existing = byId('run-history');
  if (!attempts.length) {
    if (existing) existing.remove();
    return;
  }

  let section = existing;
  if (!section) {
    section = document.createElement('details');
    section.id = 'run-history';
    section.className = 'run-history';
    summary.insertAdjacentElement('afterend', section);
  }

  const cards = attempts.map((attempt, index) => {
    const attemptNumber = attempts.length - index;
    const attemptLabel = 'Attempt ' + attemptNumber;
    const latest = attempt.latestSummary;
    const statusTone = attempt.label.tone || 'waiting';
    const latestLine = latest
      ? latest.errorCode || latest.phase || latest.title
      : 'No event recorded';
    const eventList = attempt.events.map((event) => {
      const summaryItem = summarizeEvent(event);
      return '<li><time>' + eventTime(event.occurredAt) + '</time><strong>' + escapeMarkup(summaryItem.title) + '</strong><p>' + escapeMarkup(summaryItem.detail) + '</p></li>';
    }).join('');
    return '<details class="attempt-card ' + statusTone + '"><summary><div class="attempt-meta"><span class="attempt-pill">' + attemptLabel + '</span><strong>' + escapeMarkup(attempt.label.label) + '</strong><small>' + escapeMarkup(attempt.run?.adapterId || 'unknown adapter') + ' · ' + escapeMarkup(attempt.duration) + ' · ' + String(attempt.eventCount) + ' events</small></div><div class="attempt-summary"><span>' + escapeMarkup(latestLine) + '</span><strong>' + escapeMarkup(attempt.updatedAt ? eventTime(attempt.updatedAt) : 'No timestamp') + '</strong></div></summary><div class="attempt-body"><dl class="attempt-facts">' + [
      ['Run ID', attempt.run?.id || 'Unavailable'],
      ['Status', attempt.status || 'Unavailable'],
      ['Started', attempt.startedAt ? new Date(attempt.startedAt).toLocaleString([], { month: 'numeric', day: 'numeric', hour: 'numeric', minute: '2-digit', second: '2-digit' }) : 'Unavailable'],
      ['Latest event', latest?.title || 'Unavailable'],
      ['Latest phase', latest?.phase || 'Unavailable'],
    ].map(([label, value]) => '<div><dt>' + escapeMarkup(label) + '</dt><dd>' + escapeMarkup(value) + '</dd></div>').join('') + '</dl><div class="attempt-events"><p class="eyebrow">Attempt events</p><ul>' + (eventList || '<li><strong>No events retained</strong><p>This attempt has no visible event stream.</p></li>') + '</ul></div></div></details>';
  }).join('');

  const countLabel = attempts.length === 1 ? '1 previous run' : attempts.length + ' previous runs';
  section.innerHTML = '<summary class="history-toggle"><span><span class="history-kicker">RUN HISTORY</span><strong>Previous runs</strong><small>Open only when you need earlier diagnostics.</small></span><span class="history-count">' + countLabel + '</span></summary><div class="history-stack">' + cards + '</div>';
}

function collapseRunHistory() {
  const history = byId('run-history');
  if (history) history.open = false;
}

function renderRunCommentary(snapshot) {
  const commentary = byId('run-commentary');
  if (!commentary) return;

  const run = Array.isArray(snapshot?.runs) ? snapshot.runs[0] : null;
  const status = String(run?.status || '').toUpperCase();
  const latestEvent = currentRunEvents(snapshot).at(-1) || null;
  const latestKind = normalizeEventName(latestEvent?.eventType || latestEvent?.kind || '');

  if (status === 'RUNNING' || status === 'LEASED' || !status) {
    commentary.textContent = latestKind === 'AgentRunStarted'
      ? 'Live commentary: the coding agent has started and the workspace is still running.'
      : latestKind === 'AgentRunLeased'
        ? 'Live commentary: the lease is active and the workspace is being prepared.'
        : 'Live commentary: the coding agent is still running. Waiting for the workspace to finish.';
    return;
  }

  if (status === 'COMPLETED') {
    commentary.textContent = 'Live commentary: the coding agent finished and the candidate is ready for review.';
    return;
  }

  if (status === 'FAILED') {
    commentary.textContent = 'Live commentary: this attempt failed and no candidate was promoted. Gate D remains closed; review the failure and retry the implementation.';
    return;
  }

  if (status === 'CANCELLED') {
    commentary.textContent = 'Live commentary: this attempt was cancelled before a candidate was promoted. Gate D remains closed.';
    return;
  }

  commentary.textContent = 'Live commentary: waiting for the next coding-agent status update.';
}

function renderRunTimings(snapshot) {
  const runDetails = byId('run-details');
  if (!runDetails?.parentNode) return;

  const run = Array.isArray(snapshot?.runs) ? snapshot.runs[0] : null;
  const events = currentRunEvents(snapshot);
  const startedAt = snapshot?.startedAt || run?.startedAt || run?.createdAt || events[0]?.occurredAt || null;
  const endedAt = run?.updatedAt || events.at(-1)?.occurredAt || null;
  const status = String(run?.status || '').toUpperCase();
  const terminalTimings = [...events].reverse().find((event) => event?.timings)?.timings || null;
  const liveTimings = { contextMs: 0, modelMs: 0, patchMs: 0, validationMs: 0 };
  let modelCalls = 0;
  events.forEach((event, index) => {
    const phase = String(event?.phase || '').toUpperCase();
    const measured = Number(event?.details?.durationMs);
    const startedMs = Date.parse(event?.occurredAt || '');
    const nextMs = Date.parse(events[index + 1]?.occurredAt || '');
    const inferred = Number.isFinite(startedMs)
      ? Math.max(0, (Number.isFinite(nextMs) ? nextMs : status === 'RUNNING' ? Date.now() : startedMs) - startedMs)
      : 0;
    if (phase === 'MODEL_REQUEST') {
      modelCalls += 1;
      liveTimings.modelMs += inferred;
    }
    if (phase === 'CONTEXT_READY' && Number.isFinite(measured)) liveTimings.contextMs += measured;
    if (phase === 'PATCH_APPLIED' && Number.isFinite(measured)) liveTimings.patchMs += measured;
    if (phase === 'VALIDATION_RESULT' && Number.isFinite(measured)) liveTimings.validationMs += measured;
    if (phase === 'VALIDATION' && !events[index + 1]) liveTimings.validationMs += inferred;
  });
  const timings = terminalTimings || liveTimings;
  const rows = [
    ['Elapsed', formatDuration(startedAt, status === 'RUNNING' || status === 'LEASED' ? null : endedAt)],
    ['Model', formatMilliseconds(timings.modelMs)],
    ['Workspace', formatMilliseconds(Number(timings.contextMs || 0) + Number(timings.workspaceCopyMs || 0))],
    ['Patch application', formatMilliseconds(timings.patchMs)],
    ['Validation', formatMilliseconds(timings.validationMs)],
    ['Model calls', String(modelCalls)],
    ['Started', startedAt ? new Date(startedAt).toLocaleString() : 'Unavailable'],
    ['Last update', endedAt ? new Date(endedAt).toLocaleString() : 'Unavailable'],
  ];

  let section = byId('run-timings');
  if (!section) {
    section = document.createElement('section');
    section.id = 'run-timings';
    section.className = 'run-timings';
    section.innerHTML = '<header><p class="eyebrow">MEASURED TIMINGS</p><h3>Where the run spent time</h3></header><dl></dl>';
    runDetails.parentNode?.appendChild(section);
  }

  const list = section.querySelector('dl');
  if (list) {
    list.innerHTML = rows.map(([label, value]) => '<div><dt>' + escapeMarkup(label) + '</dt><dd>' + escapeMarkup(value) + '</dd></div>').join('');
  }
}

function renderRunIdentity(snapshot) {
  const identity = byId('run-provider');
  if (!identity) return;

  const run = Array.isArray(snapshot?.runs) ? snapshot.runs[0] : null;
  const adapterId = String(run?.adapterId || 'unknown adapter').trim();
  const updatedAt = String(run?.updatedAt || run?.createdAt || snapshot?.startedAt || '').trim();

  if (!updatedAt) {
    identity.textContent = 'Run identity: waiting for the coding agent snapshot.';
    return;
  }

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
  identity.textContent = 'Run identity: ' + adapterId + ' · Updated ' + renderedAt;
}

function ensureRunWarningNode() {
  let warning = byId('run-warning');
  if (warning) return warning;
  const provider = byId('run-provider');
  if (!provider || !provider.parentNode) return null;
  warning = document.createElement('p');
  warning.id = 'run-warning';
  warning.className = 'run-warning';
  warning.hidden = true;
  warning.style.margin = '8px 0 0';
  warning.style.padding = '10px 12px';
  warning.style.borderRadius = '12px';
  warning.style.background = 'rgba(200, 106, 64, 0.12)';
  warning.style.color = '#7b3d20';
  warning.style.font = '600 0.8rem/1.45 ui-monospace, SFMono-Regular, monospace';
  provider.insertAdjacentElement('afterend', warning);
  return warning;
}

function leaseWarning(snapshot) {
  const run = Array.isArray(snapshot?.runs) ? snapshot.runs[0] : null;
  const lease = Array.isArray(snapshot?.leases) ? snapshot.leases[0] : null;
  const status = String(run?.status || '').toUpperCase();
  if (status !== 'RUNNING' && status !== 'LEASED' && status) return null;
  const now = Date.now();
  const startedAt = snapshot?.startedAt || run?.startedAt || run?.createdAt || snapshot?.events?.[0]?.occurredAt || null;
  const startedMs = startedAt ? Date.parse(startedAt) : NaN;
  const ageMs = Number.isFinite(startedMs) ? now - startedMs : NaN;
  const expiresMs = lease?.expiresAt ? Date.parse(lease.expiresAt) : NaN;
  const staleByAge = Number.isFinite(ageMs) && ageMs >= 15 * 60 * 1000;
  const staleByExpiry = Number.isFinite(expiresMs) && now >= expiresMs;
  if (!staleByAge && !staleByExpiry) return null;
  return staleByExpiry
    ? 'Warning: this run has exceeded its signed lease window. It should stop automatically; if it is still running, the worker is stuck.'
    : 'Warning: this run has been active for more than 15 minutes. It should be stopping soon; if it does not, the worker may be stuck.';
}

function renderRunWarning(snapshot) {
  const warning = ensureRunWarningNode();
  if (!warning) return;
  const text = leaseWarning(snapshot);
  if (!text) {
    warning.hidden = true;
    warning.textContent = '';
    return;
  }
  warning.hidden = false;
  warning.textContent = text;
}

function renderLivePhase(snapshot) {
  setLivePhaseLabel(describeLivePhase(snapshot));
}

function renderRunSteps(snapshot) {
  const verificationStep = document.querySelectorAll('.run-steps li')[3];
  if (!verificationStep) return;
  const title = verificationStep.querySelector('strong');
  const detail = verificationStep.querySelector('small');
  const status = String(snapshot?.runs?.[0]?.status || '').toUpperCase();
  if (status === 'COMPLETED') {
    if (title) title.textContent = 'Independent verification ready';
    if (detail) detail.textContent = 'The validated candidate is available. Open Gate D to review and verify it.';
    return;
  }
  if (status === 'FAILED' || status === 'CANCELLED') {
    if (title) title.textContent = 'Independent verification blocked';
    if (detail) detail.textContent = 'This attempt produced no validated candidate. Review the failure details, then run bounded implementation again.';
    return;
  }
  if (title) title.textContent = 'Independent verification pending';
  if (detail) detail.textContent = 'The candidate will be exposed only after validation.';
}

function renderRunStepState(snapshot) {
  const latest = currentRunEvents(snapshot).at(-1) || null;
  if (!latest?.eventType && !latest?.kind) return;
  const eventName = normalizeEventName(latest.eventType || latest.kind);
  const entry = eventLabels[eventName] || { stage: phaseStages[String(latest.phase || '').toUpperCase()] || 'started', failed: false };
  const active = stageOrder.indexOf(entry.stage);
  document.querySelectorAll('.run-steps li').forEach((item, index) => {
    item.classList.toggle('done', !entry.failed && index < active);
    item.classList.toggle('active', !entry.failed && index === active);
    item.classList.toggle('failed', Boolean(entry.failed) && index === active);
  });
}

function scrollToLiveConsole() {
  const target = byId('run-summary') || byId('progress-console');
  if (!target || typeof target.scrollIntoView !== 'function') return;
  if (location.hash && location.hash !== '#run-summary' && location.hash !== '#progress-console') return;
  target.scrollIntoView({ block: 'start', behavior: 'smooth' });
}

function resetRunClock() {
  if (clockTimer) clearInterval(clockTimer);
  clockTimer = null;
  runStartedAt = null;
  runClockKey = null;
  const clock = byId('run-clock');
  if (clock) clock.textContent = 'Elapsed 00:00';
}

function resetLiveConsoleToIdle() {
  resetRunClock();
  currentRunId = null;
  const consoleEl = byId('progress-console');
  const form = byId('dispatch-form');
  const button = byId('submit');
  const runSummary = byId('run-summary');
  const headline = byId('run-headline');
  const phase = byId('run-phase');
  const commentary = byId('run-commentary');
  const provider = byId('run-provider');
  const warning = byId('run-warning');
  const runDetails = byId('run-details');
  const candidateLink = byId('generated-candidate-link');
  const verificationLink = byId('verification-link');
  const events = byId('progress-events');

  if (consoleEl) {
    consoleEl.hidden = true;
    consoleEl.dataset.phase = 'idle';
    consoleEl.querySelectorAll('.run-steps, .event-card, .failure-card').forEach((section) => {
      section.hidden = false;
    });
  }
  if (form && button) {
    form.dataset.running = 'false';
    form.dataset.executionComplete = 'false';
    button.dataset.running = 'false';
    button.setAttribute('aria-busy', 'false');
    button.disabled = false;
  }
  if (runSummary) runSummary.hidden = true;
  if (headline) headline.textContent = 'Recording your request...';
  if (phase) phase.textContent = 'Phase: coding agent is working';
  if (commentary) commentary.textContent = 'Live commentary: waiting for the coding agent to return a snapshot.';
  if (provider) provider.textContent = 'Run identity: waiting for the coding agent snapshot.';
  if (warning) {
    warning.hidden = true;
    warning.textContent = '';
  }
  if (runDetails) runDetails.innerHTML = '';
  if (candidateLink) {
    candidateLink.hidden = true;
    candidateLink.textContent = 'View candidate';
  }
  if (verificationLink) {
    verificationLink.hidden = true;
    verificationLink.textContent = 'Open verification';
  }
  if (events) {
    events.innerHTML = '<li><time>--:--:--</time><strong>Waiting for the lease</strong><p>The coding agent has not produced a snapshot yet.</p></li>';
  }
}

function primeAcceptedRun(runId = null) {
  const consoleEl = byId('progress-console');
  const runSummary = byId('run-summary');
  const headline = byId('run-headline');
  const phase = byId('run-phase');
  const provider = byId('run-provider');
  const commentary = byId('run-commentary');
  const events = byId('progress-events');
  collapseRunHistory();
  if (consoleEl) {
    consoleEl.hidden = false;
    consoleEl.dataset.phase = 'running';
  }
  if (runSummary) runSummary.hidden = false;
  if (headline) headline.textContent = 'Coding agent accepted the run and is preparing the workspace.';
  if (phase) phase.textContent = 'Phase: workspace preparing';
  if (provider) provider.textContent = runId
    ? 'Run identity: lease accepted · waiting for the coding agent snapshot.'
    : 'Run identity: lease accepted · waiting for the coding agent snapshot.';
  if (commentary) commentary.textContent = 'Live commentary: waiting for the coding agent to return a snapshot.';
  if (events) {
    events.innerHTML = '<li><time>--:--:--</time><strong>Lease accepted</strong><p>The coding agent is preparing the disposable workspace.</p></li>';
  }
}

function renderRunClock(startedAt, endedAt = Date.now()) {
  const clock = byId('run-clock');
  if (!clock || !startedAt) return;
  const seconds = Math.max(0, Math.floor((endedAt - startedAt) / 1000));
  clock.textContent = 'Elapsed ' + String(Math.floor(seconds / 60)).padStart(2, '0') + ':' + String(seconds % 60).padStart(2, '0');
}

function ensureRunClock(startedAt, runId = null) {
  if (!Number.isFinite(startedAt)) return;
  const clockKey = [runId || '', startedAt].join('::');
  if (runClockKey === clockKey) return;
  if (clockTimer) clearInterval(clockTimer);
  runStartedAt = startedAt;
  runClockKey = clockKey;
  renderRunClock(runStartedAt);
  clockTimer = setInterval(() => {
    renderRunClock(runStartedAt);
  }, 1000);
}

function settleRunClock(startedAt, endedAt, runId = null) {
  if (clockTimer) clearInterval(clockTimer);
  clockTimer = null;
  runStartedAt = Number.isFinite(startedAt) ? startedAt : null;
  runClockKey = [runId || '', startedAt || 'unknown', 'settled'].join('::');
  if (runStartedAt) renderRunClock(runStartedAt, Number.isFinite(endedAt) ? endedAt : Date.now());
}

function latestFailureEvent(snapshot) {
  const events = currentRunEvents(snapshot);
  return [...events].reverse().find((event) => {
    const kind = String(event?.kind || event?.eventType || '').toLowerCase();
    return Boolean(event?.errorCode) || kind.includes('failed') || kind.includes('quotaexceeded') || kind.includes('cancellationobserved') || kind.includes('leaserevoked');
  }) || null;
}

function summarizeFailure(snapshot) {
  const event = latestFailureEvent(snapshot);
  if (!event) return null;
  const errorCode = String(event.errorCode || event.kind || event.eventType || '').trim();
  const details = event.errorDetails || {};
  const providerStatus = Number(details.providerStatus ?? event.providerStatus ?? 0) || 0;
  const providerRequestId = String(details.providerRequestId ?? event.providerRequestId ?? '').trim();
  const gatewayCode = String(details.gatewayCode ?? event.gatewayCode ?? '').trim();
  const gatewayParam = String(details.gatewayParam ?? event.gatewayParam ?? '').trim();
  const validationCommand = String(details.validationCommand ?? event.validationCommand ?? '').trim();
  const validationCategory = String(details.validationCategory ?? event.validationCategory ?? '').trim();
  const validationFailureReason = String(details.validationFailureReason ?? details.validationOutputExcerpt ?? event.validationFailureReason ?? event.validationOutputExcerpt ?? '').trim();
  const validationOutputExcerpt = String(details.validationOutputExcerpt ?? event.validationOutputExcerpt ?? '').trim();
  const responseIssue = String(details.responseIssue ?? event.responseIssue ?? '').trim();
  const responseCorrection = String(details.responseCorrection ?? event.responseCorrection ?? '').trim();
  const failureReason = String(details.failureReason ?? event.failureReason ?? '').trim();
  const modelAttempts = Number(details.modelAttempts ?? event.modelAttempts ?? 0) || 0;
  const modelFinishReason = String(details.modelFinishReason ?? event.modelFinishReason ?? '').trim();
  const outputDigest = String(event.outputDigest ?? snapshot.outputDigest ?? '').trim();
  const outputBytes = Number(event.outputBytes ?? snapshot.outputBytes ?? 0) || 0;
  const kind = String(event.kind || event.eventType || '').toLowerCase();
  if (errorCode === 'EXECUTION_RUNNER_HEARTBEAT_LOST') {
    return {
      title: 'Execution worker interrupted',
      summary: 'The API worker stopped before the bounded implementation completed. No candidate was promoted.',
      nextAction: 'Start the API, then run bounded implementation again. ADX has released the abandoned lease.',
      hint: 'The prior run cannot resume because execution was in process memory.',
      trace: [
        ['Diagnostic code', errorCode],
        ['Failure reason', String(details.reason || 'Worker heartbeat stopped.')],
      ],
    };
  }
  if (errorCode === 'EXECUTION_LEASE_EXPIRED') {
    return {
      title: 'Execution lease expired',
      summary: 'The bounded implementation did not finish before its signed execution window closed. No candidate was promoted.',
      nextAction: 'Review the last recorded phase, then start a new bounded implementation attempt.',
      hint: 'Expired runs cannot resume because their signed lease is no longer valid.',
      trace: [
        ['Diagnostic code', errorCode],
        ['Failure reason', String(details.reason || 'The signed execution lease expired.')],
        ['Lease expired', String(details.leaseExpiredAt || 'Unavailable')],
      ],
    };
  }
  if (errorCode === 'MODEL_PATCH_RESPONSE_INVALID') {
    const storyCoverageIssue = responseIssue.startsWith('STORY_COVERAGE_');
    return {
      title: storyCoverageIssue ? 'Story evidence rejected' : 'Model response rejected',
      summary: storyCoverageIssue
        ? 'The model response did not provide valid implementation evidence for every approved story.'
        : 'The model response did not satisfy the bounded patch contract.',
      nextAction: responseCorrection || 'Retry once to capture a precise response correction.',
      hint: responseIssue || 'Detailed response issue unavailable',
      trace: [
        ['Diagnostic code', errorCode],
        ['Response issue', responseIssue || 'Unavailable'],
        ['Required correction', responseCorrection || 'Unavailable'],
        ['Model attempts', modelAttempts ? String(modelAttempts) : 'Unavailable'],
        ['Finish reason', modelFinishReason || 'Unavailable'],
        ['Provider request ID', providerRequestId || 'Unavailable'],
      ],
    };
  }
  if (errorCode === 'MODEL_PATCH_GATEWAY_TIMEOUT') {
    return {
      title: 'Coding-model request timed out',
      summary: 'One bounded model request did not settle before ADX stopped it. No candidate was promoted.',
      nextAction: 'Retry once. ADX will use a fresh request and preserves the precise timeout diagnostic if it repeats.',
      hint: 'Gateway request deadline reached',
      trace: [
        ['Diagnostic code', errorCode],
        ['Failure reason', failureReason || 'The coding-model request exceeded its bounded deadline.'],
        ['Provider request ID', providerRequestId || 'Unavailable'],
      ],
    };
  }
  const isGateway = errorCode.includes('GATEWAY') || providerStatus > 0 || gatewayCode || gatewayParam;
  const isValidation = errorCode.includes('VALIDATION') || validationCommand || validationCategory || validationFailureReason;
  if (isGateway) {
    const summary = providerStatus === 403 || providerStatus === 401
      ? 'The gateway rejected the run before returning model output.'
      : providerStatus === 404
        ? 'The gateway route or deployment was not found.'
        : providerStatus === 429
          ? 'The gateway rate limit or quota was exhausted.'
          : providerStatus >= 500
            ? 'The Azure OpenAI gateway returned a transient server error.'
            : 'The gateway request failed before the candidate could be built.';
    const nextAction = providerStatus === 403 || providerStatus === 401
      ? 'Verify the approved gateway credentials, project access, and deployment identity.'
      : providerStatus === 404
        ? 'Verify the endpoint, deployment name, and API version, then retry once.'
        : providerStatus === 429
          ? 'Wait for the gateway limit to reset, then retry with the same lease.'
          : providerStatus >= 500
            ? 'Retry once. If the same status repeats, inspect the gateway deployment health.'
            : 'Inspect the gateway rejection details and retry once after correcting the request shape.';
    const trace = [
      ['Diagnostic code', errorCode || 'Unknown'],
      ['Provider status', providerStatus ? String(providerStatus) : 'Unavailable'],
      ['Provider request ID', providerRequestId || 'Unavailable'],
      ['Gateway code', gatewayCode || 'Unavailable'],
      ['Gateway parameter', gatewayParam || 'Unavailable'],
      ['Model output bytes', String(outputBytes)],
      ['Model output digest', outputDigest || 'Unavailable'],
    ];
    return { title: 'Gateway request failed', summary, nextAction, hint: providerStatus ? 'Status ' + providerStatus : 'Gateway failure', trace };
  }
  if (isValidation) {
    const semanticFailure = validationCategory === 'SEMANTIC_VERIFICATION_FAILED';
    const trace = [
      ['Diagnostic code', errorCode || 'Unknown'],
      ['Validation command', validationCommand || 'Unavailable'],
      ['Validation category', validationCategory || 'Unavailable'],
      ['Failure reason', validationFailureReason || 'Unavailable'],
      ['Output excerpt', validationOutputExcerpt || 'Unavailable'],
      ['Model output bytes', String(outputBytes)],
      ['Model output digest', outputDigest || 'Unavailable'],
    ];
    return {
      title: semanticFailure ? 'Story acceptance failed' : 'Validation failed',
      summary: semanticFailure
        ? 'The candidate files were created, but they did not implement the approved stories through reachable application workflows.'
        : 'The candidate was built, but the fixed validation command did not pass.',
      nextAction: semanticFailure
        ? 'Review the semantic findings below. The next implementation must change and test the named routed owners, handlers, and workflows rather than isolated helpers.'
        : validationCommand
        ? 'Inspect the output from ' + validationCommand + ' and update the candidate accordingly.'
        : 'Inspect the validation output and repair the candidate before retrying.',
      hint: semanticFailure ? 'No candidate was promoted' : validationCategory || 'Validation failure',
      trace,
    };
  }
  return {
    title: 'Runner stopped',
    summary: 'The bounded runner stopped before producing a usable candidate.',
    nextAction: 'Inspect the recorded diagnostic code and retry once after fixing the request.',
    hint: failureReason || 'No structured failure details were recorded',
    trace: [
      ['Diagnostic code', errorCode || 'Unavailable'],
      ['Failure reason', failureReason || 'Unavailable'],
    ],
  };
}

function renderFailurePanel(snapshot) {
  const panel = byId('failure-details');
  if (!panel) return;
  const failure = summarizeFailure(snapshot);
  if (!failure) {
    panel.hidden = true;
    return;
  }
  panel.hidden = false;
  const title = byId('failure-title');
  const message = byId('failure-message');
  const action = byId('failure-action');
  if (title) title.textContent = failure.title;
  if (message) message.textContent = failure.summary;
  if (action) {
    action.innerHTML = '<details open class="failure-trace"><summary>Trace</summary><dl>' + failure.trace.map(([label, value]) => '<div><dt>' + escapeMarkup(label) + '</dt><dd>' + escapeMarkup(value) + '</dd></div>').join('') + '</dl></details><details open class="failure-next-step"><summary>Quick fix</summary><p>' + escapeMarkup(failure.nextAction) + '</p><p class="field-help">' + escapeMarkup(failure.hint) + '</p></details>';
  }
}

function renderCompletionActions(snapshot) {
  const run = Array.isArray(snapshot?.runs) ? snapshot.runs[0] : null;
  const candidateLink = byId('generated-candidate-link');
  const verificationLink = byId('verification-link');
  const consoleEl = byId('progress-console');
  const runSummary = byId('run-summary');
  const runDetails = byId('run-details');
  const headline = byId('run-headline');
  if (!candidateLink || !verificationLink || !consoleEl) return;

  const latestEvent = currentRunEvents(snapshot).at(-1) || null;
  const latestKind = String(latestEvent?.eventType || latestEvent?.kind || '').trim() || 'Unavailable';
  const status = String(run?.status || 'UNKNOWN').trim();
  const runId = String(run?.id || '').trim();
  const errorCode = String(latestEvent?.errorCode || latestEvent?.eventType || '').trim();
  const validationCommand = String(latestEvent?.errorDetails?.validationCommand || '').trim();
  const validationReason = String(latestEvent?.errorDetails?.validationFailureReason || '').trim();
  const responseIssue = String(latestEvent?.errorDetails?.responseIssue || '').trim();

  const running = run?.status === 'RUNNING' || run?.status === 'LEASED';
  const completed = run?.status === 'COMPLETED';
  const failed = run?.status === 'FAILED' || run?.status === 'CANCELLED';

  if (running) {
    consoleEl.hidden = false;
    if (runSummary) runSummary.hidden = false;
    const form = byId('dispatch-form');
    const button = byId('submit');
    if (form && button) {
      form.dataset.running = 'true';
      form.dataset.executionComplete = 'false';
      button.dataset.running = 'true';
      button.setAttribute('aria-busy', 'true');
      button.disabled = true;
    }
    consoleEl.querySelectorAll('.run-steps, .event-card').forEach((section) => {
      section.hidden = false;
    });
    consoleEl.querySelectorAll('.failure-card').forEach((section) => {
      section.hidden = true;
    });
    candidateLink.hidden = true;
    verificationLink.hidden = true;
    candidateLink.textContent = 'View candidate';
    verificationLink.textContent = 'Open verification';
    if (headline) {
      headline.textContent = 'Coding agent is still running. Waiting for the workspace to finish.';
    }
    renderLivePhase(snapshot);
    renderRunIdentity(snapshot);
    renderRunWarning(snapshot);
    renderRunCommentary(snapshot);
    renderRunSteps(snapshot);
    renderRunHistory(snapshot);
    return;
  }

  consoleEl.querySelectorAll('.run-steps, .event-card, .failure-card').forEach((section) => {
    section.hidden = false;
  });
  const form = byId('dispatch-form');
  const button = byId('submit');
  if (form && button) {
    form.dataset.running = 'false';
    form.dataset.executionComplete = completed ? 'true' : 'false';
    button.dataset.running = 'false';
    button.setAttribute('aria-busy', 'false');
  }

  if (!runSummary) {
    const summary = document.createElement('section');
    summary.id = 'run-summary';
    summary.className = 'run-summary';
    summary.innerHTML = '<header><p class="eyebrow">RUN STATUS</p><h3>Current coding-agent status</h3></header><dl id="run-details"></dl>';
    summary.style.marginTop = '16px';
    summary.style.padding = '16px';
    summary.style.border = '1px solid var(--line)';
    summary.style.borderRadius = '16px';
    summary.style.background = 'rgba(255,255,255,.92)';
    const progressConsole = consoleEl.querySelector('.console-header');
    if (progressConsole?.parentNode) progressConsole.parentNode.insertBefore(summary, progressConsole.nextSibling);
  }

  if (runDetails) {
    runDetails.innerHTML = [
      ['Run ID', runId || 'Unavailable'],
      ['Status', status],
      ['Latest event', latestKind],
      ['Validation command', validationCommand || 'Unavailable'],
      ['Failure reason', validationReason || responseIssue || 'Unavailable'],
      ['Diagnostic code', errorCode || 'Unavailable'],
    ].map(([label, value]) => '<div><dt>' + escapeMarkup(label) + '</dt><dd>' + escapeMarkup(value) + '</dd></div>').join('');
    runDetails.setAttribute('data-status', status);
  }

  renderRunTimings(snapshot);

  candidateLink.hidden = !completed;
  verificationLink.hidden = !completed;
  candidateLink.textContent = 'View candidate';
  verificationLink.textContent = 'Open verification';

  if (headline) {
    headline.textContent = completed
      ? 'Coding agent completed. Review the candidate, then verify it here.'
      : running
        ? 'Coding agent is still running. Waiting for the workspace to finish.'
        : failed
          ? 'Coding agent stopped before producing a candidate.'
          : 'Recording your request...';
  }

  renderLivePhase(snapshot);
  renderRunIdentity(snapshot);
  renderRunWarning(snapshot);
  renderRunCommentary(snapshot);
  renderRunSteps(snapshot);
  renderRunHistory(snapshot);
  if (failed && typeof window.syncDispatchControls === 'function') {
    window.syncDispatchControls();
  }
}

function applySnapshot(snapshot) {
  if (!snapshot) return;
  const status = String(snapshot?.runs?.[0]?.status || '').toUpperCase();
  const running = status === 'RUNNING' || status === 'LEASED' || !status;
  const hasRuns = Array.isArray(snapshot?.runs) && snapshot.runs.length > 0;
  const hasEvents = Array.isArray(snapshot?.events) && snapshot.events.length > 0;
  if (!hasRuns && !hasEvents) {
    resetLiveConsoleToIdle();
    return;
  }
  const consoleEl = byId('progress-console');
  if (consoleEl) consoleEl.dataset.phase = running ? 'running' : 'settled';
  const run = Array.isArray(snapshot?.runs) ? snapshot.runs[0] : null;
  const runId = run?.id || null;
  const startedAt = snapshot.startedAt || run?.startedAt || run?.createdAt || snapshot.events?.[0]?.occurredAt;
  const latest = currentRunEvents(snapshot).at(-1) || null;
  if (running) {
    ensureRunClock(startedAt ? new Date(startedAt).getTime() : Date.now(), runId);
    if (consoleEl) consoleEl.hidden = false;
    renderLivePhase(snapshot);
    renderRunCommentary(snapshot);
    renderRunStepState(snapshot);
    renderEvents(currentRunEvents(snapshot));
    renderRunHistory(snapshot);
    renderCompletionActions(snapshot);
    return;
  }
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
  const endedAt = run?.updatedAt || latest?.occurredAt || null;
  settleRunClock(
    startedAt ? new Date(startedAt).getTime() : NaN,
    endedAt ? new Date(endedAt).getTime() : Date.now(),
    runId,
  );
  const form = byId('dispatch-form');
  const button = byId('submit');
  if (form && button) {
    form.dataset.running = 'false';
    button.dataset.running = 'false';
    button.setAttribute('aria-busy', 'false');
  }
  renderLivePhase(snapshot);
  renderRunStepState(snapshot);
  renderCompletionActions(snapshot);
  renderRunCommentary(snapshot);
  renderEvents(currentRunEvents(snapshot));
  renderRunHistory(snapshot);
  renderFailurePanel(snapshot);
}

async function bootstrapCurrentRun() {
  try {
    const snapshot = initialSnapshot;
    initialSnapshot = null;
    const run = Array.isArray(snapshot?.runs) ? snapshot.runs[0] : null;
    const status = String(run?.status || '').toUpperCase();
    if (snapshot && run?.id && status) {
      const runId = String(run?.id || '').trim();
      if (runId) currentRunId = runId;
      applySnapshot(snapshot);
      if (status === 'RUNNING' || status === 'LEASED') {
        if (currentRunId && !pollTimer) pollTimer = setInterval(poll, 2000);
        void poll();
      }
      return;
    }
    resetLiveConsoleToIdle();
  } finally {
    if (typeof window.syncDispatchControls === 'function') {
      window.syncDispatchControls();
    }
  }
}

async function poll() {
  if (!currentRunId) return;
  try {
    const response = await fetch(config.statusEndpoint);
    if (!response.ok) throw new Error('Execution status request failed with HTTP ' + response.status + '.');
    const snapshot = await response.json();
    if (snapshot?.uiRevision && snapshot.uiRevision !== config.uiRevision) {
      const reloadKey = 'adx:execution-ui-reload:' + snapshot.uiRevision;
      if (sessionStorage.getItem(reloadKey) !== 'true') {
        sessionStorage.setItem(reloadKey, 'true');
        location.reload();
        return;
      }
    }
    applySnapshot(snapshot);
  } catch {
    const warning = ensureRunWarningNode();
    if (warning) {
      warning.hidden = false;
      warning.textContent = 'Live status is temporarily unavailable. ADX will keep retrying without starting another run.';
    }
  }
}

async function beginRun(runId) {
  currentRunId = runId;
  resetRunClock();
  collapseRunHistory();
  const consoleEl = byId('progress-console');
  const form = byId('dispatch-form');
  const button = byId('submit');
  const candidateLink = byId('generated-candidate-link');
  const verificationLink = byId('verification-link');
  const runSummary = byId('run-summary');
  const headline = byId('run-headline');
  if (consoleEl) consoleEl.hidden = false;
  if (consoleEl) consoleEl.dataset.phase = 'running';
  if (form && button) {
    form.dataset.running = 'true';
    form.dataset.executionComplete = 'false';
    button.dataset.running = 'true';
    button.setAttribute('aria-busy', 'true');
    button.disabled = true;
  }
  if (runSummary) runSummary.hidden = true;
  if (consoleEl) {
    consoleEl.querySelectorAll('.run-steps, .event-card').forEach((section) => {
      section.hidden = false;
    });
    consoleEl.querySelectorAll('.failure-card').forEach((section) => {
      section.hidden = true;
    });
  }
  if (candidateLink) candidateLink.hidden = true;
  if (verificationLink) verificationLink.hidden = true;
  if (headline) headline.textContent = 'Coding agent is still running. Waiting for the workspace to finish.';
  ensureRunClock(Date.now(), runId);
  renderLivePhase({ runs: [{ status: 'RUNNING' }], events: [{ eventType: 'AgentRunLeased', phase: 'CONTEXT_COLLECTION' }] });
  renderRunIdentity({ runs: [{ status: 'RUNNING', adapterId: 'uhg-azure-openai-patch', updatedAt: new Date().toISOString() }] });
  renderRunWarning({ runs: [{ status: 'RUNNING' }], leases: [] });
  renderRunCommentary({ runs: [{ status: 'RUNNING' }], events: [] });
  if (runSummary) runSummary.hidden = false;
  if (!pollTimer) pollTimer = setInterval(poll, 2000);
  void poll();
  scrollToLiveConsole();
}

window.beginRun = beginRun;
window.primeAcceptedRun = primeAcceptedRun;

ensureEventConsoleControls();
bootstrapCurrentRun();

window.addEventListener('beforeunload', stopTimers);
</script>`;
}

export function describeExecutionFailure(snapshot = {}, diagnosticCode = '') {
  const code = String(diagnosticCode || snapshot.code || '').toUpperCase();
  const providerStatus = Number(snapshot.providerStatus || 0);
  const validationCommand = snapshot.validationCommand || '';
  const validationCategory = snapshot.validationCategory || '';
  const validationFailureReason = snapshot.validationFailureReason || snapshot.validationOutputExcerpt || '';
  const gatewayCode = snapshot.gatewayCode || '';
  const gatewayParam = snapshot.gatewayParam || '';
  const responseIssue = snapshot.responseIssue || '';
  const responseCorrection = snapshot.responseCorrection || '';
  const modelAttempts = Number(snapshot.modelAttempts || 0);

  if (code === 'EXECUTION_LEASE_EXPIRED') {
    return Object.freeze({
      summary: 'The bounded implementation exceeded its signed execution window.',
      reason: snapshot.reason || 'The execution lease expired before the run produced a terminal result.',
      nextAction: 'Review the last recorded phase, then start a new bounded implementation attempt.',
      hint: snapshot.leaseExpiredAt ? `Lease expired ${snapshot.leaseExpiredAt}` : 'Execution lease expired',
    });
  }

  if (code === 'MODEL_PATCH_RESPONSE_INVALID') {
    const storyCoverageIssue = responseIssue.startsWith('STORY_COVERAGE_');
    return Object.freeze({
      summary: storyCoverageIssue
        ? 'The model response did not prove every approved story was implemented and tested.'
        : 'The model response did not satisfy the bounded patch contract.',
      reason: responseIssue
        ? `The response was rejected with ${responseIssue}.`
        : 'The failed run was recorded before detailed model-response diagnostics were retained.',
      nextAction: responseCorrection || (storyCoverageIssue
        ? 'Retry once. The coding agent must patch genuine implementation and test files and map every approved story to both.'
        : 'Retry once to capture the detailed response issue, then correct the rejected schema or patch paths.'),
      hint: responseIssue
        ? `${responseIssue}${modelAttempts ? ` · ${modelAttempts} attempts` : ''}`
        : 'Detailed response issue unavailable',
    });
  }

  if (code.includes('GATEWAY') || providerStatus >= 500) {
    const summary = providerStatus === 403 || providerStatus === 401
      ? 'The gateway rejected the run before returning model output.'
      : providerStatus === 404
        ? 'The gateway route or deployment was not found.'
        : providerStatus === 429
          ? 'The gateway rate limit or quota was exhausted.'
          : 'The Azure OpenAI gateway returned a transient server error.';
    const nextAction = providerStatus === 403 || providerStatus === 401
      ? 'Verify the approved gateway credentials, project access, and deployment identity.'
      : providerStatus === 404
        ? 'Verify the endpoint, deployment name, and API version, then retry once.'
        : providerStatus === 429
          ? 'Wait for the gateway limit to reset, then retry with the same lease.'
          : 'Retry once. If the same status repeats, inspect the gateway deployment health.';
    return Object.freeze({
      summary,
      reason: gatewayCode || gatewayParam
        ? `The gateway rejected the request with ${[gatewayCode, gatewayParam].filter(Boolean).join(':')}.`
        : 'The run stopped because a gateway outage or request rejection interrupted model execution.',
      nextAction,
      hint: providerStatus ? `HTTP ${providerStatus}` : 'Gateway execution failure',
    });
  }

  if (code.includes('VALIDATION') || validationCommand || validationCategory || validationFailureReason) {
    const semanticFailure = validationCategory === 'SEMANTIC_VERIFICATION_FAILED';
    return Object.freeze({
      summary: semanticFailure
        ? 'Story acceptance failed after the candidate was built.'
        : 'Validation failed after the candidate was built.',
      reason: validationFailureReason || 'The fixed validation command did not pass for the generated candidate.',
      nextAction: semanticFailure
        ? 'Review the semantic findings and update the named routed owners, handlers, and workflows rather than isolated helpers.'
        : validationCommand
        ? `ADX already retried from a clean workspace. Inspect the output from ${validationCommand} and update the candidate to satisfy it.`
        : 'ADX already retried from a clean workspace. Inspect the validation output and update the candidate to satisfy it.',
      hint: semanticFailure
        ? 'No candidate was promoted'
        : validationCommand && validationCategory
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
