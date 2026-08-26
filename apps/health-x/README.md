# Health-X

Health-X is a small, fictional personal-care dashboard used to demonstrate a governed ADX delivery slice. It is a TanStack Start application that runs entirely with mock data in the browser.

It is not a clinical system. It does not collect, transmit, persist, or make decisions about real health information, and it does not provide medical advice.

## The initial application

The initial Health-X application establishes a deliberately small foundation:

- a server-rendered TanStack Start shell;
- a responsive personal-care dashboard;
- fictional sample data for one person, appointments, medications, and care tasks; and
- a clear non-clinical data notice.

The application has no login, API, database, analytics, or external network dependency. That keeps the reference delivery safe to run locally and makes its behavior easy to inspect.

## The three delivered features

ADX records the work as three independently reviewable Change Cases:

1. **Upcoming care:** shows the next fictional appointment and permits a browser-local check-in state.
2. **Medication check-in:** lets a user mark two fictional medications as taken for the current browser session.
3. **Today’s care plan:** provides a small, browser-local checklist of fictional wellbeing tasks.

All state resets on refresh. The feature labels in the UI make this delivery scope visible.

## Run Locally

From the ADX Studio repository root:

```bash
npm install
npm run health-x:dev
```

Open the address printed by Vinxi, normally <http://127.0.0.1:3000>.

Build a production artifact:

```bash
npm run health-x:build
```

The Node server entrypoint is produced at `apps/health-x/.output/server/index.mjs`.

From the standalone Health-X repository root, install through the approved corporate registry and use the project-local scripts:

```bash
npm ci --registry=https://edgeinternal1uhg.optum.com/artifactory/api/npm/tenant-compass-npm-vir/ --no-audit --no-fund
npm run build
```

## Run the production artifact

After building, run the output directly:

```bash
PORT=3000 node apps/health-x/.output/server/index.mjs
```

Open <http://127.0.0.1:3000>. Stop the process with `Ctrl+C`.

## Container deployment

Health-X container builds use the corporate Artifactory npm virtual registry. The ADX preview service passes `ADX_PREVIEW_NPMRC_FILE` as a Docker BuildKit secret, so the configured file must contain the corporate npm authentication required by Artifactory. Do not copy that file into the repository, candidate, or image.

Build the container from the repository root with your authenticated npm configuration mounted only for the dependency-install layer:

```bash
docker build --secret id=npmrc,src="$HOME/.npmrc" -f apps/health-x/Dockerfile -t health-x:local .
docker run --rm -p 3000:3000 health-x:local
```

Open <http://127.0.0.1:3000>. This is a local, non-production deployment demonstration. It does not configure a cloud provider, a domain, TLS termination, monitoring, backups, authentication, or a database because Health-X has no server-side data.

## Recreate from scratch

Health-X is tracked source, not a generated artifact. The clean reconstruction path is:

```bash
git clone https://github.com/ravikumarraman-cell/ad-studio.git
cd ad-studio
npm install
npm run health-x:build
PORT=3000 node apps/health-x/.output/server/index.mjs
```

To restore a locally deleted or modified Health-X directory after the Health-X files are committed, run:

```bash
git restore --source=HEAD --worktree -- apps/health-x
```

Then repeat `npm run health-x:build`. Do not use `git restore` when you need to preserve uncommitted Health-X changes.

## Verification

Run the production acceptance suite:

```bash
npm run verify:health-x
```

Health-X now also owns the equivalent project-local command:

```bash
npm --prefix apps/health-x run verify:production
```

This command builds the application, runs the generated Node server on an isolated local port, verifies the browser flows and refresh-reset behavior, and checks for browser console errors or external browser requests. It passed in an independent fresh clone of `ravikumarraman-cell/health-x` after `npm ci` through the corporate Artifactory registry on Node 22.19.0.

`verify:health-x` builds Health-X, starts the production Node output on an isolated local port, and uses a real browser to verify the rendered shell, appointment check-in, medication and care-plan state changes, refresh-reset behavior, the fictional-data notice, and the absence of external browser requests. It then shuts the server down. For a human acceptance check, start the output and verify that the page renders these visible points:

- `Health-X` appears in the header.
- `Upcoming care` exposes the check-in action and changes state when selected.
- `Medication check-in` updates its counter after an item is marked.
- `Today’s care plan` updates its counter after an item is marked.
- The footer states that the application uses fictional data and does not retain health information.

The governed-delivery record and review expectations live in [Health-X ADX delivery record](../../docs/health-x-adx-delivery.md).
