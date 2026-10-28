"""Contratos de seguridad y estados; no sustituyen la prueba visual con GPU real."""
import asyncio
import io
import time

import numpy as np
import pytest
from fastapi.testclient import TestClient
from PIL import Image, ImageOps

from fuente.aplicacion.probador import clave_resultado
from fuente.dominio.probador import ErrorProbador, categoria_vton
from fuente.infraestructura.catvton import leer_imagen, preparar_encuadre
from fuente.infraestructura.identidad import TokenInvalido, Usuario
from fuente.infraestructura.mascara_vton import mascara_agnostica
from fuente.infraestructura.modelos_vton import verificar_pesos
from fuente.infraestructura.trabajos_vton import trabajos_en_directorio as TrabajosVton
from fuente.puertos.probador import crear_aplicacion


def png(color="white", lado=256):
    salida = io.BytesIO()
    Image.new("RGB", (lado, lado), color).save(salida, "PNG")
    return salida.getvalue()


def test_encuadre_con_margen_impar_retorna_los_pixeles_sin_desplazarlos():
    for dimensiones in ((256, 259), (93, 128), (128, 93)):
        original = Image.new("RGB", dimensiones, "red")
        normalizada, caja = preparar_encuadre(original)
        contenido_real = ImageOps.contain(original, (768, 1024))
        assert normalizada.crop(caja).size == contenido_real.size
        assert normalizada.crop(caja).tobytes() == contenido_real.tobytes()
    _, caja = preparar_encuadre(Image.new("RGB", (256, 259), "red"))
    assert caja[1] == 124


def test_clave_invalida_contenido_categoria_propietario_y_prenda():
    base = ("ana", b"foto", b"ropa", "producto", "upper")
    original = clave_resultado(*base)
    assert original == clave_resultado(*base)
    for indice, cambio in enumerate(("bea", b"otra", b"nueva", "otra-prenda", "lower")):
        variante = list(base)
        variante[indice] = cambio
        assert clave_resultado(*variante) != original


def test_imagenes_invalidas_y_modelos_ausentes_controlados(tmp_path):
    for entrada in (b"no es imagen", png(lado=128), b"x" * (8 * 1024 * 1024 + 1)):
        with pytest.raises(ErrorProbador, match="imagen|fotografía"):
            leer_imagen(entrada)
    assert leer_imagen(png()).size == (256, 256)
    with pytest.raises(ErrorProbador) as capturado:
        verificar_pesos(tmp_path)
    assert capturado.value.codigo == "PESOS_NO_DISPONIBLES"
    assert categoria_vton("Poleras") == "upper"
    assert categoria_vton("Pantalones") == "lower"
    assert categoria_vton("Vestidos") == "overall"
    with pytest.raises(ErrorProbador):
        categoria_vton("accesorios")


def test_manga_larga_borra_brazos_y_protege_cara_cabello_manos_pantalon():
    dp = np.zeros((128, 96), np.uint8)
    lip, atr = dp.copy(), dp.copy()
    dp[25:75, 30:66] = 1
    dp[30:80, 18:28] = 15
    dp[30:80, 68:78] = 16
    dp[65:90, 18:28] = 19
    dp[65:90, 68:78] = 20
    dp[85:95, 18:28] = 4
    dp[85:95, 68:78] = 3
    atr[85:95, 18:28] = 14
    atr[85:95, 68:78] = 15
    lip[7:20, 38:55] = 13
    lip[10:55, 30:34] = 2  # cabello largo sobre el torso
    lip[85:120, 32:65] = 9
    lip[30:85, 17:29] = 5  # manga vieja por fuera de DensePose
    analisis = {"densepose": Image.fromarray(dp), "schp_lip": Image.fromarray(lip), "schp_atr": Image.fromarray(atr)}
    mascara = np.asarray(mascara_agnostica(analisis, "upper", Image.new("L", (96, 128))))
    assert np.all(mascara[30:80, 18:28] == 255)
    assert mascara[70, 75] == 255
    assert mascara[45, 17] == 255  # elimina también la manga antigua
    assert np.all(mascara[np.isin(dp, [3, 4])] == 0)
    assert np.all(mascara[np.isin(lip, [2, 9, 13])] == 0)
    fondo_amplio = np.asarray(mascara_agnostica(analisis, "upper", Image.new("L", (96, 128), 255)))
    assert fondo_amplio[100, 5] == 0  # el hull original no debe pintar un halo lejano de fondo
    vacio = {nombre: Image.new("L", (96, 128)) for nombre in analisis}
    with pytest.raises(ErrorProbador) as capturado:
        mascara_agnostica(vacio, "upper", Image.new("L", (96, 128)))
    assert capturado.value.codigo == "POSE_INVALIDA"


