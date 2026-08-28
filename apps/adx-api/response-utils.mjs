import { adxPageThemeCss } from "./adx-page-theme.mjs";
import { escapeHtml } from "./review-page-utils.mjs";

export function write(response, status, body, traceId) {
  response.statusCode = status;
  response.setHeader("content-type", "application/json");
  response.setHeader("cache-control", "no-store");
  response.setHeader("x-trace-id", traceId);
  response.end(JSON.stringify({ ...body, traceId }));
}

export function uiRedirectLocation(value) {
  try {
    const url = new URL(value || "http://127.0.0.1:4173/");
    if (!["http:", "https:"].includes(url.protocol))
      throw new Error("invalid protocol");
    return url.toString();
  } catch {
    return "http://127.0.0.1:4173/";
  }
}

export function realWorkspaceLocation(value) {
  const url = new URL(uiRedirectLocation(value));
  url.searchParams.set("mode", "real");
  return url.toString();
}

function signedInIndicator(principal) {
  const identity =
    String(
      principal?.displayName ??
        principal?.id?.split(":").at(-1) ??
        "Authenticated user",
    ).trim() || "Authenticated user";
  return `<aside class="signed-in-indicator" aria-label="Signed in as ${escapeHtml(identity)}"><span>Signed in</span><strong>${escapeHtml(identity)}</strong></aside>`;
}

export function authenticatedPageNavigation(principal) {
  return `<a class="workspace-return-link" href="${escapeHtml(realWorkspaceLocation(process.env.ADX_UI_ORIGIN))}">Return to workspace</a>${signedInIndicator(principal)}`;
}

const accessiblePageFoundation = `${adxPageThemeCss}<style id="adx-accessibility-foundation">p,.muted{color:var(--adx-copy)}.eyebrow{font-size:.75rem;letter-spacing:.12em;font-weight:700;color:var(--adx-muted)}input,select,textarea{color:var(--adx-ink);background:var(--adx-surface);border-color:var(--adx-line)}input::placeholder,textarea::placeholder{color:var(--adx-muted);opacity:1}.error{color:var(--adx-danger)}.workspace-return-link{position:fixed;top:12px;left:16px;z-index:10;display:inline-block;padding:6px 10px;border:1px solid var(--adx-line);border-radius:8px;background:var(--adx-surface);box-shadow:0 1px 4px #14213d14;color:var(--adx-brand-deep);font-size:.78rem;font-weight:700;text-decoration:none}.workspace-return-link:hover{background:var(--adx-surface-soft)}.signed-in-indicator{position:fixed;top:12px;right:16px;z-index:10;display:flex;gap:6px;align-items:baseline;max-width:calc(100vw - 32px);padding:6px 10px;background:var(--adx-surface);border:1px solid var(--adx-line);border-radius:8px;box-shadow:0 1px 4px #14213d14;color:var(--adx-copy);font-size:.78rem}.signed-in-indicator strong{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--adx-ink);font-weight:700}@media (max-width:600px){.workspace-return-link,.signed-in-indicator{position:static;width:max-content;max-width:calc(100% - 32px);margin:10px 16px 0}.signed-in-indicator strong{max-width:14rem}}</style>`;

export function writeHtml(response, status, html, traceId, principal = null) {
  response.statusCode = status;
  response.setHeader("content-type", "text/html; charset=utf-8");
  response.setHeader("cache-control", "no-store");
  response.setHeader("x-trace-id", traceId);
  response.end(
    html
      .replace("</head>", `${accessiblePageFoundation}</head>`)
      .replace(
        /<body([^>]*)>/,
        `<body$1>${principal ? authenticatedPageNavigation(principal) : ""}`,
      ),
  );
}