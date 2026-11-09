# Casos de uso

## CU01 — Autenticarse y gestionar perfil

Actor: Cliente o Administrador. Objetivo: acceder a funciones autorizadas con una identidad compartida. Precondición: Keycloak disponible para iniciar una sesión nueva. Disparador: seleccionar Iniciar sesión. Postcondición exitosa: sesión OIDC y perfil vinculados al mismo `sub`.

Curso básico:
1. La aplicación solicita autenticación por Authorization Code y PKCE.
2. Keycloak autentica al usuario y devuelve el código al URI registrado.
3. La aplicación valida el retorno y obtiene sesión; muestra capacidades según roles.
4. El usuario consulta o modifica su perfil con versión esperada.
5. Cada servicio verifica token y autorización antes de aceptar la solicitud.

Alternativos: sin red no se inicia sesión nueva; se permite lectura pública ya descargada. Token vencido: renovar con identidad disponible o conservar escritura pendiente. Rol insuficiente: 403 sin aplicar cambios. Perfil modificado concurrentemente: 409, actualizar y decidir nueva edición. Al cerrar sesión, eliminar datos administrativos locales y evitar enviar operaciones con otra cuenta.

No afirmar SSO nativo entre todas las aplicaciones sin el ensayo correspondiente: la identidad y el realm son compartidos, pero cada cliente conserva su propio flujo OIDC.

## CU02 — Consultar catálogo, probar ropa y recomendar talla

Actor: Cliente. Precondición: catálogo descargado para operar sin conexión; para el probador también código, modelo de pose y recurso de prenda. Disparador: abrir catálogo/detalle. Postcondición: visualización y recomendación local; ningún pedido o reserva creado.

Curso básico:
1. La aplicación muestra catálogo persistido e indica su fecha.
2. Cuando el servidor responde, descarga páginas y texturas verificadas y activa el paquete completo.
3. El usuario busca/filtra, abre detalle y elige una variante.
4. Abre el probador, autoriza cámara o selecciona foto.
5. MoveNet local detecta articulaciones. En modo regiones, el renderer coloca la prenda mediante anclas. En modo material preparado, una máscara semántica local y el compositor transfieren tejido y diseño sobre la camiseta base.
6. Con medidas introducidas por el usuario, el modelo de tallas calcula probabilidades y disponibilidad.

Alternativos: corte durante descarga conserva paquete anterior. Hash/cuota incorrectos no activan recursos. Cámara denegada permite foto de archivo. Puntos insuficientes o inclinación excesiva: orientar al usuario, sin inventar ajuste. Modelo de talla ausente: tabla de referencia, no falsa predicción. Talla/color no disponibles: informar. Abandonar vista cierra cámara y descarta resultados tardíos.

Límites: 2D frontal, sin simulación física ni oclusión de brazos; en los modos locales, fotografías personales y medidas no se transmiten. La extensión generativa opcional tiene un flujo y aviso de privacidad propios. Favoritos son locales mientras no exista procesador remoto responsable.

## CU03 — Gestionar carrito y confirmar compra distribuida

Actor: Cliente autenticado. Precondición: variantes conocidas; la confirmación comercial requiere servicios disponibles. Disparador: Confirmar pedido. Postcondición local: solicitud durable con UUID/claves estables y carrito vaciado atómicamente. Postcondición remota exitosa: un pedido confirmado, stock consumido y puntos acreditados una sola vez.

Curso básico:
1. Agregar variante/cantidad y revisar total referencial en centavos.
2. Confirmar crea operación y pedido con identidad estable en la cola del titular.
3. La sincronización envía la misma clave a Ventas.
4. Ventas obtiene datos/precios autorizados y persiste pedido/pasos.
5. Reserva stock en Inventario, acredita puntos en Clientes y consume reserva.
6. Confirma pedido, registra outbox y devuelve estado.
7. El cliente guarda respuesta y posteriormente consulta comprobante generado por n8n.

Alternativos: offline conserva PENDIENTE_LOCAL, nunca muestra compra hecha. Stock insuficiente cancela. Falla definitiva de Clientes libera reserva y revierte puntos. Respuesta perdida se consulta/reintenta con mismas claves. Falla temporal o estado incierto queda en revisión/reanudación. Cambio de cuenta impide enviar solicitudes del titular previo. Rechazo definitivo permite devolver líneas al carrito una vez, conservando el antecedente.

## CU04 — Administrar catálogo e inventario

Actor: Administrador. Precondición: rol validado; los cambios offline se guardan como propuestas hasta confirmación. Disparador: alta, edición, variante o movimiento. Postcondición: estado confirmado con versión y comprobante idempotente; registro de existencias consistente.

