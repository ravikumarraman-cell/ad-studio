FROM node:22-alpine AS build

WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/health-x/package.json apps/health-x/package.json
RUN npm ci --ignore-scripts

COPY apps/health-x apps/health-x
RUN npm --workspace=@adx/health-x run build

FROM node:22-alpine

WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
COPY --from=build /app/apps/health-x/.output ./.output

EXPOSE 3000
CMD ["node", ".output/server/index.mjs"]