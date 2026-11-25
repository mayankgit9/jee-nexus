// JEE NEXUS — Prisma client factory (dual runtime).
//
// Node (local dev, CI, sandbox): standard prisma-client-js against DATABASE_URL.
// Cloudflare Workers (production deploy): worker-runtime client from
// src/generated/worker (pure-JS query compiler, no native engine) + the
// @prisma/adapter-pg driver adapter.
//
// VERSION PIN (prod lesson 2026-11-25): the adapter must match the engine
// version exactly. @prisma/adapter-pg-worker@6.9.0 with the 6.19.2 engine
// failed every query in ~11ms with "Invalid driver adapter: Error while
// calling getConnectionInfo()" (old adapter contract; that package was
// discontinued after 6.10). @prisma/adapter-pg@6.19.2 is the canonical
// pairing — it uses the Node `pg` driver, which runs on Workers under
// nodejs_compat (node:net TCP + node:tls; requires the bumped
// compatibility_date in wrangler.jsonc).
// Connection source, in order of preference:
//   1. HYPERDRIVE binding (connection pooling + query cache — preferred once
//      the config exists; creating it needs a token with Hyperdrive:Edit,
//      see scripts/deploy_app_cloudflare.sh)
//   2. DATABASE_URL worker secret — direct TCP from Workers.
//      Use the Supabase SESSION pooler URL (port 5432); the transaction
//      pooler (6543) is not suited for direct long-lived TCP.
// If neither is present the worker still boots: UI/static routes serve fine
// and DB-backed routes fail per-request until the secret/binding is added.
//
// IMPORTANT (prod lesson 2026-11-25): the client must be created LAZILY, on
// first use, not at module load. getCloudflareContext() only exposes secrets
// inside a request scope; reading it during module initialization returned a
// context whose env lacked DATABASE_URL (worker logged "No database
// configured" even with the secret attached). The lazy Proxy below defers
// createClient() to the first db.* call, which always happens inside a route
// handler — where the full env (vars + secrets) is populated.
import { PrismaClient } from '@prisma/client'
import { PrismaClient as WorkerPrismaClient } from '@/generated/worker/client'
import { PrismaPg } from '@prisma/adapter-pg'

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

// Clearly-invalid target so an unconfigured worker fails fast per query
// (connection refused) instead of crashing the isolate at boot.
const UNCONFIGURED_URL = 'postgresql://unconfigured:unconfigured@127.0.0.1:1/unconfigured'

function createClient(): PrismaClient {
  let workersEnv: Record<string, unknown> | undefined
  try {
    // On Workers, OpenNext exposes bindings synchronously; on node this throws.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { getCloudflareContext } = require('@opennextjs/cloudflare') as {
      getCloudflareContext(opts: { async: false }): { env: Record<string, unknown> }
    }
    workersEnv = getCloudflareContext({ async: false }).env
  } catch {
    // node runtime — no Cloudflare async context; fall through to node client.
  }

  if (workersEnv) {
    const hyperdrive = (workersEnv as { HYPERDRIVE?: { connectionString?: string } }).HYPERDRIVE
    const directUrl = (workersEnv as { DATABASE_URL?: string }).DATABASE_URL
      ?? process.env.DATABASE_URL // OpenNext merges bindings into process.env in newer versions
    let connectionString = hyperdrive?.connectionString ?? directUrl
    if (!connectionString) {
      console.error(
        '[db] No database configured on Workers: set the DATABASE_URL secret ' +
          '(Supabase session-pooler URL as jee_app) or bind HYPERDRIVE. ' +
          `Visible env keys: [${Object.keys(workersEnv).sort().join(', ')}]. ` +
          'DB-backed API routes will keep failing until one of them is added.'
      )
    }
    // pg's ConnectionParameters does `Object.assign({}, config, parse(url))` —
    // a sslmode=... in the URL OVERWRITES the explicit `ssl` object below
    // (sslmode=require is aliased to verify-full, which needs a system CA
    // store the edge does not have). Strip sslmode so the explicit ssl wins.
    // Direct Supabase connections only: leave Hyperdrive URLs untouched
    // (they are already TLS-terminated at the edge and have no sslmode).
    if (connectionString && !hyperdrive) {
      connectionString = connectionString.replace(/[?&]sslmode=[^&]*/g, '')
    }
    return new WorkerPrismaClient({
      // Cast: adapter-pg-worker and the generated client each bundle a copy of
      // the driver-adapter-utils types; the interfaces are structurally identical.
      adapter: new PrismaPg({
        connectionString: connectionString ?? UNCONFIGURED_URL,
        // TLS WALL (prod lesson 2026-11-25, proven by scripts/pgworker_probe.mjs):
        // from inside a Worker EVERY TLS route to the Supabase pooler fails —
        // workerd's node:tls does not implement rejectUnauthorized and ignores
        // custom CAs, and cloudflare:sockets startTls() always validates
        // against the built-in root store (Supabase uses a private CA).
        // With no Hyperdrive binding (token lacks Hyperdrive:Edit), the only
        // working path is PLAIN TCP — the preparena project has SSL
        // enforcement disabled (dashboard: Settings > Database > SSL
        // enforcement), which the pooler permits. Any sslmode=... in the URL
        // must be stripped or pg would attempt (and fail) the TLS upgrade.
        // Morning fix: widen the CF token -> create the Hyperdrive config ->
        // bind HYPERDRIVE (TLS-terminated at the edge, full verification) and
        // re-enable SSL enforcement.
        ssl: false,
      }) as unknown as never,
    }) as unknown as PrismaClient
  }

  // node runtime (local dev, CI, sandbox preview)
  return new PrismaClient()
}

