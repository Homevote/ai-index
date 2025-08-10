.PHONY: setup index query symbol symbols clean help

help:
	@echo "Homevote AI Index - Available commands:"
	@echo "  make setup    - Install dependencies"
	@echo "  make index    - Build/rebuild the search index"
	@echo "  make query    - Search the codebase (use q='your query')"
	@echo "  make symbol   - Find symbol references (use s='symbol_name')"
	@echo "  make symbols  - Regenerate symbol indexes"
	@echo "  make clean    - Remove generated indexes"

setup:
	npm install

index:
	npm run ai:index

query:
	@if [ -z "$(q)" ]; then \
		echo "Usage: make query q='your search query'"; \
		exit 1; \
	fi
	@npm run ai:query -- --q "$(q)" --k $(or $(k),20) $(if $(area),--area $(area))

symbol:
	@if [ -z "$(s)" ]; then \
		echo "Usage: make symbol s='symbol_name'"; \
		exit 1; \
	fi
	@npm run ai:symbol -- --symbol "$(s)"

symbols:
	npm run ai:symbols

clean:
	rm -rf ai_index/scip/* ai_index/search/* ai_index/tags

test-connection:
	@echo "Testing OpenSearch connection..."
	@node -e "import('@opensearch-project/opensearch').then(({Client}) => { \
		import('@opensearch-project/opensearch/aws').then(({AwsSigv4Signer}) => { \
			const client = new Client({ \
				...AwsSigv4Signer({ region: process.env.AWS_REGION || 'us-east-1', service: 'es' }), \
				node: process.env.OPENSEARCH_URL \
			}); \
			client.ping().then(() => console.log('✅ OpenSearch connection successful')) \
				.catch(err => { console.error('❌ OpenSearch connection failed:', err.message); process.exit(1); }); \
		}); \
	})"