Curso básico:
1. Registrar o editar nombre, SKU, categoría, descripción, precio y actividad.
2. Crear variantes con talla/color/SKU; registrar entradas/salidas con motivo.
3. Guardar propuesta y enviar UUID, Idempotency-Key y versión esperada.
4. Inventario valida reglas y confirma estado/comprobante en una escritura atómica.
5. La aplicación relee el catálogo vigente y muestra existencias.

Transporte (R5, 9-nov-2026): la interfaz de gestión envía cada paso como consulta o mutación del GraphQL de gestión; IA lo delega al contrato de Inventario con el JWT del administrador, la misma Idempotency-Key y la versión esperada. Inventario sigue validando las reglas. La foto de CU04.9 se carga por REST (transferencia de archivo); consultar el trabajo y publicar van por GraphQL.

Alternativos: SKU duplicado, valores inválidos o rol insuficiente no modifican datos. GraphQL de gestión no disponible (IA caída): la propuesta queda en la cola y se reintenta con la misma clave; la lectura usa la copia guardada. Versión concurrente devuelve conflicto y conserva propuesta. Confirmación incierta conserva la clave; no preparar otra hasta resolverla. Desactivación retira producto del catálogo público sin borrarlo físicamente. Límite de historial exige revisión técnica; no eliminar deduplicación para continuar.

### CU04.9 — Preparar y publicar fotografía de prenda (ingesta con estándar de calidad)

Extiende CU04. Actor: Administrador. Colaborador: worker IA. Precondición: rol admin, conexión al servidor local, worker de
prendas activo y categoría de prenda superior, inferior o de cuerpo completo. Postcondición exitosa: recurso por hash
publicado con su informe de calidad, su modelo 3D y su espalda cuando se pudieron construir. La versión del producto sube
una sola vez.

1. El administrador lee la guía de foto: una sola prenda, de frente, fondo liso, margen y mangas o perneras separadas.
2. Elige la foto y el color representado, y la envía con la versión esperada y una clave estable.
3. Inventario valida tipo, tamaño y dimensiones, y guarda el original privado y un trabajo durable.
4. El worker reclama el trabajo con su token de servicio. Quita el fondo con U²-Net, o usa el alfa propio si la foto ya
   viene recortada, y normaliza a 768×1024.
5. Construye el modelo 3D (torso, mangas o perneras) y deduce la espalda.
6. Mide la silueta y aplica el estándar de calidad (`calidad_prenda.py`): lo grave bloquea y lo menor avisa.
7. Inventario verifica el PNG, la espalda y el contrato cerrado de `modelo3d` y `calidad`. Deja el trabajo LISTO (apta o
   con avisos) o en REQUIERE_REVISION (no apta, con cada motivo).
8. El administrador revisa la vista previa y el informe: bloqueos y avisos primero, con su medida y su objetivo.
9. Publica con control de versión y clave idempotente. Si hay avisos, debe marcar «Entiendo los avisos»
   (`aceptar_avisos`).
10. Web y Android descargan y verifican la textura y la espalda antes de activar la nueva generación offline.

Alternativos:
- Foto no apta → REQUIERE_REVISION con sus motivos; «Elegir otra fotografía».
- Publicar con avisos sin aceptarlos → 409 `AVISOS_SIN_ACEPTAR`.
- Un resultado LISTO que el worker declara `no_apta` → 422: nunca se publica.
- Prenda superior sin modelo 3D → aviso: se publica sin RA y con foto con IA.
- Pantalón sin dos perneras → bloqueo.
- Entrada inválida → 422. Categoría no soportada conserva el recurso previo.
- Timeout → ERROR. Si el worker cae, el trabajo se puede reclamar cuando vence.
- Otra foto sustituye el trabajo y descarta resultados tardíos. Producto editado antes de publicar → 409.
- Repetir la publicación no vuelve a subir la versión.

## CU05 — Monitorear empresa y generar reportes

Actor: Administrador. Precondición: acceso de gestión y modelo de lectura disponible. Disparador: misión por texto/voz, por ejemplo «monitorea mi negocio». Postcondición: reporte/resultado auditado con fecha de datos e interpretación legible; exportación xlsx o PDF con los mismos datos guardados cuando se solicita.

