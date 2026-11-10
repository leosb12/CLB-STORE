"""Consultas del sistema de gestión empresarial sobre el modelo de lectura. GraphQL las expone; nada más las usa."""
import asyncio
import statistics
from datetime import date, datetime, timezone

from fuente.aplicacion.interfaces import Agrupador, RepositorioAnalitica, RepositorioDemostracion
from fuente.dominio import demostracion, segmentos
from fuente.dominio.catalogo_reportes import CATALOGO, EspecificacionV2, texto_periodo, valor_filtro, ventana
from fuente.dominio.reportes import Agrupacion, EspecificacionReporte, Metrica, Periodo, inicio_periodo, rango_fechas


def _ahora() -> datetime:
    return datetime.now(timezone.utc)


class ConsultarAnalitica:
    def __init__(self, repositorio: RepositorioAnalitica, agrupador: Agrupador, reloj=_ahora,
                 demostracion: RepositorioDemostracion | None = None):
        self.repositorio, self.agrupador, self.reloj = repositorio, agrupador, reloj
        self.demostracion = demostracion  # dataset sintético aislado; solo se lee si la especificación lo pide

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
        repositorio, meta = self.repositorio, None
        if spec.conjunto == "DEMOSTRACION":
            meta = await self.demostracion.metadatos() if self.demostracion else None
            if not meta:
                raise ValueError("El dataset de demostración no está generado.")
            repositorio = self.demostracion
        r = await repositorio.consultar_reporte({
            "fuente": spec.fuente, "tipo": spec.tipo, "columnas": spec.columnas, "inicio": inicio, "fin": fin,
            "filtros": [(f.campo, f.operador, valor_filtro(campos[f.campo].tipo, f.campo, f.valor)) for f in spec.filtros],
            "orden": [(o.campo, o.direccion) for o in spec.orden], "limite": spec.limite,
            "grafico": {"eje": grafico.eje, "valor": grafico.valor} if grafico else None})
        frescura = await repositorio.frescura()
        datos_al = frescura.get("ventas" if spec.fuente == "VENTAS" else "existencias")
        notas = []
        if meta:
            datos_al = datetime.fromisoformat(meta["generado"])
            notas.append(f"{demostracion.NOTA} Corte al {meta['fecha_corte']}; {meta['total_registros']} registros.")
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
            "version": 2, "titulo": spec.titulo, "fuente": spec.fuente, "tipo": spec.tipo, "conjunto": spec.conjunto,
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

    async def indicadores_demostracion(self, desde: date | None = None, hasta: date | None = None,
                                       categoria: str | None = None, producto: str | None = None) -> dict:
        """KPI del tablero de inteligencia de negocios sobre el dataset sintético. Cada bloque es una especificación de
        reporte v2 resuelta por `datos_reporte`: las mismas fórmulas, filtros y conjunto que un reporte o un agente."""
        meta = await self.demostracion.metadatos() if self.demostracion else None
        if not meta:
            return {"disponible": False, "etiqueta": demostracion.ETIQUETA,
                    "mensaje": "Dataset no generado: ejecute dataset_demostracion generar y entrenar."}
        base = {"conjunto": "DEMOSTRACION", "fuente": "VENTAS", "tipo": "AGREGADO",
                "periodo": "RANGO" if desde or hasta else "TODO", "desde": desde, "hasta": hasta,
                "filtros": [{"campo": c, "operador": "IGUAL", "valor": v} for c, v in (("CATEGORIA", categoria),
                                                                                       ("PRODUCTO", producto)) if v]}
        bloques = {
            "kpi": {"titulo": "Indicadores clave", "columnas": ["MONTO", "PEDIDOS", "UNIDADES", "TICKET_PROMEDIO", "CLIENTES"],
                    "limite": 1},
            "mensual": {"titulo": "Evolución mensual", "columnas": ["MES", "MONTO", "PEDIDOS", "UNIDADES"],
                        "orden": [{"campo": "MES", "direccion": "ASC"}], "limite": 500},
            "productos": {"titulo": "Productos más vendidos", "columnas": ["PRODUCTO", "UNIDADES", "MONTO"],
                          "orden": [{"campo": "UNIDADES", "direccion": "DESC"}], "limite": 10},
            "categorias": {"titulo": "Ventas por categoría", "columnas": ["CATEGORIA", "MONTO", "UNIDADES"],
                           "orden": [{"campo": "MONTO", "direccion": "DESC"}], "limite": 50},
        }
        specs = {k: EspecificacionV2.model_validate({**base, **v}) for k, v in bloques.items()}
        datos = {k: await self.datos_reporte(s) for k, s in specs.items()}
        opciones = await self.datos_reporte(EspecificacionV2.model_validate({
            "conjunto": "DEMOSTRACION", "titulo": "Opciones de filtro", "tipo": "AGREGADO", "periodo": "TODO", "limite": 500,
            "columnas": ["CATEGORIA", "PRODUCTO", "UNIDADES"],
            "orden": [{"campo": "CATEGORIA", "direccion": "ASC"}, {"campo": "PRODUCTO", "direccion": "ASC"}]}))
        kpi = datos["kpi"]["filas"][0] if datos["kpi"]["filas"] else [0, 0, 0, None, 0]
        por_categoria: dict[str, list[str]] = {}
        for c, p, _ in opciones["filas"]:
            por_categoria.setdefault(c, []).append(p)
        return {
            "disponible": True, "etiqueta": demostracion.ETIQUETA, "nota": demostracion.NOTA,
            "dataset": meta, "conteos": await self.demostracion.conteos(),
            "periodo": datos["kpi"]["periodo"],
            "kpi": {"ingresos_centavos": kpi[0] or 0, "pedidos": kpi[1] or 0, "unidades": kpi[2] or 0,
                    "ticket_promedio_centavos": kpi[3], "clientes": kpi[4] or 0},
            "mensual": [dict(zip(("mes", "monto_centavos", "pedidos", "unidades"), f)) for f in datos["mensual"]["filas"]],
            "productos": [dict(zip(("producto", "unidades", "monto_centavos"), f)) for f in datos["productos"]["filas"]],
            "categorias": [dict(zip(("categoria", "monto_centavos", "unidades"), f)) for f in datos["categorias"]["filas"]],
            "opciones": {"categorias": sorted(por_categoria), "productos_por_categoria": por_categoria},
            "segmentacion": await self.demostracion.segmentacion(),
            "alcance_segmentacion": demostracion.ALCANCE_SEGMENTACION,
            "especificaciones": {k: s.model_dump(mode="json") for k, s in specs.items()},
        }

    async def dataset_csv(self, nombre: str) -> tuple[bytes, dict] | None:
        """Descarga del dataset sintético (vista completa o una tabla). None si no está generado."""
        meta = await self.demostracion.metadatos() if self.demostracion else None
        if not meta:
            return None
        return await self.demostracion.exportar_csv(nombre), meta

    async def productos(self, limite: int) -> list[dict]:
        return await self.repositorio.productos(limite)

    async def stock_bajo(self) -> list[dict]:
        return await self.repositorio.stock_bajo()

    async def alertas(self, limite: int) -> list[dict]:
        return await self.repositorio.alertas(limite)

    async def datos_al(self) -> dict[str, datetime]:
        return await self.repositorio.frescura()

    async def segmentos(self, con_puntos: bool = False) -> dict:
        """K-Means sobre recencia, frecuencia, gasto y diversidad de categorías de cada cliente, sin etiquetas previas.
        `con_puntos` agrega las características de cada cliente con su grupo, sin identificador (para graficar)."""
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
        if con_puntos:
            resultado["puntos"] = [{**dict(zip(segmentos.CARACTERISTICAS, f)), "grupo": g} for f, g in zip(filas, etiquetas)]
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
