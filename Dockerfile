
FROM node:22-alpine AS builder
WORKDIR /app


COPY package*.json ./
COPY prisma ./prisma
RUN npm ci


RUN npx prisma generate


COPY tsconfig.json ./
COPY src ./src
RUN npm run build


RUN npm prune --omit=dev


FROM node:22-alpine AS runner
WORKDIR /app


RUN addgroup -S appgroup && adduser -S appuser -G appgroup


COPY --from=builder --chown=appuser:appgroup /app/node_modules ./node_modules
COPY --from=builder --chown=appuser:appgroup /app/dist        ./dist
COPY --chown=appuser:appgroup prisma  ./prisma
COPY --chown=appuser:appgroup prisma.config.ts ./
COPY --chown=appuser:appgroup package.json ./

USER appuser

EXPOSE 8080

CMD ["node", "dist/server.js"]
