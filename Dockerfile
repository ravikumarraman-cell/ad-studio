FROM node:22.19.0-bookworm-slim

RUN apt-get update \
  && apt-get install --yes --no-install-recommends docker.io git ca-certificates \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /workspace

COPY package.json package-lock.json ./
COPY apps/adx-api/package.json apps/adx-api/package.json
COPY apps/adx-studio-web/package.json apps/adx-studio-web/package.json
COPY apps/health-x/package.json apps/health-x/package.json
COPY apps/tanstack-start-canary/package.json apps/tanstack-start-canary/package.json
COPY packages/domain/package.json packages/domain/package.json
COPY packages/identity/package.json packages/identity/package.json
RUN npm ci

COPY . .

CMD ["npm", "run", "api:start"]