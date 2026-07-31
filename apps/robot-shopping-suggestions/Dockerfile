# syntax=docker/dockerfile:1

FROM node:22-bookworm-slim AS build

WORKDIR /app

ENV CAMOUFOX_INSTALL_DIR=/opt/camoufox

RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json* ./
RUN npm ci

# camoufox-js lists GitHub releases via api.github.com — unauthenticated calls
# are rate-limited (~60/h). Pass GITHUB_TOKEN as a build-arg when builds fail here.
ARG GITHUB_TOKEN
ENV GITHUB_TOKEN=${GITHUB_TOKEN}

RUN mkdir -p "${CAMOUFOX_INSTALL_DIR}" \
    && for attempt in $(seq 1 10); do \
         echo "==> camoufox fetch (attempt ${attempt}/10)" \
         && npx camoufox-js fetch && exit 0; \
         echo "camoufox fetch failed, retrying in 15s..."; \
         sleep 15; \
       done \
    && echo "camoufox fetch failed after 10 attempts — set GITHUB_TOKEN build-arg (gh auth token)" >&2 \
    && exit 1

COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN npm run build \
    && npm prune --omit=dev

# ── Runtime ───────────────────────────────────────────────────────────────────
FROM node:22-bookworm-slim AS runtime

WORKDIR /app

ENV NODE_ENV=production \
    CAMOUFOX_INSTALL_DIR=/opt/camoufox \
    CAMOUFOX_HEADLESS=true

# Camoufox / Playwright Firefox system deps
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    fonts-liberation \
    libasound2 \
    libatk-bridge2.0-0 \
    libatk1.0-0 \
    libcups2 \
    libdbus-1-3 \
    libdrm2 \
    libgbm1 \
    libgtk-3-0 \
    libnspr4 \
    libnss3 \
    libx11-xcb1 \
    libxcomposite1 \
    libxdamage1 \
    libxrandr2 \
    libxshmfence1 \
    xvfb \
    && rm -rf /var/lib/apt/lists/*

COPY --from=build /app/package.json /app/package-lock.json* ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /opt/camoufox /opt/camoufox

RUN useradd --system --uid 10001 --create-home appuser \
    && chown -R appuser:appuser /app /opt/camoufox
USER appuser

CMD ["node", "dist/main.js"]
