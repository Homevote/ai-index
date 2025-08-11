#!/usr/bin/env node

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { loadConfig } from './config.js';
import { createLocalEmbedder } from './local-embedder.js';
import { createLocalVectorStore } from './local-vector-store.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function getVersion() {
  try {
    const packageJsonPath = path.join(__dirname, '..', 'package.json');
    const content = await fs.readFile(packageJsonPath, 'utf-8');
    const pkg = JSON.parse(content);
    return pkg.version;
  } catch {
    return 'unknown';
  }
}

// Parse command line arguments - the last non-option argument can be a folder path
const args = process.argv.slice(2);
let targetFolder = process.cwd();

// Find the last argument that doesn't start with -- or - and isn't a value for an option
for (let i = args.length - 1; i >= 0; i--) {
  const arg = args[i];
  if (!arg.startsWith('--') && !arg.startsWith('-')) {
    // Check if this is a value for the previous option
    if (i > 0 && ['--q', '--query', '--k', '--area', '--min-score'].includes(args[i-1])) {
      continue;
    }
    
    // Check if this arg is a directory
    try {
      const stat = await fs.stat(arg);
      if (stat.isDirectory()) {
        targetFolder = path.resolve(arg);
        break;
      }
    } catch {
      // Not a valid path, continue
    }
  }
}

const folderName = path.basename(targetFolder);
const INDEX_NAME = folderName.replace(/[^a-zA-Z0-9_-]/g, '_');

// Load configuration and initialize
const config = await loadConfig();
console.log('🏠 Running query in LOCAL mode');
console.log(`Searching index: ${INDEX_NAME}`);

const embedder = await createLocalEmbedder(config);
const vectorStore = await createLocalVectorStore(config, INDEX_NAME);
const EMBED_DIM = embedder.getDimensions();

async function embed(text) {
  return await embedder.embed(text);
}

async function loadChunkMap() {
  const chunkMapPath = path.join(targetFolder, 'ai_index/search/chunkmap.jsonl');
  try {
    const content = await fs.readFile(chunkMapPath, 'utf-8');
    return content.split('\n')
      .filter(line => line.trim())
      .map(line => JSON.parse(line));
  } catch (err) {
    console.error('Warning: Could not load chunkmap.jsonl');
    return [];
  }
}

async function searchLocal(query, k = 20, area = null, minScore = null) {
  const queryEmbedding = await embed(query);
  
  const results = await vectorStore.hybridSearch(query, queryEmbedding, {
    k,
    filter: area ? { area } : {},
    scoreThreshold: minScore || 0
  });
  
  return results.map(result => ({
    _source: {
      repo_path: result.metadata.repo_path,
      content: result.content,
      area: result.metadata.area,
      parent_id: result.metadata.parent_id || result.metadata.repo_path,
      language: result.metadata.language
    },
    _score: result.finalScore || result.score
  }));
}

// Cloud search function removed - local only

async function searchHybrid(query, k = 20, area = null, minScore = null) {
  return await searchLocal(query, k, area, minScore);
}

function groupResultsByFile(results, maxPerFile = 3) {
  const fileGroups = new Map();
  
  for (const hit of results) {
    const filePath = hit._source.parent_id || hit._source.repo_path;
    if (!fileGroups.has(filePath)) {
      fileGroups.set(filePath, {
        path: filePath,
        language: hit._source.language,
        area: hit._source.area,
        bestScore: hit._score,
        chunks: []
      });
    }
    
    const group = fileGroups.get(filePath);
    if (group.chunks.length < maxPerFile) {
      group.chunks.push({
        content: hit._source.content,
        score: hit._score
      });
    }
  }
  
  return Array.from(fileGroups.values())
    .sort((a, b) => b.bestScore - a.bestScore);
}

