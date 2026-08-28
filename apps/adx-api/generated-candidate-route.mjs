import { renderCandidateBrowserPage } from "./candidate-browser-page.mjs";

export async function handleGeneratedCandidateRoute({
  response,
  traceId,
  session,
  workspaceId,
  changeCaseId,
  candidateRoot,
  sourceRoot,
  url,
  writeHtml,
}) {
  return writeHtml(
    response,
    200,
    await renderCandidateBrowserPage({
      candidateRoot,
      sourceRoot,
      baseUrl: `/v1/workspaces/${encodeURIComponent(workspaceId)}/change-cases/${encodeURIComponent(changeCaseId)}/generated-candidate`,
      verificationUrl: `/v1/workspaces/${encodeURIComponent(workspaceId)}/change-cases/${encodeURIComponent(changeCaseId)}/evidence-review`,
      requestedPath: url.searchParams.get("path") ?? "",
    }),
    traceId,
    session.principal,
  );
}