import { createPreviewDeliveryService } from "./preview-delivery-service.mjs";
import { createGitHubDraftPrClient } from "./github-draft-pr-client.mjs";
import { createGitHubDraftPrExecutionService } from "./github-draft-pr-execution-service.mjs";
import { createGitHubMilestoneStoryClient } from "./github-milestone-story-client.mjs";
import { createStoryMilestoneService } from "./story-milestone-service.mjs";
import { createPrivateGitHubMilestoneClient } from "./github-private-milestones.mjs";
import { selectPreviewCheckout } from "./preview-checkout-selection.mjs";
import { validateReadableFilePath } from "./runtime-config.mjs";

export function createConfiguredPreviewDeliveryPreparation({ changeCases, evidenceRepository, previewDeliveries, storyRepository, environment }) {
  const providerId = environment.ADX_PREVIEW_GIT_PROVIDER_ID;
  const repositoriesJson = environment.ADX_PREVIEW_GIT_REPOSITORIES_JSON;
  const serviceId = environment.ADX_PREVIEW_DELIVERY_SERVICE_ID;
  const sourceRoot = selectPreviewCheckout(environment.ADX_PREVIEW_SOURCE_ROOT, environment.ADX_CODING_MODEL_SOURCE_ROOT, environment.ADX_LOCAL_CODING_AGENT_SOURCE_ROOT);
  const candidateRoot = selectPreviewCheckout(environment.ADX_PREVIEW_CANDIDATE_ROOT, environment.ADX_CODING_MODEL_CANDIDATE_ROOT, environment.ADX_LOCAL_VERIFIER_CANDIDATE_ROOT);
  if (!providerId && !repositoriesJson && !serviceId && !sourceRoot && !candidateRoot)
    return { service: null, code: "GIT_PREVIEW_DELIVERY_NOT_CONFIGURED" };
  if (!providerId || !repositoriesJson || !serviceId || !sourceRoot || !candidateRoot || !changeCases || !evidenceRepository || !previewDeliveries)
    return { service: null, code: "GIT_PREVIEW_DELIVERY_CONFIGURATION_INCOMPLETE" };
  try {
    return {
      service: createPreviewDeliveryService({
        providerId,
        repositories: JSON.parse(repositoriesJson),
        deliveryRepository: previewDeliveries,
        evidenceRepository,
        changeCaseRepository: changeCases,
        storyRepository,
        servicePrincipal: { type: "service", id: serviceId },
        sourceRoot,
        candidateRoot,
      }),
      code: null,
    };
  } catch {
    return { service: null, code: "GIT_PREVIEW_DELIVERY_CONFIGURATION_INVALID" };
  }
}

export async function validatePreviewRuntimeConfiguration(previewProfiles) {
  if (!(previewProfiles instanceof Map) || previewProfiles.size === 0) return;
  for (const profile of previewProfiles.values()) {
    if (!profile?.npmrcSecretRequired) continue;
    if (typeof profile.npmrcSecretPath !== "string" || !profile.npmrcSecretPath.trim())
      throw new Error("API_START_PREVIEW_NPMRC_FILE_MISSING: Configure ADX_PREVIEW_NPMRC_FILE as a readable server-owned file before starting preview-enabled profiles.");
    await validateReadableFilePath(profile.npmrcSecretPath, "PREVIEW_NPMRC_FILE").catch(() => {
      throw new Error("API_START_PREVIEW_NPMRC_FILE_UNAVAILABLE: The configured ADX_PREVIEW_NPMRC_FILE path is unreadable or missing.");
    });
  }
}

export function createConfiguredGitHubDraftPrExecution({ previewDeliveries, previewCi, environment }) {
  const token = environment.ADX_GITHUB_DRAFT_PR_TOKEN;
  const sourceRoot = environment.ADX_PREVIEW_SOURCE_ROOT;
  const candidateRoot = environment.ADX_PREVIEW_CANDIDATE_ROOT;
  if (!token && !sourceRoot && !candidateRoot)
    return { service: null, code: "GITHUB_DRAFT_PR_NOT_CONFIGURED" };
  if (!token || !sourceRoot || !candidateRoot || !previewDeliveries || !previewCi)
    return { service: null, code: "GITHUB_DRAFT_PR_CONFIGURATION_INCOMPLETE" };
  try {
    return {
      service: createGitHubDraftPrExecutionService({
        deliveryRepository: previewDeliveries,
        previewCi,
        client: createGitHubDraftPrClient({ token }),
        servicePrincipal: { type: "service", id: "adx-github-draft-pr-delivery" },
        sourceRoot,
        candidateRoot,
      }),
      code: null,
    };
  } catch {
    return { service: null, code: "GITHUB_DRAFT_PR_CONFIGURATION_INVALID" };
  }
}

export function createConfiguredStoryMilestones({ repository, environment }) {
  const token = environment.ADX_GITHUB_MILESTONE_TOKEN;
  if (!token) return { service: null, code: "GITHUB_MILESTONE_NOT_CONFIGURED" };
  if (!repository) return { service: null, code: "GITHUB_MILESTONE_CONFIGURATION_INCOMPLETE" };
  try {
    return {
      service: createStoryMilestoneService({ repository, client: createGitHubMilestoneStoryClient({ token }) }),
      code: null,
    };
  } catch {
    return { service: null, code: "GITHUB_MILESTONE_CONFIGURATION_INVALID" };
  }
}

export function createConfiguredPrivateGitHubMilestones(environment) {
  if (!environment.ADX_GITHUB_PRIVATE_READ_TOKEN) return null;
  try {
    return createPrivateGitHubMilestoneClient({ token: environment.ADX_GITHUB_PRIVATE_READ_TOKEN });
  } catch {
    return null;
  }
}
