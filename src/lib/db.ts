// JEE NEXUS — Prisma client factory (dual runtime).
//
// Node (local dev, CI, sandbox): standard prisma-client-js against DATABASE_URL.
// Cloudflare Workers (production deploy): worker-runtime client from
// src/generated/worker (pure-JS query compiler, no native engine) + pg-worker
// adapter. Connection source, in order of preference:
//   1. HYPERDRIVE binding (connection pooling + query cache — preferred once
//      the config exists; creating it needs a token with Hyperdrive:Edit,
//      see scripts/deploy_app_cloudflare.sh)
//   2. DATABASE_URL worker secret — direct TCP from Workers via
//      cloudflare:sockets. Use the Supabase SESSION pooler URL (port 5432);
//      the transaction pooler (6543) is not suited to direct long-lived TCP.
// If neither is present the worker still boots: UI/static routes serve fine
// and DB-backed routes fail per-request until the secret/binding is added.
import { PrismaClient } from '@prisma/client'
import { PrismaClient as WorkerPrismaClient } from '@/generated/worker/client'
import { PrismaPg } from '@prisma/adapter-pg-worker'

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
    const connectionString = hyperdrive?.connectionString ?? directUrl
    if (!connectionString) {
      console.error(
        '[db] No database configured on Workers: set the DATABASE_URL secret ' +
          '(Supabase session-pooler URL as jee_app) or bind HYPERDRIVE. ' +
          'DB-backed API routes will keep failing until one of them is added.'
      )
    }
    return new WorkerPrismaClient({
      // Cast: adapter-pg-worker and the generated client each bundle a copy of
      // the driver-adapter-utils types; the interfaces are structurally identical.
      adapter: new PrismaPg({
        connectionString: connectionString ?? UNCONFIGURED_URL,
      }) as unknown as never,
    }) as unknown as PrismaClient
  }

  // node runtime (local dev, CI, sandbox preview)
  return new PrismaClient({ log: ['query'] })
}

export const db = globalForPrisma.prisma ?? createClient()

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = db
