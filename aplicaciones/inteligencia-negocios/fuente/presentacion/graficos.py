"""Figuras Plotly con el lenguaje visual de Gestión: un color de dato, rejilla recesiva, cifras con formato boliviano.
Los colores categóricos se reservan para los segmentos de K-Means (lo único que los necesita)."""
import plotly.graph_objects as go

TINTA, TENUE, REJILLA, DATO, DATO_FUERTE = "#222e29", "#46544b", "#e2e4dc", "#1f8a5c", "#166a46"
# Segmentos: verde marca, ocre, azul pizarra, burdeos, oliva, gris cálido; distinguibles y sin chillar sobre #f8f7f3.
SEGMENTOS = ("#254e43", "#aa703b", "#4a6b8a", "#8a2f22", "#7c8a3a", "#6b6259")
FUENTE = "system-ui, -apple-system, 'Segoe UI', sans-serif"
MESES = ("ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic")


def _base(alto: int, **extra) -> go.Layout:
    return go.Layout(height=alto, margin={"l": 8, "r": 8, "t": 8, "b": 8}, paper_bgcolor="rgba(0,0,0,0)",
                     plot_bgcolor="rgba(0,0,0,0)", separators=",.", hovermode="closest",
                     font={"family": FUENTE, "size": 12, "color": TINTA},
                     hoverlabel={"bgcolor": "#fff", "bordercolor": "#cfd3c8", "font": {"family": FUENTE, "color": TINTA}},
                     xaxis={"gridcolor": REJILLA, "zeroline": False, "tickfont": {"color": TENUE}, "automargin": True},
                     yaxis={"gridcolor": REJILLA, "zeroline": False, "tickfont": {"color": TENUE}, "automargin": True},
                     **extra)


def vacia(texto: str, alto: int = 280) -> go.Figure:
    figura = go.Figure(layout=_base(alto))
    figura.update_xaxes(visible=False)
    figura.update_yaxes(visible=False)
    figura.add_annotation(text=texto, showarrow=False, font={"color": TENUE, "size": 13})
    return figura


def mensual(filas: list[dict]) -> go.Figure:
    if not filas:
        return vacia("Sin ventas para estos filtros.")
    etiquetas = [f"{MESES[int(f['mes'][5:]) - 1]} {f['mes'][2:4]}" for f in filas]
    figura = go.Figure(layout=_base(300))
    figura.add_bar(x=etiquetas, y=[f["monto_centavos"] / 100 for f in filas], marker_color=DATO,
                   marker_line_width=0, customdata=[[f["pedidos"], f["unidades"]] for f in filas],
                   hovertemplate="%{x}<br><b>Bs %{y:,.2f}</b><br>%{customdata[0]:,} pedidos · %{customdata[1]:,} unidades"
                                 "<extra></extra>")
    figura.update_yaxes(tickprefix="Bs ", tickformat=",.0f")
    figura.update_layout(bargap=0.35)
    return figura


def productos(filas: list[dict]) -> go.Figure:
    if not filas:
        return vacia("Sin ventas para estos filtros.")
    filas = list(reversed(filas))  # el más vendido arriba
    figura = go.Figure(layout=_base(36 * len(filas) + 30))
    figura.add_bar(y=[f["producto"] for f in filas], x=[f["unidades"] for f in filas], orientation="h", marker_color=DATO,
                   marker_line_width=0, text=[f"{f['unidades']:,}".replace(",", ".") for f in filas], textposition="outside",
                   cliponaxis=False, textfont={"color": TINTA},
                   customdata=[f["monto_centavos"] / 100 for f in filas],
                   hovertemplate="%{y}<br><b>%{x:,} unidades</b><br>Bs %{customdata:,.2f}<extra></extra>")
    figura.update_xaxes(showgrid=False, visible=False)
    figura.update_layout(bargap=0.3, margin={"l": 8, "r": 48, "t": 4, "b": 4})
    return figura


def segmentacion(seg: dict) -> go.Figure:
    # Leyenda debajo: arriba se monta sobre los puntos cuando se parte en varias líneas (móvil).
    figura = go.Figure(layout=_base(440, legend={"orientation": "h", "y": -0.2, "yanchor": "top", "x": 0, "font": {"size": 12}}))
    nombres = {s["grupo"]: s["nombre"] for s in seg["segmentos"]}
    orden = [s["grupo"] for s in seg["segmentos"]]  # de mayor a menor tamaño: colores estables
    for i, grupo in enumerate(orden):
        puntos = [p for p in seg["puntos"] if p["grupo"] == grupo]
        figura.add_scattergl(
            x=[p["recencia_dias"] for p in puntos], y=[p["monto_bs"] for p in puntos], mode="markers", name=nombres[grupo],
            marker={"size": 7, "color": SEGMENTOS[i % len(SEGMENTOS)], "opacity": 0.72, "line": {"width": 0}},
            customdata=[[p["frecuencia"], p["diversidad"]] for p in puntos],
            hovertemplate=(f"<b>{nombres[grupo]}</b><br>Última compra hace %{{x:.0f}} días<br>Gasto Bs %{{y:,.2f}}"
                           "<br>%{customdata[0]:.0f} pedidos · %{customdata[1]:.0f} categorías<extra></extra>"))
    figura.update_xaxes(title={"text": "Días desde la última compra", "font": {"color": TENUE, "size": 12}})
    figura.update_yaxes(title={"text": "Gasto total (Bs)", "font": {"color": TENUE, "size": 12}}, tickformat=",.0f")
    return figura


def color_segmento(indice: int) -> str:
    return SEGMENTOS[indice % len(SEGMENTOS)]


def confusion(matriz: list[list[int]], clases: list[str]) -> go.Figure:
    figura = go.Figure(layout=_base(300))
    figura.add_heatmap(z=matriz, x=clases, y=clases, colorscale=[[0, "#f0f3ec"], [1, DATO_FUERTE]], showscale=False,
                       xgap=2, ygap=2, hovertemplate="Real %{y} → predicha %{x}: %{z}<extra></extra>")
    maximo = max(max(f) for f in matriz) or 1
    for i, fila in enumerate(matriz):  # cifra en cada celda, legible sobre fondo claro u oscuro
        for j, valor in enumerate(fila):
            figura.add_annotation(x=clases[j], y=clases[i], text=str(valor), showarrow=False,
                                  font={"color": "#fff" if valor > maximo * 0.55 else TINTA, "size": 13})
    figura.update_xaxes(title={"text": "Talla predicha", "font": {"color": TENUE, "size": 12}}, side="bottom", showgrid=False)
    figura.update_yaxes(title={"text": "Talla real", "font": {"color": TENUE, "size": 12}}, autorange="reversed", showgrid=False)
    return figura


def probabilidades(probas: dict[str, float], elegida: str) -> go.Figure:
    clases = list(probas)
    figura = go.Figure(layout=_base(200))
    figura.add_bar(x=clases, y=[probas[c] * 100 for c in clases], marker_line_width=0,
                   marker_color=[DATO_FUERTE if c == elegida else "#cfd8c9" for c in clases],
                   text=[f"{probas[c] * 100:.0f} %" for c in clases], textposition="outside", cliponaxis=False,
                   hovertemplate="%{x}: %{y:.1f} %<extra></extra>")
    figura.update_yaxes(visible=False, range=[0, 115])
    figura.update_xaxes(showgrid=False)
    figura.update_layout(bargap=0.4)
    return figura
