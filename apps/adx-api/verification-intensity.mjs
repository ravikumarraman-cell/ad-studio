/** Maps an explicit user preference to bounded semantic-verification work. */
export function normalizeVerificationIntensity(value) {
  if (value === undefined || value === null || value === "") return 100;
  const intensity = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(intensity) || intensity < 0 || intensity > 100)
    throw new RangeError("VERIFICATION_INTENSITY_INVALID");
  return intensity;
}

export function verificationPlan(value, semanticVerificationEnabled = true) {
  const intensity = normalizeVerificationIntensity(value);
  if (!semanticVerificationEnabled || intensity === 0)
    return Object.freeze({ intensity, profile: "fixed-validation-only", semantic: false, maxRepairRounds: 0, maxVerifierAttempts: 0 });
  if (intensity < 50)
    return Object.freeze({ intensity, profile: "focused", semantic: true, maxRepairRounds: 0, maxVerifierAttempts: 1 });
  if (intensity < 100)
    return Object.freeze({ intensity, profile: "standard", semantic: true, maxRepairRounds: 0, maxVerifierAttempts: 2 });
  return Object.freeze({ intensity, profile: "full", semantic: true, maxRepairRounds: 1, maxVerifierAttempts: 3 });
}
