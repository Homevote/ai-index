variable "aws_region" {
  type        = string
  description = "AWS region for OpenSearch & Bedrock"
  default     = "eu-central-1"
}

variable "domain_name" {
  type        = string
  description = "OpenSearch domain name"
  default     = "homevote-ai-index"
}

variable "engine_version" {
  type        = string
  description = "OpenSearch engine version (2.19 supports RRF)"
  default     = "OpenSearch_2.19"
}

variable "opensearch_instance_type" {
  type        = string
  default     = "t3.small.search" # dev-friendly; scale up as needed
}

variable "opensearch_instance_count" {
  type        = number
  default     = 1
}

variable "opensearch_volume_size_gb" {
  type        = number
  default     = 50
}

variable "allowed_principal_arns" {
  type        = list(string)
  description = "IAM principals (roles/users) allowed to access the domain"
  default     = []
}

variable "allowed_cidr_blocks" {
  type        = list(string)
  description = "Optional IP CIDRs allowed to hit the domain endpoint"
  default     = []
}

variable "bedrock_model_arn" {
  type        = string
  description = "Titan V2 model ARN (foundation-model). Example: arn:aws:bedrock:eu-central-1::foundation-model/amazon.titan-embed-text-v2:0"
}

variable "create_indexer_role" {
  type        = bool
  default     = true
}

variable "indexer_role_name" {
  type        = string
  default     = "homevote-ai-indexer"
}

# If using GitHub Actions OIDC, set this and attach an assume-role policy later
variable "indexer_trust_policy_json" {
  type        = string
  description = "Optional full JSON trust policy for the indexer role"
  default     = null
}