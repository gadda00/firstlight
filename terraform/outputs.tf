# FirstLight Infrastructure Outputs

output "environment" {
  description = "Deployment environment"
  value       = var.environment
}

output "aws_region" {
  description = "AWS region"
  value       = var.aws_region
}

# Networking
output "vpc_id" {
  description = "VPC ID"
  value       = module.vpc.vpc_id
}

output "vpc_cidr" {
  description = "VPC CIDR block"
  value       = module.vpc.vpc_cidr_block
}

output "public_subnet_ids" {
  description = "Public subnet IDs"
  value       = module.vpc.public_subnets
}

output "private_subnet_ids" {
  description = "Private subnet IDs"
  value       = module.vpc.private_subnets
}

output "nat_gateway_ips" {
  description = "NAT gateway public IPs"
  value       = module.vpc.nat_public_ips
}

# Security Groups
output "app_security_group_id" {
  description = "App security group ID"
  value       = aws_security_group.app.id
}

output "database_security_group_id" {
  description = "Database security group ID"
  value       = aws_security_group.database.id
}

output "redis_security_group_id" {
  description = "Redis security group ID"
  value       = aws_security_group.redis.id
}

# Database
output "database_endpoint" {
  description = "PostgreSQL endpoint"
  value       = module.db.db_instance_address
}

output "database_port" {
  description = "PostgreSQL port"
  value       = module.db.db_instance_port
}

output "database_username" {
  description = "PostgreSQL username"
  value       = module.db.db_instance_username
  sensitive   = true
}

output "database_name" {
  description = "PostgreSQL database name"
  value       = module.db.db_instance_database
}

# Redis
output "redis_endpoint" {
  description = "Redis endpoint"
  value       = module.redis.cluster_address
}

output "redis_port" {
  description = "Redis port"
  value       = module.redis.cluster_port
}

# ECS
output "ecs_cluster_name" {
  description = "ECS cluster name"
  value       = module.ecs.cluster_name
}

output "ecs_cluster_arn" {
  description = "ECS cluster ARN"
  value       = module.ecs.cluster_arn
}

output "ecs_service_app_name" {
  description = "ECS app service name"
  value       = module.ecs_app.service_name
}

# Load Balancer
output "alb_dns_name" {
  description = "ALB DNS name"
  value       = module.alb.lb_dns_name
}

output "alb_zone_id" {
  description = "ALB zone ID"
  value       = module.alb.lb_zone_id
}

output "alb_arn" {
  description = "ALB ARN"
  value       = module.alb.lb_arn
}

output "alb_listener_arns" {
  description = "ALB listener ARNs"
  value       = module.alb.https_listener_arns
}

# DNS
output "route53_zone_id" {
  description = "Route53 zone ID"
  value       = data.aws_route53_zone.selected.zone_id
}

output "domain_name" {
  description = "Domain name"
  value       = var.domain
}

# Certificates
output "certificate_arn" {
  description = "ACM certificate ARN"
  value       = aws_acm_certificate.firstlight.arn
}

# CloudWatch
output "app_log_group_name" {
  description = "App log group name"
  value       = aws_cloudwatch_log_group.app.name
}

output "python_worker_log_group_name" {
  description = "Python worker log group name"
  value       = aws_cloudwatch_log_group.python_worker.name
}

# IAM
output "ecs_task_execution_role_arn" {
  description = "ECS task execution role ARN"
  value       = aws_iam_role.ecs_task_execution.arn
}

output "ecs_task_role_arn" {
  description = "ECS task role ARN"
  value       = aws_iam_role.ecs_task.arn
}

# Service Discovery
output "service_discovery_namespace_id" {
  description = "Service discovery namespace ID"
  value       = aws_service_discovery_http_namespace.firstlight.id
}

# Target Groups
output "app_target_group_arn" {
  description = "App target group ARN"
  value       = aws_lb_target_group.app.arn
}

# Full connection strings
output "database_connection_string" {
  description = "Full database connection string"
  value       = "postgresql://${module.db.db_instance_username}:${module.db.db_instance_password}@${module.db.db_instance_address}:${module.db.db_instance_port}/${module.db.db_instance_database}"
  sensitive   = true
}

output "redis_connection_string" {
  description = "Full Redis connection string"
  value       = "redis://${module.redis.cluster_address}:${module.redis.cluster_port}/0"
}

# Application URL
output "application_url" {
  description = "Application URL"
  value       = "https://${var.domain}"
}
