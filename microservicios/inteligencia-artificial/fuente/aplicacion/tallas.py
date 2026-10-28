"""Recomendación de talla (ML supervisado) con las medidas que el cliente guarda en su perfil de Clientes."""
from fuente.aplicacion.interfaces import ModeloTallas, Perfiles
from fuente.dominio.tallas import AVISO, TABLA_TALLAS, Medidas, talla_por_tabla


class RecomendarTalla:
    def __init__(self, modelo: ModeloTallas, perfiles: Perfiles):
        self.modelo, self.perfiles = modelo, perfiles

    def ejecutar(self, medidas: Medidas) -> dict:
        probabilidades = self.modelo.probabilidades(medidas.vector())
        talla = max(probabilidades, key=probabilidades.get)
        return {"talla": talla, "probabilidades": probabilidades, "talla_por_tabla": talla_por_tabla(medidas),
                "medidas": medidas.__dict__, "aviso": AVISO, "tabla": TABLA_TALLAS}

    async def para_titular(self, token: str) -> dict:
        return self.ejecutar(Medidas.desde(await self.perfiles.medidas(token)))
