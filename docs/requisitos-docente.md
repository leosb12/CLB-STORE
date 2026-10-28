# Requisitos del docente — fuente de verdad

> Segundo Examen Parcial · Ingeniería de Software II · **Grupo 5** · Ámbito: **tienda de ropa** · Metodología: **ICONIX**
> **Presentación: 10 de noviembre de 2026.**
> Fuentes: apuntes `Ing Soft 13-10-2026.pdf` (clase del 13-oct-2026) y audio `AudioExplicacionProyecto.ogg`
> (ver `transcripcion-audio-docente.md`; los minutos `[mm:ss]` apuntan ahí).
> **Prioridad:** si este archivo contradice `especificacion-clb.md` (la interpretación del equipo), manda este.

## Espíritu del encargo
- "Más que sistema, una especie de **plataforma**": varios elementos e infraestructura, todo relacionado al tema [00:00].
- Puede ser tan grande o tan chico como quieran, **pero todos los conceptos deben aparecer aplicados** [00:41–01:08].
- **"No tienen que aplicarlo por aplicar, tiene que ver la pertinencia"** [11:12–11:15]: cada tecnología debe resolver un problema real del dominio, y hay que poder justificarlo en la defensa.
- **"El código es lo de menos"; lo importante es la arquitectura y una muy buena especificación**. Con IA "el programador cada vez puede hacer más" [18:40–19:42]. La evaluación pesa la arquitectura y la especificación (ICONIX), no solo que funcione.

## Lista de requisitos
| # | Requisito | Detalle del docente | Fuente |
|---|---|---|---|
| R1 | **Microservicios** | Mínimo **3**, "no puede ser menos de tres, es una condición", porque cada uno va en un lenguaje distinto | Apuntes 1; [12:02–12:28] |
| R2 | **Lenguajes de microservicios** | Obligatorios: **Spring Boot**, **NestJS** (lo deletrea "N-E-S-T") y **PHP**. Con más servicios se puede sumar otro lenguaje | Apuntes; [12:34–13:04] |
| R3 | **Microfrontends** | Más de un frontend integrado | Apuntes 2; [01:15–01:46] |
| R4 | **Frontends** | **Angular** y **React** obligatorios; "después podemos agregar más" (la app móvil cuenta como otra entrada) | Apuntes; [13:48] |
| R5 | **GraphQL solo en el sistema de gestión empresarial** | "Ojo, no en todo": estrictamente en la gestión empresarial; lo demás puede ser **API REST**. Justificación esperada: los problemas de REST con muchos endpoints/datos que GraphQL resuelve | Apuntes 3; [02:15–03:06] |
| R6 | **Agentes inteligentes** | La app de gestión empresarial **debe estar construida con agentes**: las funcionalidades son agentes. Ejemplo: "le doy una misión a mi agente: **monitorea mi negocio**" y el agente decide qué revisar | Apuntes 4; [03:26–04:04] |
| R7 | **IA local** | En el **dispositivo móvil** y también en el **navegador** (front web) | Apuntes 5; [04:08–04:30] |
| R8 | **Offline + sincronización + idempotencia** | Ambos (móvil y web) funcionan sin conexión (PWA). La sincronización debe resolver idempotencia, p. ej. "se registra dos veces por una falla". Debe funcionar en **pésimas condiciones**: sin Internet **y** con Internet inestable | Apuntes 5; [04:59–06:06] |
| R9 | **Transacciones transversales + SAGA** | Una acción involucra **al menos 3 microservicios**. Ejemplo del docente: **devolución de un producto** (ventas, inventario, …). Si uno falla, el rollback no es posible entre servicios: usar un patrón de arquitectura, sugerencia **SAGA** | Apuntes 6; [06:14–07:23] |
| R10 | **Machine Learning** | Modelos **supervisados** y **no supervisados** | Apuntes 7; [07:39–07:50] |
| R11 | **Deep Learning** | Basado en **TensorFlow**, orientado al **procesamiento de imágenes o video** | Apuntes 7; [07:50–08:01] |
| R12 | **Automatización (sugerencia n8n)** | Procesos **100% automatizados** que encadenan servicios. Ejemplo: **pedido por WhatsApp** → el sistema lo recibe → genera **factura** → la pasa a otro servicio → a otro proceso | Apuntes 8; [08:21–09:17] |
| R13 | **Reportes generativos** | A partir de **lenguaje natural, por audio y por texto** (ej. "lo que me tienen que pagar mañana"). Se pueden **ver en pantalla** y **exportar a Excel u otros formatos** | Apuntes 9; [09:26–10:16] |
| R14 | **Protocolo MCP** | El docente pide examinarlo y advierte **cuidado con la inyección** (prompt injection) a través de entradas abiertas | Apuntes 9; [11:23–11:45] |
| R15 | **3 bases de datos** | Relacional: **PostgreSQL** u otra, **pero no MySQL**. No relacionales: **MongoDB** y **DynamoDB** ("esa es de Amazon") | Apuntes; [14:02–14:44] |
| R16 | **Entrada única / SSO** | "Una sola cuenta, un solo password" para pasar entre aplicaciones (BI/dashboards, app móvil y gestión empresarial) **sin ningún inconveniente**: inicio de sesión único | Apuntes; [15:14–16:20] |
| R17 | **Niveles de arquitectura** | Además de la clásica (tres capas), arquitectura de **backend**, **frontend**, **datos** (p. ej. reportes frecuentes cuyos datos están en distintos microservicios) y **despliegue** | Apuntes; [16:39–17:42] |
| R18 | **Arquitecturas de código** | Obligatorias: **Hexagonal**, **DDD** y **CLEAR** | Apuntes; [17:44–18:00] |
| R19 | **Metodología ICONIX** | Todo el proyecto sigue ICONIX | Apuntes |
| R20 | **Versión preliminar escrita** | Para la clase siguiente: documento que especifique **dónde se aplica cada punto** (entregado como `CLB Documento.pdf`) | Apuntes pág. 2 |
| R21 | **Fecha** | Presentación el **10 de noviembre** | Apuntes; [18:32] |

