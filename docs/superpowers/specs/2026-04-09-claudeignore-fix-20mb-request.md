# Fix: Claude Code "Request too large (max 20MB)" Error

**Date:** 2026-04-09
**Status:** Approved

## Problem

Claude Code frequently reports "Request too large (max 20MB)" after <10 conversation turns in the chatBI project. The error occurs in 70%+ sessions, making the project nearly unusable.

## Root Cause

The project lacks a `.claudeignore` file. Claude Code scans the project directory when building API requests, and without exclusion rules it includes:

- `.next/` — 481MB (Next.js dev build cache)
- `node_modules/` — 761MB (third-party dependencies)
- `data/chatbi.db*` — ~5.4MB (SQLite binary files)
- `package-lock.json` — ~512KB
- `test-results/` — ~221KB

Total project size: **1.3GB**, far exceeding the 20MB API request limit.

## Solution

Create a `.claudeignore` file to exclude non-essential files from Claude Code's context.

### Files to Create/Modify

1. **`.claudeignore`** (new) — Exclude large/binary directories and files
2. **`.gitignore`** (update) — Add missing entries for `data/` and `test-results/`

### `.claudeignore` Contents

```
# Build cache
.next/
out/
build/

# Dependencies
node_modules/

# Database files (binary)
*.db
*.db-wal
*.db-shm
*.sqlite

# Data files
data/

# Lock files
package-lock.json

# Test output
test-results/
coverage/

# Misc
*.log
*.pem
.DS_Store
```

### What Claude Can Still Access

All source code (`src/`), configs (`package.json`, `tsconfig.json`), tests (`tests/`), docs (`docs/`), and other text files remain fully readable.

## Verification

1. Restart Claude Code session
2. Confirm no "Request too large" error
3. Verify Claude can still read all source files normally

## Expected Impact

- Request size: >20MB → <2MB
- Error frequency: 70%+ → 0%
- No functional changes to the project
