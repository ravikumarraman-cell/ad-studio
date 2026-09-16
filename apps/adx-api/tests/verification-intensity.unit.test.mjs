import assert from "node:assert/strict";
import test from "node:test";
import { normalizeVerificationIntensity, verificationPlan } from "../verification-intensity.mjs";

test("verification intensity maps to bounded semantic-verification profiles", () => {
  assert.deepEqual(verificationPlan(0), { intensity: 0, profile: "fixed-validation-only", semantic: false, maxRepairRounds: 0, maxVerifierAttempts: 0 });
  assert.deepEqual(verificationPlan(25), { intensity: 25, profile: "focused", semantic: true, maxRepairRounds: 0, maxVerifierAttempts: 1 });
  assert.deepEqual(verificationPlan(75), { intensity: 75, profile: "standard", semantic: true, maxRepairRounds: 0, maxVerifierAttempts: 2 });
  assert.deepEqual(verificationPlan(100), { intensity: 100, profile: "full", semantic: true, maxRepairRounds: 1, maxVerifierAttempts: 3 });
});

test("verification intensity defaults safely and rejects values outside the slider contract", () => {
  assert.equal(normalizeVerificationIntensity(), 100);
  assert.equal(normalizeVerificationIntensity("50"), 50);
  assert.throws(() => normalizeVerificationIntensity(-1), /VERIFICATION_INTENSITY_INVALID/);
  assert.throws(() => normalizeVerificationIntensity(101), /VERIFICATION_INTENSITY_INVALID/);
  assert.throws(() => normalizeVerificationIntensity(12.5), /VERIFICATION_INTENSITY_INVALID/);
});
