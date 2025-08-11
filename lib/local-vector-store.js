import { LocalIndex } from 'vectra';
import path from 'path';
import { homedir } from 'os';
import fs from 'fs/promises';

export class LocalVectorStore {
  constructor(config = {}, indexName = null) {
    this.indexName = indexName || config.INDEX_NAME || 'code_index';
    this.dataPath = this.expandPath(config.DATA_PATH || '~/.ai-index/data');
    this.index = null;
    this.dimensions = null;
  }
  
  expandPath(filepath) {
    if (filepath.startsWith('~/')) {
      return path.join(homedir(), filepath.slice(2));
    }
    return filepath;
  }
  
  async initialize(dimensions = 384) {
    this.dimensions = dimensions;
    const indexPath = path.join(this.dataPath, this.indexName);
    
    await fs.mkdir(this.dataPath, { recursive: true });
    
    try {
      this.index = new LocalIndex(indexPath);
      const exists = await this.index.isIndexCreated();
      
      if (!exists) {
        console.log(`📦 Creating new local index at: ${indexPath}`);
        await this.index.createIndex({
          dimensions,
          metric: 'cosine',
          cacheSize: 1000
        });
      } else {
        console.log(`📂 Loading existing index from: ${indexPath}`);
      }
    } catch (error) {
      console.error('Failed to initialize vector store:', error);
      throw error;
    }
  }
  
  async addDocuments(documents) {
    if (!this.index) {
      throw new Error('Vector store not initialized');
    }
    
    const items = documents.map(doc => ({
      id: doc.id || this.generateId(),
      vector: doc.embedding,
      metadata: {
        content: doc.content,
        repo_path: doc.repo_path || '',
        area: doc.area || '',
        language: doc.language || '',
        start_line: doc.start_line || 0,
        end_line: doc.end_line || 0,
        chunk_id: doc.chunk_id || 0,
        is_documentation: doc.is_documentation || false,
        ...doc.metadata
      }
    }));
    
    await this.index.beginUpdate();
    
    for (const item of items) {
      await this.index.upsertItem(item);
    }
    
    await this.index.endUpdate();
    
    return items.length;
  }
  
  async search(queryEmbedding, options = {}) {
    if (!this.index) {
      throw new Error('Vector store not initialized');
    }
    
    const {
      k = 10,
      filter = {},
      scoreThreshold = 0
    } = options;
    
    const results = await this.index.queryItems(queryEmbedding, k);
    
    let filtered = results;
    
    if (filter.area) {
      filtered = filtered.filter(r => r.item.metadata.area === filter.area);
    }
    
    if (filter.language) {
      filtered = filtered.filter(r => r.item.metadata.language === filter.language);
    }
    
    if (scoreThreshold > 0) {
      filtered = filtered.filter(r => r.score >= scoreThreshold);
    }
    
    return filtered.map(result => ({
      id: result.item.id,
      score: result.score,
      metadata: result.item.metadata,
      content: result.item.metadata.content
    }));
  }
  
  async hybridSearch(query, queryEmbedding, options = {}) {
    const {
      k = 10,
      textWeight = 0.3,
      vectorWeight = 0.7,
      filter = {}
    } = options;
    
    const vectorResults = await this.search(queryEmbedding, { k: k * 2, filter });
    
    const textResults = [];
    const queryLower = query.toLowerCase();
    const allItems = await this.index.listItems();
    
    for (const item of allItems) {
      const content = (item.metadata.content || '').toLowerCase();
      if (content.includes(queryLower)) {
        const score = this.calculateTextScore(content, queryLower);
        textResults.push({
          id: item.id,
          score,
          metadata: item.metadata,
          content: item.metadata.content
        });
      }
    }
    
    textResults.sort((a, b) => b.score - a.score);
    
    const combined = new Map();
    
    for (const result of vectorResults) {
      combined.set(result.id, {
        ...result,
        finalScore: result.score * vectorWeight
      });
    }
    
    for (const result of textResults.slice(0, k * 2)) {
      if (combined.has(result.id)) {
        combined.get(result.id).finalScore += result.score * textWeight;
      } else {
        combined.set(result.id, {
          ...result,
          finalScore: result.score * textWeight
        });
      }
    }
    
    const results = Array.from(combined.values())
      .sort((a, b) => b.finalScore - a.finalScore)
      .slice(0, k);
    
    return results;
  }
  
  calculateTextScore(content, query) {
    const exactMatches = (content.match(new RegExp(query, 'gi')) || []).length;
    const wordMatches = query.split(/\s+/).filter(word => 
      content.includes(word.toLowerCase())
    ).length;
    
    return (exactMatches * 2 + wordMatches) / (query.split(/\s+/).length + 1);
  }
  
  async removeDocumentsByFile(filePath) {
    if (!this.index) {
      throw new Error('Vector store not initialized');
    }
    
    const allItems = await this.index.listItems();
    const itemsToRemove = allItems.filter(item => 
      item.metadata.repo_path === filePath
    );
    
    if (itemsToRemove.length === 0) {
      return 0;
    }
    
    await this.index.beginUpdate();
    
    for (const item of itemsToRemove) {
      await this.index.deleteItem(item.id);
    }
    
    await this.index.endUpdate();
    
    return itemsToRemove.length;
  }

  async deleteIndex() {
    if (this.index) {
      const indexPath = path.join(this.dataPath, this.indexName);
      await this.index.deleteIndex();
      console.log(`🗑️ Deleted index at: ${indexPath}`);
    }
  }
  
  async getStats() {
    if (!this.index) {
      return { documentCount: 0, dimensions: 0 };
    }
    
    const items = await this.index.listItems();
    return {
      documentCount: items.length,
      dimensions: this.dimensions,
      indexPath: path.join(this.dataPath, this.indexName)
    };
  }
  
  generateId() {
    return `doc_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }
}

export async function createLocalVectorStore(config = {}, indexName = null) {
  const store = new LocalVectorStore(config, indexName);
  const dimensions = config.EMBED_DIM || 384;
  await store.initialize(dimensions);
  return store;
}