#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join, posix } from 'node:path'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const repoDir = join(__dirname, 'repository')
const casesPath = join(__dirname, 'search-cases.json')
const resultsPath = join(__dirname, 'search-eval-results.json')

const run = (cmd, args, cwd) => new Promise((resolve, reject) => {
  const child = spawn(cmd, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] })
  let out = ''
  let err = ''
  child.stdout.on('data', (d) => (out += d.toString()))
  child.stderr.on('data', (d) => (err += d.toString()))
  child.on('close', (code) => {
    if (code === 0) resolve(out.trim())
    else reject(new Error(`${cmd} ${args.join(' ')} failed (${code}):\n${err}`))
  })
})

const normalizePath = (p) => {
  const px = p.replaceAll('\\', '/')
  if (px.startsWith('examples/todo-app/repository/')) return px
  if (px.startsWith('./')) return `examples/todo-app/repository/${px.slice(2)}`
  return `examples/todo-app/repository/${px}`
}

async function main() {
  const cases = JSON.parse(readFileSync(casesPath, 'utf8'))

  console.log('Indexing repository with ai-index...')
  await run('ai-index', ['index'], repoDir)
  console.log('Index complete.')

  const evals = []
  for (const c of cases) {
    const { input, expectedTop } = c
    try {
      const raw = await run('ai-index', ['query', '--q', input, '--k', '10'], repoDir)
      // Parse text output: grab lines like "1. path"
      const lines = raw.split(/\r?\n/)
      const fileLines = []
      for (const ln of lines) {
        const m = ln.match(/^\s*\d+\.\s+([^\s]+)$/)
        if (m) fileLines.push(m[1])
      }
      const returned = fileLines.map(p => normalizePath(p))

      const top1 = returned[0]
      const expTop1 = expectedTop[0]
      const endsWithMatch = (a, b) => a && b && (a === b || a.endsWith('/' + b.split('/').slice(-2).join('/')))

      const top1Match = endsWithMatch(top1, expTop1)
      const top3Set = new Set(returned.slice(0, 3))
      const top5Set = new Set(returned.slice(0, 5))
      const expSet = new Set(expectedTop)
      const inTop3 = expectedTop.filter(p => Array.from(top3Set).some(r => endsWithMatch(r, p)))
      const inTop5 = expectedTop.filter(p => Array.from(top5Set).some(r => endsWithMatch(r, p)))

      evals.push({
        input,
        expectedTop,
        returned: returned.slice(0, 10),
        metrics: {
          top1Match,
          expectedInTop3: inTop3.length,
          expectedInTop5: inTop5.length,
          kReturned: returned.length
        }
      })
      console.log(`✓ ${input} -> top1 ${top1Match ? 'OK' : 'MISS'} | inTop3 ${inTop3.length}/${expectedTop.length}`)
    } catch (e) {
      evals.push({ input, expectedTop, error: String(e) })
      console.error(`✗ ${input} failed:`, e.message)
    }
  }

  writeFileSync(resultsPath, JSON.stringify({ date: new Date().toISOString(), evals }, null, 2))
  console.log(`\nSaved results to ${posix.relative(process.cwd().replaceAll('\\','/'), resultsPath.replaceAll('\\','/'))}`)
}

main().catch(err => { console.error(err); process.exit(1) })
