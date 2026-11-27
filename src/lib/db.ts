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
        // POOL GUARDRAILS (prod lesson 2026-11-27): the client is now a
        // per-isolate singleton, so the pg pool must recycle connections
        // aggressively to keep the "fresh connection per burst" property the
        // old fresh-client-per-access design provided: idle sockets close
        // after 1s (poll gaps are 3-15s, so each poll burst reconnects),
        // connects bail out at 8s instead of hanging, pool stays tiny.
        max: 2,
        idleTimeoutMillis: 1_000,
        connectionTimeoutMillis: 8_000,
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
 * EXPERIMENT (M23, SUPERSEDED 2026-11-27): fresh-client-per-access was a
 * workaround for the OLD @prisma/client WASM engine's connection state
 * breaking after its first completed query (every second request hung).
 * Production now runs the query-compiler worker client + @prisma/adapter-pg
 * (no WASM engine) — and the fresh-per-access design turned into the
 * problem: every db.* access instantiated a NEW query compiler + pg pool,
 * and under concurrent chat polling (10s sidebar × users) workerd started
 * killing requests with "Worker exceeded CPU time limit" / WASM
 * "RuntimeError: unreachable" in loadEngine (cf_logs 2026-11-27 12:43-12:46,
 * exceededResources rows in cf_cpu_stats.py). The Workers path now uses a
 * per-isolate singleton — the same shape as the node path — with the pool
 * guardrails above keeping connections fresh. If the old hang ever
 * reappears, the fallback is restoring fresh-per-access in the Proxy below.
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

// Per-request client registry on Workers. Keyed by the OpenNext request
// context object (identity-stable within one request via AsyncLocalStorage).
// Fallback: burst-TTL client when no context is detectable.
const globalForWorkersPrisma = globalThis as unknown as {
  workersReqClients?: WeakMap<object, PrismaClient>
  workersPrisma: PrismaClient | undefined
  workersPrismaAt: number
}
globalForWorkersPrisma.workersReqClients = new WeakMap()

/**
 * CLIENT LIFECYCLE (prod lessons 2026-11-27, cf_logs_msgs.py):
 *
 * - fresh-client-per-access (M23): correct liveness, but a query-compiler +
 *   pg pool instantiation PER db.* access → "Worker exceeded CPU time limit"
 *   under concurrent chat polling (12:43-12:46 burst).
 * - per-isolate singleton (1st attempt): HANGS — lazy env access forces pool
 *   creation inside a request, and on workerd a node:net socket opened under
 *   request 1's execution context can never settle under request 2:
 *   "This promise was created by a request that has since ended, so it can
 *   never settle" + "timeout exceeded when trying to connect" + workerd
 *   "code had hung and would never generate a response" (13:08-13:10 burst).
 *   Cross-request socket reuse is fundamentally broken on this stack.
 *
 * Final design: ONE client PER REQUEST, keyed by the OpenNext request
 * context object. Each request gets its own pool/socket (no cross-request
 * reuse → no hangs) while the per-request cost drops from ~3-4 client
 * constructions (M23) to exactly 1. The WeakMap entry dies with the request
 * context, so nothing accumulates on the isolate.
 */
const WORKERS_CLIENT_TTL_MS = 1_200

function getWorkersClient(): PrismaClient {
  // Preferred: per-request memoization via the OpenNext context object.
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { getCloudflareContext } = require('@opennextjs/cloudflare') as {
      getCloudflareContext(opts: { async: false }): unknown
    }
    const ctxObj = getCloudflareContext({ async: false })
    if (ctxObj && typeof ctxObj === 'object') {
      const registry = globalForWorkersPrisma.workersReqClients!
      let client = registry.get(ctxObj)
      if (!client) {
        client = createClient()
        registry.set(ctxObj, client)
      }
      return client
    }
  } catch {
    // not on workers or no async context — fall through to TTL fallback
  }
  // Fallback: burst-TTL client (no context object available). Rare path.
  const now = Date.now()
  const cur = globalForWorkersPrisma.workersPrisma
  if (!cur || now - globalForWorkersPrisma.workersPrismaAt > WORKERS_CLIENT_TTL_MS) {
    if (cur) {
      void (cur as unknown as { $disconnect?: () => Promise<unknown> })
        .$disconnect?.().catch(() => {})
    }
    globalForWorkersPrisma.workersPrisma = createClient()
    globalForWorkersPrisma.workersPrismaAt = now
  }
  return globalForWorkersPrisma.workersPrisma as PrismaClient
}

export const db: PrismaClient = new Proxy({} as PrismaClient, {
  get(_target, prop, _receiver) {
    if (!WORKERS) {
      if (!globalForPrisma.prisma) globalForPrisma.prisma = createClient()
      const client = globalForPrisma.prisma as unknown as Record<string | symbol, unknown>
      const value = client[prop]
      return typeof value === 'function' ? (value as (...a: unknown[]) => unknown).bind(globalForPrisma.prisma) : value
    }
    // Workers: per-isolate singleton (see the M23 supersession note above).
    // One query compiler + one pg pool per isolate instead of one per access.
    const client = getWorkersClient() as unknown as Record<string | symbol, unknown>
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
  // Node runtime (dev/CI): reuse the singleton — createClient() here leaks a
  // fresh pg Pool (default max 10) PER REQUEST, exhausting local Postgres
  // max_connections (100) after ~30 chat requests with FATAL "sorry, too
  // many clients already". The singleton shares one healthy pool instead.
  // Workers: same singleton (see the M23 supersession note in db.ts).
  if (!WORKERS) {
    if (!globalForPrisma.prisma) globalForPrisma.prisma = createClient()
    return globalForPrisma.prisma
  }
  return getWorkersClient()
}

/**
 * Release a dbClient()'s resources — LEGACY NO-OP (2026-11-27).
 *
 * History: on Workers every dbClient() call used to instantiate a fresh
 * engine + pg pool; without an explicit $disconnect pools lingered on the
 * isolate and, under continuous traffic (import runner, 2026-11-25
 * incident), warm isolates crossed the 128MB limit → error 1102 on ~40% of
 * requests. disconnectClient() existed so routes could drain them.
 *
 * Since the per-isolate singleton (see the M23 supersession note) there is
 * exactly ONE query compiler + ONE pool per isolate with 1s idle recycling
 * — draining the singleton would break every subsequent request. The
 * function stays as a compatibility no-op; the pool guardrails in
 * createClient() do the memory work instead.
 */
export async function disconnectClient(_client: PrismaClient): Promise<void> {
  // no-op: the shared singleton must never be disconnected mid-isolate
}
