"""Recrear/actualizar la infraestructura propia, con cuenta y región fijas; no modifica DNS ni políticas de la organización."""
import argparse
import json
from pathlib import Path

from desplegar import aws, CUENTA, REGION
from plantilla import plantilla


def presupuesto():
    nombre = "clb-store-mensual"
    existentes = aws("budgets", "describe-budgets", "--account-id", CUENTA).get("Budgets", [])
    if any(b["BudgetName"] == nombre for b in existentes):
        print("Presupuesto ya existente:", nombre)
        return
    presupuesto = {"BudgetName": nombre, "BudgetType": "COST", "TimeUnit": "MONTHLY", "BudgetLimit": {"Amount": "12", "Unit": "USD"},
                   "CostTypes": {"IncludeCredit": False, "IncludeRefund": False, "UseAmortized": False}}
    notificaciones = [{"Notification": {"NotificationType": tipo, "ComparisonOperator": "GREATER_THAN", "Threshold": umbral, "ThresholdType": "PERCENTAGE"},
                       "Subscribers": [{"SubscriptionType": "EMAIL", "Address": "playstsb@gmail.com"}]} for tipo, umbral in [("ACTUAL", 50), ("ACTUAL", 80), ("FORECASTED", 100)]]
    aws("budgets", "create-budget", "--account-id", CUENTA, "--budget", json.dumps(presupuesto), "--notifications-with-subscribers", json.dumps(notificaciones))
    print("Presupuesto de USD 12/mes creado: avisos al 50 %, 80 % real y 100 % previsto, antes de créditos. No impone un tope de gasto.")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--aplicar", action="store_true", help="Crear o actualizar recursos con costo autorizado.")
    parser.add_argument("--presupuesto", action="store_true")
    args = parser.parse_args()
    if aws("sts", "get-caller-identity")["Account"] != CUENTA:
        raise RuntimeError("La cuenta de AWS no corresponde a CLB Store.")
    if args.presupuesto:
        presupuesto()
    if not args.aplicar:
        print(json.dumps(aws("cloudformation", "describe-stacks", "--stack-name", "clb-store-aws")["Stacks"][0].get("Outputs", []), indent=2))
        return
    locales = Path(__file__).parent / "datos-locales"
    locales.mkdir(exist_ok=True)
    archivo = locales / "plantilla.json"
    archivo.write_text(json.dumps(plantilla(), ensure_ascii=True), encoding="utf-8")
    argumentos = ["--stack-name", "clb-store-aws", "--template-body", "file://" + str(archivo.resolve()), "--capabilities", "CAPABILITY_IAM"]
    try:
        aws("cloudformation", "describe-stacks", "--stack-name", "clb-store-aws")
    except RuntimeError as error:
        if "does not exist" not in str(error):
            raise
        vpc = next(v for v in aws("ec2", "describe-vpcs")["Vpcs"] if v["IsDefault"])
        subred = next(s for s in aws("ec2", "describe-subnets")["Subnets"] if s["VpcId"] == vpc["VpcId"] and s["DefaultForAz"])
        imagen = aws("ssm", "get-parameter", "--name", "/aws/service/canonical/ubuntu/server/24.04/stable/current/arm64/hvm/ebs-gp3/ami-id")["Parameter"]["Value"]
        parametros = [{"ParameterKey": k, "ParameterValue": v} for k, v in [("Vpc", vpc["VpcId"]), ("Subred", subred["SubnetId"]), ("Imagen", imagen)]]
        print(aws("cloudformation", "create-stack", *argumentos, "--parameters", json.dumps(parametros), "--on-failure", "DO_NOTHING", "--tags", "Key=Proyecto,Value=clb-store"))
    else:
        parametros = [{"ParameterKey": k, "UsePreviousValue": True} for k in ["Vpc", "Subred", "Imagen"]]
        try:
            print(aws("cloudformation", "update-stack", *argumentos, "--parameters", json.dumps(parametros)))
        except RuntimeError as error:
            if "No updates are to be performed" not in str(error):
                raise
            print("Infraestructura vigente, sin cambios.")
    print("Consultar CloudFormation en", REGION, "antes de continuar. Bootstrap se ejecuta al primer arranque; cambiar UserData puede interrumpir una instancia existente.")


if __name__ == "__main__":
    main()
