# syntax=docker/dockerfile:1

# One image: the API and the built dashboard on a single port.
#
#   docker build -t pg-durable-dashboard .
#   docker run --rm -p 127.0.0.1:4000:4000 -v pgdd-data:/data pg-durable-dashboard
#
# Node 24 because the connection store uses node:sqlite, which still needs
# --experimental-sqlite on 22.
ARG NODE_VERSION=24-alpine@sha256:d32cdf619f63fe0471182d08996dd516c6275bb5fd31ae06e55a570bd9e1ad43

FROM node:${NODE_VERSION} AS client
WORKDIR /app/client
COPY client/package.json client/package-lock.json ./
RUN npm ci
COPY client/ ./
RUN npm run build

FROM node:${NODE_VERSION} AS server
WORKDIR /app/server
COPY server/package.json server/package-lock.json ./
RUN npm ci
COPY server/ ./
RUN npm run build

# Production dependencies only, resolved from the same lockfile.
FROM node:${NODE_VERSION} AS deps
WORKDIR /app/server
COPY server/package.json server/package-lock.json ./
RUN npm ci --omit=dev

FROM node:${NODE_VERSION} AS runtime
ENV NODE_ENV=production \
    PORT=4000 \
    # Loopback would make the server unreachable from outside the container, so
    # the container boundary is the exposure control instead: publish to
    # 127.0.0.1 on the host, or put an authenticating proxy in front.
    HOST=0.0.0.0 \
    DATA_DIR=/data \
    CLIENT_DIR=/app/public

WORKDIR /app

# package.json comes along because it declares "type": "module" — without it
# Node reads the compiled ESM output as CommonJS and refuses to start.
COPY --from=server /app/server/package.json ./package.json
COPY --from=deps /app/server/node_modules ./node_modules
COPY --from=server /app/server/dist ./dist
COPY --from=client /app/client/dist ./public

# The connection store and its generated key live here; mount a volume to keep
# them across upgrades. /app is owned by the runtime user too, so a relative
# DATA_DIR still resolves somewhere writable instead of failing at first write.
RUN mkdir -p /data && chown -R node:node /data /app
VOLUME /data

USER node
EXPOSE 4000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||4000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "dist/index.js"]
