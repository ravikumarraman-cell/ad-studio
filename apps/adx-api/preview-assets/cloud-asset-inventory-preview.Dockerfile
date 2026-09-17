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