/**
 * EXPERIMENT (M23): on Workers the Prisma WASM engine's connection state
 * breaks after its first completed query — every second request hung
 * ("canceled... would never generate a response", perfect 200/500
 * alternation). Testing fresh-client-per-access to confirm the engine is
 * the stateful culprit. Node runtime keeps the classic singleton.
 */
function isWorkersRuntime(): boolean {
  // Detection must NOT be "does the package resolve" — it is installed in
  // node_modules for the OpenNext build, so a bare require() succeeds in
  // `next dev` too, making every db.* access and dbClient() call open a
  // FRESH PrismaClient + pg Pool (max 10 each). ~30 requests later local
  // Postgres hits max_connections (100) and every route 500s with
  // "FATAL: sorry, too many clients already" (e2e suite failure, 2026-11-25).
  // The reliable signal is the same one createClient() uses: on Workers
  // getCloudflareContext({async:false}) RETURNS a context (env may be
  // incomplete at module load — that's fine, we only test for throwing);
  // on the Node runtime it throws.
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { getCloudflareContext } = require('@opennextjs/cloudflare') as {
      getCloudflareContext(opts: { async: false }): { env: Record<string, unknown> }
    }
    getCloudflareContext({ async: false })
    return true
  } catch {
    return false
  }
}
const WORKERS = isWorkersRuntime()

export const db: PrismaClient = new Proxy({} as PrismaClient, {
  get(_target, prop, _receiver) {
    if (!WORKERS) {
      if (!globalForPrisma.prisma) globalForPrisma.prisma = createClient()
      const client = globalForPrisma.prisma as unknown as Record<string | symbol, unknown>
      const value = client[prop]
      return typeof value === 'function' ? (value as (...a: unknown[]) => unknown).bind(globalForPrisma.prisma) : value
    }
    // Workers: fresh client per property access (WASM module stays cached by
    // the runtime; only engine state + adapter pool are recreated).
    const client = createClient() as unknown as Record<string | symbol, unknown>
    const value = client[prop]
    return typeof value === 'function' ? (value as (...a: unknown[]) => unknown).bind(client) : value
  },
})

/**
 * Explicit single client for multi-operation units of work ($transaction,
 * sequential queries that must share one connection). On Workers every db.*
 * Proxy access opens a FRESH client — and therefore a fresh connection,
 * which counts against the 50-subrequest-per-invocation cap. Routes that
 * loop over many writes must use this instead: create one client, run all
 * operations (or one $transaction) through it.
 */
export function dbClient(): PrismaClient {
  if (!WORKERS) {
    // Node runtime (dev/CI): reuse the singleton — createClient() here leaks a
    // fresh pg Pool (default max 10) PER REQUEST, exhausting local Postgres
    // max_connections (100) after ~30 chat requests with FATAL "sorry, too
    // many clients already". The singleton shares one healthy pool instead.
    // (Workers keeps fresh-per-call: see the M23 note above.)
    if (!globalForPrisma.prisma) globalForPrisma.prisma = createClient()
    return globalForPrisma.prisma
  }
  return createClient()
}
