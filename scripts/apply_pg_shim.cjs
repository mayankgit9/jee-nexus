#!/usr/bin/env node
// JEE NEXUS — apply shims/pg over node_modules/pg (idempotent, postinstall).
// See shims/pg/index.js for the why. Original is kept at node_modules/.pg-original.
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.resolve(__dirname, '..')
const PG = path.join(ROOT, 'node_modules', 'pg')
const BACKUP = path.join(ROOT, 'node_modules', '.pg-original')
const SHIM = path.join(ROOT, 'shims', 'pg')

function main() {
  if (!fs.existsSync(SHIM)) return console.log('pg-shim: shim source missing, skip')
  // Already applied?
  const cur = fs.readFileSync(path.join(PG, 'package.json'), 'utf8')
  if (cur.includes('8.8.0-shim')) return console.log('pg-shim: already applied')
  // Backup original once
  if (!fs.existsSync(BACKUP)) fs.renameSync(PG, BACKUP)
  else fs.rmSync(PG, { recursive: true, force: true })
  fs.cpSync(SHIM, PG, { recursive: true })
  // Keep the original's node_modules deps needed at runtime? The shim needs
  // only @prisma/pg-worker (hoisted at root) — nothing else.
  console.log('pg-shim: applied (original backed up to node_modules/.pg-original)')
}

try { main() } catch (e) { console.error('pg-shim: FAILED', e.message); process.exit(1) }
