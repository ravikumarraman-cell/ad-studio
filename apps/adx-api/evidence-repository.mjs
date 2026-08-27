import { randomUUID } from "node:crypto";
import pg from "pg";
import { ChangeCaseError } from "./change-case-ledger.mjs";
import { verifyEvidenceBundle } from "./verification-evidence.mjs";

export class PostgresEvidenceRepository {
  constructor({ connectionString, signer }) {
    if (!connectionString || !signer?.publicKey || !signer?.keyId)
      throw new Error("EVIDENCE_REPOSITORY_CONFIGURATION_REQUIRED");
    this.pool = new pg.Pool({
      connectionString,
      max: 10,
      idleTimeoutMillis: 10_000,
    });
    this.signer = signer;
  }
  async scoped(scope, work) {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        "SELECT set_config('adx.organization_id', $1, true), set_config('adx.workspace_id', $2, true)",
        [scope.organizationId, scope.workspaceId],
      );
      const value = await work(client);
      await client.query("COMMIT");
      return value;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
  async retain({ scope, principal, changeCaseId, evidence, artifacts = [] }) {
    if (principal?.type !== "service")
      throw new ChangeCaseError(
        "EVIDENCE_WRITER_REQUIRED",
        "Only the independent verifier service can retain verification evidence.",
      );
    verifyEvidenceBundle(evidence, (keyId) =>
      keyId === this.signer.keyId ? this.signer.publicKey : null,
    );
    const normalized = normalizeArtifacts(artifacts);
    return this.scoped(scope, async (client) => {
      const changeCase = await client.query(
        "SELECT 1 FROM adx_change_case WHERE id=$1 AND organization_id=$2 AND workspace_id=$3",
        [changeCaseId, scope.organizationId, scope.workspaceId],
      );
      if (!changeCase.rowCount)
        throw new ChangeCaseError(
          "CHANGE_CASE_NOT_FOUND",
          "Change Case was not found.",
        );
      const id = randomUUID();
      const row = await client.query(
        "INSERT INTO adx_evidence_bundle (id,organization_id,workspace_id,change_case_id,evidence,evidence_digest,verifier_id,verifier_version,status,candidate_digest,runtime_image_digest,config_digest,command_digest,signature,signature_key_id,recorded_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) ON CONFLICT (change_case_id,evidence_digest) DO NOTHING RETURNING id",
        [
          id,
          scope.organizationId,
          scope.workspaceId,
          changeCaseId,
          evidence,
          evidence.evidenceDigest,
          evidence.verifier.id,
          evidence.verifier.version,
          evidence.status,
          evidence.candidateDigest,
          evidence.runtimeImageDigest,
          evidence.configDigest,
          evidence.commandDigest,
          evidence.signature,
          evidence.signatureKeyId,
          principal.id,
        ],
      );
      if (!row.rowCount)
        return {
          accepted: true,
          deduplicated: true,
          evidenceId: (
            await client.query(
              "SELECT id FROM adx_evidence_bundle WHERE change_case_id=$1 AND evidence_digest=$2",
              [changeCaseId, evidence.evidenceDigest],
            )
          ).rows[0].id,
          evidenceDigest: evidence.evidenceDigest,
        };
      for (const artifact of normalized)
        await client.query(
          "INSERT INTO adx_evidence_artifact (id,organization_id,workspace_id,evidence_id,artifact_digest,object_key,media_type,byte_length,metadata) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)",
          [
            randomUUID(),
            scope.organizationId,
            scope.workspaceId,
            id,
            artifact.digest,
            artifact.objectKey,
            artifact.mediaType,
            artifact.bytes,
            artifact.metadata,
          ],
        );
      return {
        accepted: true,
        deduplicated: false,
        evidenceId: id,
        evidenceDigest: evidence.evidenceDigest,
      };
    });
  }
  async list(scope, changeCaseId) {
    return this.scoped(scope, async (client) => {
      const bundles = (
        await client.query(
          'SELECT id,evidence_digest AS "evidenceDigest",verifier_id AS "verifierId",verifier_version AS "verifierVersion",status,candidate_digest AS "candidateDigest",runtime_image_digest AS "runtimeImageDigest",config_digest AS "configDigest",command_digest AS "commandDigest",evidence->\'command\' AS command,created_at AS "createdAt" FROM adx_evidence_bundle WHERE change_case_id=$1 AND organization_id=$2 AND workspace_id=$3 ORDER BY created_at DESC',
          [changeCaseId, scope.organizationId, scope.workspaceId],
        )
      ).rows;
      for (const bundle of bundles)
        bundle.artifacts = (
          await client.query(
            'SELECT artifact_digest AS digest,object_key AS "objectKey",media_type AS "mediaType",byte_length AS bytes,metadata FROM adx_evidence_artifact WHERE evidence_id=$1 AND organization_id=$2 AND workspace_id=$3 ORDER BY created_at',
            [bundle.id, scope.organizationId, scope.workspaceId],
          )
        ).rows;
      return bundles;
    });
  }
  async close() {
    await this.pool.end();
  }
}
function normalizeArtifacts(artifacts) {
  if (!Array.isArray(artifacts))
    throw new ChangeCaseError(
      "EVIDENCE_ARTIFACT_INVALID",
      "Evidence artifacts must be an array.",
    );
  return artifacts.map((artifact) => {
    if (
      !artifact ||
      typeof artifact.digest !== "string" ||
      !artifact.digest.startsWith("sha256:") ||
      typeof artifact.objectKey !== "string" ||
      !artifact.objectKey.trim() ||
      typeof artifact.mediaType !== "string" ||
      !artifact.mediaType.trim() ||
      !Number.isInteger(artifact.bytes) ||
      artifact.bytes < 0
    )
      throw new ChangeCaseError(
        "EVIDENCE_ARTIFACT_INVALID",
        "Artifact digest, object key, media type, and non-negative byte length are required.",
      );
    return {
      digest: artifact.digest,
      objectKey: artifact.objectKey.trim(),
      mediaType: artifact.mediaType.trim(),
      bytes: artifact.bytes,
      metadata:
        artifact.metadata && typeof artifact.metadata === "object"
          ? artifact.metadata
          : {},
    };
  });
}
