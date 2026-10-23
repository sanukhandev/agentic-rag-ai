FROM node:22-bookworm-slim@sha256:c3de60bf2f9dd0ac6370e6117950ff62d6e339527e7472301c9c78a017978392 AS node-deps
WORKDIR /workspace
COPY package.json package-lock.json ./
COPY apps/admin/package.json apps/admin/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/chat-utils/package.json packages/chat-utils/package.json
COPY packages/contracts/package.json packages/contracts/package.json
COPY services/api/package.json services/api/package.json
RUN npm ci

FROM node-deps AS node-source
COPY tsconfig.base.json ./
COPY apps ./apps
COPY packages ./packages
COPY services ./services

FROM node-source AS api-build
RUN npm run build --workspace services/api

FROM node-deps AS api-runtime-deps
RUN npm prune --omit=dev

FROM node:22-bookworm-slim@sha256:c3de60bf2f9dd0ac6370e6117950ff62d6e339527e7472301c9c78a017978392 AS api-runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=api-runtime-deps /workspace/node_modules ./node_modules
COPY --from=api-build /workspace/services/api/package.json ./services/api/package.json
COPY --from=api-build /workspace/services/api/dist ./services/api/dist
USER node
EXPOSE 4000
CMD ["node", "services/api/dist/index.js"]

FROM node-source AS web-build
ARG NEXT_PUBLIC_API_URL=/
ENV NEXT_PUBLIC_API_URL=${NEXT_PUBLIC_API_URL}
RUN npm run build --workspace packages/chat-utils
RUN npm run build --workspace apps/web

FROM node:22-bookworm-slim@sha256:c3de60bf2f9dd0ac6370e6117950ff62d6e339527e7472301c9c78a017978392 AS web-runtime
ENV NODE_ENV=production
ENV PORT=3000
WORKDIR /app
COPY --from=web-build /workspace/apps/web/.next/standalone ./
COPY --from=web-build /workspace/apps/web/.next/static ./apps/web/.next/static
EXPOSE 3000
CMD ["node", "apps/web/server.js"]

FROM node-source AS admin-build
ARG ADMIN_BASE_HREF=/admin/
RUN npm run build --workspace packages/chat-utils
RUN npm run build --workspace apps/admin -- --base-href="${ADMIN_BASE_HREF}"

FROM nginx:1.27-alpine@sha256:65645c7bb6a0661892a8b03b89d0743208a18dd2f3f17a54ef4b76fb8e2f2a10 AS admin-runtime
COPY infra/nginx/admin.conf /etc/nginx/conf.d/default.conf
COPY --from=admin-build /workspace/apps/admin/dist/admin/browser /usr/share/nginx/html
EXPOSE 80

FROM python:3.12-slim@sha256:a6e34c598f2467ed0e9a8d349809fcd8b5c603269512df273a0bb1784edc11b1 AS ingestion-runtime
WORKDIR /app
COPY tools/ingestion/requirements.txt ./requirements.txt
RUN apt-get update && apt-get install -y --no-install-recommends tesseract-ocr tesseract-ocr-eng tesseract-ocr-ara && rm -rf /var/lib/apt/lists/* && pip install --no-cache-dir -r requirements.txt
COPY tools/ingestion/ingestion ./ingestion
ENTRYPOINT ["python", "-m", "ingestion.worker"]
