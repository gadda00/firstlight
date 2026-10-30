# FirstLight Infrastructure Variables

variable "repository" {
  description = "GitHub repository (owner/repo)"
  type        = string
  default     = "gadda00/firstlight"
}

variable "aws_region" {
  description = "AWS region"
  type        = string
  default     = "us-east-1"
}

variable "environment" {
  description = "Deployment environment"
  type        = string
  default     = "staging"
  
  validation {
    condition     = contains(["staging", "production", "development"], var.environment)
    error_message = "Environment must be one of: staging, production, development"
  }
}

variable "domain" {
  description = "Domain name for the application"
  type        = string
}

variable "app_version" {
  description = "Application version to deploy"
  type        = string
  default     = "latest"
}

# Database
variable "database_instance_class" {
  description = "RDS instance class"
  type        = string
  default     = "db.t4g.micro"
}

variable "database_allocated_storage" {
  description = "RDS allocated storage in GB"
  type        = number
  default     = 100
}

variable "database_max_allocated_storage" {
  description = "RDS max allocated storage in GB"
  type        = number
  default     = 500
}

variable "database_backup_retention_period" {
  description = "RDS backup retention period in days"
  type        = number
  default     = 7
}

# Redis
variable "redis_node_type" {
  description = "ElastiCache node type"
  type        = string
  default     = "cache.t4g.micro"
}

# ECS
variable "app_desired_count" {
  description = "Desired count for app service"
  type        = number
  default     = 1
}

variable "app_cpu" {
  description = "CPU units for app task"
  type        = number
  default     = 1024
}

variable "app_memory" {
  description = "Memory for app task in MB"
  type        = number
  default     = 2048
}

# Monitoring
variable "enable_prometheus" {
  description = "Enable Prometheus monitoring"
  type        = bool
  default     = true
}

variable "enable_grafana" {
  description = "Enable Grafana"
  type        = bool
  default     = true
}

variable "enable_otel" {
  description = "Enable OpenTelemetry"
  type        = bool
  default     = true
}

# Security
variable "enable_waf" {
  description = "Enable WAF"
  type        = bool
  default     = true
}

variable "enable_shield" {
  description = "Enable Shield Advanced"
  type        = bool
  default     = false
}

# Networking
variable "vpc_cidr" {
  description = "VPC CIDR block"
  type        = string
  default     = "10.0.0.0/16"
}

variable "public_subnet_cidrs" {
  description = "Public subnet CIDR blocks"
  type        = list(string)
  default     = ["10.0.1.0/24", "10.0.2.0/24", "10.0.3.0/24"]
}

variable "private_subnet_cidrs" {
  description = "Private subnet CIDR blocks"
  type        = list(string)
  default     = ["10.0.101.0/24", "10.0.102.0/24", "10.0.103.0/24"]
}

# Tags
variable "tags" {
  description = "Additional tags"
  type        = map(string)
  default     = {}
}
