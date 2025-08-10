#!/usr/bin/env node

import fs from 'fs/promises';
import path from 'path';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function parseCtagsFile(tagsPath) {
  try {
    const content = await fs.readFile(tagsPath, 'utf-8');
    const lines = content.split('\n').filter(line => !line.startsWith('!'));
    
    const tags = {};
    for (const line of lines) {
      const parts = line.split('\t');
      if (parts.length >= 3) {
        const [symbol, file, pattern] = parts;
        const lineMatch = parts.find(p => p.startsWith('line:'));
        const lineNum = lineMatch ? parseInt(lineMatch.split(':')[1]) : null;
        
        if (!tags[symbol]) {
          tags[symbol] = [];
        }
        
        tags[symbol].push({
          file: file.replace('../', ''),
          pattern: pattern,
          line: lineNum
        });
      }
    }
    
    return tags;
  } catch (err) {
    console.error('Could not read tags file:', err.message);
    return {};
  }
}

function findReferences(symbol, repoRoot) {
  try {
    const escapeRegex = (str) => str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern = `\\b${escapeRegex(symbol)}\\b`;
    
    let command;
    let output;
    
    // Try ripgrep first, fall back to grep
    try {
      const rgCommand = `rg -n --no-heading "${pattern}" --glob '!node_modules' --glob '!dist' --glob '!build' --glob '!*.min.js' --glob '!package-lock.json' -t js -t ts`;
      output = execSync(rgCommand, {
        cwd: repoRoot,
        encoding: 'utf-8',
        maxBuffer: 1024 * 1024 * 10
      });
    } catch (rgErr) {
      // Fallback to find + grep
      const findCommand = `find . -name "*.js" -o -name "*.mjs" -o -name "*.jsx" | grep -v node_modules | head -50 | xargs grep -n "${pattern}" 2>/dev/null || true`;
      output = execSync(findCommand, {
        cwd: repoRoot,
        encoding: 'utf-8',
        maxBuffer: 1024 * 1024 * 10
      });
    }
    
    const refs = [];
    const lines = output.split('\n').filter(Boolean);
    
    for (const line of lines) {
      const match = line.match(/^([^:]+):(\d+):(.*)$/);
      if (match) {
        const [, file, lineNum, content] = match;
        refs.push({
          file: file.replace('./', ''),
          line: parseInt(lineNum),
          content: content.trim().slice(0, 100)
        });
      }
    }
    
    return refs.slice(0, 20); // Limit results
  } catch (err) {
    if (err.status === 1) {
      return [];
    }
    console.error('Error finding references:', err.message);
    return [];
  }
}

async function findInScipIndex(symbol, scipPath) {
  try {
    const stats = await fs.stat(scipPath);
    if (stats.size > 100 * 1024 * 1024) {
      console.error('SCIP index too large to process in memory');
      return { defs: [], refs: [] };
    }
    
    return { defs: [], refs: [] };
  } catch (err) {
    return { defs: [], refs: [] };
  }
}

async function main() {
  const args = process.argv.slice(2);
  const symbolIndex = args.indexOf('--symbol');
  
  if (symbolIndex === -1 || !args[symbolIndex + 1]) {
    console.error('Usage: npm run ai:symbol -- --symbol <symbol_name>');
    process.exit(1);
  }
  
  const symbol = args[symbolIndex + 1];
  const tagsPath = path.join(__dirname, '../../ai_index/tags');
  const scipPath = path.join(__dirname, '../../ai_index/scip/index.scip');
  const repoRoot = path.resolve(__dirname, '../../../');
  
  const tags = await parseCtagsFile(tagsPath);
  const definitions = tags[symbol] || [];
  
  const references = findReferences(symbol, repoRoot);
  
  const uniqueRefs = references.filter(ref => {
    return !definitions.some(def => 
      def.file === ref.file && Math.abs((def.line || 0) - ref.line) <= 1
    );
  });
  
  const result = {
    symbol,
    defs: definitions.map(def => ({
      file: def.file,
      line: def.line,
      type: 'definition'
    })),
    refs: uniqueRefs.slice(0, 50).map(ref => ({
      file: ref.file,
      line: ref.line,
      preview: ref.content
    }))
  };
  
  console.log(JSON.stringify(result, null, 2));
}

main();