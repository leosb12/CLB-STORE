"""Tablero: SSO OIDC (state, nonce, PKCE, firma, iss, aud, exp; tokens fuera de URL y cookie), formato boliviano,
filtros y que el tablero no recalcula KPI (pide a IA y muestra). Keycloak e IA son dobles; la validación es la real de Authlib."""
import base64
import json
import time
from urllib.parse import parse_qs, urlsplit

import pytest
from joserfc import jwt
from joserfc.jwk import KeySet, RSAKey

from fuente.adaptadores.ia import SinPermiso
from fuente.adaptadores.sso import ConfiguracionSso
from fuente.aplicacion.tablero import Tablero
from fuente.dominio.tablero import FiltroInvalido, Filtros, bs, entero
from fuente.presentacion.app import crear_aplicacion

ORIGEN = "http://127.0.0.1:14200"
CONFIG = ConfiguracionSso("clb-bi", "secreto-cliente", "s" * 32, "http://127.0.0.1:18000/identidad",
                          "http://identidad:8080/identidad", (ORIGEN,))
EMISOR = "http://127.0.0.1:18000/identidad/realms/clb"
CLAVE = RSAKey.generate_key(2048, parameters={"kid": "k1"})
OTRA = RSAKey.generate_key(2048, parameters={"kid": "k1"})


def _id_token(nonce_esperado, clave=CLAVE, **cambios):
    ahora = int(time.time())
    claims = {"iss": EMISOR, "aud": "clb-bi", "sub": "admin-1", "exp": ahora + 300, "iat": ahora, "nonce": nonce_esperado,
              "azp": "clb-bi", **cambios}
    return jwt.encode({"alg": "RS256", "kid": "k1"}, claims, clave)


def _cliente(app):
    cliente = app.server.test_client()
    original = cliente.get
    cliente.get = lambda ruta, **kw: original(ruta, base_url=ORIGEN, **kw)  # Host con puerto, como lo reenvía la web nginx
    return cliente


def _app():
    app = crear_aplicacion(CONFIG, ia=object())
    sso = next(f.__self__ for n, f in app.server.view_functions.items() if n == "callback")
    sso.keycloak.server_metadata["jwks"] = KeySet([CLAVE]).as_dict(private=False)
    return app, sso


def _ingresar(cliente):
    respuesta = cliente.get("/bi/ingresar")
    assert respuesta.status_code == 302
    return {k: v[0] for k, v in parse_qs(urlsplit(respuesta.headers["Location"]).query).items()}


def _cookie(cliente) -> str:
    valor = cliente.get_cookie("clb_bi_sesion", domain="127.0.0.1", path="/bi/").value
    datos = valor.split(".")[0].lstrip(".")
    return base64.urlsafe_b64decode(datos + "=" * (-len(datos) % 4)).decode(errors="ignore")


def test_autorizacion_con_pkce_s256_nonce_y_origen_en_lista_blanca():
    app, _ = _app()
    cliente = _cliente(app)
    p = _ingresar(cliente)
    assert p["client_id"] == "clb-bi" and p["code_challenge_method"] == "S256" and p["code_challenge"] and p["nonce"]
    assert p["redirect_uri"] == f"{ORIGEN}/bi/callback" and "openid" in p["scope"]
    assert "code_verifier" not in _cookie(cliente)  # el estado temporal queda en el servidor
    assert cliente.get("/bi/ingresar", headers={"Host": "evil.example"}).status_code == 400
    assert cliente.get("/bi/").headers["Location"].endswith("/bi/ingresar")


def test_callback_valido_abre_sesion_sin_tokens_en_url_ni_cookie():
    app, sso = _app()
    cliente = _cliente(app)
    p = _ingresar(cliente)
    sso.keycloak.fetch_access_token = lambda **_: {"access_token": "AT-secreto", "refresh_token": "RT", "expires_in": 300,
                                                   "token_type": "Bearer", "id_token": _id_token(p["nonce"])}
    respuesta = cliente.get(f"/bi/callback?code=c1&state={p['state']}")
    assert respuesta.status_code == 302 and respuesta.headers["Location"] == "/bi/"
    assert "AT-secreto" not in _cookie(cliente) and '"RT"' not in _cookie(cliente) and "sid" in _cookie(cliente)
    assert cliente.get("/bi/").status_code == 200
    assert cliente.get(f"/bi/callback?code=c1&state={p['state']}").status_code == 401  # el state no se reutiliza


