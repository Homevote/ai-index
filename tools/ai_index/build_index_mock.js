#!/usr/bin/env node

// Mock version for testing without Bedrock access
import { Client } from '@opensearch-project/opensearch';
import { AwsSigv4Signer } from '@opensearch-project/opensearch/aws';
import { globby } from 'globby';
import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import { execSync } from 'child_process';
import * as dotenv from 'dotenv';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, '../../.env') });

const AWS_REGION = process.env.AWS_REGION || 'us-east-1';
const OPENSEARCH_URL = process.env.OPENSEARCH_URL;
const OPENSEARCH_INDEX = process.env.OPENSEARCH_INDEX || 'homevote_ai_chunks';
const EMBED_DIM = parseInt(process.env.EMBED_DIM || '512');
const REPO_ROOT = path.resolve('../');

const osClient = new Client({
  ...AwsSigv4Signer({
    region: AWS_REGION,
    service: 'es',
  }),
  node: OPENSEARCH_URL,
});

// Mock embedding function - creates deterministic fake embeddings
async function mockEmbed(text) {
  const hash = crypto.createHash('sha256').update(text).digest();
  const embedding = [];
  for (let i = 0; i < EMBED_DIM; i++) {
    // Create pseudo-random but deterministic values
    const byte1 = hash[i % hash.length];
    const byte2 = hash[(i + 1) % hash.length];
    const value = ((byte1 / 255) + (byte2 / 255)) / 2 - 0.5;
    embedding.push(value);
  }
  return embedding;
}

async function createIndex() {
  console.log('Creating OpenSearch index...');
  try {
    await osClient.indices.create({
      index: OPENSEARCH_INDEX,
      body: {
        settings: { 
          index: { 
            knn: true,
            number_of_shards: 1,
            number_of_replicas: 0
          } 
        },
        mappings: {
          properties: {
            repo_path: { type: 'keyword' },
            sha: { type: 'keyword' },
            language: { type: 'keyword' },
            area: { type: 'keyword' },
            parent_id: { type: 'keyword' },
            content: { type: 'text' },
            embedding: {
              type: 'knn_vector',
              dimension: EMBED_DIM,
              method: { 
                name: 'hnsw', 
                space_type: 'cosinesimil',
                parameters: {
                  ef_construction: 512,
                  m: 16
                }
              }
            }
          }
        }
      }
    });
    console.log('Index created successfully');
  } catch (err) {
    if (err.body?.error?.type === 'resource_already_exists_exception') {
      console.log('Index already exists - deleting and recreating...');
      await osClient.indices.delete({ index: OPENSEARCH_INDEX });
      await createIndex();
    } else {
      throw err;
    }
  }
}

function getFileArea(filePath) {
  if (filePath.includes('/api/') || filePath.includes('/models/') || 
      filePath.includes('/helpers/') || filePath.includes('/jobs/') || 
      filePath.includes('/worker') || filePath.includes('/server')) {
    return 'backend';
  } else if (filePath.includes('/components/') || filePath.includes('/pages/') || 
             filePath.includes('/data/') || filePath.includes('/public/')) {
    return 'frontend';
  } else if (filePath.includes('/terraform/') || filePath.includes('/k8s/') || 
             filePath.includes('docker') || filePath.includes('Dockerfile')) {
    return 'infra';
  } else if (filePath.includes('/docs/') || filePath.includes('README') || 
             filePath.includes('DOCUMENTATION')) {
    return 'docs';
  }
  return 'other';
}

function getLanguage(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const langMap = {
    '.js': 'javascript',
    '.mjs': 'javascript',
    '.jsx': 'javascript',
    '.ts': 'typescript',
    '.tsx': 'typescript',
    '.py': 'python',
    '.go': 'go',
    '.tf': 'terraform',
    '.yml': 'yaml',
    '.yaml': 'yaml',
    '.json': 'json',
    '.md': 'markdown',
    '.scss': 'scss',
    '.css': 'css',
    '.sql': 'sql',
    '.sh': 'bash'
  };
  return langMap[ext] || 'unknown';
}

async function chunkFile(filePath, content) {
  const chunks = [];
  const lines = content.split('\n');
  const language = getLanguage(filePath);
  const area = getFileArea(filePath);
  
  const maxLinesPerChunk = language === 'markdown' || area === 'docs' ? 50 : 30;
  const overlap = 5;
  
  for (let i = 0; i < lines.length; i += maxLinesPerChunk - overlap) {
    const chunkLines = lines.slice(i, i + maxLinesPerChunk);
    const chunkContent = chunkLines.join('\n');
    
    if (chunkContent.trim().length > 50) {
      const chunkId = crypto.createHash('md5')
        .update(`${filePath}:${i}`)
        .digest('hex');
      
      chunks.push({
        id: chunkId,
        repo_path: filePath,
        content: chunkContent,
        language,
        area,
        parent_id: filePath,
        start_line: i,
        end_line: Math.min(i + maxLinesPerChunk, lines.length)
      });
    }
  }
  
  return chunks;
}

