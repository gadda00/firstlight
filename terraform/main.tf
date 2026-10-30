# FirstLight Infrastructure as Code - Main Module
# This module defines the core infrastructure for FirstLight

terraform {
  required_version = ">= 1.5.0"
  
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = ">= 5.0"
    }
    
    kubernetes = {
      source  = "hashicorp/kubernetes"
      version = ">= 2.20"
    }
    
    helm = {
      source  = "hashicorp/helm"
      version = ">= 2.9"
    }
    
    random = {
      source  = "hashicorp/random"
      version = ">= 3.5"
    }
    
    tls = {
      source  = "hashicorp/tls"
      version = ">= 4.0"
    }
  }
  
  backend "s3" {
    bucket         = "firstlight-terraform-state"
    key            = "terraform.tfstate"
    region         = "us-east-1"
    encrypt        = true
    dynamodb_table = "firstlight-terraform-lock"
  }
}

provider "aws" {
  region = var.aws_region
}

# ===========================================================================
# Variables
# ===========================================================================

variable "aws_region" {
  description = "AWS region"
  type        = string
  default     = "us-east-1"
}

variable "environment" {
  description = "Deployment environment (staging, production)"
  type        = string
  default     = "staging"
}

variable "domain" {
  description = "Domain name for the application"
  type        = string
  default     = "firstlight.example.com"
}

variable "app_version" {
  description = "Application version to deploy"
  type        = string
  default     = "latest"
}

variable "database_password" {
  description = "PostgreSQL database password"
  type        = string
  sensitive   = true
}

variable "redis_password" {
  description = "Redis password"
  type        = string
  sensitive   = true
  default     = null
}

variable "minio_root_user" {
  description = "MinIO root user"
  type        = string
  sensitive   = true
  default     = "minioadmin"
}

variable "minio_root_password" {
  description = "MinIO root password"
  type        = string
  sensitive   = true
  default     = "minioadmin"
}

variable "grafana_admin_password" {
  description = "Grafana admin password"
  type        = string
  sensitive   = true
  default     = "admin"
}

variable "auth0_client_id" {
  description = "Auth0 client ID"
  type        = string
  sensitive   = true
  default     = null
}

variable "auth0_client_secret" {
  description = "Auth0 client secret"
  type        = string
  sensitive   = true
  default     = null
}

variable "firms_token" {
  description = "NASA FIRMS token"
  type        = string
  sensitive   = true
  default     = null
}

# ===========================================================================
# Random Resources
# ===========================================================================

resource "random_id" "suffix" {
  byte_length = 4
}

# ===========================================================================
# VPC and Networking
# ===========================================================================

module "vpc" {
  source  = "terraform-aws-modules/vpc/aws"
  version = ">= 5.0"
  
  name = "firstlight-${var.environment}-vpc"
  cidr = "10.0.0.0/16"
  
  azs             = ["${var.aws_region}a", "${var.aws_region}b", "${var.aws_region}c"]
  public_subnets  = ["10.0.1.0/24", "10.0.2.0/24", "10.0.3.0/24"]
  private_subnets = ["10.0.101.0/24", "10.0.102.0/24", "10.0.103.0/24"]
  
  enable_nat_gateway   = true
  single_nat_gateway   = false
  enable_dns_hostnames = true
  enable_dns_support   = true
  
  tags = {
    Environment = var.environment
    Application = "firstlight"
  }
}

# ===========================================================================
# Security Groups
# ===========================================================================

resource "aws_security_group" "app" {
  name        = "firstlight-${var.environment}-app-sg"
  description = "Security group for FirstLight application"
  vpc_id      = module.vpc.vpc_id
  
  # HTTP/HTTPS ingress
  ingress {
    from_port   = 80
    to_port     = 80
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }
  
  ingress {
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }
  
  # Application port
  ingress {
    from_port   = 3000
    to_port     = 3000
    protocol    = "tcp"
    cidr_blocks = ["10.0.0.0/16"]
  }
  
  # Health check
  ingress {
    from_port   = 3000
    to_port     = 3000
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
    description = "Health check access"
  }
  
  # Egress
  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
  
  tags = {
    Environment = var.environment
    Application = "firstlight"
  }
}

resource "aws_security_group" "database" {
  name        = "firstlight-${var.environment}-db-sg"
  description = "Security group for PostgreSQL database"
  vpc_id      = module.vpc.vpc_id
  
  # PostgreSQL port
  ingress {
    from_port   = 5432
    to_port     = 5432
    protocol    = "tcp"
    cidr_blocks = ["10.0.0.0/16"]
  }
  
  # Egress
  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
  
  tags = {
    Environment = var.environment
    Application = "firstlight"
  }
}

