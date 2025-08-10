#!/usr/bin/env node

// Mock version for testing without Bedrock access
import { Client } from '@opensearch-project/opensearch';
import { AwsSigv4Signer } from '@opensearch-project/opensearch/aws';
import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import * as dotenv from 'dotenv';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, '../../.env') });

const AWS_REGION = process.env.AWS_REGION || 'us-east-1';
const OPENSEARCH_URL = process.env.OPENSEARCH_URL;
const OPENSEARCH_INDEX = process.env.OPENSEARCH_INDEX || 'homevote_ai_chunks';
const EMBED_DIM = parseInt(process.env.EMBED_DIM || '512');

const osClient = new Client({
  ...AwsSigv4Signer({
    region: AWS_REGION,
    service: 'es',
  }),
  node: OPENSEARCH_URL,
});

// Mock embedding - same as in build script for consistency
async function mockEmbed(text) {
  const hash = crypto.createHash('sha256').update(text).digest();
  const embedding = [];
  for (let i = 0; i < EMBED_DIM; i++) {
    const byte1 = hash[i % hash.length];
    const byte2 = hash[(i + 1) % hash.length];
    const value = ((byte1 / 255) + (byte2 / 255)) / 2 - 0.5;
    embedding.push(value);
  }
  return embedding;
}

async function loadChunkMap() {
  const chunkMapPath = path.join(__dirname, '../../ai_index/search/chunkmap.jsonl');
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

async function searchHybrid(query, k = 20, area = null) {
  // For mock version, use text search primarily
  const searchBody = {
    size: k * 2,
    _source: ['repo_path', 'content', 'area', 'parent_id', 'language'],
    query: {
      bool: {
        must: [
          {
            multi_match: {
              query: query,
              fields: ['content^2', 'repo_path'],
              type: 'best_fields',
              fuzziness: 'AUTO'
            }
          }
        ]
      }
    }
  };
  
  if (area) {
    searchBody.query.bool.filter = [
      { term: { area: area } }
    ];
  }
  
  try {
    const response = await osClient.search({
      index: OPENSEARCH_INDEX,
      body: searchBody
    });
    
    return response.body.hits.hits;
  } catch (err) {
    console.error('Search error:', err);
    throw err;
  }
}

function expandToParent(hits, chunkMap) {
  const fileGroups = {};
  
  for (const hit of hits) {
    const source = hit._source;
    const parentId = source.parent_id || source.repo_path;
    
    if (!fileGroups[parentId]) {
      fileGroups[parentId] = {
        path: parentId,
        language: source.language,
        area: source.area,
        score: hit._score,
        snippets: []
      };
    }
    
    const chunkInfo = chunkMap.find(c => c.file === source.repo_path);
    fileGroups[parentId].snippets.push({
      content: source.content.slice(0, 200),
      start: chunkInfo?.start || 0,
      end: chunkInfo?.end || 0,
      score: hit._score
    });
    
    fileGroups[parentId].score = Math.max(fileGroups[parentId].score, hit._score);
  }
  
  const results = Object.values(fileGroups)
    .sort((a, b) => b.score - a.score)
    .map(file => ({
      path: file.path,
      language: file.language,
      area: file.area,
      score: file.score,
      snippets: file.snippets
        .sort((a, b) => b.score - a.score)
        .slice(0, 3)
        .map(s => ({ 
          start: s.start, 
          end: s.end,
          preview: s.content.replace(/\n/g, ' ').slice(0, 100) + '...'
        }))
    }));
  
  return results;
}

async function main() {
  const args = process.argv.slice(2);
  const queryIndex = args.indexOf('--q');
  const kIndex = args.indexOf('--k');
  const areaIndex = args.indexOf('--area');
  
  if (queryIndex === -1 || args[queryIndex + 1] === undefined) {
    console.error('Usage: node query_mock.js --q "<query>" [--k 20] [--area backend|frontend|infra|docs]');
    process.exit(1);
  }
  
  if (!OPENSEARCH_URL) {
    console.error('Error: OPENSEARCH_URL environment variable is required');
    process.exit(1);
  }
  
  const query = args[queryIndex + 1];
  const k = kIndex !== -1 ? parseInt(args[kIndex + 1]) : 20;
  const area = areaIndex !== -1 ? args[areaIndex + 1] : null;
  
  console.log('\n🔍 Searching (MOCK MODE - text search only)...\n');
  
  try {
    const chunkMap = await loadChunkMap();
    const hits = await searchHybrid(query, k, area);
    const results = expandToParent(hits, chunkMap);
    
    const output = {
      query,
      area,
      mode: 'MOCK_TEXT_SEARCH',
      total_results: results.length,
      files: results.slice(0, k)
    };
    
    console.log(JSON.stringify(output, null, 2));
  } catch (err) {
    console.error('Query failed:', err.message);
    process.exit(1);
  }
}

main();