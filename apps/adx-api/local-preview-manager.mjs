import { createServer } from "node:net";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { access, readFile } from "node:fs/promises";
import { ChangeCaseError } from "./change-case-ledger.mjs";

const previewLabel = "com.adx.preview";

export class LocalPreviewManager {
  constructor({
    profiles,
    digestCandidate,
    runCommand = runCommandVector,
    waitForReady = waitForPreview,
  } = {}) {
    if (!(profiles instanceof Map) || typeof digestCandidate !== "function")
      throw new Error("LOCAL_PREVIEW_CONFIGURATION_REQUIRED");
    this.profiles = profiles;
    this.digestCandidate = digestCandidate;
    this.runCommand = runCommand;
    this.waitForReady = waitForReady;
    this.previews = new Map();
  }

  configured() {
    return this.profiles.size > 0;
  }

  list() {
    return [...this.previews.values()].map((preview) => ({ ...preview }));
  }

  async start({ profileId, candidateDigest, changeCaseId }) {
    const profile = this.profiles.get(profileId);
    if (!profile)
      throw new ChangeCaseError(
        "LOCAL_PREVIEW_PROFILE_NOT_FOUND",
        "The requested application preview profile is not enabled.",
      );
    if (
      typeof candidateDigest !== "string" ||
      !candidateDigest.startsWith("sha256:")
    )
      throw new ChangeCaseError(
        "LOCAL_PREVIEW_CANDIDATE_REQUIRED",
        "A signed verification candidate digest is required to start a preview.",
      );
    if (
      profile.npmrcSecretRequired &&
      (typeof profile.npmrcSecretPath !== "string" || !profile.npmrcSecretPath)
    )
      throw new ChangeCaseError(
        "LOCAL_PREVIEW_NPM_CREDENTIALS_REQUIRED",
        "This application preview requires the server-configured ADX_PREVIEW_NPMRC_FILE credential path.",
      );
    await access(profile.dockerfile).catch(() => {
      throw new ChangeCaseError(
        "LOCAL_PREVIEW_PROFILE_INVALID",
        "The registered preview Dockerfile is unavailable.",
      );
    });
    if (profile.npmrcSecretPath)
      await access(profile.npmrcSecretPath).catch(() => {
        throw new ChangeCaseError(
          "LOCAL_PREVIEW_NPM_CREDENTIALS_REQUIRED",
          "The server-configured npm credential file is unavailable.",
        );
      });
    if (Array.isArray(profile.requiredDockerfileMarkers)) {
      const dockerfile = await readFile(profile.dockerfile, "utf8");
      if (
        !profile.requiredDockerfileMarkers.every((marker) =>
          dockerfile.includes(marker),
        )
      )
        throw new ChangeCaseError(
          "LOCAL_PREVIEW_CANDIDATE_STALE",
          "The generated candidate predates the registered preview build contract. Generate and independently verify a fresh candidate before starting a preview.",
        );
    }
    const actualDigest = await this.digestCandidate(profile.context);
    if (profile.candidateBound !== false && actualDigest !== candidateDigest)
      throw new ChangeCaseError(
        "LOCAL_PREVIEW_CANDIDATE_MISMATCH",
        "The configured after-implementation preview source no longer matches the independently verified candidate.",
      );
    const existing = this.list().find(
      (preview) =>
        preview.profileId === profileId &&
        preview.candidateDigest === candidateDigest &&
        preview.changeCaseId === changeCaseId,
    );
    if (existing)
      return { accepted: true, deduplicated: true, preview: existing };

    const id = randomUUID();
    const image = `adx-preview/${profile.id}:${candidateDigest.slice(7, 19)}`;
    const containerName = `adx-preview-${id}`;
    const port = await availablePort();
    const registryArgument = profile.npmRegistry
      ? ["--build-arg", `NPM_REGISTRY=${profile.npmRegistry}`]
      : [];
    const npmrcSecretArgument =
      typeof profile.npmrcSecretPath === "string" && profile.npmrcSecretPath
        ? ["--secret", `id=npmrc,src=${profile.npmrcSecretPath}`]
        : [];
    try {
      await this.runCommand(
        [
          "docker",
          "build",
          "--label",
          `${previewLabel}=true`,
          "--label",
          `com.adx.preview.profile=${profile.id}`,
          "--label",
          `com.adx.preview.candidate=${candidateDigest}`,
          ...registryArgument,
          ...npmrcSecretArgument,
          "--tag",
          image,
          "--file",
          profile.dockerfile,
          profile.context,
        ],
        { timeoutMs: 10 * 60_000 },
      );
    } catch (error) {
      throw previewBuildError(error);
    }
    try {
      await this.runCommand(
        [
          "docker",
          "run",
          "--detach",
          "--rm",
          "--name",
          containerName,
          "--label",
          `${previewLabel}=true`,
          "--label",
          `com.adx.preview.profile=${profile.id}`,
          "--label",
          `com.adx.preview.candidate=${candidateDigest}`,
          "--publish",
          `127.0.0.1:${port}:${profile.containerPort}`,
          image,
        ],
        { timeoutMs: 30_000 },
      );
      const url = `http://127.0.0.1:${port}${profile.readinessPath}`;
      await this.waitForReady(url);
      const preview = Object.freeze({
        id,
        profileId: profile.id,
        label: profile.label,
        comparisonRole: profile.comparisonRole ?? "AFTER",
        changeCaseId,
        candidateDigest,
        sourceDigest: actualDigest,
        url,
        containerName,
        status: "READY",
        startedAt: new Date().toISOString(),
      });
      this.previews.set(id, preview);
      return { accepted: true, deduplicated: false, preview };
    } catch (error) {
      await this.runCommand(["docker", "rm", "--force", containerName], {
        timeoutMs: 30_000,
      }).catch(() => {});
      throw error;
    }
  }

