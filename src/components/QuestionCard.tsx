'use client'

// JEE NEXUS — question renderer: LaTeX text, diagrams, 3 answer types, result states
import { useEffect, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  CheckCircle2, XCircle, Bookmark, BookmarkCheck, Flag, ChevronRight, ZoomIn, ShieldQuestion, Sparkles, Loader2,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Label } from '@/components/ui/label'
import { Checkbox } from '@/components/ui/checkbox'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { MathText } from '@/components/MathText'
import type { PublicQuestion, QuestionSolution, SubmittedResult } from '@/lib/types'
import { DIFFICULTY_META, TYPE_META, SUBJECT_META } from '@/lib/types'
import { api, SUBJECT_COLORS } from '@/lib/client'
import { cn } from '@/lib/utils'
import { toast } from '@/hooks/use-toast'

const OPTION_LABELS = ['A', 'B', 'C', 'D', 'E', 'F']

export function SourceBadges({ q }: { q: PublicQuestion }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5 text-xs">
      <Badge variant="outline" className="border-border/70 font-normal">
        {q.sourceExam} {q.sourceYear ?? ''}
      </Badge>
      {q.sourceShift && (
        <Badge variant="outline" className="border-border/70 font-normal">{q.sourceShift}</Badge>
      )}
      {q.sourceQuestionNumber != null && (
        <Badge variant="outline" className="border-border/70 font-normal">Q{q.sourceQuestionNumber}</Badge>
      )}
      <Badge variant="outline" className={cn('font-normal', DIFFICULTY_META[q.difficulty].className)}>
        {DIFFICULTY_META[q.difficulty].label}
      </Badge>
      <Badge variant="outline" className="border-border/70 font-normal">{q.chapter.name}</Badge>
      {q.verificationStatus !== 'verified' && (
        <Badge variant="outline" className="border-amber-500/30 bg-amber-500/10 text-amber-400 font-normal">
          <ShieldQuestion className="mr-1 h-3 w-3" />Unverified
        </Badge>
      )}
    </div>
  )
}

function ZoomableImage({ src, alt, caption, attribution }: { src: string; alt: string; caption?: string; attribution?: string }) {
  const [zoom, setZoom] = useState(false)
  return (
    <figure className="my-4">
      <button
        type="button"
        onClick={() => setZoom(true)}
        className="group relative block w-full overflow-hidden rounded-lg border border-border bg-black/20"
        aria-label={`Zoom image: ${alt}`}
      >
        { }
        <img src={src} alt={alt} className="mx-auto max-h-[420px] w-auto max-w-full p-2" loading="lazy" />
        <span className="absolute right-2 top-2 rounded-md bg-black/60 p-1.5 opacity-0 transition-opacity group-hover:opacity-100">
          <ZoomIn className="h-4 w-4 text-white" />
        </span>
      </button>
      {caption && <figcaption className="mt-1.5 text-center text-xs text-muted-foreground">{caption}</figcaption>}
      {attribution && (
        <figcaption className="text-center text-[11px] text-muted-foreground/70">
          {attribution.replace(/^Source:\s*/i, '') ? (
            <>Source: {attribution.replace(/^Source:\s*/i, '')}</>
          ) : null}
        </figcaption>
      )}
      <Dialog open={zoom} onOpenChange={setZoom}>
        <DialogContent className="max-w-4xl">
          { }
          <img src={src} alt={alt} className="mx-auto max-h-[75vh] w-auto max-w-full" />
          <DialogDescription>{caption ?? alt}</DialogDescription>
        </DialogContent>
      </Dialog>
    </figure>
  )
}

