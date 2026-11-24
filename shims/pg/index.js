// JEE NEXUS — pg shim: route @prisma/adapter-pg's driver layer to
// @prisma/pg-worker (cloudflare:sockets) instead of node-pg (node:net/tls).
//
// WHY (prod lesson 2026-11-25): inside workerd, node-pg's socket lifecycle
// breaks the pool — requests perfectly alternate 200/500 ("hung and would
// never generate a response"): after one query the connection is never
// properly released, the next checkout hangs, the canceled request evicts
// the connection, the next one opens fresh. @prisma/pg-worker is a drop-in
// fork of pg whose socket layer is built on cloudflare:sockets — designed
// for this runtime. Node-side (dev/CI) never constructs PrismaPg, and even
// importing this shim is harmless: pg-worker feature-detects the runtime
// and only touches cloudflare:sockets inside a live Worker connect().
//
// @prisma/pg-worker exports the full pg surface: Pool, Client, Connection,
// Query, types, defaults, DatabaseError, escapeIdentifier, escapeLiteral.
module.exports = require('@prisma/pg-worker')