class MotorDeContrato:
    """Doble explícito para probar cola/HTTP. No es un resultado de CatVTON."""
    def __init__(self):
        self.llamadas = 0
    def generar(self, *entrada):
        self.llamadas += 1
        return png("blue")
    def cerrar(self):
        return None


class IdentidadDeContrato:
    async def verificar(self, token):
        if token == "malo":
            raise TokenInvalido()
        return Usuario(token, frozenset({"cliente"}), token)


def test_http_autenticacion_cache_propiedad_y_datos_invalidos(tmp_path):
    motor = MotorDeContrato()
    trabajos = TrabajosVton(str(tmp_path), motor)
    with TestClient(crear_aplicacion(trabajos, IdentidadDeContrato())) as cliente:
        ruta = "/api/v1/probador/trabajos"
        assert cliente.post(ruta).status_code == 401
        ana = {"Authorization": "Bearer ana"}
        assert cliente.post(ruta, headers=ana).status_code == 422
        archivos = {"persona": ("foto.png", png(), "image/png"), "prenda": ("ropa.png", png("red"), "image/png")}
        datos = {"identificador": "producto", "categoria": "polera"}
        respuesta = cliente.post(ruta, headers=ana, files=archivos, data=datos)
        assert respuesta.status_code == 202
        clave = respuesta.json()["identificador"]
        for _ in range(50):
            resultado = cliente.get(ruta + "/" + clave, headers=ana)
            if resultado.json()["estado"] == "LISTO":
                break
            time.sleep(0.01)
        assert resultado.json()["estado"] == "LISTO"
        assert cliente.get(ruta + "/" + clave, headers={"Authorization": "Bearer bea"}).status_code == 404
        assert cliente.get(ruta + "/" + clave + "/imagen", headers={"Authorization": "Bearer bea"}).status_code == 404
        imagen = cliente.get(ruta + "/" + clave + "/imagen", headers=ana)
        assert imagen.content == png("blue")
        assert imagen.headers["Cache-Control"] == "no-store"
        repetida = cliente.post(ruta, headers=ana, files=archivos, data=datos)
        assert repetida.json()["identificador"] == clave
        assert motor.llamadas == 1
        assert clave == clave_resultado("ana", png(), png("red"), "producto", "polera")
        # Borrar una cuenta no afecta a otra; force_regenerate debe ejecutar de nuevo el motor.
        assert cliente.delete(ruta + "/" + clave, headers={"Authorization": "Bearer bea"}).status_code == 204
        assert cliente.get(ruta + "/" + clave, headers=ana).status_code == 200
        cliente.post(ruta, headers=ana, files=archivos, data={**datos, "force_regenerate": "true"})
        for _ in range(50):
            if cliente.get(ruta + "/" + clave, headers=ana).json()["estado"] == "LISTO":
                break
            time.sleep(0.01)
        assert motor.llamadas == 2
        invalida = cliente.post(ruta, headers=ana, files={"persona": ("x", b"rota"), "prenda": ("r", png())}, data=datos)
        assert invalida.status_code == 422
        assert invalida.json()["código"] == "IMAGEN_INVALIDA"
        (tmp_path / (clave + ".png")).write_bytes(b"archivo corrupto")
        assert cliente.get(ruta + "/" + clave + "/imagen", headers=ana).status_code == 404
        assert cliente.get(ruta + "/" + clave, headers=ana).json()["estado"] == "ERROR"
        assert cliente.delete(ruta, headers=ana).status_code == 204
        assert cliente.get(ruta + "/" + clave, headers=ana).status_code == 404
        assert not (tmp_path / (clave + ".png")).exists()


@pytest.mark.anyio
async def test_borrado_durante_inferencia_no_resucita_archivos(tmp_path):
    import threading
    iniciado, terminar = threading.Event(), threading.Event()

    class MotorLento(MotorDeContrato):
        def generar(self, *entrada):
            iniciado.set()
            assert terminar.wait(5)
            return super().generar(*entrada)

    trabajos = TrabajosVton(str(tmp_path), MotorLento())
    trabajo = await trabajos.crear("ana", png(), png("red"), "p", "upper")
    assert await asyncio.to_thread(iniciado.wait, 2)
    trabajos.eliminar("ana", trabajo["identificador"])
    terminar.set()
    await asyncio.gather(*trabajos.tareas)
    with pytest.raises(ErrorProbador):
        trabajos.consultar(trabajo["identificador"], "ana")
    assert list(tmp_path.glob("*.png")) == []
    await trabajos.cerrar()


