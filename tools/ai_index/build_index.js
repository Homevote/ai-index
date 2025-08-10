#!/usr/bin/env node

import { Client } from '@opensearch-project/opensearch';
import { AwsSigv4Signer } from '@opensearch-project/opensearch/aws';
import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';
import { globby } from 'globby';
import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import { execSync } from 'child_process';
import * as dotenv from 'dotenv';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load environment variables
dotenv.config({ path: path.join(__dirname, '../../.env') });

const AWS_REGION = process.env.AWS_REGION || 'us-east-1';
const OPENSEARCH_URL = process.env.OPENSEARCH_URL;
const OPENSEARCH_INDEX = process.env.OPENSEARCH_INDEX || 'homevote_ai_chunks';
const OPENSEARCH_PIPELINE = process.env.OPENSEARCH_PIPELINE || 'ai-hybrid-rrf';
const BEDROCK_MODEL_ID = process.env.BEDROCK_MODEL_ID || 'amazon.titan-embed-text-v2:0';
const EMBED_DIM = parseInt(process.env.EMBED_DIM || '512');
const REPO_ROOT = path.resolve('../');

const osClient = new Client({
  ...AwsSigv4Signer({
    region: AWS_REGION,
    service: 'es',
  }),
  node: OPENSEARCH_URL,
});

const bedrockClient = new BedrockRuntimeClient({ region: AWS_REGION });

async function embed(text) {
  const body = JSON.stringify({
    inputText: text.slice(0, 8192),
    dimensions: EMBED_DIM
  });
  
  const command = new InvokeModelCommand({
    modelId: BEDROCK_MODEL_ID,
    contentType: 'application/json',
    accept: 'application/json',
    body
  });
  
  const response = await bedrockClient.send(command);
  const output = JSON.parse(new TextDecoder().decode(response.body));
  return output.embedding;
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
      console.log('Index already exists');
    } else {
      throw err;
    }
  }
}

async function createPipeline() {
  console.log('Creating hybrid search pipeline...');
  try {
    // For now, skip pipeline creation as it requires specific OpenSearch version
    // Hybrid search will work with standard multi-match queries
    console.log('Skipping pipeline creation (will use standard hybrid search)');
  } catch (err) {
    console.log('Pipeline creation skipped:', err.message);
  }
}

function getFileArea(filePath) {
  if (filePath.includes('/app/api/') || filePath.includes('/app/models/') || 
      filePath.includes('/app/helpers/') || filePath.includes('/app/jobs/') || 
      filePath.includes('/app/worker') || filePath.includes('/app/server')) {
    return 'backend';
  } else if (filePath.includes('/app/components/') || filePath.includes('/app/pages/') || 
             filePath.includes('/app/data/') || filePath.includes('/app/public/')) {
    return 'frontend';
  } else if (filePath.includes('/terraform/') || filePath.includes('/k8s/') || 
             filePath.includes('/docker') || filePath.includes('Dockerfile')) {
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
    'app/**/*.{json,yml,yaml}',
    'docs/**/*.md',
    'terraform/**/*.tf',
    'k8s/**/*.{yml,yaml}',
    '*.md'
  ];
  
  const ignorePatterns = [
    '**/node_modules/**',
    '**/dist/**',
    '**/build/**',
    '**/*.min.js',
    '**/package-lock.json',
    '**/public/fonts/**',
    '**/public/icons/**',
    '**/public/flags/**'
  ];
  
  const files = await globby(patterns, {
    cwd: REPO_ROOT,
    ignore: ignorePatterns,
    absolute: false
  });
  
  console.log(`Found ${files.length} files to index`);
  
  const sha = execSync('git rev-parse HEAD', { cwd: REPO_ROOT })
    .toString().trim();
  
  const chunkMap = [];
  const batchSize = 10;
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
          console.log(`Embedding chunk from ${file}...`);
          const embedding = await embed(chunk.content);
          
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
    
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  
  const chunkMapPath = path.join(process.cwd(), 'ai_index/search/chunkmap.jsonl');
  await fs.mkdir(path.dirname(chunkMapPath), { recursive: true });
  await fs.writeFile(
    chunkMapPath,
    chunkMap.map(c => JSON.stringify(c)).join('\n')
  );
  
  const manifest = {
    index: OPENSEARCH_INDEX,
    pipeline: OPENSEARCH_PIPELINE,
    embed_model: BEDROCK_MODEL_ID,
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

async function generateSymbolIndex() {
  console.log('\nGenerating symbol indexes...');
  
  try {
    execSync('npx @sourcegraph/scip-typescript index --project-root .. --output ai_index/scip/index.scip --infer-tsconfig', {
      cwd: process.cwd(),
      stdio: 'inherit'
    });
    console.log('SCIP index generated');
  } catch (err) {
    console.error('Failed to generate SCIP index:', err.message);
  }
  
  try {
    execSync('ctags -R --languages=JavaScript,TypeScript --fields=+n --extras=+q -f ai_index/tags ..', {
      cwd: process.cwd(),
      stdio: 'inherit'
    });
    console.log('ctags index generated');
  } catch (err) {
    console.error('Failed to generate ctags index:', err.message);
  }
}

async function main() {
  if (!OPENSEARCH_URL) {
    console.error('Error: OPENSEARCH_URL environment variable is required');
    process.exit(1);
  }
  
  console.log('Starting AI index build...');
  console.log(`OpenSearch URL: ${OPENSEARCH_URL}`);
  console.log(`Index: ${OPENSEARCH_INDEX}`);
  console.log(`Embedding model: ${BEDROCK_MODEL_ID}`);
  console.log(`Embedding dimension: ${EMBED_DIM}`);
  
  try {
    await createIndex();
    await createPipeline();
    await processFiles();
    await generateSymbolIndex();
    
    console.log('\nBuild complete!');
  } catch (err) {
    console.error('Build failed:', err);
    process.exit(1);
  }
}

main();