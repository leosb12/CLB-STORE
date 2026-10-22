# Memoria técnica de CLB Store

## Identidad y alcance
- Nombre oficial: CLB Store. Identificador técnico: `clb-store`.
- Toda nueva base, servicio, recurso, contenedor y configuración utilizará la identidad CLB. Nunca utilizar nombres anteriores.
- PostgreSQL: `clb_ventas`. MongoDB: `clb_inventario`. Futuras tablas DynamoDB y recursos Docker: prefijo `clb_`.
- Implementar solamente la fase solicitada. No anticipar futuras fases.
- La fase 1 comprende estructura y bases locales; no inicializar frameworks ni crear APIs, interfaces, Android, tablas de negocio, Ollama, TensorFlow, SAGA, GraphQL, n8n ni Keycloak.

## Microservicios definitivos
1. Ventas: Java + Spring Boot + PostgreSQL + DDD.
2. Inventario: PHP + Laravel + MongoDB + Hexagonal.
3. Clientes: TypeScript + Next.js + DynamoDB.
4. Inteligencia Artificial: Python + FastAPI + CLEAR.

Cada microservicio será un backend independiente con su propio proceso, API, pruebas y despliegue. Cada uno tendrá su responsabilidad y base privada; ninguno accederá directamente a la base de otro.

## Frontends
- Web principal: Angular.
- Microfrontend del probador virtual: React.
- Android: Flutter, organizado mediante Presentation, Domain y Data.
- No se requiere un frontend por microservicio.

## Inteligencia artificial
- Qwen3 4B local mediante Ollama.
- TensorFlow.js en navegador y TensorFlow Lite en Android.
- ML supervisado para recomendación de tallas y no supervisado para segmentación de clientes.
- Agentes con herramientas MCP y comandos de voz locales.
- Reportes generativos mediante lenguaje natural, GraphQL y datos reales.
- Deep Learning con TensorFlow para imágenes o video del probador virtual.

## Integración
- REST para funcionalidades cliente y GraphQL para consultas empresariales.
- API Gateway y SSO centralizado mediante Keycloak.
- SAGA para compras entre Ventas, Inventario y Clientes.
- Idempotencia en operaciones distribuidas y sincronización offline-first.
- n8n para automatización de eventos.

## Arquitecturas obligatorias
- DDD en Ventas: entidades, objetos de valor, agregados, reglas de dominio y repositorios mediante abstracciones; separar aplicación, dominio e infraestructura.
- Hexagonal en Inventario: núcleo independiente de Laravel, puertos de entrada y salida, adaptadores REST y MongoDB; dependencias hacia el dominio.
- CLEAR en Inteligencia Artificial: nombre confirmado por el docente. No asumir que significa Clean Architecture ni implementar su estructura interna definitiva hasta conocer la definición específica de clase.

## Reglas permanentes
- Código propio, carpetas, archivos, identificadores, dominio, bases, endpoints, errores, comentarios y textos en español y UTF-8.
- Usar ñ y caracteres españoles cuando sean técnicamente compatibles. Conservar palabras reservadas, nombres oficiales y nombres técnicos exigidos por herramientas.
- Las variables de entorno emplean `CLAVE`: Docker Compose restringe los nombres interpolados a identificadores ASCII; no utilizar variantes incorrectas de «contraseña».
- Evitar acoplamiento; no mezclar negocio e infraestructura.
- Diseñar desde el principio para offline-first.
- Separar desarrollo local y despliegue cloud mediante configuración.
- Aplicar pruebas reales por funcionalidad; no simular funcionalidades terminadas.
- No generar diagramas ICONIX ni documentación académica salvo solicitud explícita.
- No versionar secretos ni borrar volúmenes para pruebas.

## Operación local de bases
- Configuración en `infraestructura/bases-de-datos/`; ejecutar Compose desde esa carpeta.
- Copiar `.env.example` a `.env` y definir claves locales antes de ejecutar `docker compose config --quiet` y `docker compose up -d`.
- Publicar solamente en `127.0.0.1`; puertos configurables 5432, 27017 y 8000.
- En esta estación el puerto 5432 estaba ocupado; el `.env` local usa 5433 para PostgreSQL. `.env.example` conserva el predeterminado 5432. No detener servicios ajenos para liberar puertos.
- Volúmenes nombrados persistentes; no ejecutar `docker compose down -v`.
- MongoDB crea el usuario limitado a `clb_inventario` al inicializar un volumen vacío. El script es repetible: crea o actualiza el usuario sin borrar datos.
- Con volúmenes existentes, cambiar `.env` no rota contraseñas. Para repetir el script, autenticar una sesión administrativa de mongosh y cargar `/docker-entrypoint-initdb.d/inicializar-inventario.js`; el usuario de aplicación no debe recibir permisos administrativos.
- DynamoDB Local usa `-sharedDb` y `-dbPath`; las credenciales son ficticias y los clientes deben indicar explícitamente el endpoint local. No usar estas credenciales en cloud.
- DynamoDB Local ejecuta como UID 0 exclusivamente en desarrollo local para escribir en el volumen nombrado inicialmente propiedad de root; no montar directorios personales ni el socket Docker.
- Las pruebas solo pueden crear recursos temporales y deben limpiarlos después de verificar persistencia, sin borrar volúmenes.
- Ejecutar `python comprobar-bases.py` desde la carpeta de bases para verificar conexiones, permisos MongoDB, escritura y lectura UTF-8, reinicio, recreación y persistencia. Requiere Python y AWS CLI locales; solo llama al endpoint de DynamoDB en localhost. Si falla, conserva los recursos temporales para diagnóstico.

