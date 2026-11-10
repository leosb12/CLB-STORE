"""Stack independiente para IA. Nunca actualiza el stack ni la instancia de Clientes."""
from pathlib import Path


def plantilla():
    ref = lambda n: {"Ref": n}
    sub = lambda t: {"Fn::Sub": t}
    return {
        "AWSTemplateFormatVersion": "2010-09-09",
        "Description": "CLB Store: microservicio-ia dedicado g4dn.xlarge, sin apagados programados",
        "Parameters": {
            "Vpc": {"Type": "AWS::EC2::VPC::Id"}, "Subred": {"Type": "AWS::EC2::Subnet::Id"},
            "Imagen": {"Type": "AWS::EC2::Image::Id"},
            "LanzarServidor": {"Type": "String", "AllowedValues": ["si", "no"], "Default": "si"}},
        "Conditions": {"GPUHabilitada": {"Fn::Equals": [ref("LanzarServidor"), "si"]}},
        "Resources": {
            "RolIA": {"Type": "AWS::IAM::Role", "Properties": {
                "AssumeRolePolicyDocument": {"Version": "2012-10-17", "Statement": [{"Effect": "Allow", "Principal": {"Service": "ec2.amazonaws.com"}, "Action": "sts:AssumeRole"}]},
                "ManagedPolicyArns": ["arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore"],
                "Policies": [{"PolicyName": "clb-ia-archivos", "PolicyDocument": {"Version": "2012-10-17", "Statement": [
                    {"Effect": "Allow", "Action": ["s3:GetObject"], "Resource": "arn:aws:s3:::clb-store-despliegues-leonardoserrate/IA/*"},
                    {"Effect": "Allow", "Action": ["s3:PutObject", "s3:GetObject"], "Resource": [
                        "arn:aws:s3:::clb-store-archivos-leonardoserrate/RESPALDOS/ANALITICA/*",
                        "arn:aws:s3:::clb-store-archivos-leonardoserrate/REPORTES/PDF/*",
                        "arn:aws:s3:::clb-store-archivos-leonardoserrate/REPORTES/EXCEL/*"]}]}}],
                "Tags": [{"Key": "Proyecto", "Value": "clb-store"}, {"Key": "Componente", "Value": "ia"}]}},
            "PerfilIA": {"Type": "AWS::IAM::InstanceProfile", "Properties": {"Roles": [ref("RolIA")]}},
            "RedIA": {"Type": "AWS::EC2::SecurityGroup", "Properties": {
                "GroupDescription": "IA HTTPS. Sin SSH, PostgreSQL, Ollama ni workers expuestos directamente",
                "VpcId": ref("Vpc"), "SecurityGroupIngress": [{"IpProtocol": "tcp", "FromPort": p, "ToPort": p, "CidrIp": "0.0.0.0/0"} for p in [80, 443]],
                "Tags": [{"Key": "Name", "Value": "microservicio-ia-https"}, {"Key": "Componente", "Value": "ia"}]}},
            "IpIA": {"Type": "AWS::EC2::EIP", "Properties": {"Domain": "vpc", "Tags": [{"Key": "Name", "Value": "microservicio-ia"}, {"Key": "Componente", "Value": "ia"}]}},
            "ServidorIA": {"Type": "AWS::EC2::Instance", "Condition": "GPUHabilitada", "Properties": {
                "ImageId": ref("Imagen"), "InstanceType": "g4dn.xlarge", "DisableApiTermination": True,
                "IamInstanceProfile": ref("PerfilIA"), "SubnetId": ref("Subred"), "SecurityGroupIds": [ref("RedIA")],
                "MetadataOptions": {"HttpEndpoint": "enabled", "HttpTokens": "required", "HttpPutResponseHopLimit": 1},
                "BlockDeviceMappings": [{"DeviceName": "/dev/sda1", "Ebs": {"VolumeSize": 100, "VolumeType": "gp3", "Encrypted": True, "DeleteOnTermination": False}}],
                "UserData": {"Fn::Base64": (Path(__file__).parent / "preparar-servidor.sh").read_text(encoding="utf-8")},
                "Tags": [{"Key": "Name", "Value": "microservicio-ia"}, {"Key": "Proyecto", "Value": "clb-store"}, {"Key": "Componente", "Value": "ia"}]}},
            "AsociacionIA": {"Type": "AWS::EC2::EIPAssociation", "Condition": "GPUHabilitada", "Properties": {
                "AllocationId": {"Fn::GetAtt": ["IpIA", "AllocationId"]}, "InstanceId": ref("ServidorIA")}}},
        "Outputs": {"IpPublica": {"Value": ref("IpIA")}, "GrupoSeguridad": {"Value": ref("RedIA")}, "Perfil": {"Value": ref("PerfilIA")},
                    "Instancia": {"Condition": "GPUHabilitada", "Value": ref("ServidorIA")},
                    "Dominio": {"Value": "ia.leonardoserrate.xyz"}}}
