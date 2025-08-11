import fs from 'fs/promises';
import path from 'path';
import os from 'os';

const CONFIG_DIR = path.join(os.homedir(), '.ai-index');
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');

const DEFAULT_CONFIG = {
  AWS_REGION: 'us-east-1',
  OPENSEARCH_URL: '',
  OPENSEARCH_INDEX: 'homevote_ai_chunks',
  OPENSEARCH_PIPELINE: 'ai-hybrid-rrf',
  BEDROCK_MODEL_ID: 'amazon.titan-embed-text-v2:0',
  EMBED_DIM: '512'
};

export async function ensureConfigDir() {
  try {
    await fs.mkdir(CONFIG_DIR, { recursive: true });
  } catch (err) {
    if (err.code !== 'EEXIST') {
      throw err;
    }
  }
}

export async function loadConfig() {
  try {
    const content = await fs.readFile(CONFIG_FILE, 'utf-8');
    return { ...DEFAULT_CONFIG, ...JSON.parse(content) };
  } catch (err) {
    if (err.code === 'ENOENT') {
      return DEFAULT_CONFIG;
    }
    throw err;
  }
}

export async function saveConfig(config) {
  await ensureConfigDir();
  const mergedConfig = { ...DEFAULT_CONFIG, ...config };
  await fs.writeFile(CONFIG_FILE, JSON.stringify(mergedConfig, null, 2));
  return mergedConfig;
}

export async function isConfigured() {
  try {
    const config = await loadConfig();
    return config.OPENSEARCH_URL && config.OPENSEARCH_URL !== '';
  } catch {
    return false;
  }
}

export function getConfigPath() {
  return CONFIG_FILE;
}