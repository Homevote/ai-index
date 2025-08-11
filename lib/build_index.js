#!/usr/bin/env node

import { globby } from 'globby';
import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';
import { loadConfig } from './config.js';
import { createLocalEmbedder } from './local-embedder.js';
import { createLocalVectorStore } from './local-vector-store.js';

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

// Parse command line arguments
const args = process.argv.slice(2);
const targetFolder = args[0] || process.cwd();
const REPO_ROOT = path.resolve(targetFolder);
const FORCE_REINDEX = args.includes('--force');

// Generate index name from folder path
const folderName = path.basename(REPO_ROOT);
const INDEX_NAME = folderName.replace(/[^a-zA-Z0-9_-]/g, '_');

// Load configuration and initialize local components
const config = await loadConfig();
console.log('🏠 Running in LOCAL mode');
console.log(`Indexing folder: ${REPO_ROOT}`);
console.log(`Index key: ${INDEX_NAME}`);

const embedder = await createLocalEmbedder(config);
const vectorStore = await createLocalVectorStore(config, INDEX_NAME);
const EMBED_DIM = embedder.getDimensions();

async function embed(text) {
  return await embedder.embed(text);
}

async function createIndex() {
  console.log('Local vector store initialized');
}

async function createPipeline() {
  // Not needed for local mode
}

function getFileArea(filePath) {
  if (filePath.includes('/app/api/') || filePath.includes('/app/models/') || 
      filePath.includes('/app/helpers/') || filePath.includes('/app/jobs/') || 
      filePath.includes('/app/worker') || filePath.includes('/app/server')) {
    return 'backend';
  } else if (filePath.includes('/app/components/') || filePath.includes('/app/pages/') || 
             filePath.includes('/app/data/') || filePath.includes('/app/public/')) {
    return 'frontend';
  } else if (filePath.includes('/terraform/') || filePath.includes('/k8s/') || 
             filePath.includes('/docker') || filePath.includes('Dockerfile')) {
    return 'infra';
  } else if (filePath.includes('/docs/') || filePath.includes('README') || 
             filePath.includes('DOCUMENTATION')) {
    return 'docs';
  }
  return 'other';
}

function getLanguage(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const langMap = {
    '.js': 'javascript',
    '.mjs': 'javascript',
    '.jsx': 'javascript',
    '.ts': 'typescript',
    '.tsx': 'typescript',
    '.py': 'python',
    '.go': 'go',
    '.tf': 'terraform',
    '.yml': 'yaml',
    '.yaml': 'yaml',
    '.json': 'json',
    '.md': 'markdown',
    '.scss': 'scss',
    '.css': 'css',
    '.sql': 'sql',
    '.sh': 'bash'
  };
  return langMap[ext] || 'unknown';
}

async function chunkFile(filePath, content) {
  const chunks = [];
  const lines = content.split('\n');
  const language = getLanguage(filePath);
  const area = getFileArea(filePath);
  
  const maxLinesPerChunk = language === 'markdown' || area === 'docs' ? 50 : 30;
  const overlap = 5;
  
  for (let i = 0; i < lines.length; i += maxLinesPerChunk - overlap) {
    const chunkLines = lines.slice(i, i + maxLinesPerChunk);
    const chunkContent = chunkLines.join('\n');
    
    if (chunkContent.trim().length > 50) {
      const chunkId = crypto.createHash('md5')
        .update(`${filePath}:${i}`)
        .digest('hex');
      
      chunks.push({
        id: chunkId,
        repo_path: filePath,
        content: chunkContent,
        language,
        area,
        parent_id: filePath,
        start_line: i,
        end_line: Math.min(i + maxLinesPerChunk, lines.length)
      });
    }
  }
  
  return chunks;
}

async function indexDocuments(documents) {
  if (documents.length === 0) return;
  await vectorStore.addDocuments(documents);
}

async function loadFileHashes() {
  const hashFilePath = path.join(REPO_ROOT, 'ai_index/file_hashes.json');
  try {
    const content = await fs.readFile(hashFilePath, 'utf-8');
    return JSON.parse(content);
  } catch (err) {
    if (err.code === 'ENOENT') {
      return {};
    }
    throw err;
  }
}

