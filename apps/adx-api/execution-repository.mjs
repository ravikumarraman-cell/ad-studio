import { randomUUID } from "node:crypto";
import pg from "pg";
import { ChangeCaseError, sha256 } from "./change-case-ledger.mjs";
import {
  authorizeLeaseAction,
  createExecutionLease,
  verifyExecutionLease,
} from "./execution-governance.mjs";
import { authorizeResolvedEgress } from "./network-governance.mjs";

export class PostgresExecutionRepository {
  constructor({ connectionString, signer }) {
    if (
      !connectionString ||
      !signer?.privateKey ||
      !signer?.publicKey ||
      !signer?.keyId
    )
      throw new Error("EXECUTION_REPOSITORY_CONFIGURATION_REQUIRED");
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
  async issueLease({ scope, principal, changeCaseId, request }) {
    return this.scoped(scope, async (client) => {
      const caseRow = await client.query(
        "SELECT state FROM adx_change_case WHERE id=$1 AND organization_id=$2 AND workspace_id=$3 FOR UPDATE",
        [changeCaseId, scope.organizationId, scope.workspaceId],
      );
      if (!caseRow.rowCount)
        throw new ChangeCaseError(
          "CHANGE_CASE_NOT_FOUND",
          "Change Case was not found.",
        );
      if (caseRow.rows[0].state !== "READY_FOR_EXECUTION")
        throw new ChangeCaseError(
          "EXECUTION_LEASE_NOT_ALLOWED",
          "Execution leases require an execution-ready Change Case.",
        );
      const lease = createExecutionLease({
        changeCaseId,
        principal: request.agentPrincipal,
        repositories: request.repositories,
        requestedCapabilities: request.requestedCapabilities,
        requestedEgress: request.requestedEgress,
        policyEgress: request.policyEgress,
        requestedSecrets: request.requestedSecrets,
        policySecrets: request.policySecrets,
        adapter: request.adapter,
        policyCapabilities: request.policyCapabilities,
        limits: request.limits,
        policyVersion: request.policyVersion,
        durationSeconds: request.durationSeconds,
        signer: this.signer,
      });
      const runId = randomUUID();
      const event = this.#event({
        runId,
        sequence: 1,
        eventType: "AgentRunLeased.v1",
        payload: { leaseId: lease.leaseId, leaseDigest: lease.leaseDigest },
      });
      await client.query(
        "INSERT INTO adx_execution_lease (id,organization_id,workspace_id,change_case_id,lease,lease_digest,signature,signature_key_id,status,issued_by,issued_at,expires_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)",
        [
          lease.leaseId,
          scope.organizationId,
          scope.workspaceId,
          changeCaseId,
          lease,
          lease.leaseDigest,
          lease.signature,
          lease.signatureKeyId,
          "ACTIVE",
          principal.id,
          lease.issuedAt,
          lease.expiresAt,
        ],
      );
      await client.query(
        "INSERT INTO adx_agent_run (id,organization_id,workspace_id,change_case_id,lease_id,adapter_id,adapter_version,status) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)",
        [
          runId,
          scope.organizationId,
          scope.workspaceId,
          changeCaseId,
          lease.leaseId,
          lease.adapter.adapterId,
          lease.adapter.version,
          "LEASED",
        ],
      );
      await this.#insertEvent(client, scope, event);
      return {
        accepted: true,
        leaseId: lease.leaseId,
        runId,
        leaseDigest: lease.leaseDigest,
        expiresAt: lease.expiresAt,
        status: "ACTIVE",
      };
    });
  }
  async revokeLease({ scope, principal, leaseId, reason }) {
    if (typeof reason !== "string" || !reason.trim())
      throw new ChangeCaseError(
        "EXECUTION_REVOCATION_REASON_REQUIRED",
        "A revocation reason is required.",
      );
    return this.scoped(scope, async (client) => {
      const row = await client.query(
        "UPDATE adx_execution_lease SET status='REVOKED',revoked_at=now(),revoked_by=$4,revoke_reason=$5 WHERE id=$1 AND organization_id=$2 AND workspace_id=$3 AND status='ACTIVE' RETURNING change_case_id AS \"changeCaseId\"",
        [
          leaseId,
          scope.organizationId,
          scope.workspaceId,
          principal.id,
          reason.trim(),
        ],
      );
      if (!row.rowCount)
        throw new ChangeCaseError(
          "EXECUTION_LEASE_NOT_REVOCABLE",
          "Execution lease is not active or was not found.",
        );
      const run = await client.query(
        "SELECT id FROM adx_agent_run WHERE lease_id=$1 AND organization_id=$2 AND workspace_id=$3 FOR UPDATE",
        [leaseId, scope.organizationId, scope.workspaceId],
      );
      if (run.rowCount) {
        const sequence = await this.#nextSequence(client, run.rows[0].id);
        const event = this.#event({
          runId: run.rows[0].id,
          sequence,
          eventType: "AgentRunLeaseRevoked.v1",
          payload: { leaseId, reason: reason.trim() },
        });
        await client.query(
          "UPDATE adx_agent_run SET status='CANCELLED',updated_at=now() WHERE id=$1 AND status IN ('LEASED','RUNNING')",
          [run.rows[0].id],
        );
        await this.#insertEvent(client, scope, event);
      }
      return { accepted: true, leaseId, status: "REVOKED" };
    });
  }
  async recordReceipt({
    scope,
    leaseId,
    runId,
    action,
    allowed,
    request,
    receipt,
  }) {
    return this.scoped(scope, async (client) => {
      const lease = await client.query(
        "SELECT lease,status FROM adx_execution_lease WHERE id=$1 AND organization_id=$2 AND workspace_id=$3",
        [leaseId, scope.organizationId, scope.workspaceId],
      );
      if (!lease.rowCount)
        throw new ChangeCaseError(
          "EXECUTION_LEASE_NOT_FOUND",
          "Execution lease was not found.",
        );
      const verified = verifyExecutionLease(lease.rows[0].lease, (keyId) =>
        keyId === this.signer.keyId ? this.signer.publicKey : null,
      );
      const requestDigest = sha256({
        leaseId,
        runId: runId ?? null,
        action,
        request,
      });
      const receiptDigest = sha256({
        leaseDigest: verified.leaseDigest,
        action,
        allowed: Boolean(allowed),
        requestDigest,
        receipt,
      });
      await client.query(
        "INSERT INTO adx_gateway_receipt (id,organization_id,workspace_id,lease_id,run_id,action,allowed,request_digest,receipt,receipt_digest) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)",
        [
          randomUUID(),
          scope.organizationId,
          scope.workspaceId,
          leaseId,
          runId ?? null,
          action,
          Boolean(allowed),
          requestDigest,
          receipt ?? {},
          receiptDigest,
        ],
      );
      return { accepted: true, requestDigest, receiptDigest };
    });
  }
  async authorizeGatewayAction({
    scope,
    leaseId,
    runId,
    action,
    request = {},
    now = new Date(),
  }) {
    return this.scoped(scope, async (client) => {
      const row = await client.query(
        'SELECT lease,status,tool_calls AS "toolCalls",network_bytes AS "networkBytes",cost_usd AS "costUsd" FROM adx_execution_lease WHERE id=$1 AND organization_id=$2 AND workspace_id=$3 FOR UPDATE',
        [leaseId, scope.organizationId, scope.workspaceId],
      );
      if (!row.rowCount)
        throw new ChangeCaseError(
          "EXECUTION_LEASE_NOT_FOUND",
          "Execution lease was not found.",
        );
      const stored = row.rows[0];
      let allowed = true;
      let errorCode = null;
      let lease = null;
      try {
        if (stored.status !== "ACTIVE")
          throw new ChangeCaseError(
            stored.status === "REVOKED"
              ? "EXECUTION_LEASE_REVOKED"
              : "EXECUTION_LEASE_EXPIRED",
            "Execution lease is not active.",
          );
        lease = verifyExecutionLease(
          stored.lease,
          (keyId) =>
            keyId === this.signer.keyId ? this.signer.publicKey : null,
          { now },
        );
        authorizeLeaseAction({
          lease,
          action,
          repositoryId: request.repositoryId,
          path: request.path,
          now,
        });
        if (action === "network")
          await authorizeResolvedEgress({ lease, target: request });
        const networkBytes = nonNegativeInteger(request.networkBytes);
        const costUsd = nonNegativeNumber(request.costUsd);
        if (stored.toolCalls + 1 > lease.limits.maxToolCalls)
          throw new ChangeCaseError(
            "EXECUTION_TOOL_QUOTA_EXCEEDED",
            "Execution lease tool-call quota is exhausted.",
          );
        if (stored.networkBytes + networkBytes > lease.limits.maxNetworkBytes)
          throw new ChangeCaseError(
            "EXECUTION_NETWORK_QUOTA_EXCEEDED",
            "Execution lease network-byte quota is exhausted.",
          );
        if (Number(stored.costUsd) + costUsd > lease.limits.maxCostUsd)
          throw new ChangeCaseError(
            "EXECUTION_COST_QUOTA_EXCEEDED",
            "Execution lease cost quota is exhausted.",
          );
        await client.query(
          "UPDATE adx_execution_lease SET tool_calls=tool_calls+1,network_bytes=network_bytes+$1,cost_usd=cost_usd+$2 WHERE id=$3",
          [networkBytes, costUsd, leaseId],
        );
      } catch (error) {
        allowed = false;
        errorCode =
          error instanceof ChangeCaseError
            ? error.code
            : "EXECUTION_GATEWAY_FAILED";
        if (
          errorCode === "EXECUTION_LEASE_EXPIRED" &&
          stored.status === "ACTIVE"
        )
          await client.query(
            "UPDATE adx_execution_lease SET status='EXPIRED' WHERE id=$1",
            [leaseId],
          );
      }
      const requestDigest = sha256({
        leaseId,
        runId: runId ?? null,
        action,
        request,
      });
      const receipt = {
        gateway: "adx-tool-gateway-v1",
        outcome: allowed ? "ALLOW" : "DENY",
        errorCode,
        at: now.toISOString(),
      };
      const receiptDigest = sha256({
        leaseDigest: stored.lease.leaseDigest,
        action,
        allowed,
        requestDigest,
        receipt,
      });
      const existing = await client.query(
        'SELECT receipt_digest AS "receiptDigest",allowed FROM adx_gateway_receipt WHERE lease_id=$1 AND request_digest=$2',
        [leaseId, requestDigest],
      );
      if (existing.rowCount)
        return {
          allowed: existing.rows[0].allowed,
          requestDigest,
          receiptDigest: existing.rows[0].receiptDigest,
          errorCode: existing.rows[0].allowed ? null : errorCode,
          deduplicated: true,
        };
      await client.query(
        "INSERT INTO adx_gateway_receipt (id,organization_id,workspace_id,lease_id,run_id,action,allowed,request_digest,receipt,receipt_digest) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)",
        [
          randomUUID(),
          scope.organizationId,
          scope.workspaceId,
          leaseId,
          runId ?? null,
          action,
          allowed,
          requestDigest,
          receipt,
          receiptDigest,
        ],
      );
      return {
        allowed,
        requestDigest,
        receiptDigest,
        errorCode,
        deduplicated: false,
      };
    });
  }
  async dispatchContext({ scope, leaseId, runId, now = new Date() }) {
    return this.scoped(scope, async (client) => {
      const row = await client.query(
        'SELECT l.lease,l.status,r.status AS "runStatus" FROM adx_execution_lease l JOIN adx_agent_run r ON r.lease_id=l.id WHERE l.id=$1 AND r.id=$2 AND l.organization_id=$3 AND l.workspace_id=$4 FOR UPDATE',
        [leaseId, runId, scope.organizationId, scope.workspaceId],
      );
      if (!row.rowCount)
        throw new ChangeCaseError(
          "EXECUTION_RUN_NOT_FOUND",
          "Execution lease or run was not found.",
        );
      if (row.rows[0].status !== "ACTIVE")
        throw new ChangeCaseError(
          "EXECUTION_LEASE_REVOKED",
          "Execution lease is not active.",
        );
      if (row.rows[0].runStatus !== "LEASED")
        throw new ChangeCaseError(
          "EXECUTION_RUN_NOT_DISPATCHABLE",
          "Execution run is not available for dispatch.",
        );
      const verified = verifyExecutionLease(
        row.rows[0].lease,
        (keyId) => (keyId === this.signer.keyId ? this.signer.publicKey : null),
        { now },
      );
      const { canonical, ...lease } = verified;
      await client.query(
        "UPDATE adx_agent_run SET status='RUNNING',updated_at=now() WHERE id=$1",
        [runId],
      );
      const event = this.#event({
        runId,
        sequence: await this.#nextSequence(client, runId),
        eventType: "AgentRunStarted.v1",
        payload: { leaseId, leaseDigest: lease.leaseDigest },
      });
      await this.#insertEvent(client, scope, event);
      return lease;
    });
  }
  async isLeaseActive({ scope, leaseId }) {
    return this.scoped(scope, async (client) =>
      Boolean(
        (
          await client.query(
            "SELECT 1 FROM adx_execution_lease WHERE id=$1 AND organization_id=$2 AND workspace_id=$3 AND status='ACTIVE' AND expires_at > now()",
            [leaseId, scope.organizationId, scope.workspaceId],
          )
        ).rowCount,
      ),
    );
  }
  async completeDispatch({ scope, leaseId, runId, result, request }) {
    return this.scoped(scope, async (client) => {
      const current = await client.query(
        "SELECT status FROM adx_agent_run WHERE id=$1 AND organization_id=$2 AND workspace_id=$3 FOR UPDATE",
        [runId, scope.organizationId, scope.workspaceId],
      );
      if (!current.rowCount)
        throw new ChangeCaseError(
          "EXECUTION_RUN_NOT_FOUND",
          "Execution run was not found.",
        );
      const cancelled =
        current.rows[0].status === "CANCELLED" || result.cancelled;
      const status = cancelled
        ? "CANCELLED"
        : result.code === 0 && !result.quotaExceeded && !result.timedOut
          ? "COMPLETED"
          : "FAILED";
      const artifacts = Array.isArray(result.artifacts) ? result.artifacts : [];
      const errorCode =
        typeof result.errorCode === "string" ? result.errorCode : null;
      const errorDetails =
        result.errorDetails && typeof result.errorDetails === "object"
          ? result.errorDetails
          : null;
      const timings =
        result.timings && typeof result.timings === "object"
          ? result.timings
          : null;
      const quota = {
        exceeded: Boolean(result.quotaExceeded),
        workspaceExceeded: Boolean(result.workspaceQuotaExceeded),
        workspaceBytes: Number(result.workspaceBytes ?? 0),
        outputBytes: result.outputBytes,
      };
      if (!cancelled)
        await client.query(
          "UPDATE adx_agent_run SET status=$1,updated_at=now() WHERE id=$2 AND organization_id=$3 AND workspace_id=$4",
          [status, runId, scope.organizationId, scope.workspaceId],
        );
      const event = this.#event({
        runId,
        sequence: await this.#nextSequence(client, runId),
        eventType: cancelled
          ? "AgentRunCancellationObserved.v1"
          : result.quotaExceeded || result.timedOut
            ? "AgentRunQuotaExceeded.v1"
            : status === "COMPLETED"
              ? "AgentRunCompleted.v1"
              : "AgentRunFailed.v1",
        payload: {
          leaseId,
          exitCode: result.code,
          signal: result.signal,
          errorCode,
          errorDetails,
          timings,
          quota,
          timedOut: Boolean(result.timedOut),
          cancelled,
          artifacts,
        },
      });
      await this.#insertEvent(client, scope, event);
      const requestDigest = sha256({
        leaseId,
        runId,
        action: "sandbox_dispatch",
        request,
      });
      const receipt = {
        gateway: "adx-tool-gateway-v1",
        outcome: status,
        exitCode: result.code,
        signal: result.signal,
        errorCode,
        errorDetails,
        timings,
        quota,
        timedOut: Boolean(result.timedOut),
        cancelled,
        artifacts,
      };
      const receiptDigest = sha256({ leaseId, requestDigest, receipt });
      await client.query(
        "INSERT INTO adx_gateway_receipt (id,organization_id,workspace_id,lease_id,run_id,action,allowed,request_digest,receipt,receipt_digest) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)",
        [
          randomUUID(),
          scope.organizationId,
          scope.workspaceId,
          leaseId,
          runId,
          "sandbox_dispatch",
          status === "COMPLETED",
          requestDigest,
          receipt,
          receiptDigest,
        ],
      );
      return {
        status,
        receiptDigest,
        errorCode,
        errorDetails,
        timings,
        artifacts,
      };
    });
  }
  async view(scope, changeCaseId) {
    return this.scoped(scope, async (client) => ({
      leases: (
        await client.query(
          'SELECT id,status,lease_digest AS "leaseDigest",issued_at AS "issuedAt",expires_at AS "expiresAt",revoked_at AS "revokedAt",revoke_reason AS "revokeReason" FROM adx_execution_lease WHERE change_case_id=$1 AND organization_id=$2 AND workspace_id=$3 ORDER BY issued_at DESC',
          [changeCaseId, scope.organizationId, scope.workspaceId],
        )
      ).rows,
      runs: (
        await client.query(
          'SELECT id,lease_id AS "leaseId",adapter_id AS "adapterId",adapter_version AS "adapterVersion",status,created_at AS "createdAt",updated_at AS "updatedAt" FROM adx_agent_run WHERE change_case_id=$1 AND organization_id=$2 AND workspace_id=$3 ORDER BY created_at DESC',
          [changeCaseId, scope.organizationId, scope.workspaceId],
        )
      ).rows,
      events: (
        await client.query(
          "SELECT event.run_id AS \"runId\",event.sequence,event.event_type AS \"eventType\",event.occurred_at AS \"occurredAt\",event.payload->>'errorCode' AS \"errorCode\",event.payload->'errorDetails' AS \"errorDetails\",event.payload->'timings' AS timings,event.payload->'quota' AS quota,event.payload->'artifacts' AS artifacts,COALESCE((event.payload->>'timedOut')::boolean,false) AS \"timedOut\",event.payload->>'signal' AS signal FROM adx_agent_run_event event JOIN adx_agent_run run ON run.id=event.run_id WHERE run.change_case_id=$1 AND run.organization_id=$2 AND run.workspace_id=$3 ORDER BY event.occurred_at ASC,event.sequence ASC",
          [changeCaseId, scope.organizationId, scope.workspaceId],
        )
      ).rows,
    }));
  }
  async close() {
    await this.pool.end();
  }
  #event({ runId, sequence, eventType, payload }) {
    const occurredAt = new Date().toISOString();
    const payloadDigest = sha256(payload);
    const material = {
      runId,
      sequence,
      eventType,
      occurredAt,
      payloadDigest,
      payload,
    };
    return { id: randomUUID(), ...material, eventDigest: sha256(material) };
  }
  async #nextSequence(client, runId) {
    return Number(
      (
        await client.query(
          "SELECT COALESCE(MAX(sequence),0)+1 AS sequence FROM adx_agent_run_event WHERE run_id=$1",
          [runId],
        )
      ).rows[0].sequence,
    );
  }
  async #insertEvent(client, scope, event) {
    const previous = await client.query(
      'SELECT event_digest AS "eventDigest" FROM adx_agent_run_event WHERE run_id=$1 ORDER BY sequence DESC LIMIT 1',
      [event.runId],
    );
    const material = {
      runId: event.runId,
      sequence: event.sequence,
      eventType: event.eventType,
      occurredAt: event.occurredAt,
      payloadDigest: event.payloadDigest,
      payload: event.payload,
      previousEventDigest: previous.rows[0]?.eventDigest ?? null,
    };
    await client.query(
      "INSERT INTO adx_agent_run_event (id,organization_id,workspace_id,run_id,sequence,event_type,payload,payload_digest,previous_event_digest,event_digest,occurred_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)",
      [
        event.id,
        scope.organizationId,
        scope.workspaceId,
        event.runId,
        event.sequence,
        event.eventType,
        event.payload,
        event.payloadDigest,
        material.previousEventDigest,
        sha256(material),
        event.occurredAt,
      ],
    );
  }
}

function nonNegativeInteger(value) {
  const number = Number(value ?? 0);
  if (!Number.isInteger(number) || number < 0)
    throw new ChangeCaseError(
      "EXECUTION_GATEWAY_REQUEST_INVALID",
      "Network byte usage must be a non-negative integer.",
    );
  return number;
}
function nonNegativeNumber(value) {
  const number = Number(value ?? 0);
  if (!Number.isFinite(number) || number < 0)
    throw new ChangeCaseError(
      "EXECUTION_GATEWAY_REQUEST_INVALID",
      "Cost usage must be a non-negative number.",
    );
  return number;
}
