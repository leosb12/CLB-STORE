"""Infraestructura mínima declarativa; no contiene credenciales. Genera la plantilla de CloudFormation."""
import json
from pathlib import Path


def plantilla():
    ref = lambda nombre: {"Ref": nombre}
    sub = lambda texto: {"Fn::Sub": texto}
    recursos = {
        "Archivos": {"Type": "AWS::S3::Bucket", "DeletionPolicy": "Retain", "UpdateReplacePolicy": "Retain", "Properties": {
            "BucketName": "clb-store-archivos-leonardoserrate", "PublicAccessBlockConfiguration": {
                "BlockPublicAcls": True, "BlockPublicPolicy": True, "IgnorePublicAcls": True, "RestrictPublicBuckets": True},
            "OwnershipControls": {"Rules": [{"ObjectOwnership": "BucketOwnerEnforced"}]},
            "BucketEncryption": {"ServerSideEncryptionConfiguration": [{"ServerSideEncryptionByDefault": {"SSEAlgorithm": "AES256"}}]},
            "CorsConfiguration": {"CorsRules": [{"AllowedOrigins": ["https://leonardoserrate.xyz", "https://tienda.leonardoserrate.xyz", "https://clientes.leonardoserrate.xyz"],
                "AllowedMethods": ["GET", "PUT", "HEAD"], "AllowedHeaders": ["content-type", "if-none-match", "x-amz-checksum-sha256", "x-amz-*"],
                "ExposedHeaders": ["ETag", "x-amz-checksum-sha256"], "MaxAge": 300}]},
            "Tags": [{"Key": "Proyecto", "Value": "clb-store"}]}},
        "Despliegues": {"Type": "AWS::S3::Bucket", "DeletionPolicy": "Retain", "UpdateReplacePolicy": "Retain", "Properties": {
            "BucketName": "clb-store-despliegues-leonardoserrate", "PublicAccessBlockConfiguration": {
                "BlockPublicAcls": True, "BlockPublicPolicy": True, "IgnorePublicAcls": True, "RestrictPublicBuckets": True},
            "OwnershipControls": {"Rules": [{"ObjectOwnership": "BucketOwnerEnforced"}]},
            "BucketEncryption": {"ServerSideEncryptionConfiguration": [{"ServerSideEncryptionByDefault": {"SSEAlgorithm": "AES256"}}]},
            "LifecycleConfiguration": {"Rules": [{"Id": "paquetes-temporales", "Status": "Enabled", "ExpirationInDays": 30, "AbortIncompleteMultipartUpload": {"DaysAfterInitiation": 1}}]},
            "Tags": [{"Key": "Proyecto", "Value": "clb-store"}]}},
        "Fidelizacion": {"Type": "AWS::DynamoDB::Table", "DeletionPolicy": "Retain", "UpdateReplacePolicy": "Retain", "Properties": {
            "TableName": "clb_fidelizacion", "BillingMode": "PAY_PER_REQUEST", "DeletionProtectionEnabled": True,
            "AttributeDefinitions": [{"AttributeName": n, "AttributeType": "S"} for n in ["pk", "sk", "identificador_cliente", "fecha"]],
            "KeySchema": [{"AttributeName": "pk", "KeyType": "HASH"}, {"AttributeName": "sk", "KeyType": "RANGE"}],
            "GlobalSecondaryIndexes": [{"IndexName": "clb_por_cliente", "KeySchema": [{"AttributeName": "identificador_cliente", "KeyType": "HASH"}, {"AttributeName": "fecha", "KeyType": "RANGE"}], "Projection": {"ProjectionType": "ALL"}}],
            "PointInTimeRecoverySpecification": {"PointInTimeRecoveryEnabled": True, "RecoveryPeriodInDays": 7},
            "Tags": [{"Key": "Proyecto", "Value": "clb-store"}]}},
        "RegistroArchivos": {"Type": "AWS::DynamoDB::Table", "DeletionPolicy": "Retain", "UpdateReplacePolicy": "Retain", "Properties": {
            "TableName": "clb_archivos", "BillingMode": "PAY_PER_REQUEST", "DeletionProtectionEnabled": True,
            "AttributeDefinitions": [{"AttributeName": n, "AttributeType": "S"} for n in ["identificador", "titular", "fecha"]],
            "KeySchema": [{"AttributeName": "identificador", "KeyType": "HASH"}],
            "GlobalSecondaryIndexes": [{"IndexName": "clb_por_titular", "KeySchema": [{"AttributeName": "titular", "KeyType": "HASH"}, {"AttributeName": "fecha", "KeyType": "RANGE"}], "Projection": {"ProjectionType": "ALL"}}],
            "PointInTimeRecoverySpecification": {"PointInTimeRecoveryEnabled": True, "RecoveryPeriodInDays": 7},
            "Tags": [{"Key": "Proyecto", "Value": "clb-store"}]}},
        "RolClientes": {"Type": "AWS::IAM::Role", "Properties": {
            "AssumeRolePolicyDocument": {"Version": "2012-10-17", "Statement": [{"Effect": "Allow", "Principal": {"Service": "ec2.amazonaws.com"}, "Action": "sts:AssumeRole"}]},
            "ManagedPolicyArns": ["arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore"],
            "Policies": [{"PolicyName": "clb-datos-privados", "PolicyDocument": {"Version": "2012-10-17", "Statement": [
                {"Effect": "Allow", "Action": ["dynamodb:DescribeTable", "dynamodb:GetItem", "dynamodb:PutItem", "dynamodb:UpdateItem", "dynamodb:DeleteItem", "dynamodb:Query", "dynamodb:Scan", "dynamodb:BatchGetItem", "dynamodb:ConditionCheckItem"],
                 "Resource": [sub("arn:aws:dynamodb:${AWS::Region}:${AWS::AccountId}:table/clb_fidelizacion"), sub("arn:aws:dynamodb:${AWS::Region}:${AWS::AccountId}:table/clb_fidelizacion/index/*")]},
                {"Effect": "Allow", "Action": ["dynamodb:DescribeTable", "dynamodb:GetItem", "dynamodb:PutItem", "dynamodb:UpdateItem", "dynamodb:Query"],
                 "Resource": [sub("arn:aws:dynamodb:${AWS::Region}:${AWS::AccountId}:table/clb_archivos"), sub("arn:aws:dynamodb:${AWS::Region}:${AWS::AccountId}:table/clb_archivos/index/*")]},
                {"Effect": "Allow", "Action": ["s3:PutObject", "s3:GetObject", "s3:DeleteObject"], "Resource": sub("${Archivos.Arn}/*")},
                {"Effect": "Allow", "Action": ["s3:GetObject"], "Resource": sub("${Despliegues.Arn}/CLIENTES/*")}
            ]}}], "Tags": [{"Key": "Proyecto", "Value": "clb-store"}]}},
        "PerfilClientes": {"Type": "AWS::IAM::InstanceProfile", "Properties": {"Roles": [ref("RolClientes")]}},
        "RedClientes": {"Type": "AWS::EC2::SecurityGroup", "Properties": {"GroupDescription": "CLB Clientes HTTPS, sin SSH ni puerto Node publico", "VpcId": ref("Vpc"),
            "SecurityGroupIngress": [{"IpProtocol": "tcp", "FromPort": p, "ToPort": p, "CidrIp": "0.0.0.0/0"} for p in [80, 443]],
            "Tags": [{"Key": "Name", "Value": "clb-clientes-https"}, {"Key": "Proyecto", "Value": "clb-store"}]}},
        "ServidorClientes": {"Type": "AWS::EC2::Instance", "Properties": {"ImageId": ref("Imagen"), "InstanceType": "t4g.micro",
            "CreditSpecification": {"CPUCredits": "standard"}, "IamInstanceProfile": ref("PerfilClientes"),
            "SubnetId": ref("Subred"), "SecurityGroupIds": [ref("RedClientes")],
            "MetadataOptions": {"HttpEndpoint": "enabled", "HttpTokens": "required", "HttpPutResponseHopLimit": 1},
            "BlockDeviceMappings": [{"DeviceName": "/dev/sda1", "Ebs": {"VolumeSize": 8, "VolumeType": "gp3", "Encrypted": True, "DeleteOnTermination": True}}],
            "UserData": {"Fn::Base64": (Path(__file__).parent / "preparar-servidor.sh").read_text(encoding="utf-8")},
            "Tags": [{"Key": "Name", "Value": "clb-clientes"}, {"Key": "Proyecto", "Value": "clb-store"}]}},
        "IpClientes": {"Type": "AWS::EC2::EIP", "Properties": {"Domain": "vpc", "Tags": [{"Key": "Name", "Value": "clb-clientes"}, {"Key": "Proyecto", "Value": "clb-store"}]}},
        "AsociacionIp": {"Type": "AWS::EC2::EIPAssociation", "Properties": {"AllocationId": {"Fn::GetAtt": ["IpClientes", "AllocationId"]}, "InstanceId": ref("ServidorClientes")}},
    }
    for nombre in ["Archivos", "Despliegues"]:
        reglas = [{"Sid": "SoloTLS", "Effect": "Deny", "Principal": "*", "Action": "s3:*", "Resource": [sub(f"${{{nombre}.Arn}}"), sub(f"${{{nombre}.Arn}}/*")], "Condition": {"Bool": {"aws:SecureTransport": "false"}}}]
        if nombre == "Archivos":
            reglas.append({"Sid": "NuncaSobrescribir", "Effect": "Deny", "Principal": "*", "Action": "s3:PutObject", "Resource": sub("${Archivos.Arn}/*"), "Condition": {"Null": {"s3:if-none-match": "true"}}})
        recursos[nombre + "Politica"] = {"Type": "AWS::S3::BucketPolicy", "Properties": {"Bucket": ref(nombre), "PolicyDocument": {"Version": "2012-10-17", "Statement": reglas}}}
    return {"AWSTemplateFormatVersion": "2010-09-09", "Description": "CLB Store: Clientes, DynamoDB y S3 privados, administracion SSM",
        "Parameters": {"Vpc": {"Type": "AWS::EC2::VPC::Id"}, "Subred": {"Type": "AWS::EC2::Subnet::Id"}, "Imagen": {"Type": "AWS::EC2::Image::Id"}},
        "Resources": recursos, "Outputs": {"Instancia": {"Value": ref("ServidorClientes")}, "IpPublica": {"Value": ref("IpClientes")},
            "BucketArchivos": {"Value": ref("Archivos")}, "BucketDespliegues": {"Value": ref("Despliegues")}, "Rol": {"Value": ref("RolClientes")}}}


if __name__ == "__main__":
    print(json.dumps(plantilla(), ensure_ascii=False, indent=2))
