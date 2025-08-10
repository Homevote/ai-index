#!/usr/bin/env node

import path from 'path'
import { fileURLToPath } from 'url'
import { exec } from 'child_process'
import { promisify } from 'util'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const execAsync = promisify(exec)

// Import the query functionality from the tools directory
const queryPath = path.join(__dirname, '../tools/ai_index/query.js')

try {
  // Pass all arguments to the query script
  const { spawn } = await import('child_process')
  const child = spawn('node', [queryPath, ...process.argv.slice(2)], {
    stdio: 'inherit',
    cwd: process.cwd()
  })
  
  child.on('exit', (code) => {
    process.exit(code)
  })
} catch (error) {
  console.error('Error running ai-query:', error.message)
  process.exit(1)
}