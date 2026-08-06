"""
Minimal AWS CDK stack for RPS Call QA (ECS Fargate + ALB + S3).

Prereqs:
  npm i -g aws-cdk
  pip install aws-cdk-lib constructs

Deploy from repo root after filling context:
  cd infra/aws
  cdk bootstrap
  cdk deploy
"""

from __future__ import annotations

from aws_cdk import (
    CfnOutput,
    Duration,
    RemovalPolicy,
    Stack,
    aws_ec2 as ec2,
    aws_ecs as ecs,
    aws_ecs_patterns as ecs_patterns,
    aws_s3 as s3,
    aws_secretsmanager as secretsmanager,
)
from constructs import Construct


class RpsCallQaStack(Stack):
    def __init__(self, scope: Construct, construct_id: str, **kwargs) -> None:
        super().__init__(scope, construct_id, **kwargs)

        vpc = ec2.Vpc(self, "Vpc", max_azs=2)

        recordings = s3.Bucket(
            self,
            "RecordingsBucket",
            block_public_access=s3.BlockPublicAccess.BLOCK_ALL,
            encryption=s3.BucketEncryption.S3_MANAGED,
            enforce_ssl=True,
            versioned=True,
            removal_policy=RemovalPolicy.RETAIN,
        )

        # Create an empty secret shell — paste JSON env values in console after deploy
        app_secret = secretsmanager.Secret(
            self,
            "AppSecret",
            description="RPS Call QA env JSON (VBC_*, GOOGLE_*, FIREBASE_*, BEDROCK_MODEL_ID, …)",
            secret_name="rps-call-qa/app",
        )

        cluster = ecs.Cluster(self, "Cluster", vpc=vpc)

        # Image: build from repo Dockerfile via CDK asset, or point at ECR
        service = ecs_patterns.ApplicationLoadBalancedFargateService(
            self,
            "Service",
            cluster=cluster,
            cpu=512,
            memory_limit_mib=1024,
            desired_count=1,
            public_load_balancer=True,
            task_image_options=ecs_patterns.ApplicationLoadBalancedTaskImageOptions(
                image=ecs.ContainerImage.from_asset("../.."),
                container_port=8501,
                environment={
                    "S3_BUCKET": recordings.bucket_name,
                    "AWS_REGION": Stack.of(self).region,
                    "BEDROCK_MODEL_ID": "anthropic.claude-3-5-sonnet-20241022-v2:0",
                },
                secrets={
                    # Expand after you structure the secret as key/value
                },
            ),
            health_check_grace_period=Duration.seconds(120),
        )

        # Streamlit needs sticky sessions
        service.target_group.enable_cookie_stickiness(Duration.hours(1))
        service.target_group.configure_health_check(path="/_stcore/health")

        recordings.grant_read_write(service.task_definition.task_role)
        app_secret.grant_read(service.task_definition.task_role)

        CfnOutput(self, "LoadBalancerDNS", value=service.load_balancer.load_balancer_dns_name)
        CfnOutput(self, "RecordingsBucketName", value=recordings.bucket_name)
        CfnOutput(self, "SecretName", value=app_secret.secret_name)


app = None
try:
    from aws_cdk import App

    app = App()
    RpsCallQaStack(app, "RpsCallQaStack")
    app.synth()
except ImportError:
    # aws-cdk-lib not installed in the app venv — fine for local Streamlit work
    pass