async function saveFileHashes(hashes) {
  const hashFilePath = path.join(REPO_ROOT, 'ai_index/file_hashes.json');
  await fs.mkdir(path.dirname(hashFilePath), { recursive: true });
  await fs.writeFile(hashFilePath, JSON.stringify(hashes, null, 2));
}

function calculateFileHash(content) {
  return crypto.createHash('sha256').update(content, 'utf-8').digest('hex');
}

async function processFiles() {
  const patterns = [
    '**/*.{js,mjs,jsx,ts,tsx}',
    '**/*.{json,yml,yaml}',
    '**/*.md',
    '**/*.{py,go,java,scala,rs,cpp,c,h}',
    '**/*.{tf,Dockerfile}',
    '**/*.{sql,sh,bash}'
  ];
  
  const ignorePatterns = [
    '**/node_modules/**',
    '**/dist/**',
    '**/build/**',
    '**/*.min.js',
    '**/package-lock.json',
    '**/public/fonts/**',
    '**/public/icons/**',
    '**/public/flags/**'
  ];
  
  const files = await globby(patterns, {
    cwd: REPO_ROOT,
    ignore: ignorePatterns,
    absolute: false
  });
  
  console.log(`Found ${files.length} files to index`);
  
  const previousHashes = await loadFileHashes();
  const currentHashes = {};
  const filesToProcess = [];
  
  console.log('Checking file changes...');
  for (const file of files) {
    const fullPath = path.join(REPO_ROOT, file);
    try {
      const content = await fs.readFile(fullPath, 'utf-8');
      const currentHash = calculateFileHash(content);
      currentHashes[file] = currentHash;
      
      if (FORCE_REINDEX || previousHashes[file] !== currentHash) {
        filesToProcess.push({ file, content });
      }
    } catch (err) {
      console.error(`Error reading ${file}:`, err.message);
    }
  }
  
  const skippedCount = files.length - filesToProcess.length;
  if (FORCE_REINDEX) {
    console.log(`Files to process: ${filesToProcess.length} (force reindex enabled)`);
  } else {
    console.log(`Files to process: ${filesToProcess.length} (${skippedCount} unchanged files skipped)`);
  }
  
  if (filesToProcess.length === 0 && !FORCE_REINDEX) {
    console.log('No files need reindexing. Index is up to date.');
    return;
  }
  
  let sha = 'unknown';
  try {
    sha = execSync('git rev-parse HEAD', { cwd: REPO_ROOT })
      .toString().trim();
  } catch (err) {
    console.log('Warning: Not a git repository, using fallback SHA');
    sha = `local-${Date.now()}`;
  }
  
  const chunkMap = [];
  const MAX_BULK_SIZE = 50;
  let totalChunks = 0;
  let pendingDocuments = [];
  
  console.log('Processing changed files and creating embeddings...');
  
  for (let i = 0; i < filesToProcess.length; i++) {
    const { file, content } = filesToProcess[i];
    
    try {
      if (previousHashes[file]) {
        const removedCount = await vectorStore.removeDocumentsByFile(file);
        if (removedCount > 0) {
          console.log(`Removed ${removedCount} outdated chunks for ${file}`);
        }
      }
      
      const chunks = await chunkFile(file, content);
      
      for (const chunk of chunks) {
        const embedding = await embed(chunk.content);
        
        pendingDocuments.push({
          ...chunk,
          sha,
          embedding
        });
        
        chunkMap.push({
          chunk_id: chunk.id,
          file: chunk.repo_path,
          start: chunk.start_line,
          end: chunk.end_line,
          parent_id: chunk.parent_id,
          area: chunk.area
        });
        
        if (pendingDocuments.length >= MAX_BULK_SIZE) {
          console.log(`Bulk indexing ${pendingDocuments.length} documents...`);
          await indexDocuments(pendingDocuments);
          totalChunks += pendingDocuments.length;
          console.log(`✅ Indexed ${totalChunks} chunks total`);
          pendingDocuments = [];
        }
      }
      
      if ((i + 1) % 10 === 0) {
        console.log(`Processed ${i + 1}/${filesToProcess.length} changed files...`);
      }
    } catch (err) {
      console.error(`Error processing ${file}:`, err.message);
    }
  }
  
  if (pendingDocuments.length > 0) {
    console.log(`Bulk indexing final ${pendingDocuments.length} documents...`);
    await indexDocuments(pendingDocuments);
    totalChunks += pendingDocuments.length;
    console.log(`✅ Indexed ${totalChunks} chunks total`);
  }
  
  const deletedFiles = Object.keys(previousHashes).filter(file => !currentHashes[file]);
  if (deletedFiles.length > 0) {
    console.log(`Removing ${deletedFiles.length} deleted files from index...`);
    for (const file of deletedFiles) {
      const removedCount = await vectorStore.removeDocumentsByFile(file);
      if (removedCount > 0) {
        console.log(`Removed ${removedCount} chunks for deleted file: ${file}`);
      }
    }
  }
  
  await saveFileHashes(currentHashes);
  
  const chunkMapPath = path.join(REPO_ROOT, 'ai_index/search/chunkmap.jsonl');
  await fs.mkdir(path.dirname(chunkMapPath), { recursive: true });
  await fs.writeFile(
    chunkMapPath,
    chunkMap.map(c => JSON.stringify(c)).join('\n')
  );
  
  const manifest = {
    mode: 'local',
    index: INDEX_NAME,
    folder: REPO_ROOT,
    embed_model: config.EMBED_MODEL,
    dim: EMBED_DIM,
    last_built_at: new Date().toISOString(),
    total_chunks: totalChunks,
    total_files: files.length,
    processed_files: filesToProcess.length,
    skipped_files: skippedCount,
    sha
  };
  
  await fs.writeFile(
    path.join(REPO_ROOT, 'ai_index/manifest.json'),
    JSON.stringify(manifest, null, 2)
  );
  
  if (FORCE_REINDEX) {
    console.log(`\nIndexing complete! Indexed ${totalChunks} chunks from ${filesToProcess.length} files (force reindex)`);
  } else {
    console.log(`\nIndexing complete! Processed ${filesToProcess.length} changed files, indexed ${totalChunks} new chunks (${skippedCount} files unchanged)`);
  }
}