resource "aws_security_group" "redis" {
  name        = "firstlight-${var.environment}-redis-sg"
  description = "Security group for Redis"
  vpc_id      = module.vpc.vpc_id
  
  # Redis port
  ingress {
    from_port   = 6379
    to_port     = 6379
    protocol    = "tcp"
    cidr_blocks = ["10.0.0.0/16"]
  }
  
  # Egress
  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
  
  tags = {
    Environment = var.environment
    Application = "firstlight"
  }
}

resource "aws_security_group" "minio" {
  name        = "firstlight-${var.environment}-minio-sg"
  description = "Security group for MinIO"
  vpc_id      = module.vpc.vpc_id
  
  # MinIO API port
  ingress {
    from_port   = 9000
    to_port     = 9000
    protocol    = "tcp"
    cidr_blocks = ["10.0.0.0/16"]
  }
  
  # MinIO console port
  ingress {
    from_port   = 9001
    to_port     = 9001
    protocol    = "tcp"
    cidr_blocks = ["10.0.0.0/16"]
  }
  
  # Egress
  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
  
  tags = {
    Environment = var.environment
    Application = "firstlight"
  }
}

# ===========================================================================
# RDS PostgreSQL Database
# ===========================================================================

module "db" {
  source  = "terraform-aws-modules/rds/aws"
  version = ">= 6.0"
  
  identifier = "firstlight-${var.environment}-db"
  
  engine               = "postgres"
  engine_version       = "16.1"
  family               = "postgres16"
  major_engine_version = "16"
  instance_class       = var.environment == "production" ? "db.m6i.large" : "db.t4g.micro"
  
  allocated_storage     = 100
  max_allocated_storage = 500
  storage_encrypted     = true
  
  db_name  = "firstlight"
  username = "firstlight"
  password = var.database_password
  port     = 5432
  
  vpc_security_group_ids = [aws_security_group.database.id]
  subnet_ids             = module.vpc.private_subnets
  
  backup_retention_period = 7
  backup_window          = "03:00-04:00"
  maintenance_window     = "sun:04:00-sun:05:00"
  
  performance_insights_enabled = true
  performance_insights_retention_period = 7
  
  tags = {
    Environment = var.environment
    Application = "firstlight"
  }
}

# ===========================================================================
# ElastiCache Redis
# ===========================================================================

module "redis" {
  source  = "terraform-aws-modules/elasticache/aws"
  version = ">= 5.0"
  
  cluster_id           = "firstlight-${var.environment}-redis"
  engine               = "redis"
  node_type            = var.environment == "production" ? "cache.m6g.large" : "cache.t4g.micro"
  num_cache_nodes      = 1
  parameter_group_name = "default.redis7"
  engine_version       = "7.0"
  port                 = 6379
  
  vpc_security_group_ids = [aws_security_group.redis.id]
  subnet_ids           = module.vpc.private_subnets
  
  create_security_group = false
  
  tags = {
    Environment = var.environment
    Application = "firstlight"
  }
}

# ===========================================================================
# ECS Cluster for FirstLight Application
# ===========================================================================

module "ecs" {
  source  = "terraform-aws-modules/ecs/aws"
  version = ">= 5.0"
  
  cluster_name = "firstlight-${var.environment}-cluster"
  
  container_insights = true
  
  capacity_providers = ["FARGATE", "FARGATE_SPOT"]
  
  default_capacity_provider_strategy = [
    {
      capacity_provider = "FARGATE"
      weight            = 70
      base              = 1
    },
    {
      capacity_provider = "FARGATE_SPOT"
      weight            = 30
      base              = 0
    }
  ]
  
  tags = {
    Environment = var.environment
    Application = "firstlight"
  }
}

# ===========================================================================
# ECS Service for FirstLight App
# ===========================================================================

module "ecs_app" {
  source  = "terraform-aws-modules/ecs/aws//modules/service"
  version = ">= 5.0"
  
  name        = "firstlight-${var.environment}-app"
  cluster_arn = module.ecs.cluster_arn
  
  desired_count = var.environment == "production" ? 3 : 1
  
  launch_type = "FARGATE"
  
  network_configuration = {
    subnets          = module.vpc.private_subnets
    security_groups   = [aws_security_group.app.id]
    assign_public_ip  = false
  }
  
  service_connect_configuration = {
    namespace = aws_service_discovery_http_namespace.firstlight.arn
    service   = {
      port_name      = "app"
      discovery_name = "app"
    }
  }
  
