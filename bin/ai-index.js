#!/usr/bin/env node

import path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// Import the build_index functionality from the tools directory
const buildIndexPath = path.join(__dirname, '../tools/ai_index/build_index.js')

try {
  // Pass all arguments to the build_index script
  const { spawn } = await import('child_process')
  const child = spawn('node', [buildIndexPath, ...process.argv.slice(2)], {
    stdio: 'inherit',
    cwd: process.cwd()
  })
  
  child.on('exit', (code) => {
    process.exit(code)
  })
} catch (error) {
  console.error('Error running ai-index:', error.message)
  process.exit(1)
}