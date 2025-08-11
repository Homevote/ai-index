#!/usr/bin/env node

import path from 'path';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';
import readline from 'readline';
import fs from 'fs/promises';
import { loadConfig, saveConfig, isConfigured, getConfigPath } from '../lib/config.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function getVersion() {
  try {
    const packageJsonPath = path.join(__dirname, '..', 'package.json');
    const content = await fs.readFile(packageJsonPath, 'utf-8');
    const pkg = JSON.parse(content);
    return pkg.version;
  } catch {
    return 'unknown';
  }
}

function question(rl, prompt) {
  return new Promise((resolve) => {
    rl.question(prompt, resolve);
  });
}

// Configuration function removed - now uses defaults

async function runCommand(command, args) {
  // Map command names to script names
  const scriptMap = {
    'index': 'build_index.js',
    'query': 'query.js'
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

async function showHelp() {
  const version = await getVersion();
  console.log(`
🤖 ai-index v${version} - Local AI-powered code indexing and search

Usage:
  ai-index index [folder]      Index current folder or specified folder
  ai-index query [options]     Search the code index
  ai-index --help              Show this help message

Examples:
  ai-index index               # Index current folder
  ai-index index /path/to/code # Index specific folder
  ai-index query --q "authentication logic" --k 10

Indexes are stored locally using folder names as keys.
`);
}

async function main() {
  const args = process.argv.slice(2);
  const command = args[0];
  const commandArgs = args.slice(1);
  
  if (!command || command === '--help' || command === '-h') {
    await showHelp();
    return;
  }
  
  switch (command) {
    case 'index':
      await runCommand('index', commandArgs);
      break;
      
    case 'query':
      await runCommand('query', commandArgs);
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