## Despliegue futuro
- PostgreSQL local → Supabase PostgreSQL.
- MongoDB local → MongoDB Atlas.
- DynamoDB Local → AWS DynamoDB.
- Imágenes de productos → Supabase Storage.
- Migrar con scripts, configuración y mecanismos reproducibles sin rediseñar entidades. No utilizar servicios cloud en la fase 1.

## Inventario — decisiones de la fase 2
- Laravel 13 con PHP 8.4 o posterior, ext-mongodb 2.5 y mongodb/laravel-mongodb 5.11; versiones resueltas en composer.lock.
- Núcleo propio en `microservicios/inventario/fuente/{Dominio,Aplicacion,Puertos}`; adaptadores y vinculación del contenedor en `Adaptadores` y `Configuracion`. Conservar nombres técnicos de archivos y directorios requeridos por Laravel, Composer y PHPUnit.
- Único caso implementado: RegistrarProducto; entrada `POST /api/v1/productos`. No añadir otros casos sin solicitud.
- Puerto HTTP local de Inventario: 18080, enlazado a 127.0.0.1; los puertos 8081–8085 estaban ocupados por procesos ajenos.
- Precio BOB recibido como texto decimal y persistido en `precio_centavos` entero. No convertir dinero a float. Fechas UTC.
- SKU normalizado a mayúsculas sin espacios exteriores; índice MongoDB único `clb_sku_unico`, creado idempotentemente antes de insertar. Colisiones de SKU → HTTP 409.
- Pruebas puras usan repositorio en memoria; integración y HTTP usan colecciones temporales `clb_prueba_*` en la misma base privada, con limpieza posterior. Nunca borrar la colección de productos para probar.
- En Windows la extensión puede cargarse con `ejecutar-php.ps1`; `preparar-php.ps1` obtiene el binario oficial para PHP 8.4 x64. `.herramientas` y `.env` son locales y no se versionan.

## Catálogo — decisiones de la fase 3
- Inventario añade únicamente ListarProductos y ConsultarProducto: `GET /api/v1/productos` y `GET /api/v1/productos/{identificador}`. Solo publica activos; orden fijo por nombre e identificador, límite máximo 100. Conservar el POST de la fase 2.
- Representación pública común: precio decimal en texto BOB, fechas UTC, `fecha_actualización` y `versión_sincronización`. Documentos anteriores se leen con actualización igual a creación y versión 1; no requieren migración destructiva.
- Angular 21.2 y TypeScript estricto en `aplicaciones/web/`; paquetes fijados en `package-lock.json`. Usar npm 11.6.2 si npm 10.9.2 falla al resolver dependencias opcionales. El lexer de plantillas Angular requiere acceder a propiedades con tildes y ñ mediante corchetes (`this['búsqueda']`); TypeScript sí admite estos identificadores.
- Desarrollo web en 127.0.0.1:4200 y previsualización PWA de producción en 127.0.0.1:14200; REST por proxy `/api` hacia Inventario en 18080. Configuración REST pública sin secretos en `public/configuracion.json`.
- IndexedDB `clb_catalogo`: productos, metadatos, favoritos y operaciones. Reemplazar el catálogo solo tras una descarga completa exitosa, en una transacción. El Service Worker almacena recursos locales; la API se consulta por red y la aplicación gestiona su persistencia.
- Favoritos locales y operación se guardan atómicamente. `CAMBIAR_FAVORITO` permanece pendiente sin intentos ni confirmaciones remotas mientras no exista servicio responsable. No registrar un procesador ficticio.
- Sincronización con comprobación REST real, backoff, reclamo transaccional y arrendamientos recuperables entre pestañas. Conservar UUID e idempotencia; los procesadores futuros deben respetar cancelación y tener deduplicación real en su backend.
- `clb:catalogo-demostracion` utiliza el registro existente, solo en local/testing y sin duplicar SKU. Pruebas PWA sobre producción con Chrome y perfil temporal aislado; no usar perfiles personales.

