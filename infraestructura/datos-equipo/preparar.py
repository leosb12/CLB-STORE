"""Semilla compartible y reinicio coordinado del stack LOCAL. Sin dependencias Python externas."""
import argparse
import base64
import hashlib
import json
import pathlib
import subprocess

CARPETA = pathlib.Path(__file__).resolve().parent
RAIZ = CARPETA.parent.parent
SEMILLA = CARPETA / 'semilla'
COMPOSE = RAIZ / 'infraestructura/bases-de-datos'


def ejecutar(*args, entrada=None):
    r = subprocess.run(list(args), input=entrada, capture_output=True, text=True, encoding='utf-8', cwd=RAIZ)
    if r.returncode:
        raise RuntimeError(f'Falló {args[0]} {args[1]}: {r.stderr[-1500:]} {r.stdout[-800:]}')
    return r.stdout


def copiar(origen, destino):
    ejecutar('docker', 'cp', str(origen), destino)


def comprobar_semilla():
    s = json.loads((SEMILLA / 'catalogo.json').read_text(encoding='utf-8'))
    if s.get('version') != 1 or not s.get('productos') or not s.get('variantes'):
        raise ValueError('Semilla incompleta')
    ids = [p['identificador'] for p in s['productos']]
    if len(ids) != len(set(ids)) or not 1 <= s['stock_inicial'] <= 1000:
        raise ValueError('Identificadores o stock inválidos')
    hashes = set()
    for p in s['productos']:
        if any(k.startswith('clb_') for k in p) or p['nombre'].startswith('[DEMO]'):
            raise ValueError('La semilla contiene historial o productos de prueba')
        r = p.get('recurso_probador')
        if r:
            hashes.update(filter(None, [r['sha256'], r.get('maestro_sha256'), (r.get('espalda') or {}).get('sha256')]))
    for h in hashes:
        if len(h) != 64 or any(c not in '0123456789abcdef' for c in h):
            raise ValueError('Hash inválido')
        if hashlib.sha256((SEMILLA / 'recursos' / f'{h}.png').read_bytes()).hexdigest() != h:
            raise ValueError(f'Recurso corrupto: {h}')
    for v in s['variantes']:
        if v['identificador_producto'] not in ids or any(k in v for k in ('movimientos','reservas')):
            raise ValueError('Variante inválida')
    return s


def instalar_auxiliares():
    copiar(CARPETA / 'catalogo.php', 'clb_backend_inventario:/tmp/clb-catalogo.php')