  load_balancer = {
    service = {
      target_group_arn = aws_lb_target_group.app.arn
      container_name   = "app"
      container_port   = 3000
    }
  }
  
  tags = {
    Environment = var.environment
    Application = "firstlight"
  }
}

# ===========================================================================
# ECS Task Definition for App
# ===========================================================================

resource "aws_ecs_task_definition" "app" {
  family                   = "firstlight-${var.environment}-app"
  network_mode             = "awsvpc"
  requires_compatibilities = ["FARGATE"]
  cpu                      = 1024
  memory                   = 2048
  execution_role_arn       = aws_iam_role.ecs_task_execution.arn
  task_role_arn            = aws_iam_role.ecs_task.arn
  
  container_definitions = jsonencode([
    {
      name      = "app"
      image     = "ghcr.io/${var.repository}/app:${var.app_version}"
      essential = true
      
      portMappings = [
        {
          containerPort = 3000
          hostPort      = 3000
        }
      ]
      
      environment = [
        {
          name  = "NODE_ENV"
          value = "production"
        },
        {
          name  = "DATABASE_URL"
          value = "postgresql://${module.db.db_instance_username}:${module.db.db_instance_password}@${module.db.db_instance_address}:5432/${module.db.db_instance_database}"
        },
        {
          name  = "REDIS_URL"
          value = "redis://${module.redis.cluster_address}:6379/0"
        },
        {
          name  = "MINIO_ENDPOINT"
          value = "minio.firstlight.svc.cluster.local"
        },
        {
          name  = "MINIO_PORT"
          value = "9000"
        },
        {
          name  = "MINIO_ACCESS_KEY"
          value = var.minio_root_user
        },
        {
          name  = "MINIO_SECRET_KEY"
          value = var.minio_root_password
        },
        {
          name  = "FIRSTLIGHT_FIRMS_TOKEN"
          value = var.firms_token != null ? var.firms_token : ""
        },
        {
          name  = "DEMO_MODE"
          value = "false"
        },
        {
          name  = "NEXT_PUBLIC_DEMO_MODE"
          value = "false"
        }
      ]
      
      secrets = [
        {
          name      = "AUTH0_CLIENT_ID"
          valueFrom = var.auth0_client_id != null ? var.auth0_client_id : ""
        },
        {
          name      = "AUTH0_CLIENT_SECRET"
          valueFrom = var.auth0_client_secret != null ? var.auth0_client_secret : ""
        }
      ]
      
      logConfiguration = {
        logDriver = "awslogs"
        options = {
          awslogs-group         = aws_cloudwatch_log_group.app.name
          awslogs-region        = var.aws_region
          awslogs-stream-prefix = "app"
        }
      }
      
      healthCheck = {
        command     = ["CMD-SHELL", "curl -f http://localhost:3000/api/health || exit 1"]
        interval    = 30
        timeout     = 5
        retries     = 3
        startPeriod = 10
      }
    }
  ])
  
  tags = {
    Environment = var.environment
    Application = "firstlight"
  }
}

# ===========================================================================
# Application Load Balancer
# ===========================================================================

module "alb" {
  source  = "terraform-aws-modules/alb/aws"
  version = ">= 9.0"
  
  name = "firstlight-${var.environment}-alb"
  
  load_balancer_type = "application"
  
  vpc_id          = module.vpc.vpc_id
  subnets         = module.vpc.public_subnets
  security_groups = [aws_security_group.app.id]
  
  http_tcp_listeners = [
    {
      port               = 80
      protocol           = "HTTP"
      target_group_index = 0
    }
  ]
  
  https_listeners = [
    {
      port               = 443
      protocol           = "HTTPS"
      certificate_arn    = aws_acm_certificate.firstlight.arn
      target_group_index = 0
    }
  ]
  
  target_groups = [
    {
      name             = "firstlight-${var.environment}-app-tg"
      backend_protocol = "HTTP"
      backend_port     = 3000
      target_type      = "ip"
      
      health_check = {
        enabled             = true
        interval            = 30
        path                = "/api/health"
        port                = 3000
        healthy_threshold   = 2
        unhealthy_threshold = 2
        timeout             = 5
        matcher             = "200-399"
      }
    }
  ]
  
  tags = {
    Environment = var.environment
    Application = "firstlight"
  }
}

# ===========================================================================
# ACM Certificate
# ===========================================================================

