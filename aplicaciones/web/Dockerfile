# syntax=docker/dockerfile:1
FROM node:22.15.0-bookworm-slim AS compilacion
WORKDIR /aplicacion/clb_web
COPY package.json package-lock.json ./
RUN npx --yes npm@11.6.2 ci --no-audit --no-fund
COPY . .
ARG CLB_IDENTIDAD_AUTORIDAD
RUN if [ -n "$CLB_IDENTIDAD_AUTORIDAD" ]; then \
      node -e "const fs = require('node:fs'); const ruta = 'public/configuracion.json'; const config = JSON.parse(fs.readFileSync(ruta)); config.identidad.autoridad = process.env.CLB_IDENTIDAD_AUTORIDAD; fs.writeFileSync(ruta, JSON.stringify(config));"; \
    fi
RUN npm run build

FROM nginx:stable-alpine AS aplicacion
COPY infraestructura/nginx.conf /etc/nginx/nginx.conf
COPY infraestructura/cabeceras-seguridad.conf /etc/nginx/cabeceras-seguridad.conf
COPY --from=compilacion /aplicacion/clb_web/dist/clb-store/browser /usr/share/nginx/html
USER nginx
EXPOSE 8080
ENTRYPOINT ["nginx", "-g", "daemon off;"]
