# syntax=docker/dockerfile:1
FROM node:24-bookworm-slim AS compilacion
WORKDIR /app
COPY package.json package-lock.json ./
RUN --mount=type=cache,id=clb_npm,target=/root/.npm npm ci --no-audit --no-fund
COPY tsconfig.json ./
COPY fuente ./fuente
COPY pruebas ./pruebas
RUN npx tsc -p tsconfig.json && npm prune --omit=dev

FROM node:24-bookworm-slim AS aplicacion
ENV NODE_ENV=production
WORKDIR /app
COPY --from=compilacion /app/package.json ./
COPY --from=compilacion /app/node_modules ./node_modules
COPY --from=compilacion /app/dist/fuente ./dist/fuente
USER node
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=8s --start-period=20s --retries=10 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.CLB_CLIENTES_PUERTO_INTERNO||3000)+'/salud').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/fuente/principal.js"]
