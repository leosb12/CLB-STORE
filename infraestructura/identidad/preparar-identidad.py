"""Prepara el realm clb de Keycloak con valores del .env local, sin versionar secretos. Es repetible.

- Fija el secreto del cliente de servicio clb-ventas (client credentials).
- Crea si faltan los clientes de servicio clb-ia (fase 8) y clb-n8n (fase 10), con rol servicio, y fija sus secretos.
- Crea o actualiza los usuarios de demostración cliente.demo (rol cliente) y admin.demo (roles admin y cliente).
- Crea o actualiza el cliente confidencial clb-bi (tablero de inteligencia de negocios, código + PKCE S256) con las
  redirecciones de CLB_BI_ORIGENES y fija su secreto.
- Crea el cliente clb-demostracion (password grant) SOLO para los scripts de demostración locales.

Uso (con el contenedor clb_identidad saludable):  python preparar-identidad.py
Nunca imprime claves.
"""
import json
import pathlib
import subprocess
import sys

CONTENEDOR = "clb_identidad"
KCADM = "/opt/keycloak/bin/kcadm.sh"
ENV = pathlib.Path(__file__).resolve().parent.parent / "bases-de-datos" / ".env"


def leer_env():
    valores = {}
    for línea in ENV.read_text(encoding="utf-8").splitlines():
        if "=" in línea and not línea.startswith("#"):
            clave, valor = línea.split("=", 1)
            valores[clave.strip()] = valor.strip()
    return valores


def kcadm(*argumentos, comprobar=True):
    resultado = subprocess.run(["docker", "exec", CONTENEDOR, KCADM, *argumentos], capture_output=True, text=True, encoding="utf-8")
    if comprobar and resultado.returncode != 0:
        # El mensaje de kcadm no contiene claves (se pasan como argumentos, no se repiten en la salida).
        raise SystemExit(f"kcadm falló ({argumentos[0]}): {resultado.stderr.strip()[:300]}")
    return resultado


def exigir(env, clave):
    if not env.get(clave):
        raise SystemExit(f"Defina {clave} en {ENV}")
    return env[clave]


def usuario(env, nombre, correo, nombre_pila, clave_env, roles):
    existentes = json.loads(kcadm("get", "users", "-r", "clb", "-q", f"username={nombre}", "-q", "exact=true", "--fields", "id").stdout or "[]")
    if not existentes:
        kcadm("create", "users", "-r", "clb", "-s", f"username={nombre}", "-s", "enabled=true", "-s", f"email={correo}",
              "-s", "emailVerified=true", "-s", f"firstName={nombre_pila}", "-s", "lastName=Demostración")
    kcadm("set-password", "-r", "clb", "--username", nombre, "--new-password", exigir(env, clave_env))
    for rol in roles:
        kcadm("add-roles", "-r", "clb", "--uusername", nombre, "--rolename", rol)
    print(f"  ✓ usuario {nombre} ({', '.join(roles)})")


def cliente_tablero(env):
    """Tablero Dash en /bi/ (servidor): secreto propio, solo código + PKCE, sin contraseñas ni cuentas de servicio."""
    origenes = [o.strip().rstrip("/") for o in exigir(env, "CLB_BI_ORIGENES").split(",") if o.strip()]
    ajustes = ["-s", "name=CLB Store — tablero de inteligencia de negocios", "-s", "enabled=true", "-s", "publicClient=false",
               "-s", "standardFlowEnabled=true", "-s", "directAccessGrantsEnabled=false", "-s", "serviceAccountsEnabled=false",
               "-s", "implicitFlowEnabled=false", "-s", f"redirectUris={json.dumps([f'{o}/bi/callback' for o in origenes])}",
               "-s", "attributes.\"pkce.code.challenge.method\"=S256",
               "-s", 'defaultClientScopes=["basic","clb-api","profile"]']
    existente = json.loads(kcadm("get", "clients", "-r", "clb", "-q", "clientId=clb-bi", "--fields", "id").stdout)
    if existente:
        kcadm("update", f"clients/{existente[0]['id']}", "-r", "clb", *[a for a in ajustes if not a.startswith("defaultClientScopes")])
    else:
        kcadm("create", "clients", "-r", "clb", "-s", "clientId=clb-bi", *ajustes)
    identificador = json.loads(kcadm("get", "clients", "-r", "clb", "-q", "clientId=clb-bi", "--fields", "id").stdout)[0]["id"]
    kcadm("update", f"clients/{identificador}", "-r", "clb", "-s", f"secret={exigir(env, 'CLB_IDENTIDAD_SECRETO_BI')}")
    print(f"  ✓ cliente clb-bi (código + PKCE S256; {len(origenes)} orígenes)")


