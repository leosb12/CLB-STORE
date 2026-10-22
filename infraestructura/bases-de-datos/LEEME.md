# CLB Store en Docker Desktop

Los cinco contenedores pertenecen al mismo grupo **clb-store**:

| Contenedor | Responsabilidad | Acceso desde esta estación |
| --- | --- | --- |
| `clb_frontend_web_angular` | Catálogo Angular PWA compilado, servido por Nginx | http://127.0.0.1:14200 |
| `clb_backend_inventario` | Backend REST de Inventario, PHP 8.4 + Laravel 13 | http://127.0.0.1:18080/api/v1/productos |
| `clb_mongo` | Base privada `clb_inventario` de Inventario | 127.0.0.1:27017 |
| `clb_postgres` | Base privada `clb_ventas` de Ventas | 127.0.0.1:5433 en esta estación |
| `clb_dynamodb` | Base local de Clientes | http://127.0.0.1:8000 |

Ventas y Clientes todavía no tienen backend implementado; aquí solo se ejecutan sus bases existentes. Los comentarios y las etiquetas `clb.componente` y `clb.tecnologia` identifican cada servicio en Compose y en la inspección de Docker Desktop.

Con Docker Desktop iniciado, ejecutar desde **esta carpeta**:

```powershell
docker compose config --quiet
docker compose up -d --build --wait
```

Después de la primera creación, el botón de iniciar/detener del grupo **clb-store** en Docker Desktop controla todo junto. Por consola, `docker compose stop` detiene los cinco y `docker compose up -d --wait` vuelve a iniciarlos. Si cambia el código, usar de nuevo `up -d --build --wait` para reconstruir las aplicaciones.

La web se abre en http://127.0.0.1:14200/catalogo. Es la compilación PWA de producción: después de la primera descarga permite trabajar offline. No hace falta iniciar PHP, Node ni Angular por separado en Windows. El backend utiliza el servidor HTTP local de Laravel dentro de Docker; esta configuración corresponde exclusivamente al desarrollo local.

Configuración en `.env`, nunca en el repositorio. Conserva las claves actuales de las bases: cambiarlas aquí no rota usuarios en volúmenes existentes. Los puertos de aplicaciones son opcionales (`CLB_WEB_PUERTO` y `CLB_INVENTARIO_PUERTO`); sus valores predeterminados son 14200 y 18080. `CLB_INVENTARIO_CLAVE_APLICACION` es una clave independiente de Laravel que se genera una vez, se conserva en `.env` y no reemplaza ninguna clave de MongoDB.

En una instalación nueva, copiar `.env.example` a `.env`, completar las claves y generar la de Laravel con `php -r "echo 'base64:'.base64_encode(random_bytes(32));"`. Si no hay PHP local, se puede generar sin mostrarla en los argumentos de un contenedor temporal: `docker run --rm --name clb_generar_clave php:8.4-cli-bookworm php -r "echo 'base64:'.base64_encode(random_bytes(32));"`. Pegar el resultado en la variable correspondiente del archivo local.

Comprobación de estado y diagnóstico:

```powershell
docker compose ps
docker compose logs --tail=50 inventario web
```

MongoDB debe estar saludable antes de arrancar Inventario; su control de salud verifica REST y acceso real a MongoDB. La web arranca después de Inventario. Nginx remite `/api` al backend en la red interna; el navegador nunca accede directamente a las bases. Solo se publican puertos en `127.0.0.1`.

Los volúmenes de las bases conservan sus nombres originales. **No ejecutar `docker compose down -v`.** Las imágenes excluyen `.env`, dependencias del host, herramientas de Windows y cachés locales. No se cargan datos de demostración automáticamente; para hacerlo explícitamente, ejecutar `docker compose exec inventario php artisan clb:catalogo-demostracion`.

El panel de la fase 4 está en http://127.0.0.1:14200/administracion/productos. La bandera `CLB_ADMINISTRACION_LOCAL_HABILITADA` está habilitada explícitamente en el `.env` de esta estación; su valor de ejemplo/predeterminado es `false`. Las escrituras y lecturas administrativas se rechazan en producción incluso con la bandera. Las redes permitidas por Compose corresponden a loopback y Docker privado; no modificar la publicación en 127.0.0.1 para exponer este modo. **No hay autenticación de usuarios: NO APTO PARA PRODUCCIÓN.**


La fase 5 se ejecuta en los mismos cinco contenedores. El panel ahora incluye variantes y movimientos de stock; el detalle público permite elegir variantes y `/carrito` mantiene una selección offline sin reservar unidades. Los endpoints internos de reservas continúan restringidos al desarrollo local. La migración repetible `docker compose exec inventario php artisan clb:migrar-variantes` conserva los ocho productos y no inventa tallas, colores ni existencias. Las pruebas de variantes/reservas usan colecciones temporales aisladas; la suite backend incluye reinicio controlado de `clb_mongo` para verificar persistencia sin borrar volúmenes.