Curso básico:
1. Elegir misión y, si corresponde, destino y formato del reporte.
2. STT local convierte voz a texto; el LLM local propone especificación estructurada.
3. Validar métricas, herramientas y autorización mediante listas cerradas.
4. Agentes consultan herramientas MCP que ejecutan GraphQL sobre la proyección analítica.
5. Calcular/verificar cifras de forma determinista; mostrar resultado, interpretación («qué se entendió») y fecha de actualización.
6. Opcional: el administrador ajusta métricas extra (hasta 2 columnas), agrupación, filtros (categoría, talla, color, producto), periodo o rango de fechas (≤ 366 días, sin fechas futuras), orden, gráfico y límite; la especificación editada se valida igual que una interpretada y se recalcula.
7. Guardar reporte/historial y exportar xlsx o PDF (mismas filas, filtros y periodo que la pantalla).

Alternativos: petición de SQL/herramienta ajena se rechaza y audita. LLM apagado permite respuestas no generativas donde exista plantilla. Modelo de lectura caído impide afirmar cifras nuevas; no consultar bases ajenas como atajo. Misión concurrente 429. Voz no transcrita permite texto. Petición sin ningún término de ventas, prendas o periodo → AMBIGUA con sugerencias, sin inventar un reporte. Sin ventas en el periodo/filtros → estado vacío explícito. Datos con más de 15 min sin sincronizar → aviso de antigüedad. Consulta que excede 5 s → se cancela (statement_timeout). Una propuesta de reposición requiere confirmación administrativa explícita antes de escribir en Inventario.

Automatización relacionada: stock bajo genera alerta persistente; pedido confirmado inicia comprobante entre Ventas, Clientes e Inventario. n8n caído conserva cursor y reentrega idempotente; no se representa como interacción humana obligatoria.

### CU02 — Alternativos específicos del material

Precondiciones adicionales: recurso de Poleras preparado con zonas de estampado analizadas, modelos semántico/pose descargados e íntegros y fotografía frontal con camiseta base uniforme, luz suficiente y borde distinguible del pantalón. El selector aparece antes del visor. El cliente calcula máscara, borde y luz localmente; conserva piel/cabello y objetos que pueda delimitar. No se usa ajuste por SKU, identidad ni coordenadas de una foto concreta. Muestra el estado de material separado de confianza de pose y talla.

Sin metadatos de estampado se conserva el modo anterior y se necesita nueva preparación administrativa para habilitar material. Si falta cadera, la imagen es demasiado oscura, no se distingue pantalón o no se delimita una oclusión, se explica el motivo y se solicita repetir la fotografía: no se cambia silenciosamente al PNG superpuesto. Cámara continua Web conserva regiones articuladas. El estampado queda tapado donde hay teléfono/mano, sin inventar letras ocultas. La silueta y caída corresponden a la camiseta base, no certifican corte físico del producto. No se garantiza cualquier foto perfecta.

CU04.9: faltan pesos de texto, hash inválido o inferencia fallida → ERROR recuperable, sin publicar. Un array de zonas vacío indica análisis ejecutado sin texto detectado; no constituye garantía semántica. El administrador revisa legibilidad/completitud antes de publicar. Fotografías personales nunca pasan por este caso de uso.

### CU02.1 — Fotografía generativa opcional

Actor: cliente autenticado. Precondición: pesos locales aprobados y servidor GPU preparado.
La vista local y la talla TensorFlow no requieren este servidor. El usuario selecciona foto
y recibe el aviso de envío/retención antes de Generar. Android confirma foto/prenda en SQLite
antes de enviar; web admite generar con conexión y abrir resultados ya guardados sin ella.
El servidor valida JWT y archivos, deduplica por contenido/titular/versión y encola un trabajo.
Un motor precargado produce el PNG y el cliente guarda la copia privada. Android retira
los originales de la cola al completar. No se deriva una talla física del PNG.
Alternativos: falta de conexión conserva solicitudes Android; 401 exige renovar sesión;
colas ocupadas/errores temporales reintentan con la misma identidad; pose inválida informa
ERROR; eliminar retira vista, archivos y solicitud y sincroniza la invalidación remota.
Un resultado tardío de un trabajo eliminado no vuelve a publicarse. Sin servidor se
conservan catálogo, compras y modo local. Límites de segmentación y evidencia en
[docs/probador.md](../probador.md).

### CU02.2 — Probar un conjunto (arriba + abajo)

