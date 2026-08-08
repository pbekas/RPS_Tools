"""
RPS Call QA — production CDK stack (Next.js + Vonage poller).

Deploys:
  - ALB (HTTPS) → ECS Fargate Next.js review UI
  - ECS Fargate Vonage poller (no public listener)
  - Imports existing S3 recordings bucket
  - Reads secrets from Secrets Manager `rps-call-qa/app`

Prereqs:
  npm i -g aws-cdk
  pip install -r requirements.txt
  Create/fill secret (see scripts/push_aws_secret.sh)
  ACM cert for tool.releviumpain.com (pass -c certificateArn=...)

Deploy:
  cd infra/aws
  cdk bootstrap   # once per account/region
  cdk deploy -c certificateArn=arn:aws:acm:... \\
             -c domainName=tool.releviumpain.com \\
             -c recordingsBucketName=rps-call-qa-recordings-013908492747
"""

from __future__ import annotations

import json

from aws_cdk import (
    App,
    CfnOutput,
    Duration,
    RemovalPolicy,
    Stack,
    aws_certificatemanager as acm,
    aws_ec2 as ec2,
    aws_ecr_assets as ecr_assets,
    aws_ecs as ecs,
    aws_ecs_patterns as ecs_patterns,
    aws_elasticloadbalancingv2 as elbv2,
    aws_iam as iam,
    aws_kms as kms,
    aws_logs as logs,
    aws_rds as rds,
    aws_s3 as s3,
    aws_secretsmanager as secretsmanager,
)
from constructs import Construct


DEFAULT_DOMAIN = "tool.releviumpain.com"
DEFAULT_BUCKET = "rps-call-qa-recordings-013908492747"
SECRET_NAME = "rps-call-qa/app"
DEFAULT_BEDROCK = "us.anthropic.claude-haiku-4-5-20251001-v1:0"
DEFAULT_COACHING = "us.anthropic.claude-sonnet-4-5-20250929-v1:0"


