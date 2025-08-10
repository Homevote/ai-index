# Publishing Guide for @homevote/ai-index

## Pre-publish Checklist

✅ `.env` files excluded via `.npmignore`  
✅ Secrets and credentials excluded  
✅ Only necessary files included (bin/, lib/, README.md, package.json)  
✅ Global CLI binaries configured  
✅ Documentation complete  

## Publishing Steps

### 1. Login to npm (one time)
```bash
npm login
# Enter your npm credentials
```

### 2. Verify package contents
```bash
npm pack --dry-run
# Review the list of files that will be included
```

### 3. Publish to npm
```bash
# For first publish or major version
npm publish

# For scoped packages (if needed)
npm publish --access public
```

### 4. Test global installation
```bash
# Install globally from npm
npm install -g @homevote/ai-index

# Test CLI tools
ai-query --help
ai-index --help
```

## Version Management

```bash
# Patch version (1.0.0 -> 1.0.1)
npm version patch

# Minor version (1.0.1 -> 1.1.0) 
npm version minor

# Major version (1.1.0 -> 2.0.0)
npm version major

# Then publish
npm publish
```

## Security Verification

The package excludes:
- All `.env*` files
- AWS credentials and keys
- Development tools and terraform files
- Local data directories (`ai_index/`)
- Node modules and build artifacts

Only includes:
- `bin/` - CLI executables
- `lib/` - Library code
- `README.md` - Documentation
- `package.json` - Package metadata