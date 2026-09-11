# Candidate dashboard launcher

This starts the shared `cloud-asset-inventory` candidate with a local runtime-config and API proxy. It does not write credentials or modify the candidate workspace.

## Prerequisites

- Candidate dependencies are installed:

  ```bash
  cd /Users/rraviku2/adx-cloud-asset-inventory-candidate/frontend
  npm install
  ```

- An Entra SPA app registration has `http://127.0.0.1:5173` configured as a redirect URI.
- Your account has the needed Tenant Compass group membership.
- The approved Inventory API allows requests from the local origin, or is accessed through an approved local API gateway.

## Run

From the `ad-studio` repository:

```bash
CAI_AZURE_CLIENT_ID='<Entra SPA client ID>' \
CAI_AZURE_AUTHORITY='https://login.microsoftonline.com/<tenant ID>' \
CAI_API_URL='https://<approved inventory API origin>' \
node scripts/start-cloud-asset-inventory-candidate-dashboard.mjs
```

Open `http://127.0.0.1:5173/`. The app should redirect you through Microsoft sign-in, then return to the dashboard.

To stop it, press `Ctrl+C` in the terminal.

## Candidate screens

- Dashboard: `http://127.0.0.1:5173/`
- Before comparison: `http://127.0.0.1:5173/demo/funding-before`
- After comparison: `http://127.0.0.1:5173/demo/funding`
- Real onboarding: `http://127.0.0.1:5173/tenant-onboard/<tenantId>`

The comparison routes deliberately bypass MSAL. The dashboard and onboarding routes use the runtime config and MSAL flow.
