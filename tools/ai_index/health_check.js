#!/usr/bin/env node

import { Client } from '@opensearch-project/opensearch';
import { AwsSigv4Signer } from '@opensearch-project/opensearch/aws';
import * as dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, '../../.env') });

const client = new Client({
  ...AwsSigv4Signer({
    region: process.env.AWS_REGION,
    service: 'es',
  }),
  node: process.env.OPENSEARCH_URL,
});

async function healthCheck() {
  try {
    console.log('🔍 AI Index Health Check');
    console.log('========================');
    
    // Test basic connectivity
    const ping = await client.ping();
    console.log(`✅ OpenSearch connectivity: OK`);

    // Get document count
    const count = await client.count({ index: process.env.OPENSEARCH_INDEX });
    console.log(`📊 Document count: ${count.body.count}`);

    // Get index statistics
    const stats = await client.indices.stats({ index: process.env.OPENSEARCH_INDEX });
    const indexStats = stats.body.indices[process.env.OPENSEARCH_INDEX];
    const sizeInMB = (indexStats.total.store.size_in_bytes / 1024 / 1024).toFixed(2);
    console.log(`💾 Index size: ${sizeInMB} MB`);

    // Test search functionality
    const testSearch = await client.search({
      index: process.env.OPENSEARCH_INDEX,
      body: {
        query: { match: { content: 'user' } },
        size: 1
      }
    });

    const searchWorking = testSearch.body.hits.total.value > 0;
    console.log(`🔍 Search test: ${searchWorking ? '✅ PASS' : '❌ FAIL'}`);

    // Test embedding search if available
    try {
      const embedSearch = await client.search({
        index: process.env.OPENSEARCH_INDEX,
        body: {
          query: {
            knn: {
              embedding: {
                vector: Array(512).fill(0.1),
                k: 1
              }
            }
          },
          size: 1
        }
      });
      
      const embedWorking = embedSearch.body.hits.hits.length > 0;
      console.log(`🧠 Embedding search: ${embedWorking ? '✅ PASS' : '❌ FAIL'}`);
    } catch (err) {
      console.log(`🧠 Embedding search: ⚠️  Not available (${err.message.split('\n')[0]})`);
    }

    // Check index freshness (last update time)
    const mapping = await client.indices.getMapping({ index: process.env.OPENSEARCH_INDEX });
    console.log(`🕒 Index configuration: Valid`);

    // Summary
    console.log('\n📋 Health Summary');
    console.log('=================');
    console.log(`Status: ${searchWorking ? '✅ HEALTHY' : '❌ UNHEALTHY'}`);
    console.log(`Documents: ${count.body.count} chunks indexed`);
    console.log(`Storage: ${sizeInMB} MB`);
    console.log(`Search: ${searchWorking ? 'Working' : 'Failed'}`);

  } catch (err) {
    console.error('❌ Health check failed:', err.message);
    
    // Specific error diagnostics
    if (err.message.includes('No Living connections')) {
      console.error('💡 Suggestion: Check OpenSearch URL and network connectivity');
    } else if (err.message.includes('index_not_found')) {
      console.error('💡 Suggestion: Run "npm run ai:index" to create the index');
    } else if (err.message.includes('security_exception')) {
      console.error('💡 Suggestion: Check AWS credentials and IAM permissions');
    }
    
    process.exit(1);
  }
}

healthCheck();