def test_selfie_protege_mano_sin_coincidencia_schp_y_telefono():
    dp = np.zeros((128, 96), np.uint8)
    dp[20:100, 20:76] = 1
    dp[50:58, 35:44] = 4
    lip = np.zeros_like(dp)
    lip[20:100, 20:76] = 5  # SCHP confunde incluso la mano con ropa.
    atr = np.zeros_like(dp)
    atr[20:100, 20:76] = 4
    oclusion = np.zeros_like(dp)
    oclusion[45:70, 45:60] = 255
    analisis = {"densepose": Image.fromarray(dp), "schp_lip": Image.fromarray(lip), "schp_atr": Image.fromarray(atr), "oclusion": Image.fromarray(oclusion)}
    mascara = np.asarray(mascara_agnostica(analisis, "upper", Image.new("L", (96, 128))))
    assert np.all(mascara[dp == 4] == 0)
    assert np.all(mascara[oclusion > 0] == 0)
    assert mascara[80, 50] == 255
    # Regresión real: ATR Face se extiende sobre el cuello de ropa clasificado por LIP.
    atr[28:35, 35:60] = 11
    analisis["schp_atr"] = Image.fromarray(atr)
    corregida = np.asarray(mascara_agnostica(analisis, "upper", Image.new("L", (96, 128))))
    assert np.all(corregida[28:35, 35:60] == 255)


@pytest.mark.anyio
async def test_recuperacion_y_cola_acotada(tmp_path):
    trabajos = TrabajosVton(str(tmp_path), MotorDeContrato(), maximos=1)
    with trabajos.repositorio.conexion() as db:
        db.execute("insert into trabajos values ('anterior','ana','PROCESANDO',?,null,null)", (time.time(),))
    await trabajos.cerrar()
    trabajos = TrabajosVton(str(tmp_path), MotorDeContrato(), maximos=1)
    assert trabajos.consultar("anterior", "ana")["estado"] == "ERROR"
    with trabajos.repositorio.conexion() as db:
        db.execute("insert into trabajos values ('ocupado','ana','PENDIENTE',?,null,null)", (time.time(),))
    with pytest.raises(ErrorProbador) as capturado:
        await trabajos.crear("ana", png(), png(), "p", "upper")
    assert capturado.value.estado == 429
    with trabajos.repositorio.conexion() as db:
        db.execute("update trabajos set estado='LISTO', creado=0 where clave='ocupado'")
    (tmp_path / "ocupado.png").write_bytes(png())
    trabajos.limpiar_vencidos()
    assert not (tmp_path / "ocupado.png").exists()
    await trabajos.cerrar()


def test_composicion_preserva_fondo_manos_y_transparencia_sin_halo():
    from fuente.infraestructura.catvton import componer_resultado
    original = Image.new("RGBA", (256, 256), (30, 80, 120, 180))
    generado = Image.new("RGB", original.size, "red")
    mascara = Image.new("L", original.size)
    mascara.paste(255, (60, 60, 200, 200))
    protegida = Image.new("L", original.size)
    protegida.paste(255, (100, 80, 130, 150))
    salida = np.asarray(componer_resultado(original, generado, mascara, protegida))
    entrada = np.asarray(original)
    fuera = (np.asarray(mascara) == 0) | (np.asarray(protegida) == 255)
    assert np.array_equal(salida[fuera], entrada[fuera])
    assert np.array_equal(salida[:, :, 3], entrada[:, :, 3])
    assert salida[170, 170, 0] > 200


def test_lectura_convierte_icc_srgb_preserva_alfa_y_rechaza_perfil_roto():
    from PIL import ImageCms
    perfil = ImageCms.ImageCmsProfile(ImageCms.createProfile("sRGB")).tobytes()
    for color in [(255, 0, 0, 128), (0, 255, 0, 255), (0, 0, 255, 0), (128, 128, 128, 255)]:
        entrada = Image.new("RGBA", (256, 256), color)
        buffer = io.BytesIO(); entrada.save(buffer, "PNG", icc_profile=perfil)
        resultado = leer_imagen(buffer.getvalue())
        assert resultado.getpixel((128, 128)) == color
        assert not resultado.info
    buffer = io.BytesIO()
    Image.new("RGB", (256, 256)).save(buffer, "PNG", icc_profile=b"perfil corrupto")
    with pytest.raises(ErrorProbador):
        leer_imagen(buffer.getvalue())


