# ─── Stage 1: Builder ────────────────────────────────────────────────────────
FROM node:22-alpine AS builder
WORKDIR /app

# Install deps first (maximizes layer cache)
COPY package*.json ./
COPY prisma ./prisma
RUN npm ci

# Generate Prisma client (writes to node_modules/.prisma + node_modules/@prisma/client)
RUN npx prisma generate

# Compile TypeScript + resolve path aliases
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# Remove devDependencies (prisma CLI stays — it's now a prod dep)
RUN npm prune --omit=dev

# ─── Stage 2: Production image ───────────────────────────────────────────────
FROM node:22-alpine AS runner
WORKDIR /app

# Non-root user for security
RUN addgroup -S appgroup && adduser -S appuser -G appgroup

# Copy only what the runtime needs
COPY --from=builder --chown=appuser:appgroup /app/node_modules ./node_modules
COPY --from=builder --chown=appuser:appgroup /app/dist        ./dist
COPY --chown=appuser:appgroup prisma  ./prisma
COPY --chown=appuser:appgroup package.json ./

USER appuser

EXPOSE 8080

CMD ["node", "dist/server.js"]
