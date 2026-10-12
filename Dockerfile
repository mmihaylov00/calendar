# syntax=docker/dockerfile:1
# Calendar: multi-stage image (build the web UI, then a slim runtime with production deps only).

# ---- build ---------------------------------------------------------------------------------
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY tsconfig.json vite.config.ts ./
COPY web ./web
COPY server ./server
RUN npm run build

# ---- runtime -------------------------------------------------------------------------------
FROM node:22-alpine
ARG MARCO_RUNTIME_USER=node
LABEL org.opencontainers.image.title="Calendar" \
      org.opencontainers.image.description="Calendar dashboard with Home Assistant calendars, weather and photos." \
      org.opencontainers.image.source="https://github.com/mmihaylov00/calendar" \
      org.opencontainers.image.licenses="MIT"
# Container updates are managed outside Calendar; the admin never offers an in-process update button.
ENV NODE_ENV=production \
    MARCO_INSTALL=docker \
    PORT=3000 \
    DATA_DIR=/data
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force
COPY server ./server
COPY deploy/start-container.js ./deploy/start-container.js
COPY --from=build /app/dist ./dist
RUN mkdir -p /data && chown node:node /data
USER ${MARCO_RUNTIME_USER}
VOLUME ["/data"]
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "deploy/start-container.js"]
