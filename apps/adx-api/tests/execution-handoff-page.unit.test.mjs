import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import {
  describeExecutionFailure,
  renderExecutionHandoffPage,
} from "../execution-handoff-page.mjs";
import { buildExecutionLiveScript } from "../execution-run-components.mjs";
import { accessiblePageFoundation } from "../response-utils.mjs";

const changeCase = {
  title: "Referral decision communication",
  state: "READY_FOR_EXECUTION",
  projectionVersion: 12,
};
const options = {
  canSubmit: true,
  signedInRoles: ["workspace_admin"],
  dispatchEndpoint: "/execution/dispatch",
  statusEndpoint: "/execution",
  evidenceReviewUrl: "/evidence-review",
  candidateUrl: "/generated-candidate",
  handoffUrl: "/v1/workspaces/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/change-cases/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb/execution-handoff",
  projectRepository: "cloud-asset-inventory",
  providers: [
    {
      id: "LOCAL_TEST",
      label: "Local test provider",
      description: "A registered provider.",
      enabled: true,
    },
  ],
};

test("execution handoff requests a bounded implementation run instead of attesting to an external candidate", () => {
  const page = renderExecutionHandoffPage(changeCase, options);
  assert.match(page, /Start a controlled implementation run/);
  assert.match(page, /for cloud-asset-inventory/);
  assert.match(page, /Implementation runner/);
  assert.match(page, /Story decomposition models are configured separately/);
  assert.match(page, /Implementation activity/);
  assert.match(page, /View generated candidate/);
  assert.match(page, /Open independent verification/);
  assert.match(page, /run-commentary/);
  assert.match(page, /Live commentary: waiting for the coding agent to return a snapshot\./);
  assert.match(page, /run-provider/);
  assert.match(page, /Run identity: waiting for the coding agent snapshot\./);
  assert.match(page, /Execution-handoff URL:/);
  assert.match(page, /\/v1\/workspaces\/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa\/change-cases\/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb\/execution-handoff/);
  assert.match(page, /Workspace preparing/);
  assert.match(page, /Validation in progress/);
  assert.match(page, /Independent verification pending/);
  assert.doesNotMatch(page, /Candidate validated/);
  assert.doesNotMatch(page, /Candidate verified/);
  assert.match(page, /LOCAL_TEST/);
  assert.match(page, /candidateUrl/);
  assert.match(page, /id="run-phase"/);
  assert.match(page, /Phase: waiting for the lease\./);
  assert.match(
    page,
    /id="submit" class="button primary" type="submit" disabled><span class="busy-indicator" aria-hidden="true"><\/span>/,
  );
  assert.match(page, /aria-busy="false"/);
  assert.match(page, /status\.className = 'status loading'/);
  assert.match(page, /progress-console/);
  assert.match(page, /Requesting the signed lease and preparing the disposable workspace/);
  assert.match(accessiblePageFoundation, /input\[type="checkbox"\],input\[type="radio"\]\{width:auto!important/);
});

test("execution handoff does not expose submission controls outside execution readiness", () => {
  const page = renderExecutionHandoffPage(
    { ...changeCase, state: "AWAITING_VERIFICATION" },
    options,
  );
  assert.match(page, /Implementation is not available/);
  assert.match(page, /already left execution and is waiting for Gate D verification/);
  assert.match(page, /Current state: <strong>AWAITING_VERIFICATION<\/strong>/);
  assert.doesNotMatch(page, /id="dispatch-form"/);
});

test("execution handoff keeps submission disabled when no implementation providers are available", () => {
  const page = renderExecutionHandoffPage(changeCase, {
    ...options,
    providers: [],
  });

  assert.match(page, /Submission disabled: No enabled implementation providers are configured for this server\./);
  assert.match(page, /const submissionAvailable = false;/);
  assert.match(page, /button\.disabled = !submissionAvailable \|\| !providerSelected \|\| !confirmation\?\.checked;/);
  assert.match(page, /window\.syncDispatchControls = syncControls;/);
  assert.match(page, /id="submit" class="button primary" type="submit" disabled/);
});

test("execution handoff keeps submission disabled while a bounded implementation is already active", () => {
  const page = renderExecutionHandoffPage(changeCase, {
    ...options,
    execution: {
      runs: [
        {
          id: "run-1",
          status: "RUNNING",
          adapterId: "adapter-1",
          updatedAt: new Date().toISOString(),
        },
      ],
    },
  });

  assert.match(page, /A bounded implementation is already in progress for this Change Case\./);
  assert.match(page, /const submissionAvailable = false;/);
  assert.match(page, /id="submit" class="button primary" type="submit" disabled/);
});

test("execution handoff rehydrates the live console when an implementation is already running", () => {
  const page = renderExecutionHandoffPage(changeCase, {
    ...options,
    execution: {
      runs: [
        {
          id: "run-1",
          status: "RUNNING",
          adapterId: "adapter-1",
          updatedAt: new Date().toISOString(),
        },
      ],
      events: [
        {
          runId: "run-1",
          eventType: "AgentRunLeased.v1",
          occurredAt: new Date().toISOString(),
        },
      ],
    },
  });

  assert.match(page, /let initialSnapshot = \{/);
  assert.match(page, /initialSnapshot = null;/);
  assert.match(page, /if \(snapshot && run\?\.id && status\)/);
  assert.match(page, /if \(status === 'RUNNING' \|\| status === 'LEASED'\)/);
  assert.match(page, /currentRunId = runId;/);
  assert.match(page, /applySnapshot\(snapshot\);/);
  assert.match(page, /<section id="progress-console" class="run-console" aria-live="polite" data-phase="running">/);
  assert.match(page, /<p id="run-headline">Coding agent is still running\. Waiting for the workspace to finish\.<\/p>/);
  assert.match(page, /<p id="run-provider"[^>]*>Run identity: adapter-1 · Updated /);
  assert.doesNotMatch(page, /\$\{escapeHtml\(live(?:Headline|Phase|Identity|Commentary)\)\}/);
});

test("execution handoff treats a leased implementation as active before dispatch starts", () => {
  const page = renderExecutionHandoffPage(changeCase, {
    ...options,
    execution: {
      runs: [
        {
          id: "run-leased",
          status: "LEASED",
          adapterId: "adapter-1",
          updatedAt: new Date().toISOString(),
        },
      ],
      events: [],
    },
  });

  assert.match(page, /const submissionAvailable = false;/);
  assert.match(page, /<section id="progress-console" class="run-console" aria-live="polite" data-phase="running">/);
  assert.match(page, /"status":"LEASED"/);
});

test("execution handoff rehydrates an interrupted terminal run and leaves retry available", () => {
  const page = renderExecutionHandoffPage(changeCase, {
    ...options,
    execution: {
      runs: [
        {
          id: "run-interrupted",
          status: "FAILED",
          adapterId: "adapter-1",
          updatedAt: new Date().toISOString(),
        },
      ],
      events: [
        {
          runId: "run-interrupted",
          eventType: "AgentRunFailed.v1",
          errorCode: "EXECUTION_RUNNER_HEARTBEAT_LOST",
          errorDetails: { reason: "Worker heartbeat stopped." },
          occurredAt: new Date().toISOString(),
        },
      ],
    },
  });

  assert.match(page, /<section id="progress-console" class="run-console" aria-live="polite">/);
  assert.match(page, /Coding agent stopped before producing a candidate\./);
  assert.match(page, /"status":"FAILED"/);
  assert.match(page, /Execution worker interrupted/);
  assert.match(page, /const submissionAvailable = true;/);
});

test("execution handoff names the current role and the contributor-capable roles when submission is denied", () => {
  const page = renderExecutionHandoffPage(changeCase, {
    ...options,
    canSubmit: false,
    signedInRoles: ["reviewer"],
  });
  assert.match(page, /Your current workspace role: <strong>reviewer<\/strong>/);
  assert.match(page, /contributor<\/strong> or <strong>workspace_admin/);
  assert.match(page, /reviewer<\/strong> role remains read-and-review only/);
});

test("execution handoff sends only a reviewed coding specification ID with dispatch", () => {
  const page = renderExecutionHandoffPage(changeCase, {
    ...options,
    templates: [
      {
        id: "evidence-first-feature",
        label: "Evidence-first feature",
        description: "Bounded feature delivery.",
        guidance: "Implement only approved scope.",
      },
    ],
  });
  assert.match(page, /Implementation specification/);
  assert.match(page, /coding-spec-template/);
  assert.match(page, /evidence-first-feature/);
  assert.match(page, /templateId/);
  assert.match(page, /cannot expand the lease scope/);
  assert.match(page, /title="Implement only approved scope\."/);
  assert.match(page, /Bounded feature delivery\. Implement only approved scope\./);
});

test("execution handoff explains transient gateway failures and validation failures", () => {
  const gatewayFailure = describeExecutionFailure(
    { providerStatus: 502 },
    "AZURE_OPENAI_GATEWAY_REQUEST_FAILED",
  );
  assert.equal(gatewayFailure.summary, "The Azure OpenAI gateway returned a transient server error.");
  assert.match(gatewayFailure.reason, /gateway outage or request rejection/i);
  assert.match(gatewayFailure.nextAction, /Retry once/);

  const authFailure = describeExecutionFailure(
    { providerStatus: 403, gatewayCode: "unsupported_parameter", gatewayParam: "response_format" },
    "AZURE_OPENAI_GATEWAY_REQUEST_FAILED",
  );
  assert.equal(authFailure.summary, "The gateway rejected the run before returning model output.");
  assert.match(authFailure.reason, /unsupported_parameter:response_format/);
  assert.match(authFailure.nextAction, /project access/i);

  const validationFailure = describeExecutionFailure(
    {
      validationCommand: "npm run verify:production",
      validationCategory: "CHECK_FAILED",
      validationFailureReason: "Expected 4 actions, got 7.",
    },
    "MODEL_PATCH_VALIDATION_FAILED",
  );
  assert.equal(
    validationFailure.summary,
    "Validation failed after the candidate was built.",
  );
  assert.match(validationFailure.reason, /Expected 4 actions, got 7\./);
  assert.match(validationFailure.nextAction, /ADX already retried from a clean workspace/);
  assert.match(validationFailure.nextAction, /npm run verify:production/);

  const semanticFailure = describeExecutionFailure(
    {
      validationCommand: "candidate semantic verifier",
      validationCategory: "SEMANTIC_VERIFICATION_FAILED",
      validationFailureReason: "STORY-1 is not wired into the onboarding route.",
    },
    "MODEL_PATCH_VALIDATION_FAILED",
  );
  assert.equal(
    semanticFailure.summary,
    "Story acceptance failed after the candidate was built.",
  );
  assert.match(semanticFailure.reason, /not wired into the onboarding route/);
  assert.match(semanticFailure.nextAction, /routed owners, handlers, and workflows/);
  assert.equal(semanticFailure.hint, "No candidate was promoted");

  const storyCoverageFailure = describeExecutionFailure(
    {
      responseIssue: "STORY_COVERAGE_OWNER_MISSING",
      responseCorrection: "Patch and cite the missing authoritative API owner.",
      modelAttempts: 4,
    },
    "MODEL_PATCH_RESPONSE_INVALID",
  );
  assert.match(storyCoverageFailure.summary, /every approved story/i);
  assert.match(storyCoverageFailure.reason, /STORY_COVERAGE_OWNER_MISSING/);
  assert.equal(storyCoverageFailure.nextAction, "Patch and cite the missing authoritative API owner.");
  assert.match(storyCoverageFailure.hint, /4 attempts/);

  const legacyResponseFailure = describeExecutionFailure(
    {},
    "MODEL_PATCH_RESPONSE_INVALID",
  );
  assert.match(legacyResponseFailure.reason, /before detailed model-response diagnostics/i);
  assert.match(legacyResponseFailure.nextAction, /Retry once/i);

  const leaseExpiration = describeExecutionFailure(
    {
      reason: "The signed lease elapsed during context collection.",
      leaseExpiredAt: "2026-09-10T23:20:38.515Z",
    },
    "EXECUTION_LEASE_EXPIRED",
  );
  assert.match(leaseExpiration.summary, /signed execution window/);
  assert.match(leaseExpiration.reason, /elapsed during context collection/);
  assert.match(leaseExpiration.nextAction, /new bounded implementation attempt/);
  assert.match(leaseExpiration.hint, /2026-09-10T23:20:38.515Z/);
});

test("execution handoff presents durable live run status without exposing unvalidated model output", () => {
  const page = renderExecutionHandoffPage(changeCase, options);
  assert.match(page, /AgentRunLeased/);
  assert.match(page, /AgentRunStarted/);
  assert.match(page, /AgentRunCompleted/);
  assert.match(page, /Feature implementation/);
  assert.match(page, /waiting for the model gateway/);
  assert.match(page, /setInterval\(poll, 2000\)/);
  assert.match(page, /renderFailurePanel\(snapshot\)/);
  assert.match(page, /renderCompletionActions\(snapshot\)/);
  assert.match(page, /renderRunCommentary\(snapshot\)/);
  assert.match(page, /renderRunWarning\(snapshot\)/);
  assert.match(page, /Story evidence rejected/);
  assert.match(page, /Required correction/);
  assert.match(page, /Model attempts/);
  assert.match(page, /details\.responseCorrection/);
  assert.match(page, /uiRevision/);
  assert.match(page, /adx:execution-ui-reload:/);
  assert.match(page, /location\.reload\(\)/);
  assert.match(page, /snapshot\.uiRevision !== config\.uiRevision/);
  assert.match(page, /leaseWarning\(snapshot\)/);
  assert.match(page, /runClockKey/);
  assert.match(page, /resetRunClock\(\)/);
  assert.match(page, /currentRunEvents\(snapshot\)/);
  assert.match(page, /run-summary/);
  assert.match(page, /run-history/);
  assert.match(page, /Current coding-agent status/);
  assert.match(page, /Previous runs/);
  assert.match(page, /MEASURED TIMINGS/);
  assert.match(page, /Where the run spent time/);
  assert.match(page, /Model calls/);
  assert.match(page, /follow-live/);
  assert.match(page, /jump-latest/);
  assert.match(page, /height:360px/);
  assert.match(page, /overflow-y:scroll/);
  assert.match(page, /scrollbar-gutter:stable/);
  assert.match(page, /scrollbar-color:#6b8798 #e5edf0/);
  assert.match(page, /eventFollowStorageKey/);
  assert.match(page, /sessionStorage\.setItem\(eventFollowStorageKey/);
  assert.match(page, /eventSignature === renderedEventSignature/);
  assert.match(page, /if \(eventFollowLive\) scrollEventLogToLatest\(log\)/);
  assert.match(page, /attempt-card/);
  assert.match(page, /const attempts = groupRuns\(snapshot\)\.slice\(1\)/);
  assert.doesNotMatch(page, /section\.open = false/);
  assert.match(page, /collapseRunHistory\(\)/);
  assert.match(page, /#dispatch-form\[data-running="true"\] > :not\(#status\)\{display:none\}/);
  assert.match(page, /.history-toggle:focus-visible/);
  assert.match(page, /Coding agent is still running\. Waiting for the workspace to finish\./);
  assert.match(page, /Coding agent completed\. Review the candidate, then verify it here\./);
  assert.match(page, /failure-trace/);
  assert.match(page, /failure-next-step/);
});

test("execution handoff refreshes the live event log while a run is still active", () => {
  const page = renderExecutionHandoffPage(changeCase, options);
  assert.match(page, /renderEvents\(currentRunEvents\(snapshot\)\);/);
  assert.match(page, /renderRunHistory\(snapshot\);/);
  const applySnapshotSource = page.slice(page.indexOf('function applySnapshot'), page.indexOf('async function bootstrapCurrentRun'));
  assert.doesNotMatch(applySnapshotSource, /scrollToLiveConsole\(\)/);
  const completionSource = page.slice(page.indexOf('function renderCompletionActions'), page.indexOf('function applySnapshot'));
  assert.doesNotMatch(completionSource, /scrollToLiveConsole\(\)/);
});

test("execution handoff stays idle until a fresh bounded implementation is submitted", () => {
  const page = renderExecutionHandoffPage(changeCase, options);
  assert.match(page, /bootstrapCurrentRun\(\);/);
  assert.match(page, /resetLiveConsoleToIdle\(\);/);
  assert.match(page, /fetch\(config\.statusEndpoint\)/);
  assert.doesNotMatch(page, /fetch\(config\.statusEndpoint \+ '\/' \+ currentRunId\)/);
  assert.match(page, /<section id="progress-console" class="run-console" hidden aria-live="polite">/);
  assert.match(page, /<p id="run-headline">Recording your request\.\.\.<\/p>/);
  assert.match(page, /<p id="run-provider"[^>]*>Run identity: waiting for the coding agent snapshot\.<\/p>/);
  assert.match(page, /<p id="run-commentary"[^>]*>Live commentary: waiting for the coding agent to return a snapshot\.<\/p>/);
  assert.doesNotMatch(page, /\$\{escapeHtml\(live(?:Headline|Phase|Identity|Commentary)\)\}/);
});

test("execution live script initializes without a browser runtime exception", () => {
  const script = buildExecutionLiveScript({
    statusEndpoint: "/execution",
    projectRepository: "cloud-asset-inventory",
  }).replace(/^\s*<script>|<\/script>\s*$/g, "");
  const window = { addEventListener() {} };
  const context = {
    clearInterval() {},
    document: {
      getElementById() { return null; },
      querySelectorAll() { return []; },
    },
    fetch: async () => ({ ok: true, json: async () => ({ runs: [], events: [] }) }),
    location: { hash: "" },
    setInterval() { return 1; },
    window,
  };

  assert.doesNotThrow(() => vm.runInNewContext(script, context));
});

test("execution live script excludes previous-attempt events from the current run", () => {
  const script = buildExecutionLiveScript({
    statusEndpoint: "/execution",
    projectRepository: "cloud-asset-inventory",
  }).replace(/^\s*<script>|<\/script>\s*$/g, "");
  const window = { addEventListener() {} };
  const context = {
    clearInterval() {},
    document: {
      getElementById() { return null; },
      querySelectorAll() { return []; },
    },
    fetch: async () => ({ ok: true, json: async () => ({ runs: [], events: [] }) }),
    location: { hash: "" },
    setInterval() { return 1; },
    window,
  };
  const snapshot = {
    runs: [{ id: "current-run", status: "RUNNING" }, { id: "previous-run", status: "FAILED" }],
    events: [
      { runId: "previous-run", eventType: "AgentRunFailed.v1" },
      { runId: "current-run", eventType: "AgentRunLeased.v1" },
    ],
  };

  vm.runInNewContext(
    `${script}\nglobalThis.currentEvents = JSON.stringify(currentRunEvents(${JSON.stringify(snapshot)}));`,
    context,
  );

  assert.equal(context.currentEvents, JSON.stringify([snapshot.events[1]]));
});

test("execution live script marks workspace preparation as the active animated step", () => {
  const script = buildExecutionLiveScript({
    statusEndpoint: "/execution",
    projectRepository: "cloud-asset-inventory",
  }).replace(/^\s*<script>|<\/script>\s*$/g, "");
  const classes = Array.from({ length: 3 }, () => new Map());
  const steps = classes.map((state) => ({
    classList: {
      toggle(name, enabled) { state.set(name, enabled); },
    },
  }));
  const context = {
    clearInterval() {},
    document: {
      getElementById() { return null; },
      querySelectorAll(selector) { return selector === ".run-steps li" ? steps : []; },
    },
    fetch: async () => ({ ok: true, json: async () => ({ runs: [], events: [] }) }),
    location: { hash: "" },
    setInterval() { return 1; },
    window: { addEventListener() {} },
  };
  const snapshot = {
    runs: [{ id: "current-run", status: "RUNNING", createdAt: "2026-09-10T20:00:00.000Z" }],
    events: [{ runId: "current-run", eventType: "AgentRunProgressed.v1", phase: "CONTEXT_COLLECTION" }],
  };

  vm.runInNewContext(`${script}\napplySnapshot(${JSON.stringify(snapshot)});`, context);

  assert.equal(classes[0].get("active"), true);
  assert.equal(classes[1].get("active"), false);
  assert.equal(classes[2].get("active"), false);
});

test("execution live script keeps the current run primary and collapses previous attempts", () => {
  const script = buildExecutionLiveScript({
    statusEndpoint: "/execution",
    projectRepository: "cloud-asset-inventory",
  }).replace(/^\s*<script>|<\/script>\s*$/g, "");
  let historySection = null;
  const runSummary = {
    insertAdjacentElement(_position, section) { historySection = section; },
  };
  const document = {
    createElement() {
      return {
        id: "",
        className: "",
        style: {},
        innerHTML: "",
        remove() { historySection = null; },
      };
    },
    getElementById(id) {
      if (id === "run-summary") return runSummary;
      if (id === "run-history") return historySection;
      return null;
    },
    querySelectorAll() { return []; },
  };
  const context = {
    clearInterval() {},
    document,
    fetch: async () => ({ ok: true, json: async () => ({ runs: [], events: [] }) }),
    location: { hash: "" },
    setInterval() { return 1; },
    window: { addEventListener() {} },
  };
  const snapshot = {
    runs: [
      { id: "run-3", status: "FAILED", adapterId: "adapter-1", createdAt: "2026-09-10T03:00:00.000Z", updatedAt: "2026-09-10T03:15:00.000Z" },
      { id: "run-2", status: "FAILED", adapterId: "adapter-1", createdAt: "2026-09-10T02:00:00.000Z", updatedAt: "2026-09-10T02:15:00.000Z" },
      { id: "run-1", status: "FAILED", adapterId: "adapter-1", createdAt: "2026-09-10T01:00:00.000Z", updatedAt: "2026-09-10T01:15:00.000Z" },
    ],
    events: ["run-1", "run-2", "run-3"].map((runId, index) => ({
      runId,
      sequence: 1,
      eventType: "AgentRunFailed.v1",
      errorCode: "EXECUTION_LEASE_EXPIRED",
      occurredAt: `2026-09-10T0${index + 1}:15:00.000Z`,
    })),
  };

  vm.runInNewContext(
    `${script}\nrenderRunHistory(${JSON.stringify(snapshot)}); document.getElementById('run-history').open = true; renderRunHistory(${JSON.stringify(snapshot)}); globalThis.historyHtml = document.getElementById('run-history').innerHTML; globalThis.historyOpen = document.getElementById('run-history').open;`,
    context,
  );

  assert.match(context.historyHtml, /<strong>Previous runs<\/strong>/);
  assert.match(context.historyHtml, />2 previous runs<\/span>/);
  assert.match(context.historyHtml, /Attempt 2/);
  assert.match(context.historyHtml, /Attempt 1/);
  assert.equal((context.historyHtml.match(/class="attempt-card failure"/g) || []).length, 2);
  assert.equal((context.historyHtml.match(/ open>/g) || []).length, 0);
  assert.doesNotMatch(context.historyHtml, /run-3/);
  assert.match(context.historyHtml, /run-2/);
  assert.match(context.historyHtml, /run-1/);
  assert.equal(context.historyOpen, true);
});
