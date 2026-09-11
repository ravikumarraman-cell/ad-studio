#!/usr/bin/env node

/**
 * Starts the shared cloud-asset-inventory candidate as a complete local SPA:
 *   browser -> http://127.0.0.1:5173 -> this proxy -> Vite / approved API
 *
 * Required environment variables:
 *   CAI_AZURE_CLIENT_ID   Entra SPA application (client) ID
 *   CAI_AZURE_AUTHORITY   e.g. https://login.microsoftonline.com/<tenant-id>
 *   CAI_API_URL           Approved inventory API base URL
 */
import { createServer, request as httpRequest } from 'node:http';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const publicPort = Number(process.env.CAI_PORT || 5173);
const vitePort = Number(process.env.CAI_VITE_PORT || 5174);
const candidateFrontend = resolve(
  process.env.CAI_CANDIDATE_FRONTEND ||
    '/Users/rraviku2/adx-cloud-asset-inventory-candidate/frontend',
);
const required = ['CAI_AZURE_CLIENT_ID', 'CAI_AZURE_AUTHORITY', 'CAI_API_URL'];
const missing = required.filter((name) => !process.env[name]?.trim());

if (missing.length) {
  console.error(`Missing required environment variables: ${missing.join(', ')}`);
  console.error('Copy the command in scripts/README-candidate-dashboard.md and replace its placeholders.');
  process.exit(1);
}
if (!existsSync(candidateFrontend)) {
  console.error(`Candidate frontend not found: ${candidateFrontend}`);
  process.exit(1);
}

const apiOrigin = new URL(process.env.CAI_API_URL);
const config = JSON.stringify({
  AzureClientId: process.env.CAI_AZURE_CLIENT_ID,
  AzureAuthority: process.env.CAI_AZURE_AUTHORITY,
  wowApiUrl: `http://127.0.0.1:${publicPort}`,
  appInsightsConnectionString: '',
});

const vite = spawn('npm', ['run', 'start', '--', '--host', '127.0.0.1', '--port', String(vitePort)], {
  cwd: candidateFrontend,
  stdio: 'inherit',
  // The config loader constructs apiClient before runtime config exists.  Give
  // it this same-origin base for that bootstrap request; runtime config then
  // supplies the durable wowApiUrl value.
  env: {...process.env, VITE_BASE_URL: `http://127.0.0.1:${publicPort}`},
  shell: process.platform === 'win32',
});

const isBrowserNavigation = (req) => (req.headers.accept || '').includes('text/html');
const stripHopByHop = (headers) => {
  const copy = {...headers};
  for (const name of ['connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization', 'te', 'trailers', 'transfer-encoding', 'upgrade']) delete copy[name];
  return copy;
};

function proxy(req, res, target) {
  const upstream = httpRequest(target, {
    method: req.method,
    headers: {...req.headers, host: target.host},
  }, (upstreamResponse) => {
    res.writeHead(upstreamResponse.statusCode || 502, stripHopByHop(upstreamResponse.headers));
    upstreamResponse.pipe(res);
  });
  upstream.on('error', (error) => {
    if (!res.headersSent) res.writeHead(502, {'content-type': 'application/json'});
    res.end(JSON.stringify({error: 'UPSTREAM_UNAVAILABLE', message: error.message}));
  });
  req.pipe(upstream);
}

const server = createServer((req, res) => {
  const requestUrl = new URL(req.url || '/', `http://127.0.0.1:${publicPort}`);
  if (requestUrl.pathname === '/config/config.json') {
    res.writeHead(200, {'content-type': 'application/json', 'cache-control': 'no-store'});
    res.end(config);
    return;
  }

  // Browser navigations and Vite assets come from Vite. XHR/fetch requests go
  // to the configured inventory API while preserving their path and query.
  const target = isBrowserNavigation(req) || requestUrl.pathname.startsWith('/@') || requestUrl.pathname.startsWith('/src/') || requestUrl.pathname.startsWith('/node_modules/')
    ? new URL(req.url || '/', `http://127.0.0.1:${vitePort}`)
    : new URL(`${requestUrl.pathname}${requestUrl.search}`, apiOrigin);
  proxy(req, res, target);
});

server.listen(publicPort, '127.0.0.1', () => {
  console.log(`Candidate dashboard: http://127.0.0.1:${publicPort}/`);
  console.log(`Before screen:      http://127.0.0.1:${publicPort}/demo/funding-before`);
  console.log(`After screen:       http://127.0.0.1:${publicPort}/demo/funding`);
});

function shutdown() {
  server.close();
  vite.kill('SIGTERM');
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
vite.on('exit', (code) => {
  if (code && code !== 0) console.error(`Vite exited with status ${code}.`);
  server.close();
});