def test_lectura_orienta_exif_y_rechaza_animacion():
    imagen = Image.new("RGB", (256, 300), "blue")
    exif = Image.Exif(); exif[274] = 6
    buffer = io.BytesIO(); imagen.save(buffer, "JPEG", exif=exif)
    assert leer_imagen(buffer.getvalue()).size == (300, 256)
    buffer = io.BytesIO()
    imagen.save(buffer, "PNG", save_all=True, append_images=[Image.new("RGB", imagen.size, "red")], duration=100, loop=0)
    with pytest.raises(ErrorProbador):
        leer_imagen(buffer.getvalue())


def test_precarga_tiene_plazo_independiente_y_cierra_al_agotarse(monkeypatch):
    from types import SimpleNamespace
    from fuente.infraestructura.trabajos_vton import ProcesoVton
    esperas, cerrados = [], []
    conexion = SimpleNamespace(poll=lambda plazo: esperas.append(plazo) or False,
                               close=lambda: cerrados.append("conexion"))
    hijo = SimpleNamespace(close=lambda: None)
    proceso = SimpleNamespace(start=lambda: None, is_alive=lambda: True,
                              terminate=lambda: cerrados.append("terminate"),
                              join=lambda *args: None, kill=lambda: cerrados.append("kill"))
    contexto = SimpleNamespace(Pipe=lambda: (conexion, hijo), Process=lambda **args: proceso)
    monkeypatch.setattr("fuente.infraestructura.trabajos_vton.mp.get_context", lambda _: contexto)
    motor = ProcesoVton("pesos", plazo=7, plazo_carga=42)
    with pytest.raises(ErrorProbador) as capturado:
        motor.iniciar()
    assert capturado.value.codigo == "MOTOR_NO_PREPARADO"
    assert esperas == [42]
    assert motor.plazo == 7
    assert cerrados == ["terminate", "kill", "conexion"]
    assert motor.proceso is None


def test_mezcla_unica_no_reintroduce_ropa_blanca_en_bordes_opacos():
    from fuente.infraestructura.catvton import componer_resultado
    original = Image.new("RGB", (256, 256), "white")
    generado = Image.new("RGB", original.size, (200, 0, 0))
    mascara = Image.new("L", original.size)
    mascara.paste(255, (60, 60, 200, 200))
    protegida = Image.new("L", original.size)
    salida = componer_resultado(original, generado, mascara, protegida)
    assert salida.getpixel((60, 60)) == (200, 0, 0)
    assert salida.getpixel((59, 60)) == (255, 255, 255)
    mascara.putpixel((60, 60), 128)
    salida = componer_resultado(original, generado, mascara, protegida)
    # Alfa 0.5 produce una mezcla 50/50, no 25/75 por composición duplicada.
    assert salida.getpixel((60, 60)) == (227, 127, 127)


@pytest.mark.anyio
async def test_reintentable_cuota_por_titular_y_temporales_huerfanos(tmp_path):
    (tmp_path / "cortado.tmp").write_bytes(b"escritura interrumpida")
    trabajos = TrabajosVton(str(tmp_path), MotorDeContrato(), maximos=4, maximos_titular=1)
    assert not (tmp_path / "cortado.tmp").exists()
    with trabajos.repositorio.conexion() as db:
        db.execute("insert into trabajos values ('gpu','ana','ERROR',?,'GPU_SIN_MEMORIA','sin memoria')", (time.time(),))
        db.execute("insert into trabajos values ('foto','ana','ERROR',?,'PERSONA_INVALIDA','dos personas')", (time.time(),))
        db.execute("insert into trabajos values ('activo','ana','PROCESANDO',?,null,null)", (time.time(),))
    assert trabajos.consultar("gpu", "ana")["reintentable"] is True
    assert trabajos.consultar("foto", "ana")["reintentable"] is False
    # Un titular con un trabajo activo no acapara la GPU; otra cuenta sí puede encolar.
    with pytest.raises(ErrorProbador) as capturado:
        await trabajos.crear("ana", png(), png("red"), "p", "upper")
    assert capturado.value.estado == 429
    assert (await trabajos.crear("bea", png(), png("red"), "p", "upper"))["estado"] in ("PENDIENTE", "PROCESANDO", "LISTO")
    await asyncio.gather(*trabajos.tareas)
    await trabajos.cerrar()


