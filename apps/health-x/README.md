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

## Run locally

From the repository root:

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

## Run the production artifact

After building, run the output directly:

```bash
PORT=3000 node apps/health-x/.output/server/index.mjs
```

Open <http://127.0.0.1:3000>. Stop the process with `Ctrl+C`.

## Container deployment

Build the container from the repository root:

```bash
docker build -f apps/health-x/Dockerfile -t health-x:local .
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

Run the production build first:

```bash
npm run health-x:build
npm run verify:health-x
```

`verify:health-x` starts the built Node output on an isolated local port, verifies the rendered shell, all three feature surfaces, and the fictional-data notice, then shuts the server down. For a human acceptance check, start the output and verify that the page renders these visible points:

- `Health-X` appears in the header.
- `Upcoming care` exposes the check-in action and changes state when selected.
- `Medication check-in` updates its counter after an item is marked.
- `Today’s care plan` updates its counter after an item is marked.
- The footer states that the application uses fictional data and does not retain health information.

The governed-delivery record and review expectations live in [Health-X ADX delivery record](../../docs/health-x-adx-delivery.md).