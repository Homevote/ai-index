# @homevote/ai-index

AI-powered code indexing and search system using OpenSearch and AWS Bedrock embeddings. Enables semantic code search across any codebase with natural language queries.

## Features

- 🔍 **Semantic Search**: Find code using natural language queries
- ⚡ **Hybrid Search**: Combines BM25 lexical and k-NN vector search
- 🎯 **Relevance Filtering**: Filter results by relevance score
- 📦 **Compact Output**: AI-optimized format for frequent consumption
- 🏷️ **Area Filtering**: Filter by codebase areas (backend, frontend, docs, infra)
- 🔧 **Global CLI**: Install globally for use in any repository
- 📚 **Programmatic API**: Use as a library in your applications

## Installation

### Global Installation (Recommended)

```bash
npm install -g @homevote/ai-index
```

### Local Installation

```bash
npm install @homevote/ai-index
```

## Prerequisites

You need:
- **AWS Account** with OpenSearch domain and Bedrock access
- **Environment Variables** configured (see Configuration section)

### AWS Resources Required

- Amazon OpenSearch domain with k-NN enabled
- Amazon Bedrock access with Titan Text Embeddings V2 model
- Proper IAM permissions for OpenSearch and Bedrock

## Configuration

Create a `.env` file in your project root:

```bash
# Required
AWS_REGION=us-east-1
OPENSEARCH_URL=https://your-domain.us-east-1.es.amazonaws.com
OPENSEARCH_INDEX=your_code_chunks

# Optional
OPENSEARCH_PIPELINE=ai-hybrid-rrf
BEDROCK_MODEL_ID=amazon.titan-embed-text-v2:0
EMBED_DIM=512
```

## Usage

### CLI Usage (After Global Install)

#### 1. Index Your Codebase

```bash
# Run from your project root
ai-index
```

#### 2. Search Your Code

```bash
# Basic search
ai-query --q "user authentication logic"

# Compact format (optimized for AI consumption)
ai-query --q "database models" --compact

# Filter by area and relevance
ai-query --q "error handling" --area backend --min-score 2.0 --k 5

# Available options:
# --q "query"           Natural language search query (required)
# --k 20                Number of results to return
# --area backend        Filter by area (backend|frontend|infra|docs)
# --min-score 1.5       Minimum relevance score threshold
# --compact             Return compact format for AI consumption
```

### Programmatic Usage

```javascript
import { CodeSearcher } from '@homevote/ai-index'

const searcher = new CodeSearcher({
  opensearchUrl: process.env.OPENSEARCH_URL,
  opensearchIndex: 'my_code_chunks',
  awsRegion: 'us-east-1'
})

// Basic search
const results = await searcher.search("user authentication", {
  k: 10,
  compact: true
})

// Advanced search with filtering
const filteredResults = await searcher.search("database models", {
  area: 'backend',
  minScore: 2.0,
  k: 5
})
```

## Output Formats

### Compact Format (--compact)
Optimized for AI system consumption:

```json
{
  "query": "authentication middleware",
  "results": [
    {
      "path": "app/middleware/auth.js",
      "snippets": ["15-45", "67-89"]
    }
  ]
}
```

### Full Format
Includes relevance scores and detailed metadata:

```json
{
  "query": "authentication middleware",
  "area": "backend",
  "total_results": 3,
  "files": [
    {
      "path": "app/middleware/auth.js",
      "area": "backend", 
      "score": 15.7,
      "snippets": [
        {"start": 15, "end": 45, "score": 15.7},
        {"start": 67, "end": 89, "score": 12.3}
      ]
    }
  ]
}
```

## File Area Classification

Files are automatically categorized:
- `backend`: API routes, models, helpers, workers
- `frontend`: Components, pages, client-side code  
- `infra`: Terraform, Kubernetes, Docker configs
- `docs`: Markdown documentation

## Security

This package:
- ✅ Uses AWS IAM for authentication (no hardcoded credentials)
- ✅ Excludes all `.env` files and secrets from npm package
- ✅ Uses environment variables for configuration
- ✅ Follows AWS security best practices

## Development

```bash
# Clone and install dependencies
git clone https://github.com/homevote/ai-index.git
cd ai-index
npm install

# Set up environment variables
cp .env.example .env
# Edit .env with your AWS configuration

# Test locally
npm run ai:index  # Index current directory
npm run ai:query -- --q "test query"
```

## License

MIT

## Contributing

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add some amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## Support

- 🐛 **Issues**: [GitHub Issues](https://github.com/homevote/ai-index/issues)
- 📧 **Email**: dev@homevote.at
- 📖 **Docs**: [GitHub Repository](https://github.com/homevote/ai-index)