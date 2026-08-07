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
    Stack,
    aws_certificatemanager as acm,
    aws_ec2 as ec2,
    aws_ecs as ecs,
    aws_ecs_patterns as ecs_patterns,
    aws_elasticloadbalancingv2 as elbv2,
    aws_iam as iam,
    aws_logs as logs,
    aws_s3 as s3,
    aws_secretsmanager as secretsmanager,
)
from constructs import Construct


DEFAULT_DOMAIN = "tool.releviumpain.com"
DEFAULT_BUCKET = "rps-call-qa-recordings-013908492747"
SECRET_NAME = "rps-call-qa/app"
DEFAULT_BEDROCK = "us.anthropic.claude-sonnet-4-5-20250929-v1:0"


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
                    "FIREBASE_SERVICE_ACCOUNT": ecs.Secret.from_secrets_manager(
                        app_secret, "FIREBASE_SERVICE_ACCOUNT"
                    ),
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
                "VBC_POLLER_ENABLED": "1",
                "VBC_POLLER_INTERVAL_SECONDS": "300",
                "VBC_POLLER_LOOKBACK_MINUTES": "30",
                "VBC_POLLER_MAX_PER_CYCLE": "25",
                "ALLOWED_EMAIL_DOMAIN": "releviumpain.com",
            },
            secrets={
                "FIREBASE_SERVICE_ACCOUNT": ecs.Secret.from_secrets_manager(
                    app_secret, "FIREBASE_SERVICE_ACCOUNT"
                ),
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
