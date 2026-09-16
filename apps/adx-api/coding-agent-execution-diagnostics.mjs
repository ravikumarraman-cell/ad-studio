import { ChangeCaseError, sha256 } from "./change-case-ledger.mjs";

/**
 * Converts untrusted broker and provider outcomes into the bounded records
 * persisted by execution storage and returned to the UI.
 */
export function failureResult(error) {
  const malformedModelJson = isMalformedModelJsonError(error);
  const code =
    typeof error?.code === "string" && error.code.trim()
      ? error.code.trim()
      : error instanceof ChangeCaseError
        ? error.code
        : malformedModelJson
          ? "MODEL_PATCH_RESPONSE_INVALID"
          : "CODING_AGENT_EXECUTION_FAILED";
  const errorDetails = safeErrorDetails({
    ...error?.details,
    ...(malformedModelJson
      ? {
          responseIssue: "NON_JSON",
          responseCorrection:
            "Return exactly one JSON object matching responseSchema, with a non-empty patches array, featureSpotlight, and storyCoverage. Do not include markdown or explanatory text.",
        }
      : {}),
    failureStage: failureStageFor(code),
    failureReason: failureReasonFor(code) ?? safeUnhandledFailureReason(error),
  });
  return {
    accepted: false,
    promoted: false,
    code: 1,
    signal: null,
    timedOut: false,
    quotaExceeded: false,
    output: "",
    outputBytes: 0,
    outputDigest: sha256(""),
    errorCode: diagnosticCode(code, errorDetails),
    errorDetails,
    timings: safeTimings(error?.executionTimings),
    candidateDigest: null,
  };
}

export function toCompletionResult(result) {
  const artifacts = result.candidateDigest
    ? [{ mediaType: "application/vnd.adx.candidate-digest", digest: result.candidateDigest, bytes: 0 }]
    : [];
  if (result.featureSpotlight)
    artifacts.push({
      mediaType: "application/vnd.adx.feature-spotlight+json",
      digest: sha256(result.featureSpotlight),
      bytes: Buffer.byteLength(JSON.stringify(result.featureSpotlight)),
      metadata: result.featureSpotlight,
    });
  for (const contract of Array.isArray(result.provisionalExternalContracts)
    ? result.provisionalExternalContracts
    : [])
    artifacts.push({
      mediaType: "application/vnd.adx.provisional-external-contract+json",
      digest: sha256(contract),
      bytes: Buffer.byteLength(JSON.stringify(contract)),
      metadata: contract,
    });
  return {
    code: Number(result.code ?? 1),
    signal: result.signal ?? null,
    timedOut: Boolean(result.timedOut),
    quotaExceeded: Boolean(result.quotaExceeded),
    outputDigest:
      typeof result.outputDigest === "string" && result.outputDigest.startsWith("sha256:")
        ? result.outputDigest
        : null,
    outputBytes: Number(result.outputBytes ?? 0),
    errorCode: result.errorCode ?? null,
    errorDetails: result.errorDetails ?? null,
    timings: safeTimings(result.timings),
    artifacts,
  };
}

export function publicResult(result) {
  return Object.freeze({
    provider: result.provider ?? null,
    code: Number(result.code ?? 1),
    signal: result.signal ?? null,
    timedOut: Boolean(result.timedOut),
    quotaExceeded: Boolean(result.quotaExceeded),
    outputDigest: result.outputDigest ?? sha256(""),
    outputBytes: Number(result.outputBytes ?? 0),
    errorCode: result.errorCode ?? null,
    errorDetails: safeErrorDetails(result.errorDetails),
  });
}