class RpsCallQaStack(Stack):
    def __init__(self, scope: Construct, construct_id: str, **kwargs) -> None:
        super().__init__(scope, construct_id, **kwargs)

        domain = self.node.try_get_context("domainName") or DEFAULT_DOMAIN
        bucket_name = (
            self.node.try_get_context("recordingsBucketName") or DEFAULT_BUCKET
        )
        cert_arn = self.node.try_get_context("certificateArn")
        bedrock_model = (
            self.node.try_get_context("bedrockModelId") or DEFAULT_BEDROCK
        )
        coaching_model = (
            self.node.try_get_context("bedrockCoachingModelId") or DEFAULT_COACHING
        )
        enable_rds = str(
            self.node.try_get_context("enableRds") or "false"
        ).lower() in {"1", "true", "yes", "on"}
        rds_multi_az = str(
            self.node.try_get_context("rdsMultiAz") or "false"
        ).lower() in {"1", "true", "yes", "on"}
        db_backend = str(
            self.node.try_get_context("dbBackend") or "firestore"
        ).lower()
        database_secret_arn = str(
            self.node.try_get_context("databaseSecretArn") or ""
        ).strip()
        database_key_arn = str(
            self.node.try_get_context("databaseKeyArn") or ""
        ).strip()
        if db_backend not in {"firestore", "postgres"}:
            raise ValueError("dbBackend must be firestore or postgres")
        db_dual_write = str(
            self.node.try_get_context("dbDualWrite") or "false"
        ).lower() in {"1", "true", "yes", "on"}
        if db_dual_write:
            raise ValueError(
                "dbDualWrite is reserved for migration phase 3 and is not "
                "implemented yet"
            )
        if db_backend == "postgres" and not (enable_rds or database_secret_arn):
            raise ValueError(
                "enableRds=true or databaseSecretArn is required "
                "when dbBackend=postgres"
            )
        if database_secret_arn and not database_key_arn:
            raise ValueError(
                "databaseKeyArn is required with databaseSecretArn "
                "so ECS can decrypt database credentials"
            )

        vpc = ec2.Vpc(
            self,
            "Vpc",
            max_azs=2,
            nat_gateways=1,
        )

        recordings = s3.Bucket.from_bucket_name(
            self, "RecordingsBucket", bucket_name
        )

        app_secret = secretsmanager.Secret.from_secret_name_v2(
            self, "AppSecret", SECRET_NAME
        )

        database: rds.DatabaseInstance | None = None
        database_key: kms.IKey | None = None
        database_secret: secretsmanager.ISecret | None = None
        database_secrets: dict[str, ecs.Secret] = {}
        if enable_rds:
            database_key = kms.Key(
                self,
                "DatabaseKey",
                enable_key_rotation=True,
                removal_policy=RemovalPolicy.RETAIN,
                description="RPS Call QA PostgreSQL encryption key",
            )
            database = rds.DatabaseInstance(
                self,
                "Database",
                engine=rds.DatabaseInstanceEngine.postgres(
                    version=rds.PostgresEngineVersion.VER_16_13
                ),
                credentials=rds.Credentials.from_generated_secret("rps_app"),
                database_name="rps_call_qa",
                instance_type=ec2.InstanceType.of(
                    ec2.InstanceClass.BURSTABLE4_GRAVITON,
                    ec2.InstanceSize.MICRO,
                ),
                vpc=vpc,
                vpc_subnets=ec2.SubnetSelection(
                    subnet_type=ec2.SubnetType.PRIVATE_WITH_EGRESS
                ),
                publicly_accessible=False,
                multi_az=rds_multi_az,
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
                performance_insight_retention=rds.PerformanceInsightRetention.DEFAULT,
                enable_performance_insights=True,
                auto_minor_version_upgrade=True,
                removal_policy=RemovalPolicy.SNAPSHOT,
            )
            if database.secret is None:
                raise ValueError("RDS generated secret was not created")
            database_secret = database.secret
        elif database_secret_arn:
            database_key = kms.Key.from_key_arn(
                self,
                "ImportedDatabaseKey",
                database_key_arn,
            )
            database_secret = secretsmanager.Secret.from_secret_attributes(
                self,
                "DatabaseSecret",
                secret_complete_arn=database_secret_arn,
                encryption_key=database_key,
            )

        if database_secret is not None:
            database_secrets = {
                "PGHOST": ecs.Secret.from_secrets_manager(database_secret, "host"),
                "PGPORT": ecs.Secret.from_secrets_manager(database_secret, "port"),
                "PGDATABASE": ecs.Secret.from_secrets_manager(
                    database_secret, "dbname"
                ),
                "PGUSER": ecs.Secret.from_secrets_manager(
                    database_secret, "username"
                ),
                "PGPASSWORD": ecs.Secret.from_secrets_manager(
                    database_secret, "password"
                ),
            }
        firestore_secrets = (
            {
                "FIREBASE_SERVICE_ACCOUNT": ecs.Secret.from_secrets_manager(
                    app_secret, "FIREBASE_SERVICE_ACCOUNT"
                )
            }
            if db_backend == "firestore"
            else {}
        )

        if cert_arn:
            certificate = acm.Certificate.from_certificate_arn(
                self, "Cert", cert_arn
            )
        else:
            # Deploy will wait until you add the DNS validation CNAMEs in Cloudflare.
            certificate = acm.Certificate(
                self,
                "Cert",
                domain_name=domain,
                validation=acm.CertificateValidation.from_dns(),
            )

        cluster = ecs.Cluster(self, "Cluster", vpc=vpc)

        # ── Next.js review UI ───────────────────────────────────────────
        web = ecs_patterns.ApplicationLoadBalancedFargateService(
            self,
            "Web",
            cluster=cluster,
            cpu=512,
            memory_limit_mib=1024,
            desired_count=1,
            public_load_balancer=True,
            assign_public_ip=False,
            certificate=certificate,
            protocol=elbv2.ApplicationProtocol.HTTPS,
            redirect_http=True,
            circuit_breaker=ecs.DeploymentCircuitBreaker(rollback=True),
            min_healthy_percent=100,
            max_healthy_percent=200,
            task_image_options=ecs_patterns.ApplicationLoadBalancedTaskImageOptions(
                image=ecs.ContainerImage.from_asset(
                    "../../web",
                    platform=ecr_assets.Platform.LINUX_AMD64,
                ),
                container_port=3000,
                log_driver=ecs.LogDrivers.aws_logs(
                    stream_prefix="web",
                    log_retention=logs.RetentionDays.TWO_WEEKS,
                ),
                environment={
                    "NODE_ENV": "production",
                    "NEXTAUTH_URL": f"https://{domain}",
                    "AWS_REGION": Stack.of(self).region,
                    "AWS_DEFAULT_REGION": Stack.of(self).region,
                    "S3_BUCKET": bucket_name,
                    "ALLOWED_EMAIL_DOMAIN": "releviumpain.com",
                    "BEDROCK_MODEL_ID": bedrock_model,
                    "BEDROCK_COACHING_MODEL_ID": coaching_model,
                    # Defaults keep Firestore primary until shadow validation.
                    "DB_BACKEND": db_backend,
                    "DB_DUAL_WRITE": "1" if db_dual_write else "0",
                    "PGSSLMODE": "verify-full",
                    "PGSSLROOTCERT": "/etc/ssl/certs/aws-rds-global-bundle.pem",
                },
                secrets={
                    "NEXTAUTH_SECRET": ecs.Secret.from_secrets_manager(
                        app_secret, "NEXTAUTH_SECRET"
                    ),
                    "GOOGLE_CLIENT_ID": ecs.Secret.from_secrets_manager(
                        app_secret, "GOOGLE_CLIENT_ID"
                    ),
                    "GOOGLE_CLIENT_SECRET": ecs.Secret.from_secrets_manager(
                        app_secret, "GOOGLE_CLIENT_SECRET"
                    ),
                    **firestore_secrets,
                    **database_secrets,
                },
            ),
            health_check_grace_period=Duration.seconds(120),
        )
        web.target_group.configure_health_check(
            path="/api/auth/providers",
            healthy_http_codes="200-399",
            interval=Duration.seconds(30),
            timeout=Duration.seconds(5),
        )

        # ── Vonage poller (private) ─────────────────────────────────────
        poller_td = ecs.FargateTaskDefinition(
            self,
            "PollerTask",
            cpu=512,
            memory_limit_mib=1024,
        )
        poller_td.add_container(
            "poller",
            image=ecs.ContainerImage.from_asset(
                "../..",
                file="Dockerfile.poller",
                platform=ecr_assets.Platform.LINUX_AMD64,
            ),
            logging=ecs.LogDrivers.aws_logs(
                stream_prefix="poller",
                log_retention=logs.RetentionDays.TWO_WEEKS,
            ),
            port_mappings=[ecs.PortMapping(container_port=8080)],
            environment={
                "AWS_REGION": Stack.of(self).region,
                "AWS_DEFAULT_REGION": Stack.of(self).region,
                "S3_BUCKET": bucket_name,
                "BEDROCK_MODEL_ID": bedrock_model,
                "BEDROCK_COACHING_MODEL_ID": coaching_model,
                "VBC_POLLER_ENABLED": "1",
                "VBC_POLLER_INTERVAL_SECONDS": "300",
                "VBC_POLLER_LOOKBACK_MINUTES": "30",
                "VBC_POLLER_MAX_PER_CYCLE": "25",
                "ALLOWED_EMAIL_DOMAIN": "releviumpain.com",
                "APP_URL": f"https://{domain}",
                "ALERTS_ENABLED": "1",
                "MISSED_ALERT_WINDOW_MINUTES": "30",
                "MISSED_ALERT_THRESHOLD": "8",
                # Defaults keep Firestore primary until shadow validation.
                "DB_BACKEND": db_backend,
                "DB_DUAL_WRITE": "1" if db_dual_write else "0",
                "PGSSLMODE": "verify-full",
                "PGSSLROOTCERT": "/etc/ssl/certs/aws-rds-global-bundle.pem",
            },
            secrets={
                **firestore_secrets,
                "VBC_CLIENT_ID": ecs.Secret.from_secrets_manager(
                    app_secret, "VBC_CLIENT_ID"
                ),
                "VBC_CLIENT_SECRET": ecs.Secret.from_secrets_manager(
                    app_secret, "VBC_CLIENT_SECRET"
                ),
                "VBC_USERNAME": ecs.Secret.from_secrets_manager(
                    app_secret, "VBC_USERNAME"
                ),
                "VBC_PASSWORD": ecs.Secret.from_secrets_manager(
                    app_secret, "VBC_PASSWORD"
                ),
                "VBC_ACCOUNT_ID": ecs.Secret.from_secrets_manager(
                    app_secret, "VBC_ACCOUNT_ID"
                ),
                "GCHAT_WEBHOOK_URL": ecs.Secret.from_secrets_manager(
                    app_secret, "GCHAT_WEBHOOK_URL"
                ),
                **database_secrets,
            },
            health_check=ecs.HealthCheck(
                command=[
                    "CMD-SHELL",
                    "curl -f http://localhost:8080/health || exit 1",
                ],
                interval=Duration.seconds(30),
                timeout=Duration.seconds(5),
                retries=3,
                start_period=Duration.seconds(60),
            ),
        )

        poller = ecs.FargateService(
            self,
            "Poller",
            cluster=cluster,
            task_definition=poller_td,
            desired_count=1,
            assign_public_ip=False,
            vpc_subnets=ec2.SubnetSelection(
                subnet_type=ec2.SubnetType.PRIVATE_WITH_EGRESS
            ),
            circuit_breaker=ecs.DeploymentCircuitBreaker(rollback=True),
            min_healthy_percent=100,
            max_healthy_percent=200,
        )

        if database_secret is not None and database_key is not None:
            for execution_role in (
                web.task_definition.execution_role,
                poller_td.execution_role,
            ):
                database_secret.grant_read(execution_role)
                database_key.grant_decrypt(execution_role)

        if database is not None:
            database.connections.allow_default_port_from(
                web.service, "PostgreSQL from web service"
            )
            database.connections.allow_default_port_from(
                poller, "PostgreSQL from poller service"
            )

        for role in (
            web.task_definition.task_role,
            poller_td.task_role,
        ):
            recordings.grant_read_write(role)
            app_secret.grant_read(role)
            role.add_to_policy(
                iam.PolicyStatement(
                    actions=[
                        "bedrock:InvokeModel",
                        "bedrock:InvokeModelWithResponseStream",
                        "bedrock:Converse",
                        "bedrock:ConverseStream",
                    ],
                    resources=["*"],
                )
            )
            role.add_to_policy(
                iam.PolicyStatement(
                    actions=[
                        "transcribe:StartTranscriptionJob",
                        "transcribe:GetTranscriptionJob",
                        "transcribe:ListTranscriptionJobs",
                        "transcribe:DeleteTranscriptionJob",
                    ],
                    resources=["*"],
                )
            )

        CfnOutput(self, "LoadBalancerDNS", value=web.load_balancer.load_balancer_dns_name)
        CfnOutput(self, "AppURL", value=f"https://{domain}")
        CfnOutput(self, "DomainName", value=domain)
        CfnOutput(self, "RecordingsBucketName", value=bucket_name)
        CfnOutput(self, "SecretName", value=SECRET_NAME)
        CfnOutput(self, "ClusterName", value=cluster.cluster_name)
        CfnOutput(self, "PollerServiceName", value=poller.service_name)
        if database is not None:
            CfnOutput(self, "DatabaseEndpoint", value=database.db_instance_endpoint_address)
            CfnOutput(self, "DatabaseName", value="rps_call_qa")
            if database.secret is not None:
                CfnOutput(self, "DatabaseSecretArn", value=database.secret.secret_arn)
        CfnOutput(
            self,
            "CloudflareDNSHint",
            value=json.dumps(
                {
                    "type": "CNAME",
                    "name": "tool",
                    "target": web.load_balancer.load_balancer_dns_name,
                    "proxy": "DNS only while validating ACM; Full/Strict SSL if proxied",
                }
            ),
        )


app = App()

import os
from aws_cdk import Environment

_account = app.node.try_get_context("account") or os.environ.get("CDK_DEFAULT_ACCOUNT")
_region = (
    app.node.try_get_context("region")
    or os.environ.get("CDK_DEFAULT_REGION")
    or "us-east-1"
)
_env = Environment(account=_account, region=_region) if _account else None

RpsCallQaStack(app, "RpsCallQaStack", env=_env)
app.synth()
