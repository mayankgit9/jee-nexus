import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '@prisma/client'

const url = process.env.DATABASE_URL
const adapter = new PrismaPg({ url })
const prisma = new PrismaClient({ adapter })

const patterns = await prisma.examPattern.findMany({
  select: { key: true, name: true, durationMinutes: true, id: true },
  orderBy: { key: "asc" },
})
console.log('patterns:', JSON.stringify(patterns, null, 2))
const examCount = await prisma.exam.count()
console.log('exam count:', examCount)
await prisma.$disconnect()