resource "aws_acm_certificate" "firstlight" {
  domain_name       = var.domain
  validation_method = "DNS"
  
  lifecycle {
    create_before_destroy = true
  }
  
  tags = {
    Environment = var.environment
    Application = "firstlight"
  }
}

resource "aws_route53_record" "cert_validation" {
  for_each = {
    for dvo in aws_acm_certificate.firstlight.domain_validation_options : dvo.domain_name => {
      name   = dvo.resource_record_name
      record = dvo.resource_record_value
      type   = dvo.resource_record_type
    }
  }
  
  allow_overwrite = true
  name            = each.value.name
  records         = [each.value.record]
  ttl             = 60
  type            = each.value.type
  zone_id         = data.aws_route53_zone.selected.zone_id
}

resource "aws_acm_certificate_validation" "firstlight" {
  certificate_arn         = aws_acm_certificate.firstlight.arn
  validation_record_fqdns = [for record in aws_route53_record.cert_validation : record.fqdn]
}

# ===========================================================================
# Route 53 DNS
# ===========================================================================

data "aws_route53_zone" "selected" {
  name         = var.domain
  private_zone = false
}

resource "aws_route53_record" "alb" {
  zone_id = data.aws_route53_zone.selected.zone_id
  name    = var.domain
  type    = "A"
  
  alias {
    name                   = module.alb.lb_dns_name
    zone_id                = module.alb.lb_zone_id
    evaluate_target_health = true
  }
}

# ===========================================================================
# CloudWatch Logs
# ===========================================================================

resource "aws_cloudwatch_log_group" "app" {
  name              = "/ecs/firstlight-${var.environment}-app"
  retention_in_days = 30
  
  tags = {
    Environment = var.environment
    Application = "firstlight"
  }
}

resource "aws_cloudwatch_log_group" "python_worker" {
  name              = "/ecs/firstlight-${var.environment}-python-worker"
  retention_in_days = 30
  
  tags = {
    Environment = var.environment
    Application = "firstlight"
  }
}

# ===========================================================================
# IAM Roles
# ===========================================================================

resource "aws_iam_role" "ecs_task_execution" {
  name = "firstlight-${var.environment}-ecs-task-execution"
  
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Action = "sts:AssumeRole"
        Effect = "Allow"
        Principal = {
          Service = "ecs-tasks.amazonaws.com"
        }
      }
    ]
  })
}

resource "aws_iam_role_policy_attachment" "ecs_task_execution" {
  role       = aws_iam_role.ecs_task_execution.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

resource "aws_iam_role" "ecs_task" {
  name = "firstlight-${var.environment}-ecs-task"
  
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Action = "sts:AssumeRole"
        Effect = "Allow"
        Principal = {
          Service = "ecs-tasks.amazonaws.com"
        }
      }
    ]
  })
}

resource "aws_iam_role_policy" "ecs_task" {
  name = "firstlight-${var.environment}-ecs-task-policy"
  role = aws_iam_role.ecs_task.id
  
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "secretsmanager:GetSecretValue",
          "ssm:GetParameters",
          "kms:Decrypt"
        ]
        Resource = "*"
      },
      {
        Effect = "Allow"
        Action = [
          "s3:GetObject",
          "s3:PutObject",
          "s3:ListBucket"
        ]
        Resource = [
          "arn:aws:s3:::firstlight-*",
          "arn:aws:s3:::firstlight-*/*"
        ]
      }
    ]
  })
}

# ===========================================================================
# Service Discovery
# ===========================================================================

resource "aws_service_discovery_http_namespace" "firstlight" {
  name        = "firstlight-${var.environment}.local"
  description = "Service discovery namespace for FirstLight"
  vpc_id      = module.vpc.vpc_id
  
  tags = {
    Environment = var.environment
    Application = "firstlight"
  }
}

# ===========================================================================
# Outputs
# ===========================================================================

output "alb_dns_name" {
  description = "ALB DNS name"
  value       = module.alb.lb_dns_name
}

output "database_endpoint" {
  description = "PostgreSQL endpoint"
  value       = module.db.db_instance_address
}

output "redis_endpoint" {
  description = "Redis endpoint"
  value       = module.redis.cluster_address
}

output "ecs_cluster_name" {
  description = "ECS cluster name"
  value       = module.ecs.cluster_name
}

output "vpc_id" {
  description = "VPC ID"
  value       = module.vpc.vpc_id
}

output "public_subnets" {
  description = "Public subnet IDs"
  value       = module.vpc.public_subnets
}

output "private_subnets" {
  description = "Private subnet IDs"
  value       = module.vpc.private_subnets
}
