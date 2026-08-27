const maxItems = 50;

/**
 * Builds review-friendly Markdown only from retained ADX data. The resulting
 * text is stored in the preview plan and included in its digest before any
 * GitHub mutation is allowed.
 */
export function buildDraftPrDescription({
  changeCase,
  governance,
  storyPublication,
  evidence,
  exported,
}) {
  const stories = Array.isArray(governance?.stories?.stories)
    ? governance.stories.stories
    : [];
  const publishedByStory = new Map(
    (storyPublication?.syncs ?? []).map((sync) => [sync.storyKey, sync]),
  );
  const changedFiles = Array.isArray(exported?.changes) ? exported.changes : [];
  const acceptanceCriteria = lines(governance?.intent?.acceptanceCriteria);
  const verifier = [evidence?.verifierId, evidence?.verifierVersion]
    .filter(Boolean)
    .join(" · ");

  return [
    "## What changed",
    `**${text(changeCase?.title, "Verified ADX candidate")}**`,
    storyList(stories),
    "## Why",
    acceptanceCriteria.length
      ? acceptanceCriteria.map((item) => `- ${item}`).join("\n")
      : "- The retained Intake contract did not include a separate acceptance-criteria field.",
    "## Scope",
    changedFiles.length
      ? changedFiles
          .slice(0, maxItems)
          .map(
            (change) =>
              `- \`${text(change.path)}\` — ${text(change.operation, "MODIFY").toLowerCase()}`,
          )
          .join("\n") +
        (changedFiles.length > maxItems
          ? `\n- …and ${changedFiles.length - maxItems} more file(s)`
          : "")
      : "- No files were retained in the export.",
    "## Validation",
    `- **PASS** — Gate D independent verification${verifier ? ` (${verifier})` : ""}.`,
    `- Verifier command: ${command(evidence?.command)}.`,
    "## Traceability",
    `- Change Case: \`${text(changeCase?.id)}\``,
    governance?.stories?.storyDigest
      ? `- Approved story contract: \`${text(governance.stories.storyDigest)}\``
      : "- No approved story contract was retained.",
    traceability(stories, publishedByStory),
    "<details>",
    "<summary>Technical provenance</summary>",
    "",
    `- Candidate: \`${text(evidence?.candidateDigest)}\``,
    `- Independent evidence: \`${text(evidence?.evidenceDigest)}\``,
    `- Export: \`${text(exported?.exportDigest)}\``,
    `- Base commit: \`${text(exported?.baseCommit)}\``,
    `- Verifier command digest: \`${text(evidence?.commandDigest)}\``,
    "",
    "</details>",
  ].join("\n\n");
}

function storyList(stories) {
  if (!stories.length)
    return "- No approved stories were retained for this Change Case.";
  return stories
    .slice(0, maxItems)
    .map((story) => `- **${text(story.key)}** — ${text(story.title)}`)
    .join("\n");
}

function traceability(stories, publishedByStory) {
  const links = stories
    .map((story) => ({ story, sync: publishedByStory.get(story.key) }))
    .filter(({ sync }) => typeof sync?.issueUrl === "string" && sync.issueUrl)
    .slice(0, maxItems);
  if (!links.length)
    return "- GitHub story issues: not published for this Change Case.";
  return [
    "- GitHub story issues:",
    ...links.map(
      ({ story, sync }) =>
        `  - [${text(story.key)} — ${text(story.title)}](${sync.issueUrl}) · milestone #${text(sync.milestoneNumber)}`,
    ),
  ].join("\n");
}

function command(value) {
  if (!Array.isArray(value) || !value.length)
    return "not available in this retained evidence bundle";
  return `\`${value.map((part) => text(part).replace(/`/g, "\\`")).join(" ")}\``;
}

function lines(value) {
  return text(value)
    .split("\n")
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, maxItems);
}

function text(value, fallback = "not retained") {
  const normalized = String(value ?? "")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .trim();
  return normalized || fallback;
}
