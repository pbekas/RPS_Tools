#!/usr/bin/env python3
"""Deploy PostgreSQL separately from the application stack.

Keeping the database in its own stack lets us provision and validate staging
without rebuilding or redeploying the production ECS services.
"""

from __future__ import annotations

import os

from aws_cdk import (
    App,
    CfnOutput,
    Duration,
    Environment,
    RemovalPolicy,
    Stack,
    Tags,
    aws_ec2 as ec2,
    aws_ecr_assets as ecr_assets,
    aws_ecs as ecs,
    aws_kms as kms,
    aws_logs as logs,
    aws_rds as rds,
    aws_secretsmanager as secretsmanager,
)
from constructs import Construct


class RpsCallQaDatabaseStack(Stack):
    def __init__(self, scope: Construct, construct_id: str, **kwargs) -> None:
        super().__init__(scope, construct_id, **kwargs)

        vpc_id = self.node.try_get_context("vpcId")
        if not vpc_id:
            raise ValueError("vpcId context is required")

        client_sg_ids = [
            value.strip()
            for value in str(
                self.node.try_get_context("clientSecurityGroupIds") or ""
            ).split(",")
            if value.strip()
        ]
        if not client_sg_ids:
            raise ValueError("clientSecurityGroupIds context is required")

        environment_name = (
            str(self.node.try_get_context("environment") or "staging")
            .strip()
            .lower()
        )
        multi_az = str(
            self.node.try_get_context("multiAz") or "false"
        ).lower() in {"1", "true", "yes", "on"}

        vpc = ec2.Vpc.from_lookup(self, "Vpc", vpc_id=vpc_id)
        database_key = kms.Key(
            self,
            "DatabaseKey",
            alias=f"alias/rps-call-qa-{environment_name}-database",
            description=f"RPS Call QA {environment_name} PostgreSQL encryption key",
            enable_key_rotation=True,
            removal_policy=RemovalPolicy.RETAIN,
        )
        database_security_group = ec2.SecurityGroup(
            self,
            "DatabaseSecurityGroup",
            vpc=vpc,
            description=f"Private PostgreSQL access for RPS Call QA {environment_name}",
            allow_all_outbound=False,
        )
        for index, security_group_id in enumerate(client_sg_ids):
            database_security_group.add_ingress_rule(
                ec2.Peer.security_group_id(security_group_id),
                ec2.Port.tcp(5432),
                f"PostgreSQL from application security group {index + 1}",
            )

        engine = rds.DatabaseInstanceEngine.postgres(
            version=rds.PostgresEngineVersion.VER_16_13
        )
        parameter_group = rds.ParameterGroup(
            self,
            "DatabaseParameterGroup",
            engine=engine,
            parameters={"rds.force_ssl": "1"},
            description=f"RPS Call QA {environment_name} PostgreSQL parameters",
        )
        database = rds.DatabaseInstance(
            self,
            "Database",
            database_name="rps_call_qa",
            instance_identifier=f"rps-call-qa-{environment_name}",
            engine=engine,
            credentials=rds.Credentials.from_generated_secret(
                "rps_app",
                secret_name=f"rps-call-qa/{environment_name}/database",
                encryption_key=database_key,
            ),
            instance_type=ec2.InstanceType.of(
                ec2.InstanceClass.BURSTABLE4_GRAVITON,
                ec2.InstanceSize.MICRO,
            ),
            vpc=vpc,
            vpc_subnets=ec2.SubnetSelection(
                subnet_type=ec2.SubnetType.PRIVATE_WITH_EGRESS
            ),
            security_groups=[database_security_group],
            parameter_group=parameter_group,
            publicly_accessible=False,
            multi_az=multi_az,
            storage_encrypted=True,
            storage_encryption_key=database_key,
            allocated_storage=20,
            max_allocated_storage=100,
            storage_type=rds.StorageType.GP3,
            backup_retention=Duration.days(14),
            delete_automated_backups=False,
            deletion_protection=True,
            cloudwatch_logs_exports=["postgresql"],
            cloudwatch_logs_retention=logs.RetentionDays.ONE_MONTH,
            enable_performance_insights=True,
            performance_insight_encryption_key=database_key,
            performance_insight_retention=rds.PerformanceInsightRetention.DEFAULT,
            iam_authentication=True,
            auto_minor_version_upgrade=True,
            removal_policy=RemovalPolicy.SNAPSHOT,
        )
        if database.secret is None:
            raise ValueError("RDS generated secret was not created")

        migration_task = ecs.FargateTaskDefinition(
            self,
            "MigrationTask",
            cpu=256,
            memory_limit_mib=512,
        )
        migration_task.add_container(
            "migration",
            image=ecs.ContainerImage.from_asset(
                "../..",
                file="Dockerfile.poller",
                platform=ecr_assets.Platform.LINUX_AMD64,
            ),
            command=["python", "scripts/migrate_postgres.py"],
            logging=ecs.LogDrivers.aws_logs(
                stream_prefix=f"database-migration-{environment_name}",
                log_retention=logs.RetentionDays.ONE_MONTH,
            ),
            environment={
                "DB_BACKEND": "postgres",
                "PGSSLMODE": "verify-full",
                "PGSSLROOTCERT": "/etc/ssl/certs/aws-rds-global-bundle.pem",
            },
            secrets={
                "PGHOST": ecs.Secret.from_secrets_manager(database.secret, "host"),
                "PGPORT": ecs.Secret.from_secrets_manager(database.secret, "port"),
                "PGDATABASE": ecs.Secret.from_secrets_manager(database.secret, "dbname"),
                "PGUSER": ecs.Secret.from_secrets_manager(database.secret, "username"),
                "PGPASSWORD": ecs.Secret.from_secrets_manager(database.secret, "password"),
            },
        )
        app_secret = secretsmanager.Secret.from_secret_name_v2(
            self,
            "AppSecret",
            "rps-call-qa/app",
        )
        backfill_task = ecs.FargateTaskDefinition(
            self,
            "BackfillTask",
            cpu=512,
            memory_limit_mib=1024,
        )
        backfill_task.add_container(
            "backfill",
            image=ecs.ContainerImage.from_asset(
                "../..",
                file="Dockerfile.poller",
                platform=ecr_assets.Platform.LINUX_AMD64,
            ),
            command=["python", "scripts/backfill_firestore_to_postgres.py"],
            logging=ecs.LogDrivers.aws_logs(
                stream_prefix=f"database-backfill-{environment_name}",
                log_retention=logs.RetentionDays.ONE_MONTH,
            ),
            environment={
                "DB_BACKEND": "postgres",
                "PGSSLMODE": "verify-full",
                "PGSSLROOTCERT": "/etc/ssl/certs/aws-rds-global-bundle.pem",
            },
            secrets={
                "FIREBASE_SERVICE_ACCOUNT": ecs.Secret.from_secrets_manager(
                    app_secret,
                    "FIREBASE_SERVICE_ACCOUNT",
                ),
                "PGHOST": ecs.Secret.from_secrets_manager(database.secret, "host"),
                "PGPORT": ecs.Secret.from_secrets_manager(database.secret, "port"),
                "PGDATABASE": ecs.Secret.from_secrets_manager(database.secret, "dbname"),
                "PGUSER": ecs.Secret.from_secrets_manager(database.secret, "username"),
                "PGPASSWORD": ecs.Secret.from_secrets_manager(database.secret, "password"),
            },
        )

        Tags.of(self).add("Application", "RPS Call QA")
        Tags.of(self).add("Environment", environment_name)
        Tags.of(self).add("DataClassification", "PHI")

        CfnOutput(self, "DatabaseEndpoint", value=database.db_instance_endpoint_address)
        CfnOutput(self, "DatabasePort", value=database.db_instance_endpoint_port)
        CfnOutput(self, "DatabaseName", value="rps_call_qa")
        CfnOutput(self, "DatabaseSecretArn", value=database.secret.secret_arn)
        CfnOutput(self, "DatabaseKeyArn", value=database_key.key_arn)
        CfnOutput(
            self,
            "DatabaseSecurityGroupId",
            value=database_security_group.security_group_id,
        )
        CfnOutput(self, "MigrationTaskArn", value=migration_task.task_definition_arn)
        CfnOutput(self, "BackfillTaskArn", value=backfill_task.task_definition_arn)
        CfnOutput(self, "MultiAZ", value=str(multi_az).lower())


app = App()
account = app.node.try_get_context("account") or os.environ.get("CDK_DEFAULT_ACCOUNT")
region = (
    app.node.try_get_context("region")
    or os.environ.get("CDK_DEFAULT_REGION")
    or "us-east-1"
)
environment = Environment(account=account, region=region) if account else None
stage = str(app.node.try_get_context("environment") or "staging").strip().title()

RpsCallQaDatabaseStack(
    app,
    f"RpsCallQaDatabase{stage}Stack",
    env=environment,
)
app.synth()
