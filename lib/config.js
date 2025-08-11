import fs from 'fs/promises';
import path from 'path';
import os from 'os';

const CONFIG_DIR = path.join(os.homedir(), '.ai-index');
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');

const DEFAULT_CONFIG = {
  MODE: 'local',
  DATA_PATH: '~/.ai-index/data',
  EMBED_MODEL: 'Xenova/all-MiniLM-L6-v2'
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
    return !!(config.DATA_PATH && config.EMBED_MODEL);
  } catch {
    return false;
  }
}

export function getConfigPath() {
  return CONFIG_FILE;
}