  async stop(id) {
    const preview = this.previews.get(id);
    if (!preview)
      throw new ChangeCaseError(
        "LOCAL_PREVIEW_NOT_FOUND",
        "The requested local preview is not active.",
      );
    await this.runCommand(["docker", "rm", "--force", preview.containerName], {
      timeoutMs: 30_000,
    });
    this.previews.delete(id);
    return { accepted: true, previewId: id, status: "STOPPED" };
  }
}

function previewBuildError(error) {
  const output = typeof error?.details?.output === "string" ? error.details.output : "";
  if (/npm error code e401|incorrect or missing password/i.test(output))
    return new ChangeCaseError(
      "LOCAL_PREVIEW_NPM_AUTH_FAILED",
      "The preview build could not authenticate to the configured npm registry. Refresh the server-configured npm credential file, then retry the preview.",
    );
  return error;
}

async function availablePort() {
  const server = createServer();
  await new Promise((resolvePromise, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolvePromise);
  });
  const address = server.address();
  await new Promise((resolvePromise) => server.close(resolvePromise));
  return address.port;
}

async function waitForPreview(url) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    try {
      if ((await fetch(url)).ok) return;
    } catch {}
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 200));
  }
  throw new ChangeCaseError(
    "LOCAL_PREVIEW_START_FAILED",
    "The preview container did not become ready within 30 seconds.",
  );
}

function runCommandVector(command, { timeoutMs }) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command[0], command.slice(1), {
      env: { PATH: process.env.PATH },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
    }, timeoutMs);
    const capture = (chunk) => {
      output += chunk.toString();
      if (output.length > 65_536) output = output.slice(-65_536);
    };
    child.stdout.on("data", capture);
    child.stderr.on("data", capture);
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(
        new ChangeCaseError(
          "LOCAL_PREVIEW_COMMAND_FAILED",
          "The local preview command could not start.",
          { details: { cause: error.message } },
        ),
      );
    });
    child.once("close", (code) => {
      clearTimeout(timer);
      if (code === 0) return resolvePromise(output);
      reject(
        new ChangeCaseError(
          timedOut
            ? "LOCAL_PREVIEW_COMMAND_TIMEOUT"
            : "LOCAL_PREVIEW_COMMAND_FAILED",
          "The local preview command failed.",
          { details: { exitCode: code, output } },
        ),
      );
    });
  });
}
