# FirstLight Staging Environment

module "staging" {
  source = "../"
  
  environment = "staging"
  domain      = "staging.firstlight.example.com"
  
  # Database
  database_instance_class      = "db.t4g.micro"
  database_allocated_storage   = 50
  database_max_allocated_storage = 200
  database_password            = var.database_password
  
  # Redis
  redis_node_type = "cache.t4g.micro"
  
  # ECS
  app_desired_count = 1
  app_cpu           = 512
  app_memory        = 1024
  
  # Tags
  tags = {
    Environment = "staging"
    CostCenter   = "engineering"
    ManagedBy    = "terraform"
  }
}

# Outputs
output "alb_dns_name" {
  value = module.staging.alb_dns_name
}

output "application_url" {
  value = module.staging.application_url
}

output "database_endpoint" {
  value = module.staging.database_endpoint
}

output "redis_endpoint" {
  value = module.staging.redis_endpoint
}
