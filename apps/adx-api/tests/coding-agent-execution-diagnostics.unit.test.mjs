import assert from "node:assert/strict";
import test from "node:test";
import {
  failureResult,
  publicResult,
  toCompletionResult,
} from "../coding-agent-execution-diagnostics.mjs";

test("execution diagnostics normalize malformed model JSON without retaining the raw error", () => {
  const result = failureResult(
    new SyntaxError("Expected ',' or ']' after array element in JSON at position 2362"),
  );

  assert.equal(result.errorCode, "MODEL_PATCH_RESPONSE_INVALID");
  assert.equal(result.errorDetails.responseIssue, "NON_JSON");
  assert.match(result.errorDetails.responseCorrection, /Return exactly one JSON object/);
  assert.doesNotMatch(JSON.stringify(result), /position 2362/);
});

test("execution diagnostics persist supported artifacts and return only safe public fields", () => {
  const completion = toCompletionResult({
    code: 0,
    outputDigest: "sha256:output",
    outputBytes: 7,
    candidateDigest: "sha256:candidate",
    featureSpotlight: { title: "Funding status" },
    provisionalExternalContracts: [{ capability: "financial-api" }],
  });
  const result = publicResult({
    code: 1,
    outputDigest: "sha256:output",
    outputBytes: 7,
    errorCode: "MODEL_PATCH_RESPONSE_INVALID",
    errorDetails: { responseIssue: "PATCH_PATH_DUPLICATE", ignored: "not exposed" },
  });

  assert.deepEqual(completion.artifacts.map((artifact) => artifact.mediaType), [
    "application/vnd.adx.candidate-digest",
    "application/vnd.adx.feature-spotlight+json",
    "application/vnd.adx.provisional-external-contract+json",
  ]);
  assert.deepEqual(result.errorDetails, { responseIssue: "PATCH_PATH_DUPLICATE", provider: null, providerStatus: null, providerRequestId: null, gatewayCode: null, gatewayParam: null, responseCorrection: null, modelFinishReason: null, modelAttempts: null, failureStage: null, validationCommand: null, validationCategory: null, validationOutputExcerpt: null, validationFailureReason: null, failureReason: null, unresolvedCapabilities: null });
});
