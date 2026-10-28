# Catálogo limpio para pruebas del equipo

La semilla versionada contiene 14 prendas, 56 variantes y 22 imágenes por hash (frontal/espalda cuando existe). Stock inicial: **10 unidades por variante**, sin reservas ni historial de movimientos. Mantiene precios, tallas, colores, mínimos y recursos publicados. Se excluyen productos `[DEMO]`, solicitudes de ingesta, fotos originales privadas, ventas, perfiles y credenciales.

Los recursos proceden de las colecciones [fotográfica](../../compartido/prendas/catalogo.json) y [de ingesta](../../compartido/prendas/ingesta/ingesta.json); créditos en [CREDITOS](../../compartido/prendas/CREDITOS.txt). Son datos de demostración, no stock comercial real.

## Instalación nueva

Desde la raíz del repositorio, con los contenedores levantados:

```powershell
python infraestructura/datos-equipo/preparar.py validar
python infraestructura/datos-equipo/preparar.py importar
```

`importar` exige Inventario vacío y verifica SHA-256 antes de escribir. Preparar las cuentas con `infraestructura/identidad/preparar-identidad.py`: cada compañero define sus claves en `.env`. No exportar la base de Keycloak para compartir usuarios.

## Volver a cero en el stack local

**Destructivo y explícito**: elimina las operaciones de prueba. No crea respaldo automáticamente. Cerrar web y app y resolver/descartar previamente sus operaciones pendientes; una cola antigua puede volver a enviar compras después del reinicio.

```powershell
python infraestructura/datos-equipo/preparar.py reiniciar --confirmar-borrado-local
```

Se bloquea el acceso por la pasarela y se detienen escritores/consumidores; se vacían pedidos, SAGA, comprobantes, idempotencia, puntos y movimientos de fidelización, analítica, reportes, propuestas y alertas. Se instala el catálogo inicial y se reinician ejecuciones/cursores de los dos flujos n8n. Se conservan usuarios Keycloak, perfiles de Clientes, esquema y migraciones, configuración n8n y pesos de IA. Los datos analíticos de existencias se reconstruyen al sincronizar.

Si falla un paso, los escritores quedan detenidos: corregir la causa y repetir el comando. No se promete una transacción global entre las bases. El procedimiento es repetible mientras los clientes estén cerrados. Solo funciona contra el proyecto Docker `clb-store` local; no sirve para producción.

Después, limpiar los datos del sitio/PWA y los datos locales de la app de pruebas (borra también sesiones y descargas; requiere login y descarga nuevos), o utilizar una instalación/perfil nuevo. Un servidor no puede borrar las colas de dispositivos desconectados. No utilizar el reinicio con compras reales pendientes.

## Mantener la semilla

`exportar` produce únicamente una semilla saneada y falla si ya existe. No es un respaldo de las bases ni conserva historial. Cualquier actualización de la semilla se revisa en Git antes de compartirla. Los helpers PHP, JavaScript y Python se ejecutan solo desde este procedimiento de mantenimiento; no son endpoints públicos.