def exportar():
    if (SEMILLA / 'catalogo.json').exists():
        raise ValueError('La semilla ya existe; no se sobrescribe automáticamente')
    instalar_auxiliares()
    s = json.loads(ejecutar('docker','exec','clb_backend_inventario','php','/tmp/clb-catalogo.php','exportar'))
    archivos = s.pop('archivos')
    (SEMILLA / 'recursos').mkdir(parents=True, exist_ok=True)
    for h, contenido in archivos.items():
        datos = base64.b64decode(contenido, validate=True)
        if hashlib.sha256(datos).hexdigest() != h:
            raise ValueError('Hash de exportación inválido')
        (SEMILLA / 'recursos' / f'{h}.png').write_bytes(datos)
    (SEMILLA / 'catalogo.json').write_text(json.dumps(s,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    comprobar_semilla()
    print(f"Semilla: {len(s['productos'])} productos, {len(s['variantes'])} variantes, {len(archivos)} recursos. Sin usuarios ni ventas.")


def importar(modo):
    comprobar_semilla()
    instalar_auxiliares()
    ejecutar('docker','exec','clb_backend_inventario','mkdir','-p','/tmp/clb-semilla')
    copiar(str(SEMILLA) + '/.', 'clb_backend_inventario:/tmp/clb-semilla')
    print(ejecutar('docker','exec','clb_backend_inventario','php','/tmp/clb-catalogo.php',modo,'/tmp/clb-semilla/catalogo.json').strip())


def reiniciar():
    comprobar_semilla()
    # Verificar destino, usuarios y volúmenes antes de detener servicios o modificar datos.
    nombres = ['clb_pasarela','clb_backend_ventas','clb_backend_ia','clb_automatizacion','clb_worker_prendas','clb_worker_vton']
    todos = json.loads(ejecutar('docker','inspect','clb_backend_inventario','clb_backend_clientes','clb_postgres','clb_automatizacion','clb_backend_ia'))
    for cont in todos:
        if cont['Config']['Labels'].get('com.docker.compose.project') != 'clb-store':
            raise ValueError('Contenedor fuera del proyecto clb-store')
    env_cliente = dict(e.split('=',1) for e in todos[1]['Config']['Env'])
    if env_cliente.get('CLB_ENTORNO') != 'local' or env_cliente.get('CLB_DYNAMODB_ENDPOINT') != 'http://dynamodb:8000':
        raise ValueError('Solo se permite el stack local')
    env_pg = dict(e.split('=',1) for e in todos[2]['Config']['Env'])
    usuario = env_pg['POSTGRES_USER']
    volumen = next(m['Name'] for m in todos[3]['Mounts'] if m['Destination']=='/home/node/.n8n')
    if volumen != 'clb_datos_n8n':
        raise ValueError('Volumen n8n inesperado')
    activos = set(ejecutar('docker','ps','--format','{{.Names}}').splitlines())
    detener = [n for n in nombres if n in activos]
    copiar(CARPETA / 'limpiar-clientes.mjs', 'clb_backend_clientes:/app/clb-limpiar-clientes.mjs')
    print(ejecutar('docker','exec','clb_backend_clientes','node','/app/clb-limpiar-clientes.mjs').strip())
    ejecutar('docker','stop',*detener)
    try:
        ventas = 'comprobantes,pasos_saga,sagas_compra,lineas_pedido,claves_idempotencia,eventos,pedidos'
        analitica = 'cursores,eventos_procesados,lineas_venta,pedidos,existencias,alertas_stock,reportes,auditoria_agentes,propuestas_reposicion,notificaciones,eventos_rechazados'
        for base, tablas in [('clb_ventas',ventas),('clb_analitica',analitica)]:
            ejecutar('docker','exec','clb_postgres','psql','-v','ON_ERROR_STOP=1','-U',usuario,'-d',base,'-c',f'BEGIN; TRUNCATE {tablas} RESTART IDENTITY; COMMIT;')
            print(base + ': operaciones vaciadas; esquema conservado')
        print(ejecutar('docker','exec','clb_backend_clientes','node','/app/clb-limpiar-clientes.mjs','--aplicar').strip())
        importar('reiniciar')
        print(ejecutar('docker','run','--rm','-i','--network','none','--user','0','--entrypoint','python',
            '-v',volumen+':/datos',todos[4]['Config']['Image'],'-',entrada=(CARPETA/'limpiar-n8n.py').read_text(encoding='utf-8')).strip())
    except Exception:
        print('Reinicio incompleto. Escritores y pasarela quedan detenidos para impedir reprocesos. Corrija la causa y repita el mismo comando.')
        raise
    ejecutar('docker','start',*[n for n in detener if n != 'clb_pasarela'])
    # Las dependencias se comprueban antes de volver a aceptar solicitudes externas.
    import time
    for _ in range(60):
        estados = json.loads(ejecutar('docker','inspect',*[n for n in detener if n != 'clb_pasarela']))
        if all(c['State']['Running'] and c['State'].get('Health',{}).get('Status','healthy')=='healthy' for c in estados):
            break
        time.sleep(2)
    else:
        raise RuntimeError('Servicios aún no saludables; la pasarela sigue detenida. Revisar docker compose ps.')
    if 'clb_pasarela' in detener:
        ejecutar('docker','start','clb_pasarela')
    print('Reinicio completo. Usuarios de Keycloak y perfiles conservados. Renueve cachés/colas de los clientes antes de probar.')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('accion', choices=['validar','exportar','importar','reiniciar'])
    parser.add_argument('--confirmar-borrado-local', action='store_true')
    args = parser.parse_args()
    if args.accion == 'exportar': exportar()
    elif args.accion == 'validar':
        s=comprobar_semilla(); print(f"Semilla válida: {len(s['productos'])} productos y {len(s['variantes'])} variantes")
    elif args.accion == 'importar': importar('importar')
    elif not args.confirmar_borrado_local:
        parser.error('Reiniciar elimina operaciones locales. Requiere --confirmar-borrado-local; no se crean respaldos automáticamente.')
    else: reiniciar()


if __name__ == '__main__':
    main()
