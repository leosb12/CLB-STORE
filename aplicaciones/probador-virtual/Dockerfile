# syntax=docker/dockerfile:1
# Microfrontend del probador virtual: build y despliegue independientes del shell Angular.
FROM node:22.15.0-bookworm-slim AS compilacion
WORKDIR /aplicacion/clb_probador
COPY package.json package-lock.json ./
RUN npx --yes npm@11.6.2 ci --no-audit --no-fund
COPY . .
# El modelo MoveNet versionado debe coincidir con sus hashes (MODELO-MOVENET.md) antes de publicarse.
RUN cd public/modelos/movenet-lightning-4 && sha256sum -c ../../../modelos.sha256
RUN cd public/modelos && sha256sum -c ../../modelos-semanticos.sha256
RUN cd public/modelos && sha256sum -c ../../modelos-blazepose.sha256
RUN npm run build

FROM nginx:stable-alpine AS aplicacion
COPY infraestructura/nginx.conf /etc/nginx/nginx.conf
COPY --from=compilacion /aplicacion/clb_probador/dist /usr/share/nginx/html/probador
USER nginx
EXPOSE 8080
ENTRYPOINT ["nginx", "-g", "daemon off;"]
