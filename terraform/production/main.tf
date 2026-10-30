# FirstLight Production Environment

module "production" {
  source = "../"
  
  environment = "production"
  domain      = "firstlight.example.com"
  
  # Database
  database_instance_class      = "db.m6i.large"
  database_allocated_storage   = 200
  database_max_allocated_storage = 1000
  database_password            = var.database_password
  database_backup_retention_period = 30
  
  # Redis
  redis_node_type = "cache.m6g.large"
  
  # ECS
  app_desired_count = 3
  app_cpu           = 2048
  app_memory        = 4096
  
  # Monitoring
  enable_prometheus = true
  enable_grafana    = true
  enable_otel       = true
  
  # Security
  enable_waf   = true
  enable_shield = true
  
  # Tags
  tags = {
    Environment = "production"
    CostCenter   = "operations"
    ManagedBy    = "terraform"
  }
}

# Outputs
output "alb_dns_name" {
  value = module.production.alb_dns_name
}

output "application_url" {
  value = module.production.application_url
}

output "database_endpoint" {
  value = module.production.database_endpoint
}

output "redis_endpoint" {
  value = module.production.redis_endpoint
}

output "ecs_cluster_name" {
  value = module.production.ecs_cluster_name
}
