import { useEffect } from "react";

const featureIdPattern = /^[a-z][a-z0-9-]{1,63}$/;

export function FeatureSpotlightBridge() {
  useEffect(() => {
    const featureId =
      new URLSearchParams(window.location.search).get("adx-feature") ?? "";
    if (!featureIdPattern.test(featureId)) return;
    const selector = `[data-adx-feature="${featureId}"]`;
    const targets = [...document.querySelectorAll<HTMLElement>(selector)];
    if (!targets.length) return;
    const className = "adx-feature-spotlight";
    for (const target of targets) target.classList.add(className);
    targets[0].scrollIntoView({ behavior: "smooth", block: "center" });
    return () => {
      for (const target of targets) target.classList.remove(className);
    };
  }, []);
  return null;
}
