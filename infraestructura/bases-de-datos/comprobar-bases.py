"""Comprueba las bases locales con datos temporales y conserva los volúmenes."""

import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import time
import uuid


CARPETA = Path(__file__).resolve().parent


def ejecutar(argumentos, entrada=None, entorno=None):
    resultado = subprocess.run(
        argumentos, cwd=CARPETA, input=entrada, text=True, encoding="utf-8",
        capture_output=True, env=entorno, timeout=180,
    )
    if resultado.returncode:
        raise RuntimeError(resultado.stderr.strip() or resultado.stdout.strip())
    return resultado.stdout.strip()


def componer(*argumentos, entrada=None):
    return ejecutar(["docker", "compose", *argumentos], entrada)


def postgres(sentencia):
    return componer(
        "exec", "-T", "postgres", "sh", "-c",
        'PGPASSWORD="$POSTGRES_PASSWORD" psql -h 127.0.0.1 '
        '-U "$POSTGRES_USER" -d "$POSTGRES_DB" -v ON_ERROR_STOP=1 -At',
        entrada=sentencia,
    )


def mongo(sentencia, administrador=False):
    autenticación = (
        'const base = db.getSiblingDB("admin"); '
        'base.auth(process.env.MONGO_INITDB_ROOT_USERNAME, process.env.MONGO_INITDB_ROOT_PASSWORD); '
        if administrador else
        'const base = db.getSiblingDB("clb_inventario"); '
        'base.auth(process.env.CLB_MONGO_USUARIO, process.env.CLB_MONGO_CLAVE); '
    )
    return componer("exec", "-T", "mongo", "mongosh", "--quiet", "--eval", autenticación + sentencia)


def comprobar():
    if not shutil.which("aws"):
        raise RuntimeError("Se necesita AWS CLI para comprobar DynamoDB Local.")
    configuración = json.loads(componer("config", "--format", "json"))
    entorno = os.environ.copy()
    entorno.update(configuración["services"]["dynamodb"]["environment"])
    entorno.update(AWS_EC2_METADATA_DISABLED="true", AWS_PAGER="", AWS_CONFIG_FILE=os.devnull,
                   AWS_SHARED_CREDENTIALS_FILE=os.devnull, AWS_CLI_FILE_ENCODING="UTF-8",
                   PYTHONIOENCODING="utf-8", PYTHONUTF8="1")
    for nombre_variable in ("AWS_SESSION_TOKEN", "AWS_PROFILE", "AWS_DEFAULT_PROFILE"):
        entorno.pop(nombre_variable, None)
    puerto = configuración["services"]["dynamodb"]["ports"][0]["published"]
    endpoint = f"http://127.0.0.1:{puerto}"

    def dynamodb(operación, parámetros):
        with tempfile.TemporaryDirectory(prefix="clb_prueba_") as carpeta:
            archivo = Path(carpeta) / "parametros.json"
            archivo.write_text(json.dumps(parámetros, ensure_ascii=False), encoding="utf-8")
            salida = ejecutar([
                "aws", "dynamodb", operación, "--endpoint-url", endpoint,
                "--region", entorno["AWS_DEFAULT_REGION"], "--output", "json",
                "--cli-input-json", f"file://{archivo}", "--no-cli-pager",
                "--cli-connect-timeout", "3", "--cli-read-timeout", "5",
            ], entorno=entorno)
            return json.loads(salida) if salida else {}

    def esperar():
        componer("up", "-d", "--wait", "--wait-timeout", "120")
        for intento in range(30):
            try:
                dynamodb("list-tables", {})
                return
            except RuntimeError:
                if intento == 29:
                    raise
                time.sleep(2)

    esperar()
    # Repetir inicialización con autenticación administrativa, sin borrar datos.
    for intento in range(2):
        mongo('load("/docker-entrypoint-initdb.d/inicializar-inventario.js");', administrador=True)
    mongo('let accesoDenegado = false; '
          'try { base.getSiblingDB("admin").runCommand({usersInfo: 1}); } '
          'catch (error) { if (error.code !== 13) throw error; accesoDenegado = true; } '
          'if (!accesoDenegado) throw new Error("El usuario de aplicación tiene permisos excesivos");')
    print("Conexiones e inicialización repetible de MongoDB: correctas.", flush=True)

    nombre = "clb_prueba_" + uuid.uuid4().hex
    valor = "Persistencia: tamaño, año y diseño"
    postgres(f'CREATE TABLE {nombre} (identificador integer PRIMARY KEY, valor text); '
             f"INSERT INTO {nombre} VALUES (1, '{valor}');")
    mongo(f'base.getCollection("{nombre}").insertOne({{_id: "1", valor: {json.dumps(valor)}}});')
    dynamodb("create-table", {
        "TableName": nombre, "AttributeDefinitions": [{"AttributeName": "identificador", "AttributeType": "S"}],
        "KeySchema": [{"AttributeName": "identificador", "KeyType": "HASH"}],
        "BillingMode": "PAY_PER_REQUEST",
    })
    dynamodb("put-item", {"TableName": nombre, "Item": {
        "identificador": {"S": "1"}, "valor": {"S": valor},
    }})

    def verificar():
        if postgres(f"SELECT valor FROM {nombre} WHERE identificador = 1;") != valor:
            raise RuntimeError("La lectura de PostgreSQL no coincide.")
        lectura = mongo(f'print(JSON.stringify(base.getCollection("{nombre}").findOne({{_id: "1"}})));')
        if json.loads(lectura)["valor"] != valor:
            raise RuntimeError("La lectura de MongoDB no coincide.")
        lectura = dynamodb("get-item", {"TableName": nombre, "Key": {"identificador": {"S": "1"}}, "ConsistentRead": True})
        if lectura["Item"]["valor"]["S"] != valor:
            raise RuntimeError("La lectura de DynamoDB Local no coincide.")

    verificar()
    print("Escritura y lectura UTF-8 en las tres bases: correctas.", flush=True)
    componer("restart")
    esperar()
    verificar()
    print("Persistencia después de reiniciar las tres bases: correcta.", flush=True)
    componer("up", "-d", "--force-recreate", "--wait", "--wait-timeout", "120")
    esperar()
    verificar()
    print("Persistencia después de recrear contenedores: correcta.", flush=True)
    postgres(f"DROP TABLE {nombre};")
    mongo(f'base.getCollection("{nombre}").drop();')
    dynamodb("delete-table", {"TableName": nombre})
    print("Recursos temporales eliminados; volúmenes conservados.", flush=True)


if __name__ == "__main__":
    comprobar()
