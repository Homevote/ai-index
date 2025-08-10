/**
 * @homevote/ai-index - AI-powered code indexing and search
 * 
 * A library for creating semantic code search indexes using OpenSearch and AWS Bedrock embeddings.
 * Can be used programmatically or via CLI tools for any codebase.
 */

export { default as CodeIndexer } from './indexer.js'
export { default as CodeSearcher } from './searcher.js'
export * from './utils.js'