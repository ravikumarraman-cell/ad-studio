export function featureSpotlightFromEvents(events) {
  for (const event of [...(events ?? [])].reverse()) {
    for (const artifact of event?.artifacts ?? []) {
      if (artifact?.mediaType !== "application/vnd.adx.feature-spotlight+json")
        continue;
      const value = artifact.metadata;
      if (
        typeof value?.featureId === "string" &&
        typeof value?.title === "string" &&
        typeof value?.summary === "string"
      )
        return Object.freeze({
          featureId: value.featureId,
          title: value.title,
          summary: value.summary,
        });
    }
  }
  return null;
}