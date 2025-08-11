#!/usr/bin/env node

import readline from 'readline';
import { loadConfig, saveConfig, getConfigPath, configExists } from '../lib/config.js';

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

function question(prompt) {
  return new Promise((resolve) => {
    rl.question(prompt, resolve);
  });
}

async function configure() {
  console.log('🔧 ai-query Configuration Setup\n');
  
  const hasExistingConfig = await configExists();
  let config = {};
  
  if (hasExistingConfig) {
    console.log('📋 Found existing configuration at:', getConfigPath());
    const useExisting = await question('Load existing values as defaults? (y/n): ');
    if (useExisting.toLowerCase() === 'y' || useExisting.toLowerCase() === 'yes') {
      config = await loadConfig();
      console.log('✅ Loaded existing configuration\n');
    }
  }
  
  console.log('Please provide the following configuration values:');
  console.log('(Press Enter to keep current/default values shown in brackets)\n');
  
  // AWS Region
  const region = await question(`AWS Region [${config.AWS_REGION || 'us-east-1'}]: `);
  if (region.trim()) config.AWS_REGION = region.trim();
  
  // OpenSearch URL
  const osUrl = await question(`OpenSearch URL [${config.OPENSEARCH_URL || 'https://your-domain.region.es.amazonaws.com'}]: `);
  if (osUrl.trim()) config.OPENSEARCH_URL = osUrl.trim();
  
  // OpenSearch Index
  const osIndex = await question(`OpenSearch Index [${config.OPENSEARCH_INDEX || 'homevote_ai_chunks'}]: `);
  if (osIndex.trim()) config.OPENSEARCH_INDEX = osIndex.trim();
  
  // OpenSearch Pipeline
  const osPipeline = await question(`OpenSearch Pipeline [${config.OPENSEARCH_PIPELINE || 'ai-hybrid-rrf'}]: `);
  if (osPipeline.trim()) config.OPENSEARCH_PIPELINE = osPipeline.trim();
  
  // Bedrock Model ID
  const modelId = await question(`Bedrock Model ID [${config.BEDROCK_MODEL_ID || 'amazon.titan-embed-text-v2:0'}]: `);
  if (modelId.trim()) config.BEDROCK_MODEL_ID = modelId.trim();
  
  // Embedding Dimensions
  const embedDim = await question(`Embedding Dimensions [${config.EMBED_DIM || '512'}]: `);
  if (embedDim.trim()) config.EMBED_DIM = embedDim.trim();
  
  console.log('\n📝 Configuration Summary:');
  console.log('-------------------------');
  console.log(`AWS Region: ${config.AWS_REGION}`);
  console.log(`OpenSearch URL: ${config.OPENSEARCH_URL}`);
  console.log(`OpenSearch Index: ${config.OPENSEARCH_INDEX}`);
  console.log(`OpenSearch Pipeline: ${config.OPENSEARCH_PIPELINE}`);
  console.log(`Bedrock Model: ${config.BEDROCK_MODEL_ID}`);
  console.log(`Embedding Dimensions: ${config.EMBED_DIM}`);
  
  const confirm = await question('\n💾 Save this configuration? (y/n): ');
  if (confirm.toLowerCase() === 'y' || confirm.toLowerCase() === 'yes') {
    try {
      await saveConfig(config);
      console.log(`\n✅ Configuration saved to: ${getConfigPath()}`);
      console.log('🚀 You can now use ai-query without a local .env file!');
    } catch (err) {
      console.error('❌ Error saving configuration:', err.message);
      process.exit(1);
    }
  } else {
    console.log('⏹️ Configuration cancelled');
  }
  
  rl.close();
}

async function showConfig() {
  try {
    const config = await loadConfig();
    console.log('📋 Current ai-query configuration:');
    console.log('----------------------------------');
    Object.entries(config).forEach(([key, value]) => {
      console.log(`${key}: ${value}`);
    });
    console.log(`\nConfig file: ${getConfigPath()}`);
  } catch (err) {
    console.error('❌ Error reading configuration:', err.message);
    process.exit(1);
  }
}

async function main() {
  const args = process.argv.slice(2);
  
  if (args.includes('--help') || args.includes('-h')) {
    console.log(`
🔧 ai-configure - Configuration tool for ai-query

Usage:
  ai-configure              Interactive configuration setup
  ai-configure --show       Show current configuration
  ai-configure --help       Show this help message

This tool sets up global configuration for ai-query, eliminating the need
for local .env files. Configuration is stored in ~/.ai-query/config.json
`);
    return;
  }
  
  if (args.includes('--show')) {
    await showConfig();
    return;
  }
  
  await configure();
}

main().catch(err => {
  console.error('❌ Unexpected error:', err.message);
  process.exit(1);
});