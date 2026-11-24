// JEE NEXUS — idempotent admin bootstrap for a fresh production DB.
// Creates admin@jee-nexus.dev (role=admin, scrypt hash identical to the
// signup route) if missing. Run with DATABASE_URL pointing at the target DB.
// Usage: bunx tsx scripts/provision_admin.ts
import { PrismaClient } from '@prisma/client'
import { scryptSync, randomBytes } from 'crypto'

const db = new PrismaClient()
const EMAIL = process.env.ADMIN_EMAIL || 'admin@jee-nexus.dev'
const PASSWORD = process.env.ADMIN_PASSWORD || 'admin-pass-123'

function hashPassword(password: string): string {
  const salt = randomBytes(16).toString('hex')
  const hash = scryptSync(password, salt, 64).toString('hex')
  return `${salt}:${hash}`
}

async function main() {
  const existing = await db.user.findUnique({ where: { email: EMAIL } })
  if (existing) {
    console.log(`admin already present: ${EMAIL} role=${existing.role}`)
  } else {
    const u = await db.user.create({
      data: { email: EMAIL, name: 'Admin', role: 'admin', passwordHash: hashPassword(PASSWORD) },
      select: { id: true, email: true, role: true },
    })
    console.log(`admin created: ${u.email} role=${u.role}`)
  }
  await db.$disconnect()
}

main().catch((e) => { console.error(e); process.exit(1) })