@pytest.mark.parametrize("caso", ["state", "nonce", "aud", "exp", "firma", "iss"])
def test_callback_rechaza_respuestas_invalidas(caso):
    app, sso = _app()
    cliente = _cliente(app)
    p = _ingresar(cliente)
    cambios = {"nonce": {"nonce": "otro"}, "aud": {"aud": "clb-web", "azp": "clb-web"}, "exp": {"exp": int(time.time()) - 600},
               "iss": {"iss": "http://atacante/realms/clb"}}.get(caso, {})
    token = _id_token(p["nonce"], clave=OTRA if caso == "firma" else CLAVE, **cambios)
    sso.keycloak.fetch_access_token = lambda **_: {"access_token": "AT", "expires_in": 300, "token_type": "Bearer",
                                                   "id_token": token}
    state = "manipulado" if caso == "state" else p["state"]
    assert cliente.get(f"/bi/callback?code=c1&state={state}").status_code == 401
    assert cliente.get("/bi/").status_code == 302  # sigue sin sesión


def test_formato_boliviano_y_filtros():
    assert bs(13845000) == "Bs 138.450,00" and bs(5) == "Bs 0,05" and bs(None) == "—" and entero(10058) == "10.058"
    from datetime import date
    assert Filtros(date(2026, 10, 1), date(2026, 10, 31), "Buzos").variables() == {"d": "2026-10-01", "h": "2026-10-31",
                                                                                   "c": "Buzos", "p": None}
    for malos in ((date(2026, 10, 1), None), (date(2026, 10, 2), date(2026, 10, 1)), (date(2025, 1, 1), date(2026, 10, 31))):
        with pytest.raises(FiltroInvalido):
            Filtros(*malos)


class IAFalsa:
    def __init__(self):
        self.llamadas = []

    def indicadores(self, variables, token):
        self.llamadas.append((variables, token))
        return {"kpi": {"ingresos_centavos": 1}}

    def generar_reporte(self, especificacion, token):
        self.llamadas.append((especificacion, token))
        return {"identificador": "r1"}


def test_el_tablero_delega_los_kpi_y_el_reporte_reutiliza_la_especificacion():
    ia = IAFalsa()
    tablero = Tablero(ia, lambda: "tok")
    assert tablero.indicadores(Filtros()) == {"kpi": {"ingresos_centavos": 1}}
    mensual = {"conjunto": "DEMOSTRACION", "periodo": "RANGO", "desde": "2026-10-01", "hasta": "2026-10-31",
               "filtros": [{"campo": "CATEGORIA", "operador": "IGUAL", "valor": "Buzos"}], "columnas": ["MES", "MONTO"]}
    tablero.generar_reporte({"mensual": mensual})
    enviada = ia.llamadas[-1][0]
    assert {k: enviada[k] for k in mensual} == mensual and enviada["grafico"]["eje"] == "MES"
    with pytest.raises(Exception):
        Tablero(ia, lambda: None).indicadores(Filtros())


def test_sin_permiso_se_muestra_como_estado():
    class Negada(IAFalsa):
        def indicadores(self, variables, token):
            raise SinPermiso()
    app = crear_aplicacion(CONFIG, ia=Negada())
    callback = app.callback_map
    assert any("contenido.children" in k for k in callback)
    json.dumps(app.layout.to_plotly_json(), default=str)  # el layout se serializa


def test_descarga_del_dataset_con_token_y_solo_nombres_permitidos():
    class IA(IAFalsa):
        def dataset_csv(self, nombre, token):
            self.llamadas.append((nombre, token))
            return b"fecha;pedido\n", f"clb-demostracion-{nombre}.csv"
    ia = IA()
    assert Tablero(ia, lambda: "tok").descargar_dataset("completo") == (b"fecha;pedido\n", "clb-demostracion-completo.csv")
    assert ia.llamadas[-1] == ("completo", "tok")
    with pytest.raises(ValueError):
        Tablero(ia, lambda: "tok").descargar_dataset("../reportes")