function isMalformedModelJsonError(error) {
  return error instanceof SyntaxError && typeof error?.message === "string" && /(?:expected ['\",\]]|unexpected (?:token|end)|json)/i.test(error.message);
}

function safeUnhandledFailureReason(error) {
  if (
    error?.code ||
    error instanceof SyntaxError ||
    typeof error?.message !== "string"
  )
    return null;
  const message = error.message.trim().replace(/\s+/g, " ");
  return message && message.length <= 512 ? message : null;
}

function diagnosticCode(code, details) {
  if (code !== "AZURE_OPENAI_GATEWAY_REQUEST_FAILED") return code;
  const gateway = [details?.gatewayCode, details?.gatewayParam].filter(Boolean).join(":");
  return gateway ? `${code} (${gateway})` : code;
}

export function safeErrorDetails(details) {
  const providerStatus = Number(details?.providerStatus);
  const providerRequestId = boundedString(details?.providerRequestId, 256);
  const gatewayCode = boundedString(details?.gatewayError?.code, 128);
  const gatewayParam = boundedString(details?.gatewayError?.param, 128);
  const responseIssue = [
    "NON_JSON", "SCHEMA_INVALID", "PATCH_INVALID", "STORY_COVERAGE_MISSING",
    "STORY_COVERAGE_INCOMPLETE", "STORY_COVERAGE_KEY_INVALID", "STORY_COVERAGE_KEY_DUPLICATE",
    "STORY_COVERAGE_PATHS_MISSING", "STORY_COVERAGE_PATH_OVERLAP", "STORY_COVERAGE_TEST_PATH_INVALID",
    "STORY_COVERAGE_PATH_NOT_PATCHED", "STORY_COVERAGE_PATCHED_EVIDENCE_MISSING",
    "STORY_COVERAGE_COLLAPSED", "STORY_COVERAGE_OWNER_MISSING", "PATCH_ANCHOR_TARGET_MISSING",
    "PATCH_ANCHOR_NOT_UNIQUE", "PATCH_DESTRUCTIVE_REWRITE", "PATCH_COUNT_EXCEEDED",
    "PATCH_PATH_INVALID", "PATCH_PATH_NOT_WRITABLE", "PATCH_PATH_SENSITIVE", "PATCH_MODE_INVALID",
    "PATCH_CONTENT_INVALID", "PATCH_CONTENT_TOO_LARGE", "PATCH_REPLACEMENT_INVALID",
    "PATCH_REPLACEMENT_TOO_LARGE", "PATCH_PATH_DUPLICATE",
  ].includes(details?.responseIssue) ||
    (typeof details?.responseIssue === "string" && /^[A-Z][A-Z0-9_]{2,127}$/.test(details.responseIssue))
    ? details.responseIssue
    : null;
  const modelFinishReason = ["stop", "length", "content_filter"].includes(details?.modelFinishReason)
    ? details.modelFinishReason
    : null;
  const modelAttempts = Number.isInteger(details?.modelAttempts) && details.modelAttempts >= 1 && details.modelAttempts <= 4
    ? details.modelAttempts
    : null;
  const failureStage = ["SETUP", "MODEL_RESPONSE", "VALIDATION", "EXECUTION"].includes(details?.failureStage)
    ? details.failureStage
    : null;
  const validationCommand = ["node --test", "npm run verify:health-x", "npm run verify:production", "npm --prefix frontend test -- --runInBand", "cloud-asset-inventory verify"].includes(details?.validationCommand)
    ? details.validationCommand
    : null;
  const validationCategory = ["CHECK_FAILED", "TIMED_OUT", "SIGNALED"].includes(details?.validationCategory)
    ? details.validationCategory
    : null;
  const unresolvedCapabilities = Array.isArray(details?.unresolvedCapabilities)
    ? details.unresolvedCapabilities.slice(0, 8).flatMap((entry) => {
        const capability = boundedString(entry?.capability, 128);
        const missingContract = Array.isArray(entry?.missingContract)
          ? entry.missingContract.filter((field) => ["endpoint", "authentication", "responseContract"].includes(field))
          : [];
        return capability ? [{ capability, missingContract }] : [];
      })
    : [];
  const safe = {
    provider: details?.provider === "AZURE_OPENAI_GATEWAY" ? details.provider : null,
    providerStatus: Number.isInteger(providerStatus) && providerStatus >= 100 && providerStatus <= 599 ? providerStatus : null,
    providerRequestId,
    gatewayCode,
    gatewayParam,
    responseIssue,
    responseCorrection: boundedString(details?.responseCorrection, 2048),
    modelFinishReason,
    modelAttempts,
    failureStage,
    validationCommand,
    validationCategory,
    validationOutputExcerpt: boundedString(details?.validationOutputExcerpt, 4096),
    validationFailureReason: boundedString(details?.validationFailureReason, 256),
    failureReason: boundedString(details?.failureReason, 256),
    unresolvedCapabilities: unresolvedCapabilities.length ? unresolvedCapabilities : null,
  };
  return Object.values(safe).some(Boolean) ? safe : null;
}

function boundedString(value, maxLength) {
  return typeof value === "string" && value.length <= maxLength ? value : null;
}

function failureReasonFor(code) {
  if (code === "MODEL_PATCH_GATEWAY_TIMEOUT") return "A bounded coding-model request did not settle before its 90-second deadline.";
  if (code === "AZURE_OPENAI_GATEWAY_CREDENTIAL_TIMEOUT") return "Azure AD token acquisition did not settle before its bounded deadline.";
  return null;
}

function failureStageFor(code) {
  if (code === "MODEL_PATCH_CAPABILITY_UNRESOLVED") return "SETUP";
  if (code.startsWith("MODEL_PATCH_VALIDATION")) return "VALIDATION";
  if (code.startsWith("MODEL_PATCH_RESPONSE")) return "MODEL_RESPONSE";
  if (code.includes("CONFIGURED") || code.includes("SOURCE") || code.includes("DEPENDENCIES") || code.includes("CANDIDATE")) return "SETUP";
  return "EXECUTION";
}

function safeTimings(timings) {
  const safe = {};
  for (const field of ["contextMs", "workspaceCopyMs", "modelMs", "patchMs", "validationMs", "promotionMs", "totalMs"]) {
    const value = Number(timings?.[field]);
    if (Number.isInteger(value) && value >= 0 && value <= 900_000) safe[field] = value;
  }
  return Object.keys(safe).length ? safe : null;
}
