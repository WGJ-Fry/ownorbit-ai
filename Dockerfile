FROM node:24-bookworm-slim AS builder

WORKDIR /app

ENV ELECTRON_SKIP_BINARY_DOWNLOAD=1
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build
RUN npm prune --omit=dev

FROM node:24-bookworm-slim AS runner

WORKDIR /app

ENV NODE_ENV=production

LABEL org.opencontainers.image.source="https://github.com/WGJ-Fry/ownorbit-ai"
LABEL org.opencontainers.image.description="OwnOrbit - A local AI that answers what you're forgetting from Markdown notes."
LABEL org.opencontainers.image.licenses="MIT"

COPY --from=builder /app/package*.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist

EXPOSE 3000

CMD ["npm", "run", "start"]
