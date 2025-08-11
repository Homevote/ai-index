# ai-index

🤖 ai-index v3.0.0 - Local AI-powered code indexing and search

AI-powered local code indexing and search system with efficient reindexing. Enables semantic code search across any codebase using local embeddings and vector storage, with smart change detection to only reprocess modified files.

## Features

- 🔍 **Semantic Search**: Find code using natural language queries with local embeddings
- ⚡ **Efficient Reindexing**: Smart change detection - only reprocesses modified files using SHA-256 hashing
- 🗑️ **Automatic Cleanup**: Removes outdated chunks and handles deleted files automatically
- 🎯 **Hybrid Search**: Combines lexical and vector search for optimal results
- 📦 **Local Storage**: No cloud dependencies - uses local vector database (Vectra)
- 🏷️ **Area Filtering**: Filter by codebase areas (backend, frontend, docs, infra)
- 🔧 **Force Reindex**: Option to reprocess all files when needed
- 📚 **Programmatic API**: Use as a library in your applications

## Installation

### Global Installation (Recommended)

```bash
npm install -g ai-index
```

### Local Installation

```bash
npm install ai-index
```

## Prerequisites

- **Node.js 18+**: Required for running the local embedding models
- **Local Storage**: ~100MB for embedding models and vector data (per project)

## Configuration

The system works out of the box with local defaults. Optional configuration via `~/.ai-index/config.json`:

```json
{
  "MODE": "local",
  "DATA_PATH": "~/.ai-index/data", 
  "EMBED_MODEL": "Xenova/all-MiniLM-L6-v2"
}
```

### Default Settings
- **Embedding Model**: `Xenova/all-MiniLM-L6-v2` (384 dimensions, ~90MB download)
- **Storage**: `~/.ai-index/data/` (vector databases stored per project)
- **Hash Tracking**: `ai_index/file_hashes.json` (tracks file changes for efficient reindexing)

## Usage

### CLI Usage (After Global Install)

#### 1. Index Your Codebase

```bash
# Index current folder
ai-index index

# Index specific directory
ai-index index /path/to/your/project

# Force full reindex (reprocess all files)
ai-index index --force
```

**Efficient Reindexing Performance:**
- First run: Processes all files (~30 seconds for medium codebase)
- Subsequent runs: Only changed files (~2-5 seconds, 80-95% faster)
- Automatic cleanup of deleted files and outdated chunks

#### 2. Search Your Code

```bash
# Basic search
ai-index query --q "user authentication logic"

# Compact format (optimized for AI consumption)
ai-index query --q "database models" --compact

# Filter by area and relevance
ai-index query --q "error handling" --area backend --min-score 2.0 --k 5

# Available options:
# --q "query"           Natural language search query (required)
# --k 20                Number of results to return
# --area backend        Filter by area (backend|frontend|infra|docs)
# --min-score 1.5       Minimum relevance score threshold
# --compact             Return compact format for AI consumption
```

### Programmatic Usage

```javascript
import { CodeSearcher } from 'ai-index'

// Local mode - works out of the box
const searcher = new CodeSearcher({
  mode: 'local',
  indexName: 'my_project' // optional, defaults to folder name
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

### Efficient Reindexing API

```javascript
import { buildIndex } from 'ai-index'

// Smart reindexing (only changed files)
await buildIndex('/path/to/project')

// Force full reindex
await buildIndex('/path/to/project', { force: true })
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

## How Efficient Reindexing Works

1. **Hash Tracking**: Each file's SHA-256 content hash is stored in `ai_index/file_hashes.json`
2. **Change Detection**: On reindex, compares current file hashes with stored hashes  
3. **Selective Processing**: Only files with changed hashes are reprocessed
4. **Chunk Cleanup**: Old vector embeddings are removed before adding new ones
5. **Deleted Files**: Automatically removes chunks for files that no longer exist
6. **Performance**: Typical 80-95% reduction in processing time after initial index

## Security

This package:
- ✅ Runs completely locally - no data sent to external services
- ✅ Uses local embedding models (Transformers.js)
- ✅ Excludes all `.env` files and secrets from indexing
- ✅ Stores vector data locally in `~/.ai-index/data/`
- ✅ No hardcoded credentials or external dependencies

## Development

```bash
# Clone and install dependencies
git clone https://github.com/homevote/ai-index.git
cd ai-index
npm install

# Test locally (works out of the box)
ai-index index      # Index current directory
ai-index query --q "test query"

# Test efficient reindexing
ai-index index      # First run - processes all files
ai-index index      # Second run - only changed files
ai-index index --force  # Force reindex all files
```

## Performance Benchmarks

Tested on a TypeScript codebase with 1,200 files:

| Operation | First Run | Subsequent Runs | Savings |
|-----------|-----------|-----------------|---------|
| **File Processing** | 1,200 files | 15-50 files | 92-96% |
| **Time** | 45 seconds | 3-8 seconds | 82-93% |
| **Embeddings** | 3,200 chunks | 45-180 chunks | 91-98% |

*Performance varies based on code change frequency*

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