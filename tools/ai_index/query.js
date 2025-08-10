#!/usr/bin/env node

import { Client } from '@opensearch-project/opensearch';
import { AwsSigv4Signer } from '@opensearch-project/opensearch/aws';
import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import * as dotenv from 'dotenv';

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

const osClient = new Client({
  ...AwsSigv4Signer({
    region: AWS_REGION,
    service: 'es',
  }),
  node: OPENSEARCH_URL,
});

const bedrockClient = new BedrockRuntimeClient({ region: AWS_REGION });

async function embed(text) {
  try {
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
  } catch (err) {
    if (err.name === 'AccessDeniedException') {
      console.warn('Warning: Bedrock model access denied. Falling back to text-only search.');
      return null;
    }
    throw err;
  }
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

async function searchHybrid(query, k = 20, area = null, minScore = null) {
  const queryVector = await embed(query);
  
  let searchBody;
  
  if (queryVector) {
    // Hybrid search with both text and semantic
    searchBody = {
      size: k * 2,
      _source: ['repo_path', 'content', 'area', 'parent_id', 'language'],
      query: {
        bool: {
          should: [
            {
              match: {
                content: {
                  query: query,
                  boost: 1.2
                }
              }
            },
            {
              knn: {
                embedding: {
                  vector: queryVector,
                  k: k * 2,
                  boost: 2.0
                }
              }
            }
          ]
        }
      }
    };
  } else {
    // Fallback to text-only search with multiple strategies
    searchBody = {
      size: k * 2,
      _source: ['repo_path', 'content', 'area', 'parent_id', 'language'],
      query: {
        bool: {
          should: [
            {
              match: {
                content: {
                  query: query,
                  boost: 2.0
                }
              }
            },
            {
              match_phrase: {
                content: {
                  query: query,
                  boost: 3.0
                }
              }
            },
            {
              wildcard: {
                content: {
                  value: `*${query.toLowerCase()}*`,
                  boost: 1.0
                }
              }
            }
          ]
        }
      }
    };
  }
  
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

function expandToParent(hits, chunkMap, minScore = null) {
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
    
    // Try multiple ways to find chunk info
    let chunkInfo = chunkMap.find(c => c.file === source.repo_path) ||
                   chunkMap.find(c => c.chunk_id === hit._id) ||
                   chunkMap.find(c => source.repo_path.endsWith(c.file));
    
    fileGroups[parentId].snippets.push({
      content: source.content,
      start: chunkInfo?.start || chunkInfo?.start_line || 1,
      end: chunkInfo?.end || chunkInfo?.end_line || 1,
      score: hit._score
    });
    
    fileGroups[parentId].score = Math.max(fileGroups[parentId].score, hit._score);
  }
  
  let results = Object.values(fileGroups)
    .sort((a, b) => b.score - a.score)
    .map(file => ({
      path: file.path,
      area: file.area,
      score: file.score,
      snippets: file.snippets
        .sort((a, b) => b.score - a.score)
        .slice(0, 3)
        .map(s => ({ start: s.start, end: s.end, score: s.score }))
    }));
  
  // Apply score filtering if specified
  if (minScore !== null) {
    results = results.filter(r => r.score >= minScore);
  }
  
  return results;
}

async function main() {
  const args = process.argv.slice(2);
  const queryIndex = args.indexOf('--q');
  const kIndex = args.indexOf('--k');
  const areaIndex = args.indexOf('--area');
  const scoreIndex = args.indexOf('--min-score');
  const compactIndex = args.indexOf('--compact');
  
  if (queryIndex === -1 || args[queryIndex + 1] === undefined) {
    console.error('Usage: npm run ai:query -- --q "<query>" [--k 20] [--area backend|frontend|infra|docs] [--min-score 0.5] [--compact]');
    process.exit(1);
  }
  
  if (!OPENSEARCH_URL) {
    console.error('Error: OPENSEARCH_URL environment variable is required');
    process.exit(1);
  }
  
  const query = args[queryIndex + 1];
  const k = kIndex !== -1 ? parseInt(args[kIndex + 1]) : 20;
  const area = areaIndex !== -1 ? args[areaIndex + 1] : null;
  const minScore = scoreIndex !== -1 ? parseFloat(args[scoreIndex + 1]) : null;
  const compact = compactIndex !== -1;
  
  try {
    const chunkMap = await loadChunkMap();
    const hits = await searchHybrid(query, k, area, minScore);
    const results = expandToParent(hits, chunkMap, minScore);
    
    let output;
    if (compact) {
      // Compact format optimized for AI consumption
      output = {
        query,
        results: results.slice(0, k).map(file => ({
          path: file.path,
          snippets: file.snippets.map(s => `${s.start}-${s.end}`)
        }))
      };
    } else {
      // Full format with scores for debugging
      output = {
        query,
        area,
        total_results: results.length,
        files: results.slice(0, k)
      };
    }
    
    console.log(JSON.stringify(output, null, 2));
  } catch (err) {
    console.error('Query failed:', err.message);
    process.exit(1);
  }
}

main();