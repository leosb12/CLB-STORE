"""Consultas del sistema de gestión empresarial sobre el modelo de lectura. GraphQL las expone; nada más las usa."""
import asyncio
import statistics
from datetime import date, datetime, timezone

from fuente.aplicacion.interfaces import Agrupador, RepositorioAnalitica
from fuente.dominio import segmentos
from fuente.dominio.catalogo_reportes import CATALOGO, EspecificacionV2, texto_periodo, valor_filtro, ventana
from fuente.dominio.reportes import Agrupacion, EspecificacionReporte, Metrica, Periodo, inicio_periodo, rango_fechas


def _ahora() -> datetime:
    return datetime.now(timezone.utc)


class ConsultarAnalitica:
    def __init__(self, repositorio: RepositorioAnalitica, agrupador: Agrupador, reloj=_ahora):
        self.repositorio, self.agrupador, self.reloj = repositorio, agrupador, reloj

    async def resumen_ventas(self, periodo: Periodo, agrupar_por: Agrupacion | None, limite: int, metrica: Metrica = "UNIDADES",
                             desde: date | None = None, hasta: date | None = None, filtros: dict | None = None,
                             orden: str = "METRICA_DESC") -> dict:
        if periodo == "RANGO":
            spec = EspecificacionReporte(titulo="rango", metrica=metrica, periodo="RANGO", desde=desde, hasta=hasta)
            inicio, fin = rango_fechas(spec, self.reloj())
        else:
            inicio, fin = inicio_periodo(periodo, self.reloj()), None
        resumen = await self.repositorio.resumen_ventas(inicio, agrupar_por, limite, metrica, fin=fin,
                                                        filtros={k: v for k, v in (filtros or {}).items() if v}, orden=orden)
        return {**resumen, "periodo": periodo, "agrupar_por": agrupar_por, "datos_al": await self._datos_al("ventas")}

    async def datos_reporte(self, spec: EspecificacionV2) -> dict:
        """Datos de un reporte v2: misma tabla para pantalla, PDF y Excel. Dinero en centavos enteros."""
        ahora = self.reloj()
        campos = CATALOGO[spec.fuente]
        inicio, fin = ventana(spec.periodo, ahora, spec.desde, spec.hasta)
        grafico = spec.grafico if spec.grafico.tipo != "NINGUNO" else None
        r = await self.repositorio.consultar_reporte({
            "fuente": spec.fuente, "tipo": spec.tipo, "columnas": spec.columnas, "inicio": inicio, "fin": fin,
            "filtros": [(f.campo, f.operador, valor_filtro(campos[f.campo].tipo, f.campo, f.valor)) for f in spec.filtros],
            "orden": [(o.campo, o.direccion) for o in spec.orden], "limite": spec.limite,
            "grafico": {"eje": grafico.eje, "valor": grafico.valor} if grafico else None})
        frescura = await self.repositorio.frescura()
        datos_al = frescura.get("ventas" if spec.fuente == "VENTAS" else "existencias")
        notas = []
        if r["total_filas"] > len(r["filas"]):
            notas.append(f"Se muestran {len(r['filas'])} de {r['total_filas']} filas (límite {spec.limite}); los totales "
                         "incluyen todas.")
        if r["clientes_sin_nombre"]:
            notas.append(f"{r['clientes_sin_nombre']} cliente(s) sin nombre registrado: no editaron su perfil ni iniciaron "
                         "sesión desde que se registran los nombres.")
        if "STOCK_ACTUAL" in spec.columnas:
            notas.append("«Stock disponible actual» es la existencia de hoy, no la del día de la venta.")
        if "PRECIO_UNITARIO" in spec.columnas or "SUBTOTAL" in spec.columnas:
            notas.append("Precios históricos: los de cada pedido al confirmarse, no el precio actual del catálogo.")
        if not r["filas"]:
            notas.append("No hay datos para este periodo y filtros.")
        return {
            "version": 2, "titulo": spec.titulo, "fuente": spec.fuente, "tipo": spec.tipo,
            "columnas": [{"campo": c, "etiqueta": campos[c].etiqueta, "tipo": campos[c].tipo} for c in spec.columnas],
            "filas": r["filas"], "total_filas": r["total_filas"], "truncado": r["total_filas"] > len(r["filas"]),
            "totales": r["totales"],
            "grafico": {"tipo": grafico.tipo, "eje": grafico.eje, "valor": grafico.valor,
                        "etiqueta_eje": campos[grafico.eje].etiqueta, "etiqueta_valor": campos[grafico.valor].etiqueta,
                        "tipo_valor": campos[grafico.valor].tipo, "puntos": r["grafico"]} if grafico else None,
            "periodo": {"codigo": spec.periodo, "texto": texto_periodo(spec.model_dump(mode="json"), ahora),
                        "desde": inicio.isoformat() if inicio else None, "hasta": (fin or ahora).isoformat() if inicio else None},
            "datos_al": datos_al.isoformat() if datos_al else None,
            "nombres_al": frescura["clientes"].isoformat() if frescura.get("clientes") and "CLIENTE" in spec.columnas else None,
            "notas": notas,
        }

    async def productos(self, limite: int) -> list[dict]:
        return await self.repositorio.productos(limite)

    async def stock_bajo(self) -> list[dict]:
        return await self.repositorio.stock_bajo()

    async def alertas(self, limite: int) -> list[dict]:
        return await self.repositorio.alertas(limite)

    async def datos_al(self) -> dict[str, datetime]:
        return await self.repositorio.frescura()

    async def segmentos(self) -> dict:
        """K-Means sobre recencia, frecuencia, gasto y diversidad de categorías de cada cliente, sin etiquetas previas."""
        clientes = await self.repositorio.compras_por_cliente(self.reloj())
        resultado = {"clientes": len(clientes), "silueta": None, "segmentos": [], "datos_al": await self._datos_al("ventas")}
        if len(clientes) < 3:
            return resultado
        filas = [[c[x] for x in segmentos.CARACTERISTICAS] for c in clientes]
        # K-Means y la silueta son CPU: en un hilo para no congelar la ingesta, el MCP ni /salud.
        etiquetas, centroides, silueta = await asyncio.to_thread(self.agrupador.agrupar, filas)
        medianas = {x: statistics.median(f[i] for f in filas) for i, x in enumerate(segmentos.CARACTERISTICAS)}
        for grupo, centro in enumerate(centroides):
            centroide = dict(zip(segmentos.CARACTERISTICAS, centro))
            nombre, descripcion = segmentos.describir(centroide, medianas)
            if any(s["nombre"] == nombre for s in resultado["segmentos"]):
                nombre += f" ({grupo + 1})"  # dos grupos con el mismo perfil: se distinguen por número
            # Solo el tamaño del grupo: los identificadores de clientes no salen del modelo de lectura.
            resultado["segmentos"].append({"grupo": grupo, "nombre": nombre, "descripcion": descripcion,
                                           "clientes": etiquetas.count(grupo), "centroide": centroide})
        resultado["silueta"] = silueta
        resultado["segmentos"].sort(key=lambda s: -s["clientes"])
        return resultado

    # Lecturas del panel (historial, propuestas, auditoría): los puertos no tocan el repositorio directamente.
    async def reportes(self, limite: int) -> list[dict]:
        return await self.repositorio.reportes(limite)

    async def reporte(self, identificador: str) -> dict | None:
        return await self.repositorio.reporte(identificador)

    async def propuestas(self, estado: str | None) -> list[dict]:
        return await self.repositorio.propuestas(estado)

    async def auditoria(self, limite: int) -> list[dict]:
        return await self.repositorio.auditoria(limite)

    async def _datos_al(self, fuente: str) -> datetime | None:
        return (await self.repositorio.frescura()).get(fuente)