def main():
    sys.stdout.reconfigure(encoding="utf-8")
    env = leer_env()
    kcadm("config", "credentials", "--server", "http://127.0.0.1:8080/identidad", "--realm", "master",
          "--user", exigir(env, "CLB_IDENTIDAD_ADMINISTRADOR"), "--password", exigir(env, "CLB_IDENTIDAD_CLAVE_ADMINISTRADOR"))
    print("== Realm clb")
    ventas = json.loads(kcadm("get", "clients", "-r", "clb", "-q", "clientId=clb-ventas", "--fields", "id").stdout)[0]["id"]
    kcadm("update", f"clients/{ventas}", "-r", "clb", "-s", f"secret={exigir(env, 'CLB_IDENTIDAD_SECRETO_VENTAS')}")
    print("  ✓ secreto del cliente de servicio clb-ventas")
    # El realm se importa solo en un volumen vacío: un Keycloak ya creado recibe aquí los clientes nuevos.
    for cliente, nombre, clave in (("clb-ia", "Microservicio de IA (ingesta de eventos)", "CLB_IDENTIDAD_SECRETO_IA"),
                                   ("clb-n8n", "Automatización n8n (flujos entre servicios)", "CLB_IDENTIDAD_SECRETO_N8N")):
        if not json.loads(kcadm("get", "clients", "-r", "clb", "-q", f"clientId={cliente}", "--fields", "id").stdout):
            kcadm("create", "clients", "-r", "clb", "-s", f"clientId={cliente}", "-s", f"name={nombre}",
                  "-s", "publicClient=false", "-s", "serviceAccountsEnabled=true", "-s", "standardFlowEnabled=false",
                  "-s", "directAccessGrantsEnabled=false", "-s", 'defaultClientScopes=["basic","clb-api"]')
        uuid = json.loads(kcadm("get", "clients", "-r", "clb", "-q", f"clientId={cliente}", "--fields", "id").stdout)[0]["id"]
        kcadm("update", f"clients/{uuid}", "-r", "clb", "-s", f"secret={exigir(env, clave)}")
        kcadm("add-roles", "-r", "clb", "--uusername", f"service-account-{cliente}", "--rolename", "servicio")
        print(f"  ✓ cliente de servicio {cliente} (rol servicio)")
    usuario(env, "cliente.demo", "cliente.demo@clb.local", "Cliente", "CLB_IDENTIDAD_CLAVE_CLIENTE_DEMO", ["cliente"])
    usuario(env, "admin.demo", "admin.demo@clb.local", "Administrador", "CLB_IDENTIDAD_CLAVE_ADMIN_DEMO", ["admin", "cliente"])
    cliente_tablero(env)
    # Solo para scripts de demostración locales y solo con la bandera explícita: obtiene tokens sin navegador.
    # Las apps usan Code + PKCE. Nunca se habilita en cloud.
    if env.get("CLB_IDENTIDAD_DEMOSTRACION") != "true":
        existente = json.loads(kcadm("get", "clients", "-r", "clb", "-q", "clientId=clb-demostracion", "--fields", "id").stdout)
        for cliente in existente:
            kcadm("delete", f"clients/{cliente['id']}", "-r", "clb")
        print("  ✓ sin cliente clb-demostracion (CLB_IDENTIDAD_DEMOSTRACION no es true)")
        return
    if not json.loads(kcadm("get", "clients", "-r", "clb", "-q", "clientId=clb-demostracion", "--fields", "id").stdout):
        kcadm("create", "clients", "-r", "clb", "-s", "clientId=clb-demostracion", "-s", "name=Demostraciones locales (no usar en cloud)",
              "-s", "publicClient=true", "-s", "directAccessGrantsEnabled=true", "-s", "standardFlowEnabled=false",
              "-s", 'defaultClientScopes=["basic","clb-api","profile","email"]')
    print("  ✓ cliente clb-demostracion (solo local)")


if __name__ == "__main__":
    try:
        main()
    finally:
        # kcadm guarda un token de admin del realm master: no se deja en el contenedor.
        subprocess.run(["docker", "exec", CONTENEDOR, "rm", "-f", "/opt/keycloak/.keycloak/kcadm.config"], capture_output=True)
