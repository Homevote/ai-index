terraform {
  backend "s3" {
    bucket = "homevote-terraform"
    key    = "terraform.tfstate"
    region = "eu-central-1"

    # Enable state locking and consistency checking via DynamoDB
    # dynamodb_table = "homevote-terraform-locks"

    # Enable server-side encryption
    encrypt = true
  }
}

# Provider configuration with common tags
provider "aws" {
  region = var.aws_region

  default_tags {
    tags = {
      ManagedBy   = "Terraform-AIIndex"
    }
  }
}

# (Optional but sometimes required by AWS account)
resource "aws_iam_service_linked_role" "opensearch" {
  aws_service_name = "es.amazonaws.com"
}

# ---- CloudWatch Log Groups for OpenSearch logging ----
resource "aws_cloudwatch_log_group" "opensearch_search_slow_logs" {
  name              = "/aws/opensearch/domains/${var.domain_name}/search-slow-logs"
  retention_in_days = 14
}

resource "aws_cloudwatch_log_group" "opensearch_index_slow_logs" {
  name              = "/aws/opensearch/domains/${var.domain_name}/index-slow-logs"
  retention_in_days = 14
}

# CloudWatch Log Group policy to allow OpenSearch to write logs
data "aws_iam_policy_document" "opensearch_log_policy" {
  statement {
    effect = "Allow"
    principals {
      type        = "Service"
      identifiers = ["es.amazonaws.com"]
    }
    actions = [
      "logs:PutLogEvents",
      "logs:CreateLogGroup",
      "logs:CreateLogStream"
    ]
    resources = [
      "${aws_cloudwatch_log_group.opensearch_search_slow_logs.arn}:*",
      "${aws_cloudwatch_log_group.opensearch_index_slow_logs.arn}:*"
    ]
  }
}

resource "aws_cloudwatch_log_resource_policy" "opensearch_logs" {
  policy_name     = "${var.domain_name}-opensearch-logs"
  policy_document = data.aws_iam_policy_document.opensearch_log_policy.json
}

# ---- OpenSearch Domain (managed) ----
resource "aws_opensearch_domain" "ai" {
  domain_name    = var.domain_name
  engine_version = var.engine_version

  cluster_config {
    instance_type  = var.opensearch_instance_type
    instance_count = var.opensearch_instance_count
    zone_awareness_enabled = false
  }

  ebs_options {
    ebs_enabled = true
    volume_size = var.opensearch_volume_size_gb
    volume_type = "gp3"
  }

  encrypt_at_rest {
    enabled = true
  }

  node_to_node_encryption {
    enabled = true
  }

  domain_endpoint_options {
    enforce_https       = true
    tls_security_policy = "Policy-Min-TLS-1-2-2019-07"
  }

  # Keep these on unless you need them; logs help during tuning
  log_publishing_options {
    log_type                = "SEARCH_SLOW_LOGS"
    enabled                 = true
    cloudwatch_log_group_arn = aws_cloudwatch_log_group.opensearch_search_slow_logs.arn
  }
  log_publishing_options {
    log_type                = "INDEX_SLOW_LOGS"
    enabled                 = true
    cloudwatch_log_group_arn = aws_cloudwatch_log_group.opensearch_index_slow_logs.arn
  }

  depends_on = [aws_iam_service_linked_role.opensearch]
}

# ---- Access Policy (resource-based) ----
data "aws_iam_policy_document" "domain_access" {
  statement {
    sid       = "AllowIAMPrincipals"
    effect    = "Allow"
    actions   = ["es:*"]
    resources = ["${aws_opensearch_domain.ai.arn}/*"]

    dynamic "principals" {
      for_each = length(var.allowed_principal_arns) > 0 ? [1] : []
      content {
        type        = "AWS"
        identifiers = var.allowed_principal_arns
      }
    }
  }

  statement {
    sid     = "OptionalIPAllow"
    effect  = "Allow"
    actions = ["es:*"]
    resources = ["${aws_opensearch_domain.ai.arn}/*"]

    condition {
      test     = "IpAddress"
      variable = "aws:SourceIp"
      values   = var.allowed_cidr_blocks
    }

    principals {
      type        = "*"
      identifiers = ["*"]
    }
  }
}

resource "aws_opensearch_domain_policy" "ai" {
  domain_name     = aws_opensearch_domain.ai.domain_name
  access_policies = data.aws_iam_policy_document.domain_access.json
}

# ---- IAM for Bedrock embeddings + signed OpenSearch calls ----
data "aws_iam_policy_document" "bedrock_invoke" {
  statement {
    sid     = "InvokeTitanEmbeddingsV2"
    effect  = "Allow"
    actions = [
      "bedrock:InvokeModel",
      "bedrock:InvokeModelWithResponseStream"
    ]
    resources = [
      var.bedrock_model_arn
    ]
  }
}

resource "aws_iam_policy" "bedrock_invoke" {
  name        = "${var.indexer_role_name}-bedrock-invoke"
  description = "Allow invoking Bedrock Titan Text Embeddings V2"
  policy      = data.aws_iam_policy_document.bedrock_invoke.json
}

# Optional: narrow OpenSearch API permissions if you bind to a role
data "aws_iam_policy_document" "opensearch_sign" {
  statement {
    effect    = "Allow"
    actions   = ["es:ESHttp*"] # data-plane APIs against this domain
    resources = [
      "${aws_opensearch_domain.ai.arn}/*"
    ]
  }
}

resource "aws_iam_policy" "opensearch_sign" {
  name   = "${var.indexer_role_name}-opensearch-sign"
  policy = data.aws_iam_policy_document.opensearch_sign.json
}

# Create a role the indexer (e.g., GitHub Actions) can assume
resource "aws_iam_role" "indexer" {
  count              = var.create_indexer_role ? 1 : 0
  name               = var.indexer_role_name
  assume_role_policy = coalesce(var.indexer_trust_policy_json, jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow"
      Principal = { AWS = "arn:aws:iam::${data.aws_caller_identity.current.account_id}:root" }
      Action = "sts:AssumeRole"
    }]
  }))
}

data "aws_caller_identity" "current" {}

resource "aws_iam_role_policy_attachment" "indexer_bedrock" {
  count      = var.create_indexer_role ? 1 : 0
  role       = aws_iam_role.indexer[0].name
  policy_arn = aws_iam_policy.bedrock_invoke.arn
}

resource "aws_iam_role_policy_attachment" "indexer_es" {
  count      = var.create_indexer_role ? 1 : 0
  role       = aws_iam_role.indexer[0].name
  policy_arn = aws_iam_policy.opensearch_sign.arn
}
