FROM node:24-bookworm-slim AS base
RUN npm install --global pnpm@11.25.0
RUN apt-get update && apt-get install --yes --no-install-recommends ffmpeg ca-certificates && rm -rf /var/lib/apt/lists/*
FROM base AS build
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY patches ./patches
COPY apps/api/package.json ./apps/api/package.json
COPY apps/member/package.json ./apps/member/package.json
COPY apps/native/package.json ./apps/native/package.json
RUN --mount=type=cache,id=mangumi-pnpm,target=/root/.local/share/pnpm/store pnpm install --frozen-lockfile
COPY . .
RUN pnpm build:live
RUN pnpm --filter @mangumi/api deploy --prod --legacy /runtime/api
FROM base AS application
WORKDIR /app
COPY --from=build --chown=node:node /runtime/api ./apps/api
COPY --from=build --chown=node:node /app/apps/member/dist-live ./apps/member/dist-live
COPY --from=build --chown=node:node /app/apps/member/src/model.ts /app/apps/member/src/features.ts /app/apps/member/src/dates.ts ./apps/member/src/
ENV NODE_ENV=production PORT=3001 WEB_ROOT=/app/apps/member/dist-live UPLOAD_DIR=/data/uploads FFPROBE_PATH=/usr/bin/ffprobe
RUN mkdir -p /data/uploads && chown -R node:node /data
USER node
WORKDIR /app/apps/api
EXPOSE 3001
HEALTHCHECK --interval=30s --timeout=5s CMD node -e "fetch('http://127.0.0.1:3001/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "--import", "tsx", "src/main.ts"]
