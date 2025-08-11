#!/usr/bin/env node

/**
 * Example usage of @homevote/ai-index as a library - updated for testing
 */

import { CodeSearcher } from '@homevote/ai-index'

const searcher = new CodeSearcher({
  opensearchUrl: process.env.OPENSEARCH_URL,
  opensearchIndex: 'my_code_chunks',
  awsRegion: 'us-east-1'
})

// Example 1: Basic search
const results = await searcher.search("user authentication", {
  k: 10,
  compact: true
})

console.log('Basic search:', results)

// Example 2: Filtered search with relevance scoring
const filteredResults = await searcher.search("database models", {
  area: 'backend',
  minScore: 2.0,
  k: 5
})

console.log('Filtered search:', filteredResults)

// Example 3: AI-optimized compact format
const aiResults = await searcher.search("error handling middleware", {
  compact: true,
  k: 3
})

console.log('AI-optimized format:', aiResults)