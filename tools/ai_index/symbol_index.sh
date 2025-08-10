#!/usr/bin/env bash
set -euo pipefail

echo "Generating symbol indexes..."

cd "$(dirname "$0")/../.."

echo "Generating SCIP index for TypeScript/JavaScript..."
if command -v npx &> /dev/null; then
  npx @sourcegraph/scip-typescript index \
    --project-root .. \
    --output ai_index/scip/index.scip \
    --infer-tsconfig \
    2>/dev/null || echo "Warning: SCIP index generation failed"
else
  echo "Warning: npx not found, skipping SCIP index"
fi

echo "Generating ctags index..."
if command -v ctags &> /dev/null; then
  # Check if this is universal-ctags or BSD ctags
  if ctags --help 2>&1 | grep -q "Universal Ctags"; then
    ctags -R \
      --languages=JavaScript,TypeScript \
      --fields=+n \
      --extras=+q \
      --exclude=node_modules \
      --exclude=dist \
      --exclude=build \
      --exclude=.git \
      -f ai_index/tags \
      ..
  else
    # Fallback for BSD ctags (macOS default)
    find .. -name "*.js" -o -name "*.mjs" -o -name "*.jsx" | \
      grep -v node_modules | \
      grep -v dist | \
      grep -v build | \
      head -100 | \
      xargs ctags -f ai_index/tags 2>/dev/null || echo "Basic ctags fallback failed"
  fi
  echo "ctags index generated successfully"
else
  echo "Warning: ctags not found. Install with: brew install universal-ctags (macOS) or apt-get install universal-ctags (Linux)"
fi

echo "Symbol indexes refreshed."