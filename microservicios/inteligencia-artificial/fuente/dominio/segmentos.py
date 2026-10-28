"""Segmentos de clientes: cómo se nombran y describen los grupos que encuentra el aprendizaje no supervisado.

K-Means no conoce etiquetas: devuelve centroides. El nombre sale de reglas de negocio explícitas aplicadas al centroide
(inactividad y frecuencia en valores absolutos; gasto relativo a la mediana de todos los clientes), así que cambia solo
si cambia el comportamiento de compra.
"""
CARACTERISTICAS = ("recencia_dias", "frecuencia", "monto_bs", "diversidad")

DIAS_INACTIVO = 30          # sin comprar en un mes: cliente a recuperar
PEDIDOS_FRECUENTE = 4
PEDIDOS_RECURRENTE = 2


def describir(centroide: dict[str, float], medianas: dict[str, float]) -> tuple[str, str]:
    if centroide["recencia_dias"] >= DIAS_INACTIVO:
        base = "Inactivos"
    elif centroide["frecuencia"] >= PEDIDOS_FRECUENTE:
        base = "Frecuentes"
    elif centroide["frecuencia"] >= PEDIDOS_RECURRENTE:
        base = "Recurrentes"
    else:
        base = "Ocasionales"
    mediana = medianas["monto_bs"] or 1
    gasto = " de alto gasto" if centroide["monto_bs"] > 1.5 * mediana else " de gasto bajo" if centroide["monto_bs"] < 0.75 * mediana else ""
    descripcion = (f"Última compra hace {centroide['recencia_dias']:.0f} días en promedio, "
                   f"{centroide['frecuencia']:.1f} pedidos y {centroide['monto_bs']:.2f} Bs por cliente, "
                   f"{centroide['diversidad']:.1f} categorías distintas.")
    if centroide["diversidad"] >= 2:
        descripcion += " Compran de varias categorías."
    return base + gasto, descripcion
