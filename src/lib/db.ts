// JEE NEXUS — Prisma client factory (dual runtime).
//
// Node (local dev, CI, sandbox): standard prisma-client-js against DATABASE_URL.
// Cloudflare Workers (production deploy): worker-runtime client from
// src/generated/worker (pure-JS query compiler) + pg-worker adapter through
// the HYPERDRIVE binding. getCloudflareContext() throws on node, so the
// fallback there is exactly the previous behaviour.
import { PrismaClient } from '@prisma/client'
import { PrismaClient as WorkerPrismaClient } from '@/generated/worker/client'
import { PrismaPg } from '@prisma/adapter-pg-worker'

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

function createClient(): PrismaClient {
  try {
    // On Workers, OpenNext exposes bindings synchronously; on node this throws.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { getCloudflareContext } = require('@opennextjs/cloudflare') as {
      getCloudflareContext(opts: { async: false }): { env: Record<string, unknown> }
    }
    const { env } = getCloudflareContext({ async: false })
    const hyperdrive = (env as { HYPERDRIVE?: { connectionString?: string } }).HYPERDRIVE
    if (!hyperdrive?.connectionString) {
      throw new Error('HYPERDRIVE binding missing — check wrangler.jsonc')
    }
    return new WorkerPrismaClient({
      // Cast: adapter-pg-worker and the generated client each bundle a copy of
      // the driver-adapter-utils types; the interfaces are structurally identical.
      adapter: new PrismaPg({ connectionString: hyperdrive.connectionString }) as unknown as never,
    }) as unknown as PrismaClient
  } catch {
    // node runtime (local dev, CI, sandbox preview)
    return new PrismaClient({ log: ['query'] })
  }
}

export const db = globalForPrisma.prisma ?? createClient()

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = db
