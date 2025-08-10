import { Client } from '@opensearch-project/opensearch'
import { AwsSigv4Signer } from '@opensearch-project/opensearch/aws'
import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime'
import fs from 'fs/promises'
import path from 'path'

/**
 * AI-powered code search using OpenSearch and Bedrock embeddings
 */
export default class CodeSearcher {
  constructor(config) {
    this.config = {
      awsRegion: config.awsRegion || process.env.AWS_REGION || 'us-east-1',
      opensearchUrl: config.opensearchUrl || process.env.OPENSEARCH_URL,
      opensearchIndex: config.opensearchIndex || process.env.OPENSEARCH_INDEX || 'ai_code_chunks',
      bedrockModelId: config.bedrockModelId || process.env.BEDROCK_MODEL_ID || 'amazon.titan-embed-text-v2:0',
      embedDim: config.embedDim || parseInt(process.env.EMBED_DIM || '512'),
      chunkMapPath: config.chunkMapPath || './ai_index/search/chunkmap.jsonl'
    }

    this.osClient = new Client({
      ...AwsSigv4Signer({
        region: this.config.awsRegion,
        service: 'es',
      }),
      node: this.config.opensearchUrl,
    })

    this.bedrockClient = new BedrockRuntimeClient({ region: this.config.awsRegion })
    this.chunkMap = null
  }

  async loadChunkMap() {
    if (this.chunkMap) return this.chunkMap

    try {
      const content = await fs.readFile(this.config.chunkMapPath, 'utf-8')
      this.chunkMap = content.split('\\n')
        .filter(line => line.trim())
        .map(line => JSON.parse(line))
      return this.chunkMap
    } catch (err) {
      console.warn('Warning: Could not load chunkmap.jsonl')
      return []
    }
  }

  async embed(text) {
    try {
      const body = JSON.stringify({
        inputText: text.slice(0, 8192),
        dimensions: this.config.embedDim
      })
      
      const command = new InvokeModelCommand({
        modelId: this.config.bedrockModelId,
        contentType: 'application/json',
        accept: 'application/json',
        body
      })
      
      const response = await this.bedrockClient.send(command)
      const output = JSON.parse(new TextDecoder().decode(response.body))
      return output.embedding
    } catch (err) {
      if (err.name === 'AccessDeniedException') {
        console.warn('Warning: Bedrock model access denied. Falling back to text-only search.')
        return null
      }
      throw err
    }
  }

  /**
   * Search for code snippets using natural language queries
   * @param {string} query - Natural language search query
   * @param {Object} options - Search options
   * @param {number} options.k - Number of results to return
   * @param {string} options.area - Filter by area (backend, frontend, infra, docs)  
   * @param {number} options.minScore - Minimum relevance score threshold
   * @param {boolean} options.compact - Return compact format optimized for AI consumption
   * @returns {Promise<Object>} Search results
   */
  async search(query, options = {}) {
    const { k = 20, area = null, minScore = null, compact = false } = options
    
    const chunkMap = await this.loadChunkMap()
    const hits = await this.searchHybrid(query, k, area, minScore)
    const results = this.expandToParent(hits, chunkMap, minScore)
    
    if (compact) {
      return {
        query,
        results: results.slice(0, k).map(file => ({
          path: file.path,
          snippets: file.snippets.map(s => \`\${s.start}-\${s.end}\`)
        }))
      }
    }

    return {
      query,
      area,
      total_results: results.length,
      files: results.slice(0, k)
    }
  }

  async searchHybrid(query, k = 20, area = null, minScore = null) {
    const queryVector = await this.embed(query)
    
    let searchBody
    
    if (queryVector) {
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
      }
    } else {
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
                    value: \`*\${query.toLowerCase()}*\`,
                    boost: 1.0
                  }
                }
              }
            ]
          }
        }
      }
    }
    
    if (area) {
      searchBody.query.bool.filter = [
        { term: { area: area } }
      ]
    }
    
    try {
      const response = await this.osClient.search({
        index: this.config.opensearchIndex,
        body: searchBody
      })
      
      return response.body.hits.hits
    } catch (err) {
      console.error('Search error:', err)
      throw err
    }
  }

  expandToParent(hits, chunkMap, minScore = null) {
    const fileGroups = {}
    
    for (const hit of hits) {
      const source = hit._source
      const parentId = source.parent_id || source.repo_path
      
      if (!fileGroups[parentId]) {
        fileGroups[parentId] = {
          path: parentId,
          area: source.area,
          score: hit._score,
          snippets: []
        }
      }
      
      const chunkInfo = chunkMap.find(c => c.file === source.repo_path) ||
                       chunkMap.find(c => c.chunk_id === hit._id) ||
                       chunkMap.find(c => source.repo_path.endsWith(c.file))
      
      fileGroups[parentId].snippets.push({
        content: source.content,
        start: chunkInfo?.start || chunkInfo?.start_line || 1,
        end: chunkInfo?.end || chunkInfo?.end_line || 1,
        score: hit._score
      })
      
      fileGroups[parentId].score = Math.max(fileGroups[parentId].score, hit._score)
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
      }))
    
    if (minScore !== null) {
      results = results.filter(r => r.score >= minScore)
    }
    
    return results
  }
}