def test_imagen_lleva_huella_para_verificar_integridad(tmp_path):
    import hashlib
    trabajos = TrabajosVton(str(tmp_path), MotorDeContrato())
    with TestClient(crear_aplicacion(trabajos, IdentidadDeContrato())) as cliente:
        ruta, ana = "/api/v1/probador/trabajos", {"Authorization": "Bearer ana"}
        clave = cliente.post(ruta, headers=ana, files={"persona": ("f.png", png(), "image/png"), "prenda": ("r.png", png("red"), "image/png")},
                             data={"identificador": "p", "categoria": "polera"}).json()["identificador"]
        for _ in range(50):
            if cliente.get(f"{ruta}/{clave}", headers=ana).json()["estado"] == "LISTO":
                break
            time.sleep(0.01)
        imagen = cliente.get(f"{ruta}/{clave}/imagen", headers=ana)
        assert imagen.headers["X-Contenido-SHA256"] == hashlib.sha256(imagen.content).hexdigest()


def test_composicion_recupera_fondo_repintado_y_conserva_prenda_nueva():
    from fuente.infraestructura.mascara_vton import alfa_composicion
    mascara = np.zeros((100, 100), np.uint8)
    mascara[10:90, 10:90] = 255                      # margen dilatado que invade el fondo
    fondo_original = np.ones((100, 100), bool)
    fondo_original[30:70, 30:70] = False             # camiseta anterior
    fondo_generado = np.ones((100, 100), bool)
    fondo_generado[25:75, 25:75] = False             # prenda nueva, más ancha que la anterior
    alfa = np.asarray(alfa_composicion(Image.fromarray(mascara), fondo_original, fondo_generado))
    assert alfa[15, 15] == 0, "fondo repintado dentro del margen: vuelve la foto (sin halo)"
    assert alfa[50, 50] == 255 and alfa[28, 50] == 255, "prenda nueva, también fuera de la silueta anterior"
    assert alfa[5, 5] == 0, "fuera de la máscara nunca se edita"
    assert 0 < alfa[25, 50] < 255, "rampa corta en el borde de la prenda, sin costura dura"
    assert alfa[20, 50] == 0
    # Donde había ropa vieja y el resultado es fondo, se usa lo generado: la ropa anterior debe desaparecer.
    fondo_generado[30:70, 30:40] = True
    assert np.asarray(alfa_composicion(Image.fromarray(mascara), fondo_original, fondo_generado))[50, 35] == 255


def test_dobladillo_en_desacuerdo_de_parsers_se_edita():
    dp = np.zeros((128, 96), np.uint8)
    dp[25:90, 30:66] = 1
    lip, atr = np.zeros_like(dp), np.zeros_like(dp)
    lip[25:85, 30:66] = 5
    lip[85:120, 30:66] = 9                           # LIP: pantalón desde la fila 85
    atr[25:95, 30:66] = 4                            # ATR: la camiseta sigue hasta la 95 (dobladillo)
    atr[95:120, 30:66] = 6
    analisis = {"densepose": Image.fromarray(dp), "schp_lip": Image.fromarray(lip), "schp_atr": Image.fromarray(atr)}
    mascara = np.asarray(mascara_agnostica(analisis, "upper", Image.new("L", (96, 128))))
    assert np.all(mascara[86:94, 32:64] == 255), "el dobladillo anterior entra en la edición"
    assert np.all(mascara[100:120, 30:66] == 0), "el pantalón en el que ambos coinciden sigue protegido"


def test_fondo_regenerado_toma_el_tono_local_sin_tocar_prenda():
    from fuente.infraestructura.mascara_vton import igualar_fondo_regenerado
    original = np.full((80, 80, 3), 200, np.uint8)
    original[20:60, 20:50] = 250                     # camiseta blanca anterior, más ancha
    generado = np.full((80, 80, 3), 230, np.uint8)   # el modelo repinta el fondo más claro
    generado[20:60, 20:40] = 30                      # prenda nueva oscura y más estrecha
    editar = np.zeros((80, 80), bool)
    editar[10:70, 10:60] = True
    fondo_o = np.ones((80, 80), bool)
    fondo_o[20:60, 20:50] = False
    fondo_g = np.ones((80, 80), bool)
    fondo_g[20:60, 20:40] = False
    salida = np.asarray(igualar_fondo_regenerado(Image.fromarray(generado), Image.fromarray(original), editar, fondo_o, fondo_g))
    assert abs(int(salida[40, 45, 0]) - 200) <= 2, "el resto de la camiseta vieja toma el tono del fondo real"
    assert np.all(salida[20:60, 20:40] == 30), "la prenda nueva no se recolorea"
