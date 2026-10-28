# Diagrama de clases de diseño

ICONIX lo deriva de las secuencias: aquí aparecen las clases que realizan los casos, con sus operaciones. El modelo de
dominio (`modelo-dominio.md`) queda como vista conceptual. Las operaciones son las del código. En Inventario,
`GestionarExistencias.ejecutar` despacha por `tipo` (RESERVAR, CONSUMIR, LIBERAR, REGISTRAR_MOVIMIENTO…) en una sola
escritura condicional del agregado.

## Compra distribuida (CU03) — Ventas (DDD), Inventario (Hexagonal), Clientes (capas)

```mermaid
classDiagram
  class Pedido {
    +UUID identificador
    +EstadoPedido estado
    +crear(id, cliente, lineas, ahora)$ Pedido
    +confirmar(ahora)
    +cancelar(motivo, ahora)
    +ponerEnRevisión(motivo, ahora)
    +total() Dinero
  }
  class OrquestadorSagaCompra {
    +avanzar(identificadorPedido)
    +reanudarPendientes(limite)
  }
  class SagaCompra {
    +Claves claves
    +iniciar(pedido, ahora)$ SagaCompra
    +avanzar(paso, resultado, detalle, ahora)
  }
  class ComprobantesDeVenta {
    +registrar(pedido, nombre, tipo, bytes, origen) Registro
    +descargar(pedido, titular, admin) Comprobante
  }
  class Comprobante {
    +esLibroXlsx(bytes) bool
  }
  class GestionarExistencias {
    +ejecutar(tipo, datos, clave) array
    +eventosDesde(desde, limite) array
    +consultar(tipo, id, administracion) array
  }
  class ServicioFidelizacion {
    +acreditar(clave, pedido, cliente, totalCentavos) Movimiento
    +revertir(clave, pedido, cliente) Movimiento
    +movimientosDelPedido(cliente, pedido)
  }
  OrquestadorSagaCompra --> Pedido
  OrquestadorSagaCompra --> SagaCompra
  OrquestadorSagaCompra ..> GestionarExistencias : REST + token servicio
  OrquestadorSagaCompra ..> ServicioFidelizacion : REST + token servicio
  ComprobantesDeVenta --> Comprobante
```

## Probador (CU02.x) — web, Android e IA

```mermaid
classDiagram
  class ElementoProbador {
    +prenda PrendaProbador
    +catalogo PrendaProbador[]
    +modos ModoProbador[]
    +precargar()
  }
  class DetectorBlazePose {
    +preparar()
    +estimar(fuente, ancho, alto) Observacion
  }
  class MotorRA {
    +ponerPrendas(lista)
    +dibujar(fuente, ancho, alto, mascara, escena)
    +destruir()
  }
  class ServidorProbador {
    +iniciar() Uri
    +detener()
  }
  class VistaRA {
    -abrir()
    -permiso(solicitud)
    -mensaje(json)
  }
  class PantallaProbador {
    -elegirModoInicial()
    -cambiarModo(modo)
  }
  class PreparadorU2Net {
    +ejecutar(original, categoria) PrendaPreparada
  }
  class GestionarRecursosProbador {
    +cargar(id, clave, version, color, binario)
    +reclamar(ahora)
    +finalizar(id, trabajo, reclamo, datos, textura, maestro, espalda)
    +publicar(id, trabajo, clave, version, aceptarAvisos)
  }
  ElementoProbador --> DetectorBlazePose
  ElementoProbador --> MotorRA
  PantallaProbador --> VistaRA
  VistaRA ..> ServidorProbador : AnfitrionProbadorRA
  VistaRA ..> ElementoProbador : WebView + contrato v1
  PreparadorU2Net ..> GestionarRecursosProbador : worker REST
```

## Sincronización offline (CU03, CU04) — colas con idempotencia

```mermaid
classDiagram
  class Operacion {
    +UUID identificador
    +String tipo
    +UUID claveIdempotencia
    +String titular
    +EstadoOperacion estado
    +int intentos
  }
  class SincronizarPedidos {
    +ejecutar(forzar) int
    +reenviar(Operacion) PedidoVenta
  }
  class Sincronizador {
    +sincronizar(forzar) ResultadoSincronizacion
  }
  SincronizarPedidos --> Operacion
  Sincronizador --> Operacion
```
