import assert from "node:assert/strict";
import test from "node:test";
import { createGitHubDraftPrClient } from "../github-draft-pr-client.mjs";

const plan = {
  mode: "PREVIEW_ONLY",
  repository: { canonicalRemote: "https://github.com/example/ad-studio.git" },
  branch: "adx/preview/case-1",
  baseRef: "refs/heads/main",
  candidateDigest: "sha256:candidate",
  evidenceDigest: "sha256:evidence",
  pullRequest: {
    title: "Verified candidate",
    body: "## What changed\n\nA verified change.",
    digest: "sha256:plan",
  },
};
const exported = {
  baseCommit: "a".repeat(40),
  exportDigest: "sha256:export",
  changes: [
    {
      path: "src/new.mjs",
      operation: "ADD",
      content: Buffer.from("export const next = true\n").toString("base64"),
    },
    { path: "src/old.mjs", operation: "DELETE", content: null },
  ],
};

test("creates only a provenance-marked draft pull request from verified changes", async () => {
  const calls = [];
  const client = createGitHubDraftPrClient({
    token: "test-token",
    fetchImpl: async (url, options = {}) => {
      calls.push({ url, options });
      const path = new URL(url).pathname + new URL(url).search;
      if (path.includes("/pulls?")) return json([]);
      if (path.includes("/git/ref/")) return response(404, {});
      if (path.endsWith("/git/refs"))
        return json({ ref: "refs/heads/adx/preview/case-1" });
      if (path.includes("/contents/src/new.mjs?")) return response(404, {});
      if (path.includes("/contents/src/old.mjs?"))
        return json({ sha: "old-sha" });
      if (
        path.endsWith("/contents/src/new.mjs") ||
        path.endsWith("/contents/src/old.mjs")
      )
        return json({});
      if (path.endsWith("/pulls"))
        return json({
          number: 42,
          html_url: "https://github.com/example/ad-studio/pull/42",
          node_id: "PR_42",
        });
      throw new Error(`Unexpected ${path}`);
    },
  });
  const result = await client.create({ plan, exported });
  assert.deepEqual(result, {
    deduplicated: false,
    number: 42,
    url: "https://github.com/example/ad-studio/pull/42",
    nodeId: "PR_42",
  });
  assert.equal(
    calls.some(
      (call) =>
        call.options.method === "POST" &&
        call.url.endsWith("/pulls") &&
        JSON.parse(call.options.body).draft === true,
    ),
    true,
  );
  assert.match(
    JSON.parse(
      calls.find(
        (call) => call.options.method === "POST" && call.url.endsWith("/pulls"),
      ).options.body,
    ).body,
    /## What changed/,
  );
  assert.equal(
    calls.some(
      (call) =>
        call.options.method === "PUT" &&
        call.url.includes("/contents/src/new.mjs"),
    ),
    true,
  );
  assert.equal(
    calls.some(
      (call) =>
        call.options.method === "DELETE" &&
        call.url.endsWith("/contents/src/old.mjs"),
    ),
    true,
  );
});

test("returns a matching existing draft PR without mutating GitHub", async () => {
  const client = createGitHubDraftPrClient({
    token: "test-token",
    fetchImpl: async () =>
      json([
        {
          number: 42,
          html_url: "https://github.com/example/ad-studio/pull/42",
          node_id: "PR_42",
          draft: true,
          body: "<!-- adx-preview:sha256:plan -->",
        },
      ]),
  });
  assert.deepEqual(await client.create({ plan, exported }), {
    deduplicated: true,
    number: 42,
    url: "https://github.com/example/ad-studio/pull/42",
    nodeId: "PR_42",
  });
});

test("requires a fresh preview plan when an older plan lacks its retained review description", async () => {
  const legacyPlan = {
    ...plan,
    pullRequest: {
      title: plan.pullRequest.title,
      digest: plan.pullRequest.digest,
    },
  };
  const client = createGitHubDraftPrClient({
    token: "test-token",
    fetchImpl: async () => assert.fail("GitHub must not be called"),
  });
  await assert.rejects(() => client.create({ plan: legacyPlan, exported }), {
    code: "GITHUB_DRAFT_PR_DESCRIPTION_MISSING",
  });
});

test("removes a newly created preview branch when materialization fails", async () => {
  const calls = [];
  const client = createGitHubDraftPrClient({
    token: "test-token",
    fetchImpl: async (url, options = {}) => {
      calls.push({ url, options });
      const path = new URL(url).pathname + new URL(url).search;
      if (path.includes("/pulls?")) return json([]);
      if (path.includes("/git/ref/")) return response(404, {});
      if (path.endsWith("/git/refs") && options.method === "POST")
        return json({});
      if (path.includes("/contents/src/new.mjs?")) return response(404, {});
      if (path.endsWith("/contents/src/new.mjs"))
        return response(422, { message: "Invalid request" });
      if (
        path.endsWith("/git/refs/heads/adx%2Fpreview%2Fcase-1") &&
        options.method === "DELETE"
      )
        return response(204, {});
      throw new Error(`Unexpected ${options.method ?? "GET"} ${path}`);
    },
  });
  await assert.rejects(() => client.create({ plan, exported }), {
    code: "GITHUB_DRAFT_PR_CONFLICT",
  });
  assert.equal(
    calls.some(
      (call) =>
        call.options.method === "DELETE" &&
        call.url.includes("/git/refs/heads/adx%2Fpreview%2Fcase-1"),
    ),
    true,
  );
});

function json(value) {
  return response(200, value);
}
function response(status, value) {
  return { ok: status >= 200 && status < 300, status, json: async () => value };
}
