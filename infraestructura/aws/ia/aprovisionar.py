"""Prepara IA y lanza exclusivamente g4dn.xlarge cuando AWS permita su cuota. No abre solicitudes."""
import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[3]))
from infraestructura.aws.desplegar import aws, CUENTA
from infraestructura.aws.ia.plantilla import plantilla

STACK = 'clb-store-ia'
LOCALES = Path(__file__).parent.parent / 'datos-locales'


def salidas():
    if aws('sts', 'get-caller-identity')['Account'] != CUENTA:
        raise RuntimeError('Cuenta incorrecta. No se modificará otra cuenta.')
    stack = aws('cloudformation', 'describe-stacks', '--stack-name', STACK)['Stacks'][0]
    return {s['OutputKey']: s['OutputValue'] for s in stack.get('Outputs', [])}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--preparar', action='store_true', help='Crear solo IP fija, rol y red mientras AWS habilita GPU.')
    parser.add_argument('--aplicar', action='store_true', help='Crear/actualizar IA con la GPU seleccionada y costo autorizado.')
    args = parser.parse_args()
    if aws('sts', 'get-caller-identity')['Account'] != CUENTA:
        raise RuntimeError('Cuenta incorrecta.')
    if not (args.preparar or args.aplicar):
        print(json.dumps(salidas(), indent=2)); return
    cuota = aws('service-quotas', 'get-service-quota', '--service-code', 'ec2', '--quota-code', 'L-DB2E81BA')['Quota']['Value']
    plan = aws('freetier', 'get-account-plan-state')
    lanzar = args.aplicar and cuota >= 4 and plan['accountPlanType'] == 'PAID'
    if args.aplicar and not lanzar:
        raise RuntimeError(f'AWS aún impide lanzar g4dn.xlarge: cuota G={cuota}, plan={plan["accountPlanType"]}. No se abrió otra solicitud.')
    LOCALES.mkdir(exist_ok=True)
    archivo = LOCALES / 'plantilla-ia.json'
    archivo.write_text(json.dumps(plantilla(), ensure_ascii=True), encoding='utf-8')
    argumentos = ['--stack-name', STACK, '--template-body', 'file://' + str(archivo.resolve()), '--capabilities', 'CAPABILITY_IAM']
    try:
        anterior = aws('cloudformation', 'describe-stacks', '--stack-name', STACK)['Stacks'][0]
    except RuntimeError as e:
        if 'does not exist' not in str(e): raise
        subred = next(s for s in aws('ec2', 'describe-subnets')['Subnets'] if s['VpcId'] == 'vpc-0b9602e59bd072704' and s['AvailabilityZone'] == 'us-east-2a')
        parametros = [{'ParameterKey': k, 'ParameterValue': v} for k, v in [('Vpc', subred['VpcId']), ('Subred', subred['SubnetId']),
            ('Imagen', 'ami-020e0c63fc237b957'), ('LanzarServidor', 'si' if lanzar else 'no')]]
        print(json.dumps(aws('cloudformation', 'create-stack', *argumentos, '--parameters', json.dumps(parametros),
            '--on-failure', 'DO_NOTHING', '--enable-termination-protection', '--tags', 'Key=Proyecto,Value=clb-store', 'Key=Componente,Value=ia')), flush=True)
    else:
        # No retirar una instancia existente por ejecutar --preparar.
        vigente = next(p['ParameterValue'] for p in anterior['Parameters'] if p['ParameterKey'] == 'LanzarServidor')
        parametros = [{'ParameterKey': k, 'UsePreviousValue': True} for k in ['Vpc', 'Subred', 'Imagen']]
        parametros.append({'ParameterKey': 'LanzarServidor', 'ParameterValue': 'si' if lanzar or vigente == 'si' else 'no'})
        try: print(json.dumps(aws('cloudformation', 'update-stack', *argumentos, '--parameters', json.dumps(parametros))), flush=True)
        except RuntimeError as e:
            if 'No updates are to be performed' not in str(e): raise
            print('Stack IA sin cambios.', flush=True)
    print('Consultar estado de clb-store-ia. Clientes no se modificó. No hay apagados automáticos.', flush=True)


if __name__ == '__main__':
    try: main()
    except RuntimeError as e: raise SystemExit(str(e))