function formatResults(fileGroups, verbose = false) {
  let output = [];
  
  for (const [index, group] of fileGroups.entries()) {
    output.push(`\n${index + 1}. ${group.path}`);
    output.push(`   Language: ${group.language} | Area: ${group.area} | Score: ${group.bestScore.toFixed(3)}`);
    
    if (verbose) {
      for (const chunk of group.chunks) {
        output.push('\n   --- Chunk ---');
        const lines = chunk.content.split('\n').slice(0, 10);
        output.push('   ' + lines.join('\n   '));
        if (chunk.content.split('\n').length > 10) {
          output.push('   [... truncated ...]');
        }
      }
    }
  }
  
  return output.join('\n');
}

async function main() {
  const args = process.argv.slice(2);
  
  let query = null;
  let k = 10;
  let area = null;
  let minScore = null;
  let verbose = false;
  
  // Parse arguments, excluding the folder path we already found
  const argsCopy = args.slice();
  
  // Remove the folder path from args if it exists
  for (let i = argsCopy.length - 1; i >= 0; i--) {
    const arg = argsCopy[i];
    if (!arg.startsWith('--') && !arg.startsWith('-')) {
      if (i === 0 || !['--q', '--query', '--k', '--area', '--min-score'].includes(argsCopy[i-1])) {
        try {
          const stat = await fs.stat(arg);
          if (stat.isDirectory()) {
            argsCopy.splice(i, 1);
            break;
          }
        } catch {
          // Not a valid path
        }
      }
    }
  }
  
  for (let i = 0; i < argsCopy.length; i++) {
    switch (argsCopy[i]) {
      case '--q':
      case '--query':
        query = argsCopy[++i];
        break;
      case '--k':
        k = parseInt(argsCopy[++i]);
        break;
      case '--area':
        area = argsCopy[++i];
        break;
      case '--min-score':
        minScore = parseFloat(argsCopy[++i]);
        break;
      case '--verbose':
      case '-v':
        verbose = true;
        break;
      case '--help':
      case '-h':
        console.log(`
AI Index Query Tool

Usage:
  ai-index query --q "your search query" [options] [folder]

Options:
  --q, --query <query>   Search query (required)
  --k <number>          Number of results (default: 10)
  --area <area>         Filter by area (backend/frontend/infra/docs)
  --min-score <score>   Minimum score threshold
  --verbose, -v         Show detailed chunk content
  --help, -h            Show this help message
  
  [folder]              Folder to search (optional, defaults to current directory)

Examples:
  ai-index query --q "authentication logic"
  ai-index query --q "database connection" --k 5 --area backend
  ai-index query --q "React components" /path/to/project
        `);
        process.exit(0);
      default:
        if (!argsCopy[i].startsWith('--')) {
          query = argsCopy[i];
        }
    }
  }
  
  if (!query) {
    console.error('Error: Query is required. Use --q "your query" or --help for usage.');
    process.exit(1);
  }
  
  const version = await getVersion();
  console.log(`\n🔍 Searching for: "${query}" (v${version})`);
  if (area) console.log(`   Area filter: ${area}`);
  console.log(`   Index: ${INDEX_NAME}`);
  console.log('');
  
  try {
    const results = await searchHybrid(query, k * 2, area, minScore);
    
    if (results.length === 0) {
      console.log('No results found.');
      return;
    }
    
    const fileGroups = groupResultsByFile(results);
    const topK = fileGroups.slice(0, k);
    
    console.log(`Found ${results.length} chunks across ${fileGroups.length} files.`);
    console.log(`Showing top ${topK.length} files:\n`);
    console.log(formatResults(topK, verbose));
    
    // Load and display chunk map info if available
    const chunkMap = await loadChunkMap();
    if (chunkMap.length > 0 && verbose) {
      console.log('\n📊 Index Statistics:');
      console.log(`   Total indexed chunks: ${chunkMap.length}`);
      const areas = [...new Set(chunkMap.map(c => c.area))];
      console.log(`   Areas: ${areas.join(', ')}`);
    }
    
    const stats = await vectorStore.getStats();
    console.log('\n📊 Local Vector Store:');
    console.log(`   Documents: ${stats.documentCount}`);
    console.log(`   Dimensions: ${stats.dimensions}`);
    console.log(`   Storage: ${stats.indexPath}`);
  } catch (err) {
    console.error('Query failed:', err.message);
    process.exit(1);
  }
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}