export function SolutionView({ solution, result, questionId, loggedIn, onRequireAuth }: { solution: QuestionSolution; result?: SubmittedResult | null; questionId?: string; loggedIn?: boolean; onRequireAuth?: () => void }) {
  const [showAlt, setShowAlt] = useState(false)
  const [current, setCurrent] = useState(solution)
  const [enriching, setEnriching] = useState(false)
  const [enrichFailed, setEnrichFailed] = useState(false)

  // keep local state in sync when the parent injects a new solution
  useEffect(() => {
    setCurrent(solution)
    setEnrichFailed(false)
  }, [solution])

  const isThin = !(current.keyConcept && (current.formulas?.length ?? 0) > 0 && current.commonMistakes)

  const generateDetailed = async () => {
    if (!questionId || enriching) return
    if (!loggedIn) {
      onRequireAuth?.()
      return
    }
    setEnriching(true)
    setEnrichFailed(false)
    try {
      const r = await api<{ ok: boolean; skipped?: boolean; solution: QuestionSolution | null }>(
        '/api/solutions/enrich',
        { questionId }
      )
      if (r.solution) setCurrent(r.solution)
      toast({ title: r.skipped ? 'Solution already detailed' : 'Detailed solution generated' })
    } catch (e) {
      setEnrichFailed(true)
      toast({ title: 'Could not generate solution', description: (e as Error).message, variant: 'destructive' })
    } finally {
      setEnriching(false)
    }
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="mt-4 rounded-xl border border-primary/25 bg-primary/[0.04] p-5"
    >
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h4 className="flex items-center gap-2 text-sm font-semibold tracking-wide text-primary">
          Detailed Solution
        </h4>
        <div className="flex flex-wrap items-center gap-2">
          {current.isAiGenerated && (
            <Badge variant="outline" className="border-amber-500/30 bg-amber-500/10 text-[11px] text-amber-400">
              AI-generated · pending expert verification
            </Badge>
          )}
          {isThin && questionId && (
            <Button
              size="sm"
              variant="outline"
              onClick={generateDetailed}
              disabled={enriching}
              className="h-7 gap-1.5 border-primary/40 text-xs text-primary hover:bg-primary/10"
            >
              {enriching ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  Researching & writing…
                </>
              ) : (
                <>
                  <Sparkles className="h-3.5 w-3.5" />
                  Generate detailed solution
                </>
              )}
            </Button>
          )}
          {isThin && !questionId && enrichFailed && (
            <span className="text-[11px] text-rose-400">Generation failed — try again later</span>
          )}
        </div>
      </div>

      {result?.isCorrect !== undefined && result.correctOptions && (
        <p className="mb-3 text-sm">
          <span className="text-muted-foreground">Correct answer: </span>
          <span className="font-semibold text-primary">
            {result.correctOptions.map((i) => OPTION_LABELS[i]).join(', ')}
          </span>
        </p>
      )}
      {result?.numericalAnswer !== undefined && (
        <p className="mb-3 text-sm">
          <span className="text-muted-foreground">Correct answer: </span>
          <span className="font-semibold text-primary">{result.numericalAnswer}</span>
          {result.numericalTolerance != null && result.numericalTolerance > 0 && (
            <span className="text-muted-foreground"> (± {result.numericalTolerance})</span>
          )}
        </p>
      )}

      {current.keyConcept && (
        <div className="mb-4 min-w-0 rounded-lg border border-border bg-card/60 p-3.5">
          <p className="mb-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Concept</p>
          <div className="text-sm leading-relaxed"><MathText text={current.keyConcept} /></div>
        </div>
      )}

      {(current.formulas ?? []).length > 0 && (
        <div className="mb-4 rounded-lg border border-violet-400/20 bg-violet-400/[0.06] p-3.5">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-violet-300/90">Formulas used</p>
          <ul className="space-y-1.5">
            {(current.formulas ?? []).map((f, i) => (
              <li key={i} className="min-w-0 border-l-2 border-violet-400/40 break-words pl-3 text-sm">
                <MathText text={`$${f}$`} />
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="sol-body text-sm leading-relaxed">
        <MathText text={current.body} />
      </div>

      {current.solutionImages.map((img, i) => (
        <ZoomableImage key={i} src={img.url} alt={img.altText} caption={img.caption} />
      ))}

      {current.commonMistakes && (
        <div className="mt-4 rounded-lg border border-rose-400/20 bg-rose-400/[0.06] p-3.5">
          <p className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-rose-300/90">Common mistakes</p>
          <div className="text-sm leading-relaxed"><MathText text={current.commonMistakes} /></div>
        </div>
      )}

      {current.alternativeMethod && (
        <div className="mt-3">
          <button
            type="button"
            onClick={() => setShowAlt(!showAlt)}
            className="flex items-center gap-1.5 text-sm font-medium text-primary hover:underline"
          >
            <ChevronRight className={cn('h-4 w-4 transition-transform', showAlt && 'rotate-90')} />
            Alternative method
          </button>
          <AnimatePresence>
            {showAlt && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                className="overflow-hidden"
              >
                <div className="sol-body mt-2 rounded-lg border border-border bg-card/60 p-3.5 text-sm">
                  <MathText text={current.alternativeMethod} />
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      )}

      {current.verification && (
        <div className="mt-4 rounded-lg border border-emerald-400/20 bg-emerald-400/[0.06] p-3.5">
          <p className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-emerald-300/90">Final verification</p>
          <div className="text-sm leading-relaxed"><MathText text={current.verification} /></div>
        </div>
      )}

      {(current.sourceReferences ?? []).length > 0 && (
        <p className="mt-4 text-[11px] leading-relaxed text-muted-foreground/70">
          References: {(current.sourceReferences ?? []).join(' · ')}
        </p>
      )}
    </motion.div>
  )
}

interface QuestionCardProps {
  question: PublicQuestion
  /** result injected when already submitted (e.g. review mode) */
  initialResult?: SubmittedResult | null
  /** hide submit controls (review mode after answering) */
  readOnly?: boolean
  /** show a secondary "Just show solution" button (library/bookmark browsing) */
  allowReveal?: boolean
  onSubmit?: (result: SubmittedResult, timeSpentSeconds: number) => void
  loggedIn: boolean
  onRequireAuth?: () => void
  index?: number
  total?: number
}

export function QuestionCard({
  question, initialResult, readOnly, allowReveal, onSubmit, loggedIn, onRequireAuth, index, total,
}: QuestionCardProps) {
  const [selected, setSelected] = useState<number[]>([])
  const [numerical, setNumerical] = useState('')
  const [result, setResult] = useState<SubmittedResult | null>(initialResult ?? null)
  const [submitting, setSubmitting] = useState(false)
  const [bookmarked, setBookmarked] = useState(!!question.bookmarked)
  const [reportOpen, setReportOpen] = useState(false)
  const [reportReason, setReportReason] = useState('')
  const [reportDetails, setReportDetails] = useState('')
  const startedAt = useRef(Date.now())

  useEffect(() => {
    // reset state when question changes
    setSelected([])
    setNumerical('')
    setResult(initialResult ?? null)
    setBookmarked(!!question.bookmarked)
    startedAt.current = Date.now()
  }, [question.id, initialResult, question.bookmarked])

  const isMcq = question.type === 'mcq_single' || question.type === 'mcq_multi'
  const answered = isMcq ? selected.length > 0 : numerical.trim() !== ''

  const submit = async () => {
    if (!answered || submitting) return
    setSubmitting(true)
    try {
      const timeSpentSeconds = Math.round((Date.now() - startedAt.current) / 1000)
      const body = isMcq ? { questionId: question.id, selectedOptions: selected, timeSpentSeconds }
        : { questionId: question.id, numericalValue: numerical, timeSpentSeconds }
      const r = await api<{ result: SubmittedResult }>('/api/questions/submit', body)
      setResult(r.result)
      onSubmit?.(r.result, timeSpentSeconds)
    } catch (e) {
      toast({ title: 'Submission failed', description: (e as Error).message, variant: 'destructive' })
    } finally {
      setSubmitting(false)
    }
  }

  /** Library browsing: fetch the solution WITHOUT grading or recording an
   *  attempt (the submit endpoint treats an answer-less request as a reveal). */
  const reveal = async () => {
    if (submitting) return
    setSubmitting(true)
    try {
      const r = await api<{ result: SubmittedResult }>('/api/questions/submit', { questionId: question.id })
      setResult(r.result)
    } catch (e) {
      toast({ title: 'Could not load solution', description: (e as Error).message, variant: 'destructive' })
    } finally {
      setSubmitting(false)
    }
  }

  // Keyboard shortcuts (practice flow only — skipped in readOnly/revealed/library
  // modes): 1-4 toggle options · Enter submits. Declared AFTER submit so the
  // ref never touches a TDZ binding.
  const submitRef = useRef(submit)
  submitRef.current = submit
  useEffect(() => {
    if (readOnly || result) return
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null
      // don't hijack typing in inputs (the numerical answer box, report dialog)
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return
      if (e.metaKey || e.ctrlKey || e.altKey) return
      if (isMcq && ['1', '2', '3', '4'].includes(e.key)) {
        const idx = Number(e.key) - 1
        const maxIdx = question.options.length - 1
        if (idx > maxIdx) return
        setSelected((prev) => {
          if (question.type === 'mcq_single') return [idx]
          return prev.includes(idx) ? prev.filter((x) => x !== idx) : [...prev, idx].sort()
        })
        e.preventDefault()
      } else if (e.key === 'Enter') {
        submitRef.current()
        e.preventDefault()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [readOnly, result, isMcq, question.type, question.options.length])

  const toggleBookmark = async () => {
    if (!loggedIn) {
      onRequireAuth?.()
      return
    }
    try {
      const r = await api<{ bookmarked: boolean }>('/api/bookmarks', { questionId: question.id })
      setBookmarked(r.bookmarked)
      toast({ title: r.bookmarked ? 'Bookmarked' : 'Bookmark removed' })
    } catch (e) {
      toast({ title: 'Failed', description: (e as Error).message, variant: 'destructive' })
    }
  }

  const sendReport = async () => {
    if (!reportReason) return
    try {
      await api('/api/reports', { questionId: question.id, reason: reportReason, details: reportDetails })
      toast({ title: 'Report submitted', description: 'Our reviewers will look into it. Thank you.' })
      setReportOpen(false)
      setReportReason('')
      setReportDetails('')
    } catch (e) {
      toast({ title: 'Failed', description: (e as Error).message, variant: 'destructive' })
    }
  }

  return (
    <div className="rounded-2xl border border-border bg-card shadow-lg shadow-black/20">
      {/* header */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/60 px-5 py-3.5">
        <div className="flex items-center gap-3">
          {index != null && total != null && (
            <span className="text-xs text-muted-foreground">Question {index + 1} / {total}</span>
          )}
          <span
            className="inline-flex items-center rounded-md px-2 py-0.5 text-xs font-semibold"
            style={{ color: SUBJECT_COLORS[question.subject.key], background: `color-mix(in oklab, ${SUBJECT_COLORS[question.subject.key]} 12%, transparent)` }}
          >
            {SUBJECT_META[question.subject.key].name}
          </span>
          <Badge variant="outline" className="border-border/70 font-normal">{TYPE_META[question.type].label}</Badge>
        </div>
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="icon" onClick={toggleBookmark} aria-label="Bookmark question"
            className="h-8 w-8 text-muted-foreground hover:text-primary">
            {bookmarked ? <BookmarkCheck className="h-4 w-4 text-primary" /> : <Bookmark className="h-4 w-4" />}
          </Button>
          <Button variant="ghost" size="icon" onClick={() => (loggedIn ? setReportOpen(true) : onRequireAuth?.())}
            aria-label="Report question" className="h-8 w-8 text-muted-foreground hover:text-rose-400">
            <Flag className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* body */}
      <div className="min-w-0 px-5 py-5">
        <SourceBadges q={question} />
        <div className="mt-3.5 break-words text-[15px] leading-relaxed">
          <MathText text={question.text} />
        </div>

        {question.images.map((img, i) => (
          <ZoomableImage key={i} src={img.url} alt={img.altText} caption={img.caption} attribution={img.attribution} />
        ))}

        {/* answer area */}
        {question.type === 'mcq_single' && (
          <RadioGroup
            value={selected[0] !== undefined ? String(selected[0]) : undefined}
            onValueChange={(v) => !result && setSelected([Number(v)])}
            className="mt-5 space-y-2.5"
            disabled={!!result}
          >
            {question.options.map((opt) => {
              const isSelected = selected.includes(opt.idx)
              const isCorrectOpt = result?.correctOptions?.includes(opt.idx)
              return (
                <label
                  key={opt.idx}
                  className={cn(
                    'flex cursor-pointer items-start gap-3 rounded-xl border px-4 py-3 text-sm transition-colors',
                    !result && 'hover:border-primary/50 hover:bg-primary/[0.04]',
                    result && isCorrectOpt && 'border-emerald-400/50 bg-emerald-400/[0.08]',
                    result && isSelected && !isCorrectOpt && 'border-rose-400/50 bg-rose-400/[0.08]',
                    !result && isSelected && 'border-primary/60 bg-primary/[0.07]',
                    result && !isSelected && !isCorrectOpt && 'opacity-60'
                  )}
                >
                  <RadioGroupItem value={String(opt.idx)} id={`${question.id}-opt-${opt.idx}`}
                    className={cn('mt-0.5', result && isCorrectOpt && 'border-emerald-400 text-emerald-400')} />
                  <span className="font-semibold text-muted-foreground">{OPTION_LABELS[opt.idx]}.</span>
                  <span className="min-w-0 flex-1 leading-relaxed"><MathText text={opt.text} /></span>
                  {result && isCorrectOpt && <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" />}
                  {result && isSelected && !isCorrectOpt && <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-rose-400" />}
                </label>
              )
            })}
          </RadioGroup>
        )}

        {question.type === 'mcq_multi' && (
          <div className="mt-5 space-y-2.5">
            <p className="text-xs text-muted-foreground">{TYPE_META.mcq_multi.hint} — select all that apply</p>
            {question.options.map((opt) => {
              const isSelected = selected.includes(opt.idx)
              const isCorrectOpt = result?.correctOptions?.includes(opt.idx)
              return (
                <label
                  key={opt.idx}
                  className={cn(
                    'flex cursor-pointer items-start gap-3 rounded-xl border px-4 py-3 text-sm transition-colors',
                    !result && 'hover:border-primary/50 hover:bg-primary/[0.04]',
                    result && isCorrectOpt && 'border-emerald-400/50 bg-emerald-400/[0.08]',
                    result && isSelected && !isCorrectOpt && 'border-rose-400/50 bg-rose-400/[0.08]',
                    !result && isSelected && 'border-primary/60 bg-primary/[0.07]',
                    result && !isSelected && !isCorrectOpt && 'opacity-60'
                  )}
                >
                  <Checkbox
                    checked={isSelected}
                    onCheckedChange={(c) => !result && setSelected((s) => (c ? [...s, opt.idx].sort((a, b) => a - b) : s.filter((i) => i !== opt.idx)))}
                    id={`${question.id}-opt-${opt.idx}`}
                    className="mt-0.5"
                    disabled={!!result}
                  />
                  <span className="font-semibold text-muted-foreground">{OPTION_LABELS[opt.idx]}.</span>
                  <span className="min-w-0 flex-1 leading-relaxed"><MathText text={opt.text} /></span>
                  {result && isCorrectOpt && <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" />}
                  {result && isSelected && !isCorrectOpt && <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-rose-400" />}
                </label>
              )
            })}
          </div>
        )}

        {question.type === 'numerical' && (
          <div className="mt-5">
            <Label htmlFor={`${question.id}-num`} className="text-sm text-muted-foreground">Your answer (numerical value)</Label>
            <div className="mt-2 flex items-center gap-3">
              <Input
                id={`${question.id}-num`}
                type="text"
                inputMode="decimal"
                placeholder="e.g. 12.5"
                value={numerical}
                onChange={(e) => setNumerical(e.target.value)}
                disabled={!!result}
                className="max-w-[220px] font-mono text-base"
                onKeyDown={(e) => e.key === 'Enter' && submit()}
              />
              {result && (
                <span className={cn('flex items-center gap-1.5 text-sm font-semibold', result.isCorrect ? 'text-emerald-400' : 'text-rose-400')}>
                  {result.isCorrect ? <CheckCircle2 className="h-4 w-4" /> : <XCircle className="h-4 w-4" />}
                  {result.isCorrect ? 'Correct' : 'Incorrect'}
                </span>
              )}
            </div>
            {result && !result.isCorrect && result.numericalAnswer !== undefined && (
              <p className="mt-2 text-sm">
                <span className="text-muted-foreground">Correct answer: </span>
                <span className="font-semibold text-primary">{result.numericalAnswer}</span>
              </p>
            )}
          </div>
        )}

        {/* submit */}
        {!readOnly && !result && (
          <div className="mt-5 flex flex-wrap items-center gap-3">
            <Button onClick={submit} disabled={!answered || submitting} className="min-w-[160px]">
              {submitting ? 'Checking…' : 'Submit answer'}
            </Button>
            {allowReveal && (
              <Button variant="ghost" onClick={reveal} disabled={submitting} className="text-muted-foreground">
                Just show solution
              </Button>
            )}
            {isMcq && (
              <span className="hidden text-[11px] text-muted-foreground sm:inline">
                keys: <kbd className="rounded border border-border px-1">1</kbd>–<kbd className="rounded border border-border px-1">4</kbd> select · <kbd className="rounded border border-border px-1">Enter</kbd> submit
              </span>
            )}
          </div>
        )}

        {/* result banner for MCQ */}
        {result && isMcq && (
          <div className={cn(
            'mt-5 flex items-center gap-2 rounded-lg border px-4 py-2.5 text-sm font-semibold',
            result.isCorrect ? 'border-emerald-400/40 bg-emerald-400/[0.08] text-emerald-400'
              : result.isCorrect === false ? 'border-rose-400/40 bg-rose-400/[0.08] text-rose-400'
                : 'border-border bg-muted text-muted-foreground'
          )}>
            {result.isCorrect === true && <><CheckCircle2 className="h-4 w-4" /> Correct!</>}
            {result.isCorrect === false && <><XCircle className="h-4 w-4" /> Incorrect</>}
            {result.isCorrect === null && <>Skipped</>}
          </div>
        )}

        {/* solution */}
        {result?.solution && (
          <SolutionView
            solution={result.solution}
            result={result}
            questionId={question.id}
            loggedIn={loggedIn}
            onRequireAuth={onRequireAuth}
          />
        )}
      </div>

      {/* report dialog */}
      <Dialog open={reportOpen} onOpenChange={setReportOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Report this question</DialogTitle>
            <DialogDescription>
              Help us keep the bank accurate. What&apos;s wrong with question {question.publicId}?
            </DialogDescription>
          </DialogHeader>
          <Select value={reportReason} onValueChange={setReportReason}>
            <SelectTrigger><SelectValue placeholder="Select a reason" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="incorrect_answer">Incorrect answer / options</SelectItem>
              <SelectItem value="incorrect_solution">Incorrect or incomplete solution</SelectItem>
              <SelectItem value="missing_diagram">Missing diagram</SelectItem>
              <SelectItem value="typo">Typo or formatting</SelectItem>
              <SelectItem value="copyright">Copyright concern</SelectItem>
              <SelectItem value="other">Other</SelectItem>
            </SelectContent>
          </Select>
          <Textarea
            placeholder="Optional details (what exactly is wrong?)"
            value={reportDetails}
            onChange={(e) => setReportDetails(e.target.value)}
            rows={3}
          />
          <DialogFooter>
            <Button variant="ghost" onClick={() => setReportOpen(false)}>Cancel</Button>
            <Button onClick={sendReport} disabled={!reportReason}>Submit report</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