async function indexDocuments(documents) {
  if (documents.length === 0) return;
  
  const bulkBody = [];
  for (const doc of documents) {
    bulkBody.push({ index: { _index: OPENSEARCH_INDEX, _id: doc.id } });
    bulkBody.push(doc);
  }
  
  const response = await osClient.bulk({ body: bulkBody });
  
  if (response.body.errors) {
    const errors = response.body.items
      .filter(item => item.index?.error)
      .map(item => item.index.error);
    console.error('Bulk indexing errors:', errors);
  }
}

async function processFiles() {
  const patterns = [
    'app/**/*.{js,mjs,jsx}',
    'app/**/*.json',
    'app/**/*.{yml,yaml}'
  ];
  
  const ignorePatterns = [
    '**/node_modules/**',
    '**/dist/**',
    '**/build/**',
    '**/*.min.js',
    '**/package-lock.json',
    '**/public/fonts/**',
    '**/public/icons/**',
    '**/public/flags/**',
    '**/public/static/**'
  ];
  
  const files = await globby(patterns, {
    cwd: REPO_ROOT,
    ignore: ignorePatterns,
    absolute: false
  });
  
  console.log(`Found ${files.length} files to index from /app directory`);
  
  const sha = execSync('git rev-parse HEAD', { cwd: REPO_ROOT })
    .toString().trim();
  
  const chunkMap = [];
  const batchSize = 20;
  let totalChunks = 0;
  
  for (let i = 0; i < files.length; i += batchSize) {
    const batch = files.slice(i, i + batchSize);
    const documents = [];
    
    for (const file of batch) {
      const fullPath = path.join(REPO_ROOT, file);
      try {
        const content = await fs.readFile(fullPath, 'utf-8');
        const chunks = await chunkFile(file, content);
        
        for (const chunk of chunks) {
          console.log(`Creating mock embedding for ${file} (chunk ${chunks.indexOf(chunk) + 1}/${chunks.length})...`);
          const embedding = await mockEmbed(chunk.content);
          
          documents.push({
            ...chunk,
            sha,
            embedding
          });
          
          chunkMap.push({
            chunk_id: chunk.id,
            file: chunk.repo_path,
            start: chunk.start_line,
            end: chunk.end_line,
            parent_id: chunk.parent_id,
            area: chunk.area
          });
        }
      } catch (err) {
        console.error(`Error processing ${file}:`, err.message);
      }
    }
    
    if (documents.length > 0) {
      await indexDocuments(documents);
      totalChunks += documents.length;
      console.log(`Indexed ${totalChunks} chunks so far...`);
    }
  }
  
  const chunkMapPath = path.join(process.cwd(), 'ai_index/search/chunkmap.jsonl');
  await fs.mkdir(path.dirname(chunkMapPath), { recursive: true });
  await fs.writeFile(
    chunkMapPath,
    chunkMap.map(c => JSON.stringify(c)).join('\n')
  );
  
  const manifest = {
    index: OPENSEARCH_INDEX,
    pipeline: 'none',
    embed_model: 'MOCK',
    dim: EMBED_DIM,
    last_built_at: new Date().toISOString(),
    total_chunks: totalChunks,
    total_files: files.length,
    sha
  };
  
  await fs.writeFile(
    path.join(process.cwd(), 'ai_index/manifest.json'),
    JSON.stringify(manifest, null, 2)
  );
  
  console.log(`\nIndexing complete! Indexed ${totalChunks} chunks from ${files.length} files`);
}

async function main() {
  if (!OPENSEARCH_URL) {
    console.error('Error: OPENSEARCH_URL environment variable is required');
    process.exit(1);
  }
  
  console.log('Starting AI index build (MOCK MODE - using fake embeddings)...');
  console.log(`OpenSearch URL: ${OPENSEARCH_URL}`);
  console.log(`Index: ${OPENSEARCH_INDEX}`);
  console.log(`Embedding dimension: ${EMBED_DIM}`);
  console.log('⚠️  WARNING: Using mock embeddings for testing. Real Bedrock access required for production.');
  
  try {
    await createIndex();
    await processFiles();
    
    console.log('\nBuild complete (mock embeddings)!');
    console.log('Note: Search results will not be semantically accurate with mock embeddings.');
  } catch (err) {
    console.error('Build failed:', err);
    process.exit(1);
  }
}

main();