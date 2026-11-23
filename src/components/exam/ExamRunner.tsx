'use client'

// JEE NEXUS — NTA-style CBT exam runner
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Timer, ChevronLeft, BookmarkPlus, Eraser, Save, FileCheck } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { MathText } from '@/components/MathText'
import type { SubjectKey } from '@/lib/types'
import { api, SUBJECT_COLORS } from '@/lib/client'
import { toast } from '@/hooks/use-toast'
import { cn } from '@/lib/utils'

const OPTION_LABELS = ['A', 'B', 'C', 'D', 'E', 'F']

export interface ExamQuestionPayload {
  examQuestionId: string; order: number; section: SubjectKey
  question: {
    id: string; publicId: string; type: string; text: string
    options: { idx: number; text: string }[]
    images: { url: string; altText: string; caption?: string }[]
    difficulty: string; chapterName: string; sourceYear: number | null; sourceShift: string | null
  }
}
export interface StartResponse {
  attemptId: string
  endsAt: string
  exam: { id: string; title: string; durationMinutes: number; pattern: { name: string } }
  savedAnswers: Record<string, { selectedOptions?: number[]; numericalValue?: string; visited: boolean; markedForReview?: boolean }>
  questions: ExamQuestionPayload[]
}
export type AnswerState = { selectedOptions: number[]; numericalValue: string; visited: boolean; markedForReview: boolean }

