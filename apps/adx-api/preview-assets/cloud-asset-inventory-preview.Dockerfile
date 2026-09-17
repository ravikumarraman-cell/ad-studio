ARG NODE_IMAGE=node:22-alpine
ARG NGINX_IMAGE=nginx:alpine

FROM ${NODE_IMAGE} AS build

USER root
WORKDIR /app
ENV PATH=/app/node_modules/.bin:$PATH
ARG environment=stage
ARG NPM_REGISTRY
ARG VITE_BASE_URL=/preview-api/
ENV VITE_BASE_URL=${VITE_BASE_URL}
COPY package.json package-lock.json ./
RUN --mount=type=secret,id=npmrc,target=/root/.npmrc \
    npm ci --registry "$NPM_REGISTRY"
COPY . .
RUN npm run build -- --mode ${environment}

FROM ${NGINX_IMAGE}

ARG PREVIEW_API_ORIGIN=https://api-tenant-compass-stg.optum.com
COPY --from=build /app/dist /usr/share/nginx/html

# This configuration exists only in the ADX local-preview image. Browser API
# calls stay same-origin and Nginx forwards the bearer token to the configured
# staging API, so local CORS policy is not part of the demonstration.
RUN printf '%s\n' \
  'server {' \
  '  listen 80;' \
  '  root /usr/share/nginx/html;' \
  '  index index.html;' \
  '  location /assets/ { try_files $uri =404; expires 1y; add_header Cache-Control "public, max-age=31536000, immutable"; }' \
  '  # Preview-only read models for routes introduced by the retained candidate.' \
  '  # Staging does not contain these unshipped endpoints yet.' \
  '  location ~ ^/preview-api/tenant/details/[^/]+/onboarding-funding$ {' \
  '    default_type application/json;' \
  "    return 200 '{\"status\":true,\"data\":{\"status\":\"FUNDED\",\"accountStatus\":\"FUNDED\",\"checkedAt\":\"2026-09-17T00:00:00Z\",\"isHistorical\":false,\"source\":\"local_preview_fixture\"}}';" \
  '  }' \
  '  location = /preview-api/dashboard/funding {' \
  '    default_type application/json;' \
  "    return 200 '{\"status\":true,\"data\":{\"total\":1,\"FUNDED\":1,\"UNFUNDED\":0,\"UNKNOWN\":0,\"source\":\"local_preview_fixture\"}}';" \
  '  }' \
  '  location = /preview-api/tenant_lifecycle {' \
  '    default_type application/json;' \
  "    return 200 '{\"status\":true,\"data\":[{\"tenant_id\":\"024347479226\",\"tenant_name\":\"Demo funded tenant\",\"org_name\":\"Tenant Compass\",\"tenant_owner\":\"demo@optum.com\",\"cloud_service_provider\":\"Azure\",\"attestation_status\":\"Completed\",\"account_aide_funding_status\":\"FUNDED\",\"account_aide_funding_checked_at\":\"2026-09-17T00:00:00Z\",\"cloud_guru_access\":\"Enabled\",\"prisma_dspm_percentage\":100,\"prisma_cspm_percentage\":100,\"prisma_cwp_percentage\":100,\"central_logging_percentage\":100}]}';" \
  '  }' \
  '  location /preview-api/ {' \
  "    proxy_pass ${PREVIEW_API_ORIGIN}/;" \
  '    proxy_set_header Host $proxy_host;' \
  '    proxy_set_header Authorization $http_authorization;' \
  '    proxy_set_header X-Forwarded-Proto $scheme;' \
  '    proxy_ssl_server_name on;' \
  '  }' \
  '  location / { try_files $uri $uri/ /index.html; }' \
  '}' > /etc/nginx/conf.d/default.conf

EXPOSE 80
ENTRYPOINT ["nginx", "-g", "daemon off;"]