Actor: cliente. Disparador: en el probador (desde la ficha o desde «Probador» en la navegación) elige una prenda de arriba
y una de abajo del catálogo guardado. Curso básico: 1) el probador ubica cada prenda en su ranura; 2) el cliente elige el
modo; 3) RA y vista rápida dibujan primero la prenda de abajo y luego la de arriba, que tapa su cintura; la fotografía con
IA encola la prenda de abajo y, al terminar, la de arriba sobre ese resultado; 4) con sus medidas obtiene una talla y su
disponibilidad para cada prenda, y el shell ofrece «Elegir talla» en cada una.
Alternativos: un vestido ocupa las dos ranuras y una prenda de abajo lo reemplaza; quitar una prenda vuelve a una sola;
cambiar de prenda no apaga la cámara; una prenda sin modelo 3D se omite en la RA con aviso; si la página se cierra entre
las dos pasadas de la IA, la cola continúa al volver; cola llena o sesión vencida conservan la primera imagen y explican el
motivo. Límite: el conjunto en la IA tarda el doble y cada pasada puede variar color o detalle.

### CU02.3 — Probarse en realidad aumentada 3D (web y Android)

Actor: cliente. Precondición: la prenda tiene modelo 3D y espalda, sea de la colección empaquetada o de la ingesta.
Funciona sin conexión.

1. El cliente elige «RA 3D». En Android el modo se ofrece por defecto solo si ya rindió ≥ 8 img/s en ese teléfono; si no,
   lo elige él y la elección se recuerda.
2. El probador (el mismo microfrontend React en la web y en una WebView de Android) carga BlazePose desde el dispositivo.
3. El cliente pulsa «Cámara» y concede el permiso, o sube una foto.
4. En cada cuadro se estiman 33 puntos con profundidad y la máscara de la persona. Se mide el cuerpo (giro, anchos y
   radios), se suaviza y se dibujan las mallas de la prenda con su frente y su espalda.
5. Con sus medidas obtiene la talla. En Android, una barra muestra «Talla sugerida» y «Elegir talla», que vuelve al
   detalle con esa talla.

Alternativos:
- Sin WebGL → aviso y «Usar vista rápida».
- Permiso de cámara denegado para siempre → «Abrir ajustes» o subir una foto.
- Equipo lento (mediana > 90 ms) → cambia solo a BlazePose `lite`.
- De perfil u ocluido → se conserva el último cuerpo 300 ms.
- Prenda sin modelo 3D → se omite con aviso.
- Cambiar de modo, salir o pasar a segundo plano → la cámara se apaga y el análisis se detiene.
- La talla no existe en la prenda → «Ver tallas disponibles».

Límite: aproximación visual; no simula tela ni certifica el calce.

### CU04.10 — Registrar existencias desde el móvil, también sin red

Actor: Administrador (rol admin, misma cuenta SSO). Precondición: el producto y sus variantes se descargaron alguna vez con
conexión.
1. En Gestión → Existencias y fotos elige el producto y la variante. Ve el saldo confirmado con su «Datos al».
2. Registra un movimiento (Entrada, Salida o Ajuste con sentido; cantidad y motivo) o un mínimo.
3. El teléfono lo guarda en la cola única con UUID, Idempotency-Key y la `versión_esperada` de la última confirmación.
   Si ya hay otro cambio pendiente sobre esa variante, la versión se resuelve al enviarse, con el comprobante del anterior.
4. Con conexión, la cola lo envía (FIFO). Inventario aplica el cambio con su CAS y devuelve la variante con versión + 1.
   El teléfono valida el comprobante y lo marca confirmado.

Alternativos:
- Sin red → «Pendiente de enviar» con «Reintentar (mismo cambio)».
- Respuesta perdida → reintento con la misma clave: se aplica una sola vez.
- Conflicto 409 (otro dispositivo cambió la variante) → «Necesita revisión» y «Rehacer con el saldo actual». Crea una
  operación nueva y la anterior queda como antecedente (`reemplazadaPor`).
- Los dependientes de un conflicto quedan en revisión.
- La cuenta cambia o pierde el rol admin → la operación espera y nunca se envía con otra sesión.
- Salida mayor al disponible → se rechaza en el formulario.

### CU05.1 — Gestión empresarial desde el móvil

Actor: Administrador.
1. La pestaña «Gestión» (solo visible con rol admin) muestra el resumen del día por GraphQL, con los campos justos.
2. Desde ahí se abren: «Monitorea mi negocio» (resultado por agente; herramientas en «Ver detalles»), alertas de n8n
   («Atender» encolable), propuestas de reposición (confirmar con diálogo) y reportes (texto o voz → tabla → «Compartir
   Excel»).

Alternativos:
- Sin conexión → se ve la última copia con «Datos al».
- Misión, reporte y confirmación se desactivan con su motivo.
- Agentes ocupados → 429 explicado.
- IA apagada → «servicio no disponible; la tienda sigue funcionando».
- El micrófono solo aparece si el teléfono graba AAC y hay conexión; el texto transcrito es editable antes de enviarse.
