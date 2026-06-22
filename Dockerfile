FROM node:24-bookworm-slim AS builder

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build
RUN npm prune --omit=dev

FROM node:24-bookworm-slim AS runner

WORKDIR /app

ENV NODE_ENV=production

LABEL org.opencontainers.image.source="https://github.com/WGJ-Fry/lifeos-ai"
LABEL org.opencontainers.image.description="LifeOS - A local AI that answers what you're forgetting from Markdown notes."
LABEL org.opencontainers.image.licenses="MIT"

COPY --from=builder /app/package*.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist

EXPOSE 3000

CMD ["npm", "run", "start"]
