#!/usr/bin/env node

import path from 'path';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';
import readline from 'readline';
import { loadConfig, saveConfig, isConfigured, getConfigPath } from '../lib/config.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function question(rl, prompt) {
  return new Promise((resolve) => {
    rl.question(prompt, resolve);
  });
}

async function configure() {
  console.log('🔧 ai-index Configuration Setup\n');
  
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });
  
  try {
    const hasExistingConfig = await isConfigured();
    let config = {};
    
    if (hasExistingConfig) {
      console.log('📋 Found existing configuration at:', getConfigPath());
      const useExisting = await question(rl, 'Load existing values as defaults? (y/n): ');
      if (useExisting.toLowerCase() === 'y' || useExisting.toLowerCase() === 'yes') {
        config = await loadConfig();
        console.log('✅ Loaded existing configuration\n');
      }
    }
    
    console.log('Please provide the following configuration values:');
    console.log('(Press Enter to keep current/default values shown in brackets)\n');
    
    const region = await question(rl, `AWS Region [${config.AWS_REGION || 'us-east-1'}]: `);
    if (region.trim()) config.AWS_REGION = region.trim();
    
    const osUrl = await question(rl, `OpenSearch URL [${config.OPENSEARCH_URL || 'https://your-domain.region.es.amazonaws.com'}]: `);
    if (osUrl.trim()) config.OPENSEARCH_URL = osUrl.trim();
    
    const osIndex = await question(rl, `OpenSearch Index [${config.OPENSEARCH_INDEX || 'homevote_ai_chunks'}]: `);
    if (osIndex.trim()) config.OPENSEARCH_INDEX = osIndex.trim();
    
    const osPipeline = await question(rl, `OpenSearch Pipeline [${config.OPENSEARCH_PIPELINE || 'ai-hybrid-rrf'}]: `);
    if (osPipeline.trim()) config.OPENSEARCH_PIPELINE = osPipeline.trim();
    
    const modelId = await question(rl, `Bedrock Model ID [${config.BEDROCK_MODEL_ID || 'amazon.titan-embed-text-v2:0'}]: `);
    if (modelId.trim()) config.BEDROCK_MODEL_ID = modelId.trim();
    
    const embedDim = await question(rl, `Embedding Dimensions [${config.EMBED_DIM || '512'}]: `);
    if (embedDim.trim()) config.EMBED_DIM = embedDim.trim();
    
    console.log('\n📝 Configuration Summary:');
    console.log('-------------------------');
    console.log(`AWS Region: ${config.AWS_REGION}`);
    console.log(`OpenSearch URL: ${config.OPENSEARCH_URL}`);
    console.log(`OpenSearch Index: ${config.OPENSEARCH_INDEX}`);
    console.log(`OpenSearch Pipeline: ${config.OPENSEARCH_PIPELINE}`);
    console.log(`Bedrock Model: ${config.BEDROCK_MODEL_ID}`);
    console.log(`Embedding Dimensions: ${config.EMBED_DIM}`);
    
    const confirm = await question(rl, '\n💾 Save this configuration? (y/n): ');
    if (confirm.toLowerCase() === 'y' || confirm.toLowerCase() === 'yes') {
      await saveConfig(config);
      console.log(`\n✅ Configuration saved to: ${getConfigPath()}`);
      console.log('🚀 You can now use "ai-index index" and "ai-index query" commands!');
    } else {
      console.log('⏹️ Configuration cancelled');
    }
  } finally {
    rl.close();
  }
}

async function checkConfigAndRun(command, args) {
  const configured = await isConfigured();
  if (!configured) {
    console.error(`❌ ai-index is not configured yet.`);
    console.error('');
    console.error('Please run the following command first to set up your AWS and OpenSearch configuration:');
    console.error('');
    console.error('  ai-index configure');
    console.error('');
    console.error('This will create a global configuration file at ~/.ai-index/config.json');
    process.exit(1);
  }
  
  // Map command names to script names
  const scriptMap = {
    'index': 'build_index.js',
    'query': 'query.js',
    'health': 'health_check.js'
  };
  
  const scriptPath = path.join(__dirname, `../lib/${scriptMap[command]}`);
  const child = spawn('node', [scriptPath, ...args], {
    stdio: 'inherit',
    cwd: process.cwd()
  });
  
  child.on('exit', (code) => {
    process.exit(code);
  });
}

function showHelp() {
  console.log(`
🤖 ai-index - AI-powered code indexing and search

Usage:
  ai-index configure           Set up AWS and OpenSearch configuration
  ai-index index [options]     Build the code index
  ai-index query [options]     Search the code index
  ai-index health              Check system health
  ai-index --help              Show this help message

Examples:
  ai-index configure
  ai-index index
  ai-index query --q "authentication logic" --k 10
  ai-index health

Configuration is stored in ~/.ai-index/config.json
`);
}

async function main() {
  const args = process.argv.slice(2);
  const command = args[0];
  const commandArgs = args.slice(1);
  
  if (!command || command === '--help' || command === '-h') {
    showHelp();
    return;
  }
  
  switch (command) {
    case 'configure':
      await configure();
      break;
      
    case 'index':
      await checkConfigAndRun('index', commandArgs);
      break;
      
    case 'query':
      await checkConfigAndRun('query', commandArgs);
      break;
      
    case 'health':
      await checkConfigAndRun('health', commandArgs);
      break;
      
    default:
      console.error(`❌ Unknown command: ${command}`);
      console.error('');
      console.error('Run "ai-index --help" to see available commands.');
      process.exit(1);
  }
}

main().catch(err => {
  console.error('❌ Unexpected error:', err.message);
  process.exit(1);
});