## Ejecución conjunta en Docker Desktop
- El Compose de `infraestructura/bases-de-datos/` conserva el proyecto `clb-store` y sus volúmenes; incluye las tres bases y las aplicaciones existentes, sin crear otros microservicios.
- `clb_backend_inventario` ejecuta Laravel/PHP 8.4 como usuario sin privilegios, con el servidor HTTP exclusivo para desarrollo local; MongoDB se resuelve como `mongo:27017` en la red de Compose.
- `clb_frontend_web_angular` sirve la compilación Angular PWA con Nginx sin privilegios en el puerto local 14200; `/api` se remite a `inventario:8000`. El backend conserva el puerto público local 18080. La web no pertenece a la red de bases.
- Cada imagen excluye `.env`, herramientas y dependencias del host y cachés generadas. `CLB_INVENTARIO_CLAVE_APLICACION` se genera una sola vez y se conserva exclusivamente en el `.env` local de Compose. No reemplaza ni rota claves de las bases.
- Iniciar o reconstruir desde la carpeta de Compose con `docker compose up -d --build --wait`. El grupo de Docker Desktop controla los cinco contenedores ya creados; los cambios de código requieren reconstruir las imágenes. Mantener `restart: unless-stopped`, dependencias saludables y etiquetas descriptivas `clb.componente`/`clb.tecnologia`.

## Administración — decisiones de la fase 4
- Panel en `/administracion/productos`. Reutiliza el POST de registro y añade `PUT /api/v1/productos/{identificador}`, `GET /api/v1/productos/administracion` y `GET /api/v1/productos/administracion/{identificador}`. PUT recibe todos los campos editables, `activo` booleano y `versión_esperada` como entero JSON positivo. No hay DELETE físico.
- POST y PUT administrativos requieren `Idempotency-Key` UUID v4. Cada modificación compara la versión atómicamente, incrementa una sola vez la versión y actualiza la fecha UTC. Conflicto de versión → 409 con `producto_actual`; reutilización de clave con otra solicitud → 409.
- Deduplicación durable en el mismo documento MongoDB: `clb_claves_operacion` e historial privado `clb_resultados_operacion`, con índice único multikey disperso `clb_operacion_unica`. Producto y comprobante se guardan en una escritura con journal; no depende de caché PHP ni de transacciones multidocumento/replica set. Repetir una clave devuelve la instantánea de su resultado original, incluso si después cambió el producto. No exponer estos campos internos por REST.
- Conservar comprobantes sin TTL ni eliminación automática. Límite local: 256 operaciones por producto para mantener el documento bajo el límite BSON; al alcanzarlo, rechazar nuevas modificaciones para revisión técnica sin descartar deduplicación. No rotar claves para forzar cambios ni vaciar historiales.
- Restricción temporal del servidor: solo `APP_ENV=local/testing`, bandera explícita `CLB_ADMINISTRACION_LOCAL_HABILITADA=true`, IP permitida en `CLB_ADMINISTRACION_REDES_LOCALES` y rechazo de origen externo/Fetch Metadata cross-site. Predeterminado deshabilitado; Compose permite únicamente loopback y redes privadas Docker y conserva la publicación en 127.0.0.1. Producción siempre devuelve 403, incluso con la bandera. Esto no autentica usuarios ni sustituye OIDC/Keycloak con rol ADMIN; la interfaz debe advertir NO APTA PARA PRODUCCIÓN.
- `AccesoAdministrativo` es el puerto de integración del futuro control OIDC/rol ADMIN; no crear autenticación alternativa. El adaptador REST Angular acepta un contrato de cabeceras para esa futura integración, actualmente sin credenciales inventadas.
- IndexedDB pasa a versión 2 agregando solo `productosAdministracion`. Se mantiene una única cola `operaciones`; `REGISTRAR_PRODUCTO` y `MODIFICAR_PRODUCTO` tienen procesadores REST reales, y favoritos siguen pendientes sin endpoint.
- Las propuestas no sustituyen datos confirmados. Conservar UUID, idempotencia y versión esperada entre reintentos. Confirmación y respuesta se guardan juntas localmente; releer catálogo REST para altas/activaciones, porque un comprobante idempotente puede ser histórico. Conflictos y 403/422 quedan en REQUIERE_REVISION; corregir requiere una operación nueva y conserva el antecedente mediante `reemplazadaPor`.
- Si se agotan reintentos temporales, la confirmación es incierta: `motivoRevision=REINTENTOS_AGOTADOS`. La revisión manual debe reintentar la misma operación y conservar UUID, clave, versión y datos; no preparar una clave nueva mientras se desconoce el resultado. El repositorio impide sustituir esa operación incierta por otra propuesta del mismo producto.
- Las pruebas administrativas de navegador usan producción servida en 14201 y backend local aislado en 18081 con colección `clb_prueba_web_*`; se limpia exclusivamente esa colección mediante un script que valida el nombre. Nunca escribir ni borrar productos reales para pruebas. Las pruebas anteriores conservan sus aserciones; su soporte HTTP añade una clave válida por POST conforme al nuevo contrato.


