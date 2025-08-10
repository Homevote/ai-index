output "opensearch_endpoint" {
  value = aws_opensearch_domain.ai.endpoint
}

output "opensearch_domain_arn" {
  value = aws_opensearch_domain.ai.arn
}

output "indexer_role_arn" {
  value       = var.create_indexer_role ? aws_iam_role.indexer[0].arn : null
  description = "IAM role your CI/agent should assume to run the indexer"
}