## Contraste con la especificación del equipo (`especificacion-clb.md`)
| Tema | Docente | Equipo | Acción |
|---|---|---|---|
| Lenguaje de Clientes | **NestJS** obligatorio (R2) | Next.js (PDF) | ✅ **Resuelto 2026-10-21: Clientes en NestJS.** `AGENTS.md` actualizado; el PDF queda pendiente de corregir |
| Exportar reportes | Excel u otros (R13) | No contemplado | Agregar exportación (xlsx/csv) al motor de reportes |
| Automatización | Procesos 100% automatizados entre servicios (ej. WhatsApp → factura → otro servicio) | Solo `stock_bajo` → alerta | Ampliar a un flujo n8n multi-servicio; el de stock bajo es mínimo |
| Arquitectura de datos | Reportes frecuentes con datos de varios microservicios (R17) | GraphQL empresarial | Documentar y diseñar el modelo de lectura/consulta transversal (p. ej. agregador o proyecciones) |
| Arquitectura de despliegue | Nivel explícito (R17) | Docker Compose + cloud futuro | Documentar el diagrama de despliegue |
| Seguridad MCP/LLM | Cuidado con la inyección (R14) | Esquemas cerrados + validador | Mantenerlo y documentarlo como mitigación de prompt injection |
| Ejemplo de transacción | Devolución de producto | Compra (pedido → reserva → puntos) | La compra es válida. La devolución sería un segundo caso SAGA opcional |
| CLEAR | Nombrada sin definir | Capas provisionales | Falta la definición formal. En el audio no se distingue (se oye "de E"/"fría"); la confirmación del equipo dice "CLEAR" |