## Variantes, existencias y carrito — decisiones de la fase 5
- El SKU original sigue identificando comercialmente al producto; cada variante tiene UUID v4 y SKU propio, único entre todas las variantes. `clb:migrar-variantes` marca el esquema sin modificar el contrato, crear variantes ni inferir tallas, colores o saldos. Es repetible; los productos originales se conservan.
- MongoDB continúa standalone. El agregado `clb_existencias` comparte la colección privada configurada con los productos, pero no tiene `identificador` comercial ni aparece en sus consultas. Contiene variantes, saldos, movimientos, reservas y eventos. Una escritura condicional por revisión, con journal, confirma todo el agregado y su comprobante: las reservas de varias variantes son indivisibles. No se usan transacciones multidocumento ni bloqueos con vencimiento para proteger stock.
- Reutiliza `OperacionAdministrativa`, `clb_claves_operacion`, `clb_resultados_operacion` y el mismo índice único global `clb_operacion_unica`, también entre productos y existencias. El índice de SKU de variantes es `clb_sku_variante_unico`; el dominio comprueba la unicidad interna del agregado y CAS resuelve carreras. Nunca eliminar comprobantes, movimientos o eventos para continuar operando.
- Límite local: 256 operaciones por variante, incluyendo creación; se reserva espacio para terminar las reservas activas. El agregado se limita a 8 MiB BSON, incluyendo margen para terminaciones, antes del límite MongoDB de 16 MiB. Superarlo exige particionar técnicamente el adaptador conservando deduplicación y auditoría; no es una solución de escala de producción.
- Las cantidades son enteros de 0 a 1000000000; los movimientos requieren cantidad positiva y motivo. AJUSTE exige sentido INCREMENTO/DISMINUCION. Saldo disponible = física − reservada, nunca negativo. No modificar SKU/talla/color con historial o reservas; no desactivar con reservas activas. Movimientos, mínimos y ediciones usan versión esperada de variante.
- Reservas: UUID v4, referencia externa de pedido y hasta 50 variantes distintas. ACTIVA → CONSUMIDA o LIBERADA. Las terminaciones repetidas no vuelven a alterar stock; estados incompatibles dan 409. La misma clave devuelve la instantánea original, incluso histórica. El carrito no reserva stock. No se implementó Ventas, Clientes ni una SAGA completa.
- API interna `/api/v1/interno/*` utiliza el puerto `AccesoInternoInventario`, restringido al mismo modo local explícito; falta identidad verificable entre servicios. Administración y reservas siempre bloqueadas en producción, sin autenticación falsa.
- `stock_bajo` se persiste al cruzar desde disponibilidad superior al mínimo hacia el mínimo o menos (incluye subir el umbral). Eventos pendientes en el mismo agregado y escritura, consultables por la API interna; no hay consumidor n8n ni alertas automáticas.
- IndexedDB versión 3 añade variantes públicas/administrativas, movimientos descargados y carrito a `clb_catalogo`; conserva todos los almacenes anteriores y la única cola. El carrito guarda UUID/SKU y precio de referencia en centavos; los totales se calculan con bigint. Es editable offline y no genera pedidos, pagos ni reservas.
- La cola añade CREAR_VARIANTE, MODIFICAR_VARIANTE, REGISTRAR_MOVIMIENTO y CONFIGURAR_MINIMO. UUID de variante asignado en el dispositivo y enviado al servidor. Las dependencias se resuelven antes del reclamo transaccional; la versión se toma del comprobante confirmado del antecedente y se conserva tras el primer envío. No enviar dependientes de conflictos; una corrección explícita conserva el antecedente y redirige solo dependientes no enviados. Confirmación incierta mantiene UUID, clave, datos y versión.
- Las nuevas pruebas de navegador comparten la infraestructura aislada 18081/14201 y `clb_prueba_web_*`, sin escribir productos reales. La prueba operacional PHP reinicia únicamente `clb_mongo`, comprueba saldos/reservas/comprobantes/eventos y limpia solo su colección temporal; ejecutar la suite backend sin otras pruebas simultáneas que dependan de MongoDB.
