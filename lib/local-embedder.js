import { pipeline, env } from '@xenova/transformers';
import path from 'path';
import { homedir } from 'os';
import fs from 'fs/promises';

export class LocalEmbedder {
  constructor(modelName = 'Xenova/all-MiniLM-L6-v2') {
    this.modelName = modelName;
    this.model = null;
    this.initialized = false;
    
    const modelsCachePath = path.join(homedir(), '.ai-index', 'models');
    env.cacheDir = modelsCachePath;
    env.allowRemoteModels = true;
    env.localURL = modelsCachePath;
  }
  
  async initialize() {
    if (this.initialized) return;
    
    console.log(`🤖 Loading embedding model: ${this.modelName}`);
    console.log('   This may take a few minutes on first run...');
    
    try {
      const cacheDir = path.join(homedir(), '.ai-index', 'models');
      await fs.mkdir(cacheDir, { recursive: true });
      
      this.model = await pipeline('feature-extraction', this.modelName, {
        quantized: true,
      });
      
      this.initialized = true;
      console.log('✅ Embedding model loaded successfully');
    } catch (error) {
      console.error('❌ Failed to load embedding model:', error);
      throw error;
    }
  }
  
  async embed(text) {
    if (!this.initialized) {
      await this.initialize();
    }
    
    try {
      const output = await this.model(text, { 
        pooling: 'mean',
        normalize: true 
      });
      
      return Array.from(output.data);
    } catch (error) {
      console.error('Error generating embedding:', error);
      throw error;
    }
  }
  
  async embedBatch(texts, options = {}) {
    if (!this.initialized) {
      await this.initialize();
    }
    
    const { batchSize = 32, onProgress } = options;
    const embeddings = [];
    
    for (let i = 0; i < texts.length; i += batchSize) {
      const batch = texts.slice(i, i + batchSize);
      
      const batchEmbeddings = await Promise.all(
        batch.map(text => this.embed(text))
      );
      
      embeddings.push(...batchEmbeddings);
      
      if (onProgress) {
        onProgress(Math.min(i + batchSize, texts.length), texts.length);
      }
    }
    
    return embeddings;
  }
  
  getDimensions() {
    if (this.modelName.includes('all-MiniLM-L6')) {
      return 384;
    } else if (this.modelName.includes('all-mpnet-base')) {
      return 768;
    } else if (this.modelName.includes('all-MiniLM-L12')) {
      return 384;
    } else {
      return 384;
    }
  }
}

export async function createLocalEmbedder(config = {}) {
  const modelName = config.EMBED_MODEL || 'Xenova/all-MiniLM-L6-v2';
  const embedder = new LocalEmbedder(modelName);
  await embedder.initialize();
  return embedder;
}