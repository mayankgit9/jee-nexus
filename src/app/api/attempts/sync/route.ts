import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { requireUser, jsonError, HttpError, rateLimit } from '@/lib/auth'
import { Prisma } from '@prisma/client'

/**
 * Offline attempt synchronisation (Part H, migration 0019).
 *
 * POST /api/attempts/sync { attempts: [{ clientKey, questionId, selectedOptions?,
 * numericalValue?, timeSpentSeconds?, hintsUsed?, createdAt? }] }
 *
 * The CBT/ practice client queues submissions while offline (IndexedDB) and
 * flushes them here on reconnect. Every item carries a client-generated key;
 * the unique index on attempts.client_key makes replays idempotent — a
 * retried sync can never duplicate an attempt, and per-item results report
 * what was inserted vs already-known. Grading is NOT trusted from the
 * client: each attempt is re-graded server-side before storage.
 */

interface SyncItem {
  clientKey: string
  questionId: string
  selectedOptions?: number[]
  numericalValue?: string
  timeSpentSeconds?: number
  hintsUsed?: number
  createdAt?: string
}

function isCorrectMcqSingle(selected: number[], correct: number[]): boolean {
  return selected.length === 1 && correct.length === 1 && selected[0] === correct[0]
}
function isCorrectMcqMulti(selected: number[], correct: number[]): boolean {
  if (selected.length !== correct.length) return false
  const s = [...new Set(selected)].sort()
  const c = [...new Set(correct)].sort()
  return s.length === selected.length && s.every((v, i) => v === c[i])
}

export async function POST(req: NextRequest) {
  try {
    const user = await requireUser()
    await rateLimit(`attempts-sync:${user.id}`, 30, 60_000)
    const body = await req.json()
    const items: SyncItem[] = Array.isArray(body.attempts) ? body.attempts.slice(0, 200) : []
    if (items.length === 0) throw new HttpError(400, 'attempts array is required')

    // idempotency pre-check in ONE query
    const keys = items.map((i) => String(i.clientKey ?? '')).filter((k) => k.length >= 8).slice(0, 200)
    const existing = keys.length
      ? await db.attempt.findMany({ where: { clientKey: { in: keys } }, select: { clientKey: true } })
      : []
    const known = new Set(existing.map((e) => e.clientKey))

    const results: { clientKey: string; status: 'synced' | 'duplicate' | 'invalid' }[] = []

    for (const item of items) {
      const clientKey = String(item.clientKey ?? '')
      const questionId = String(item.questionId ?? '')
      if (clientKey.length < 8 || !questionId) {
        results.push({ clientKey, status: 'invalid' })
        continue
      }
      if (known.has(clientKey)) {
        results.push({ clientKey, status: 'duplicate' })
        continue
      }

      const question = await db.question.findUnique({ where: { id: questionId } })
      if (!question) {
        results.push({ clientKey, status: 'invalid' })
        continue
      }

      // ---- server-side re-grade (never trust client grading) ----
      let isCorrect: boolean | null = null
      let selectedOptions: number[] | null = null
      let numericalValue: string | null = null
      if (question.type === 'numerical') {
        const raw = String(item.numericalValue ?? '').trim()
        if (raw !== '') {
          numericalValue = raw
          const value = Number(raw)
          if (!isNaN(value) && question.numericalAnswer !== null) {
            const tol = question.numericalTolerance !== null ? Number(question.numericalTolerance) : 0.01
            isCorrect = Math.abs(value - Number(question.numericalAnswer)) <= Math.max(tol, 1e-9)
          }
        }
      } else {
        const selected = Array.isArray(item.selectedOptions)
          ? item.selectedOptions.map(Number).filter((n) => !isNaN(n))
          : []
        if (selected.length > 0) {
          selectedOptions = selected
          const correct = Array.isArray(question.correctOptions) ? (question.correctOptions as number[]) : []
          isCorrect =
            question.type === 'mcq_single'
              ? isCorrectMcqSingle(selected, correct)
              : isCorrectMcqMulti(selected, correct)
        }
      }

      await db.attempt.create({
        data: {
          userId: user.id,
          questionId,
          selectedOptions: selectedOptions ?? Prisma.DbNull,
          numericalValue,
          isCorrect,
          timeSpentSeconds: Math.max(0, Math.min(3600, Number(item.timeSpentSeconds ?? 0))),
          hintsUsed: Math.max(0, Math.min(10, Number(item.hintsUsed ?? 0))),
          clientKey,
          ...(item.createdAt ? { createdAt: new Date(item.createdAt) } : {}),
        },
      })
      known.add(clientKey)
      results.push({ clientKey, status: 'synced' })
    }

    return Response.json({ results, synced: results.filter((r) => r.status === 'synced').length })
  } catch (err) {
    return jsonError(err)
  }
}
