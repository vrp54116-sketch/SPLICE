# SPLICE — one container, free forever, zero required keys.
FROM node:22-bookworm-slim

ENV DEBIAN_FRONTEND=noninteractive \
    NODE_ENV=production \
    PORT=3001 \
    SPLICE_SCRATCH=/tmp/splice

# ffmpeg (with drawtext), fonts for burned captions, curl for the yt-dlp binary.
RUN apt-get update -qq && apt-get install -y --no-install-recommends \
      ffmpeg \
      fontconfig \
      fonts-dejavu-core \
      fonts-liberation \
      curl \
      ca-certificates \
      python3 \
    && rm -rf /var/lib/apt/lists/*

# Standalone yt-dlp release binary — no pip needed in the runtime image.
RUN curl -fsSL -o /usr/local/bin/yt-dlp \
      https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux \
    && chmod +x /usr/local/bin/yt-dlp

WORKDIR /app

# public/ and scripts/ must exist before postinstall: it synthesizes the 6 music loops there.
COPY package.json package-lock.json ./
COPY public ./public
COPY scripts ./scripts
RUN npm ci && npm cache clean --force

COPY tsconfig.json tsconfig.server.json vite.config.ts index.html ./
COPY shared ./shared
COPY src ./src

# Type-check both projects, build the server bundle and the SPA, then drop
# build-only dependencies so the final image stays small.
RUN npm run typecheck \
    && npm run build \
    && npm prune --omit=dev

# Run unprivileged; scratch stays in world-writable /tmp.
RUN useradd --create-home --uid 10001 splice \
    && mkdir -p /tmp/splice && chown -R splice:splice /tmp/splice /app
USER splice

EXPOSE 3001
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3001)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "dist-server/index.mjs"]
