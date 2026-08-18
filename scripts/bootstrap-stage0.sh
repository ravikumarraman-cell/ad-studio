#!/usr/bin/env bash
set -euo pipefail
export PATH="/opt/homebrew/opt/node@22/bin:${PATH}"
node --version
npm install --legacy-peer-deps --no-audit --no-fund
docker compose up -d postgres minio
docker compose ps
echo 'Stage 0 dependencies are running. Start API: npm --workspace=@adx/api run dev'
