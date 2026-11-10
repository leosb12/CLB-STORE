# CLB Store en Google Cloud

La VM clb-store está en us-central1-a. El proyecto Compose clb-gcp conserva los volúmenes de PostgreSQL de SSO, n8n, recursos y TLS entre entregas. El borde Caddy gestiona los certificados y Nginx conserva el enrutamiento de la API. El editor de n8n escucha en loopback de la VM.

Desde el repositorio local, ejecutar en PowerShell:

    .\infraestructura\gcp\actualizar.ps1

El comando empaqueta los archivos de trabajo rastreados de los componentes de GCP, transfiere una entrega por SSH, construye las imágenes y comprueba los servicios con Compose. Si falla el arranque y hay una entrega anterior, restaura sus etiquetas de imagen y su configuración. Los volúmenes no se migran ni se revierten con el código. La ruta de la entrega activa en la VM se obtiene con readlink ~/.clb-gcp/activa.

La configuración privada está en .env en la entrega activa. CLB_MONGO_URI admite una URI mongodb+srv con TLS y un usuario readWrite limitado a clb_inventario. En Atlas, autorizar solo 35.208.191.124/32. CLB_CLIENTES_URL, CLB_VENTAS_URL, CLB_IA_URL y CLB_VTON_URL definen los destinos externos. Los destinos pendientes devuelven error de disponibilidad. Conservar los secretos de SSO y n8n entre entregas.

DNS en Namecheap: los nombres store, probador, api y auth apuntan por registros A a 35.208.191.124. Caddy usa los puertos 80 y 443 para emitir y renovar TLS. El probador conserva el flujo integrado del shell en /probador.

El borde permite a 52.162.217.223 acceder a las rutas internas de Inventario para eventos, reservas y procesamiento de prendas. La regla usa la IP de la conexión TCP y Laravel conserva la validación del JWT y del rol. Mantener api en modo Solo DNS para que el borde reciba la IP de origen.

Para el motor fotográfico remoto, configurar `CLB_VTON_URL=https://clb-vton.leonardoserrate.xyz`, `CLB_VTON_ACCESS_ID` y `CLB_VTON_ACCESS_SECRETO` en el `.env` privado. El generador añade las cabeceras de Access únicamente para ese destino y conserva la verificación TLS. Si el túnel o su origen falla, salud y las rutas fotográficas responden `503 VTON_NO_DISPONIBLE`. Comprobar primero `/salud/probador` por la pasarela y, si falla, revisar el origen del túnel en la máquina GPU.

El generador aplica Host y Access a cada `proxy_pass $vton`, tanto salud como trabajos: la ruta de trabajos tiene
un bloque OPTIONS anidado y no admite el reemplazo genérico de locations. Validado el 10-nov-2026 con `nginx -t`,
recarga sin reiniciar servicios y una fotografía de prueba enviada desde la APK release del Samsung: trabajo
LISTO e imagen visible sin conexión. El túnel sin Access y la API de trabajos sin JWT devolvieron 401.
Conservar las credenciales solo en el `.env` y la configuración privada generada; no agregarlas a clientes web/móvil.

## Tablero de inteligencia de negocios (`https://store.leonardoserrate.xyz/bi/`)

Servicio `bi` (Dash, imagen `clb_bi:gcp`), en el mismo origen que la tienda: Caddy → web → pasarela → `bi:8050`. Usa el
Keycloak de esta VM (cliente confidencial `clb-bi`, código + PKCE) y lee IA de Azure por la pasarela. `preparar.py`
**agrega** al `.env` `CLB_IDENTIDAD_SECRETO_BI` y `CLB_BI_SECRETO_SESION` solo si faltan. `cliente-bi.sh` crea o actualiza
el cliente con el administrador existente, y `actualizar.sh` lo ejecuta en cada entrega. `actualizar.ps1` incluye
`aplicaciones/inteligencia-negocios` aunque no esté rastreado.

Primera puesta en marcha (10-nov-2026), dirigida y sin `actualizar.sh` completo:
1. Respaldo en `~/.clb-gcp/respaldos/bi-20261110-1823` e imagen `clb_web:gcp-previo-bi`.
2. Archivos del BI copiados sobre la entrega activa y `preparar.py` ejecutado.
3. `build web bi`, `bash cliente-bi.sh` y `up -d --no-deps --wait bi web`; el corte de la web fue de unos 8 s.
4. `nginx -s reload` de la pasarela.

Keycloak, n8n, Inventario, probador y borde no se reiniciaron.

Volver atrás:
```bash
R=~/.clb-gcp/respaldos/bi-20261110-1823; E=$(readlink -f ~/.clb-gcp/activa)
cp -a $R/compose.generado.yaml $R/privado $E/ && sudo docker tag clb_web:gcp-previo-bi clb_web:gcp
cd $E && sudo docker compose -f compose.generado.yaml up -d --no-deps web && sudo docker rm -f clb_frontend_bi_dash
sudo docker exec clb_pasarela nginx -s reload
```

