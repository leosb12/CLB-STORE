"""Modelos de scikit-learn: talla (supervisado) y segmentos de clientes (no supervisado)."""
import numpy as np
from sklearn.cluster import KMeans
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import accuracy_score, confusion_matrix, silhouette_score
from sklearn.model_selection import train_test_split
from sklearn.preprocessing import StandardScaler

from fuente.dominio.tallas import AVISO, CARACTERISTICAS, TABLA_TALLAS, TALLAS

SEMILLA = 7


def conjunto_sintetico(por_talla: int = 400, semilla: int = SEMILLA) -> tuple[np.ndarray, np.ndarray]:
    """Conjunto de entrenamiento documentado: medidas uniformes dentro de los rangos de la tabla de tallas, más ruido
    gaussiano (σ = 4 cm / 4 kg) que imita una medición casera con cinta. Los rangos vecinos se solapan, como en la realidad.
    No hay historial real de devoluciones por talla; con datos reales se reentrena igual."""
    azar = np.random.default_rng(semilla)
    filas, etiquetas = [], []
    for indice, talla in enumerate(TALLAS):
        rangos = TABLA_TALLAS[talla]
        muestra = np.column_stack([azar.uniform(*rangos[c], por_talla) for c in CARACTERISTICAS])
        filas.append(muestra + azar.normal(0, 4.0, muestra.shape))
        etiquetas += [indice] * por_talla
    return np.vstack(filas), np.array(etiquetas)


class ModeloTallasLogistico:
    """Regresión logística multinomial con normalización. Se exporta a JSON para inferir sin librerías (web y Android)."""

    def __init__(self, semilla: int = SEMILLA):
        x, y = conjunto_sintetico(semilla=semilla)
        x_ent, x_pru, y_ent, y_pru = train_test_split(x, y, test_size=0.2, stratify=y, random_state=semilla)
        self.escalador = StandardScaler().fit(x_ent)
        self.modelo = LogisticRegression(max_iter=2000).fit(self.escalador.transform(x_ent), y_ent)
        prediccion = self.modelo.predict(self.escalador.transform(x_pru))
        self.metricas = {"exactitud": round(float(accuracy_score(y_pru, prediccion)), 4),
                         "matriz_confusion": confusion_matrix(y_pru, prediccion).tolist(),
                         "entrenamiento": int(len(y_ent)), "prueba": int(len(y_pru))}

    def probabilidades(self, vector: list[float]) -> dict[str, float]:
        p = self.modelo.predict_proba(self.escalador.transform([vector]))[0]
        return {TALLAS[int(c)]: round(float(v), 4) for c, v in zip(self.modelo.classes_, p)}

    def exportar(self) -> dict:
        return {"version": 1, "tipo": "regresion_logistica_multinomial", "caracteristicas": list(CARACTERISTICAS),
                "clases": [TALLAS[int(c)] for c in self.modelo.classes_],
                "media": self.escalador.mean_.round(6).tolist(), "escala": self.escalador.scale_.round(6).tolist(),
                "coeficientes": self.modelo.coef_.round(6).tolist(), "intercepto": self.modelo.intercept_.round(6).tolist(),
                "inferencia": "softmax(coeficientes · ((x − media) / escala) + intercepto)",
                "metricas": self.metricas, "tabla": TABLA_TALLAS, "aviso": AVISO}


class AgrupadorKMeans:
    """K-Means sobre características normalizadas; k entre 2 y 6 se elige por el coeficiente de silueta.
    Con pocos clientes la silueta premia grupos de una sola persona: se exigen al menos 2 por grupo y k ≤ n/3.
    Un cliente atípico (|z| > 3 en alguna característica, p. ej. muchas más compras que el resto) quedaría solo en cualquier
    agrupación e impediría todas: cada atípico va a un grupo propio (son pocos por definición y pueden serlo en sentidos
    opuestos, p. ej. un VIP y un cliente dormido) y K-Means agrupa al resto. La silueta informada es la del resto."""

    Z_ATIPICO = 3.0

    def agrupar(self, filas: list[list[float]]) -> tuple[list[int], list[list[float]], float | None]:
        x = np.array(filas, dtype=float)
        atipico = (np.abs(StandardScaler().fit_transform(x)) > self.Z_ATIPICO).any(axis=1)
        if atipico.any() and (~atipico).sum() >= 6:
            etiquetas, centroides, silueta = self._kmeans(x[~atipico])
            resto, grupos = iter(etiquetas), []
            for i, a in enumerate(atipico):
                if a:
                    grupos.append(len(centroides))
                    centroides = centroides + [x[i].tolist()]
                else:
                    grupos.append(next(resto))
            return grupos, centroides, silueta
        return self._kmeans(x)

    def _kmeans(self, x: np.ndarray) -> tuple[list[int], list[list[float]], float | None]:
        escalador = StandardScaler().fit(x)
        z = escalador.transform(x)
        mejor = None
        for k in range(2, min(6, len(x) // 3) + 1):
            modelo = KMeans(n_clusters=k, n_init=10, random_state=SEMILLA).fit(z)
            if min(np.bincount(modelo.labels_, minlength=k)) < 2:
                continue
            silueta = float(silhouette_score(z, modelo.labels_))
            if mejor is None or silueta > mejor[1]:
                mejor = (modelo, silueta)
        if mejor is None:  # muy pocos clientes o todos iguales: un solo grupo
            return [0] * len(x), [x.mean(axis=0).tolist()], None
        modelo, silueta = mejor
        centroides = escalador.inverse_transform(modelo.cluster_centers_).tolist()
        return modelo.labels_.tolist(), centroides, round(silueta, 4)