async function generateSymbolIndex() {
  console.log('\nGenerating symbol indexes...');
  
  try {
    const scipOutput = path.join(REPO_ROOT, 'ai_index/scip/index.scip');
    await fs.mkdir(path.dirname(scipOutput), { recursive: true });
    execSync(`npx @sourcegraph/scip-typescript index --project-root ${REPO_ROOT} --output ${scipOutput} --infer-tsconfig`, {
      cwd: REPO_ROOT,
      stdio: 'inherit'
    });
    console.log('SCIP index generated');
  } catch (err) {
    console.error('Failed to generate SCIP index:', err.message);
  }
  
  try {
    const tagsOutput = path.join(REPO_ROOT, 'ai_index/tags');
    execSync(`ctags -R --languages=JavaScript,TypeScript --fields=+n --extras=+q -f ${tagsOutput} ${REPO_ROOT}`, {
      cwd: REPO_ROOT,
      stdio: 'inherit'
    });
    console.log('ctags index generated');
  } catch (err) {
    console.error('Failed to generate ctags index:', err.message);
  }
}

async function main() {
  const version = await getVersion();
  console.log(`Starting AI index build... (v${version})`);
  console.log(`Embedding dimension: ${EMBED_DIM}`);
  
  try {
    // Check if target folder exists
    try {
      await fs.access(REPO_ROOT);
    } catch {
      console.error(`Error: Folder does not exist: ${REPO_ROOT}`);
      process.exit(1);
    }
    
    await createIndex();
    await createPipeline();
    await processFiles();
    await generateSymbolIndex();
    
    console.log('\nBuild complete!');
    
    const stats = await vectorStore.getStats();
    console.log(`📊 Vector store stats:`, stats);
  } catch (err) {
    console.error('Build failed:', err);
    process.exit(1);
  }
}

main();