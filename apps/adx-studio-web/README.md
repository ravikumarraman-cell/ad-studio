# ADX Health Authorization Demo

An end-to-end, fictional prior-authorization workflow that demonstrates how ADX can govern high-impact health-insurance operations.

## What it demonstrates

- creation of a prior-authorization request;
- a transparent state progression from intake through evidence and human review;
- policy-governed actions that are available only at the correct stage;
- an evidence-completeness signal and a tamper-evident-style activity ledger;
- a human-only determination step, with approval or denial recorded as an auditable outcome.

It also contains the first ADX feature-delivery vertical slice: a health-insurance feature backlog can be imported from CSV, selected, and advanced through Change Case creation, scope, design, bounded execution, independent verification, controlled release, and recorded outcome. Download the sample from the app or use [the three-feature sample](public/samples/adx-health-insurance-features.csv).

This is a product demo, not a clinical decision-support system. It uses mock data only, does not process PHI, and does not automate coverage or medical determinations.

## Run it

Preferred React/TanStack development path:

```bash
cd apps/adx-studio-web
npm install
npm run dev
```

Open the address printed by Vite (normally `http://localhost:5173`).

No-install path: open [standalone.html](standalone.html) in a modern browser, or serve this folder with any static HTTP server. This single-file version has the same interactive workflow for demos where package installation is unavailable.

## Demonstration path

1. Open **PA-20478** and select **Seal evidence packet**.
2. On the resulting human-review step, record a fictional approval or denial.
3. Create a new request and use **Start governed intake**, then **Seal evidence packet**.
4. Inspect the activity ledger after each action.

The current implementation provides the Stage 0/vertical-slice UI demonstration. Production work must replace in-memory mock state with the ADX control plane, real authorization, encrypted evidence storage, and independently verified policy/evidence services.