export function ExamRunner({ data, onFinish }: { data: StartResponse; onFinish: () => void }) {
  const questions = data.questions
  const sections = useMemo(() => {
    const seen = new Map<string, { key: SubjectKey; label: string; ids: string[] }>()
    for (const q of questions) {
      const s = seen.get(q.section) ?? { key: q.section, label: q.section.charAt(0).toUpperCase() + q.section.slice(1), ids: [] }
      s.ids.push(q.examQuestionId)
      seen.set(q.section, s)
    }
    return [...seen.values()]
  }, [questions])

  const [sectionIdx, setSectionIdx] = useState(0)
  const [currentId, setCurrentId] = useState(questions[0]?.examQuestionId ?? '')
  const [answers, setAnswers] = useState<Record<string, AnswerState>>(() => {
    const init: Record<string, AnswerState> = {}
    for (const q of questions) {
      const saved = data.savedAnswers[q.examQuestionId]
      init[q.examQuestionId] = {
        selectedOptions: saved?.selectedOptions ?? [],
        numericalValue: saved?.numericalValue ?? '',
        visited: saved?.visited ?? false,
        markedForReview: saved?.markedForReview ?? false,
      }
    }
    return init
  })
  const [remainingMs, setRemainingMs] = useState(() => new Date(data.endsAt).getTime() - Date.now())
  const [submitOpen, setSubmitOpen] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const submittedRef = useRef(false)
  const questionStartRef = useRef(Date.now())

  const currentIndex = questions.findIndex((q) => q.examQuestionId === currentId)
  const current = questions[currentIndex] ?? questions[0]

  // mark visited on view
  useEffect(() => {
    setAnswers((a) => (a[currentId]?.visited ? a : { ...a, [currentId]: { ...a[currentId], visited: true } }))
    questionStartRef.current = Date.now()
  }, [currentId])

  // countdown
  useEffect(() => {
    const t = setInterval(() => setRemainingMs(new Date(data.endsAt).getTime() - Date.now()), 1000)
    return () => clearInterval(t)
  }, [data.endsAt])

  const persist = useCallback(
    async (examQuestionId: string, patch: Partial<AnswerState>) => {
      const timeDeltaSeconds = Math.round((Date.now() - questionStartRef.current) / 1000)
      questionStartRef.current = Date.now()
      try {
        await api('/api/exam/answer', {
          attemptId: data.attemptId,
          examQuestionId,
          ...(patch.selectedOptions !== undefined && { selectedOptions: patch.selectedOptions }),
          ...(patch.numericalValue !== undefined && { numericalValue: patch.numericalValue }),
          ...(patch.markedForReview !== undefined && { markedForReview: patch.markedForReview }),
          visited: true,
          timeDeltaSeconds,
        })
      } catch {
        // autosave failures are non-fatal; grading uses last saved state
      }
    },
    [data.attemptId]
  )

  const doSubmit = useCallback(async () => {
    if (submittedRef.current) return
    submittedRef.current = true
    setSubmitting(true)
    try {
      const r = await api<{ totalMarks: number; maxMarks: number; status: string }>('/api/exam/submit', {
        attemptId: data.attemptId,
      })
      toast({
        title: `Submitted — ${r.totalMarks}/${r.maxMarks}`,
        description: r.status === 'expired' ? 'Auto-submitted at time limit.' : 'Open the result from attempt history.',
      })
      onFinish()
    } catch (e) {
      submittedRef.current = false
      setSubmitting(false)
      toast({ title: 'Submission failed', description: (e as Error).message, variant: 'destructive' })
    }
  }, [data.attemptId, onFinish])

  // auto-submit at zero (client trigger; server remains authoritative on grading)
  useEffect(() => {
    if (remainingMs <= 0 && !submittedRef.current) doSubmit()
  }, [remainingMs, doSubmit])

  const counts = useMemo(() => {
    let answered = 0, notAnswered = 0, marked = 0, answeredMarked = 0, notVisited = 0
    for (const q of questions) {
      const a = answers[q.examQuestionId]
      const has = a && (a.selectedOptions.length > 0 || a.numericalValue.trim() !== '')
      if (!a?.visited) notVisited++
      else if (a.markedForReview && has) answeredMarked++
      else if (a.markedForReview) marked++
      else if (has) answered++
      else notAnswered++
    }
    return { answered, notAnswered, marked, answeredMarked, notVisited }
  }, [answers, questions])

  if (!current) return null

  const setAnswer = (patch: Partial<AnswerState>, persistPatch: Partial<AnswerState>) => {
    setAnswers((a) => ({ ...a, [currentId]: { ...a[currentId], ...patch } }))
    persist(currentId, persistPatch)
  }

  const goTo = (id: string) => setCurrentId(id)
  const nextQ = () => {
    const ids = sections[sectionIdx].ids
    const pos = ids.indexOf(currentId)
    if (pos < ids.length - 1) setCurrentId(ids[pos + 1])
  }

  const mm = Math.max(0, Math.floor(remainingMs / 60000))
  const ss = Math.max(0, Math.floor((remainingMs % 60000) / 1000))
  const lowTime = remainingMs < 5 * 60 * 1000

  const q = current.question

  return (
    <div className="fixed inset-0 z-[60] flex flex-col bg-background">
      {/* exam header */}
      <header className="border-b border-border bg-card/60">
        <div className="mx-auto flex h-14 max-w-7xl items-center justify-between gap-3 px-4">
          <div className="flex min-w-0 items-center gap-3">
            <span className="truncate text-sm font-semibold">{data.exam.title}</span>
            <Badge variant="outline" className="hidden sm:inline-flex">{data.exam.pattern.name}</Badge>
          </div>
          <div className={cn('flex items-center gap-2 rounded-lg border px-3 py-1.5 font-mono text-sm font-bold',
            lowTime ? 'animate-pulse border-rose-400/50 bg-rose-400/10 text-rose-400' : 'border-primary/30 bg-primary/10 text-primary')}>
            <Timer className="h-4 w-4" />
            {String(mm).padStart(2, '0')}:{String(ss).padStart(2, '0')}
          </div>
        </div>
      </header>

      <div className="mx-auto flex w-full max-w-7xl flex-1 gap-4 overflow-hidden p-4">
        {/* question column */}
        <div className="flex min-w-0 flex-1 flex-col">
          {/* section tabs */}
          <div className="mb-3 flex flex-wrap gap-2">
            {sections.map((s, i) => (
              <button
                key={s.key}
                type="button"
                onClick={() => { setSectionIdx(i); setCurrentId(s.ids[0]) }}
                className={cn('rounded-lg border px-4 py-2 text-sm font-medium transition-colors',
                  sectionIdx === i ? 'border-primary bg-primary/15 text-primary' : 'border-border hover:border-primary/40')}
                style={sectionIdx === i ? { color: SUBJECT_COLORS[s.key], borderColor: SUBJECT_COLORS[s.key] } : undefined}
              >
                {s.label} <span className="ml-1 text-xs opacity-70">({s.ids.length})</span>
              </button>
            ))}
          </div>

          {/* question card */}
          <ScrollArea className="flex-1 rounded-2xl border border-border bg-card p-5">
            <div className="mb-3 flex items-center justify-between text-xs text-muted-foreground">
              <span>Question {currentIndex + 1} of {questions.length}</span>
              <span className="capitalize">{q.sourceShift ?? ''} {q.sourceYear ? `· ${q.sourceYear}` : ''} · {q.chapterName}</span>
            </div>
            <div className="text-[15px] leading-relaxed"><MathText text={q.text} /></div>
            {q.images.map((img, i) => (
              // eslint-disable-next-line @next/next/no-img-element
              <img key={i} src={img.url} alt={img.altText} className="mx-auto my-4 max-h-[380px] rounded-lg border border-border p-2" loading="lazy" />
            ))}

            {q.type === 'mcq_single' && (
              <div className="mt-5 space-y-2.5">
                {q.options.map((opt) => {
                  const sel = currentAnswerIncludes(answers, currentId, opt.idx)
                  return (
                    <label key={opt.idx} className={cn('flex cursor-pointer items-start gap-3 rounded-xl border px-4 py-3 text-sm transition-colors',
                      sel ? 'border-primary/60 bg-primary/[0.08]' : 'hover:border-primary/40')}>
                      <input
                        type="radio"
                        name={`exam-${currentId}`}
                        checked={sel}
                        onChange={() => setAnswer({ selectedOptions: [opt.idx] }, { selectedOptions: [opt.idx] })}
                        className="mt-1 accent-[var(--primary)]"
                      />
                      <span className="font-semibold text-muted-foreground">{OPTION_LABELS[opt.idx]}.</span>
                      <span className="flex-1 leading-relaxed"><MathText text={opt.text} /></span>
                    </label>
                  )
                })}
              </div>
            )}
            {q.type === 'mcq_multi' && (
              <div className="mt-5 space-y-2.5">
                <p className="text-xs text-muted-foreground">One or more options may be correct — partial marking applies.</p>
                {q.options.map((opt) => {
                  const sel = currentAnswerIncludes(answers, currentId, opt.idx)
                  return (
                    <label key={opt.idx} className={cn('flex cursor-pointer items-start gap-3 rounded-xl border px-4 py-3 text-sm transition-colors',
                      sel ? 'border-primary/60 bg-primary/[0.08]' : 'hover:border-primary/40')}>
                      <input
                        type="checkbox"
                        checked={sel}
                        onChange={() => {
                          const cur = answers[currentId]?.selectedOptions ?? []
                          const next = sel ? cur.filter((i) => i !== opt.idx) : [...cur, opt.idx].sort((a, b) => a - b)
                          setAnswer({ selectedOptions: next }, { selectedOptions: next })
                        }}
                        className="mt-1 accent-[var(--primary)]"
                      />
                      <span className="font-semibold text-muted-foreground">{OPTION_LABELS[opt.idx]}.</span>
                      <span className="flex-1 leading-relaxed"><MathText text={opt.text} /></span>
                    </label>
                  )
                })}
              </div>
            )}
            {q.type === 'numerical' && (
              <div className="mt-5">
                <Label htmlFor="exam-num" className="text-sm text-muted-foreground">Your answer (numerical value)</Label>
                <Input
                  id="exam-num"
                  inputMode="decimal"
                  placeholder="e.g. 12.5"
                  value={answers[currentId]?.numericalValue ?? ''}
                  onChange={(e) => setAnswers((a) => ({ ...a, [currentId]: { ...a[currentId], numericalValue: e.target.value } }))}
                  onBlur={() => persist(currentId, { numericalValue: answers[currentId]?.numericalValue ?? '' })}
                  className="mt-2 max-w-[220px] font-mono text-base"
                />
              </div>
            )}
          </ScrollArea>

          {/* action bar (NTA layout) */}
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Button variant="outline" onClick={() => setCurrentId(questions[Math.max(0, currentIndex - 1)].examQuestionId)} disabled={currentIndex === 0}>
              <ChevronLeft className="mr-1 h-4 w-4" /> Previous
            </Button>
            <Button variant="outline" onClick={() => { setAnswer({ markedForReview: true }, { markedForReview: true }); nextQ() }}>
              <BookmarkPlus className="mr-1 h-4 w-4" /> Mark for Review &amp; Next
            </Button>
            <Button
              variant="outline"
              onClick={() => {
                const patch = q.type === 'numerical' ? { numericalValue: '' } : { selectedOptions: [] }
                setAnswer(patch, patch)
              }}
            >
              <Eraser className="mr-1 h-4 w-4" /> Clear Response
            </Button>
            <div className="flex-1" />
            <Button onClick={() => { persist(currentId, {}); nextQ() }}>
              <Save className="mr-1 h-4 w-4" /> Save &amp; Next
            </Button>
          </div>
        </div>

        {/* palette sidebar (desktop) */}
        <aside className="hidden w-[300px] shrink-0 flex-col rounded-2xl border border-border bg-card lg:flex">
          <div className="border-b border-border px-4 py-3">
            <div className="grid grid-cols-2 gap-1.5 text-[11px]">
              <Legend color="bg-emerald-500/80" label={`Answered (${counts.answered})`} />
              <Legend color="bg-rose-500/80" label={`Not answered (${counts.notAnswered})`} />
              <Legend color="bg-violet-500/80" label={`Marked (${counts.marked})`} />
              <Legend color="bg-violet-500/80 ring-2 ring-emerald-400" label={`Ans+Marked (${counts.answeredMarked})`} />
              <Legend color="bg-muted-foreground/40" label={`Not visited (${counts.notVisited})`} />
            </div>
          </div>
          <ScrollArea className="flex-1 p-4">
            <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              {sections[sectionIdx].label}
            </div>
            <div className="grid grid-cols-6 gap-2">
              {sections[sectionIdx].ids.map((id) => {
                const a = answers[id]
                const num = questions.findIndex((x) => x.examQuestionId === id) + 1
                const has = a && (a.selectedOptions.length > 0 || a.numericalValue.trim() !== '')
                return (
                  <button
                    key={id}
                    type="button"
                    onClick={() => goTo(id)}
                    aria-label={`Go to question ${num}`}
                    className={cn(
                      'relative flex h-9 w-9 items-center justify-center rounded-lg text-xs font-semibold transition-transform hover:scale-105',
                      id === currentId && 'ring-2 ring-primary ring-offset-2 ring-offset-card',
                      a?.markedForReview && has && 'bg-violet-500/80 text-white ring-2 ring-emerald-400',
                      a?.markedForReview && !has && 'bg-violet-500/80 text-white',
                      !a?.markedForReview && has && 'bg-emerald-500/80 text-white',
                      !a?.markedForReview && a?.visited && !has && 'bg-rose-500/80 text-white',
                      !a?.visited && 'bg-muted-foreground/30 text-muted-foreground'
                    )}
                  >
                    {num}
                  </button>
                )
              })}
            </div>
          </ScrollArea>
          <div className="border-t border-border p-4">
            <Button className="w-full" variant="destructive" onClick={() => setSubmitOpen(true)}>
              <FileCheck className="mr-2 h-4 w-4" /> Submit exam
            </Button>
          </div>
        </aside>
      </div>

      {/* mobile palette */}
      <div className="border-t border-border p-3 lg:hidden">
        <details>
          <summary className="cursor-pointer text-center text-sm font-medium text-primary">Question palette</summary>
          <div className="mt-3 grid grid-cols-6 gap-2">
            {questions.map((x, i) => {
              const a = answers[x.examQuestionId]
              const has = a && (a.selectedOptions.length > 0 || a.numericalValue.trim() !== '')
              return (
                <button key={x.examQuestionId} type="button" onClick={() => goTo(x.examQuestionId)}
                  className={cn('flex h-9 items-center justify-center rounded-lg text-xs font-semibold',
                    a?.markedForReview && has && 'bg-violet-500/80 text-white ring-2 ring-emerald-400',
                    a?.markedForReview && !has && 'bg-violet-500/80 text-white',
                    !a?.markedForReview && has && 'bg-emerald-500/80 text-white',
                    !a?.markedForReview && a?.visited && !has && 'bg-rose-500/80 text-white',
                    !a?.visited && 'bg-muted-foreground/30 text-muted-foreground')}>
                  {i + 1}
                </button>
              )
            })}
          </div>
          <Button className="mt-3 w-full" variant="destructive" onClick={() => setSubmitOpen(true)}>
            <FileCheck className="mr-2 h-4 w-4" /> Submit exam
          </Button>
        </details>
      </div>

      {/* submit confirmation (NTA-style) */}
      <Dialog open={submitOpen} onOpenChange={setSubmitOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Submit examination?</DialogTitle>
            <DialogDescription>Please review your attempt summary before final submission.</DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-2 text-sm">
            <SummaryRow label="Answered" value={counts.answered} className="text-emerald-400" />
            <SummaryRow label="Not answered" value={counts.notAnswered} className="text-rose-400" />
            <SummaryRow label="Marked for review" value={counts.marked} className="text-violet-400" />
            <SummaryRow label="Answered + marked" value={counts.answeredMarked} className="text-violet-400" />
            <SummaryRow label="Not visited" value={counts.notVisited} className="text-muted-foreground" />
            <SummaryRow label="Time remaining" value={`${mm}:${String(ss).padStart(2, '0')}`} className="text-primary" />
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setSubmitOpen(false)}>Continue exam</Button>
            <Button variant="destructive" onClick={doSubmit} disabled={submitting}>
              {submitting ? 'Submitting…' : 'Yes, submit'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function currentAnswerIncludes(answers: Record<string, AnswerState>, currentId: string, idx: number): boolean {
  return answers[currentId]?.selectedOptions.includes(idx) ?? false
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <div className="flex items-center gap-1.5">
      <span className={cn('h-3.5 w-3.5 shrink-0 rounded', color)} />
      <span className="truncate text-muted-foreground">{label}</span>
    </div>
  )
}

function SummaryRow({ label, value, className }: { label: string; value: string | number; className?: string }) {
  return (
    <div className="flex items-center justify-between rounded-lg border border-border px-3 py-2">
      <span className="text-muted-foreground">{label}</span>
      <span className={cn('font-bold', className)}>{value}</span>
    </div>
  )
}
