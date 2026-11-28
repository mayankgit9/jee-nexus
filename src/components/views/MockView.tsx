'use client'

// JEE NEXUS — mock test hub: exam list, custom test builder (Part F), attempt history
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { ClipboardList, AlertTriangle, Plus, History, RotateCcw, Save, Trash2, Upload } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Checkbox } from '@/components/ui/checkbox'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Separator } from '@/components/ui/separator'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { ExamRunner, type StartResponse } from '@/components/exam/ExamRunner'
import { ResultScreen, type ResultView } from '@/components/exam/ResultScreen'
import { api, useApi, formatDuration } from '@/lib/client'
import type { SubjectKey } from '@/lib/types'
import { toast } from '@/hooks/use-toast'
import { cn } from '@/lib/utils'

interface ExamListItem {
  id: string; title: string; description: string | null; kind: string
  durationMinutes: number; questionCount: number; attemptCount: number
}
interface AttemptListItem {
  id: string; examTitle: string; kind: string; status: string
  totalMarks: number | null; maxMarks: number | null; timeSpentSeconds: number | null
  startedAt: string; submittedAt: string | null
}
interface TaxonomySubject {
  key: SubjectKey
  name: string
  chapters: { key: string; name: string; unit: string | null; questionCount: number }[]
}

// ---------- Custom Test Builder (Part F) ----------
type AttemptStateFilter = 'all' | 'unattempted' | 'incorrect' | 'bookmarked'

/** The `filters` object POSTed to /api/exam/list (and stored in saved configs). */
interface BuilderFilters {
  subjectKeys?: SubjectKey[]
  chapterKeys?: string[]
  difficulties?: string[]
  types?: string[]
  year?: number
  shift?: string
  attemptState?: AttemptStateFilter
}

/** A saved builder preset row (GET /api/exam/configs). */
interface SavedConfig {
  id: string
  name: string
  config: BuilderFilters & { totalQuestions?: number; durationMinutes?: number }
  createdAt: string
  updatedAt: string
  lastUsedAt: string | null
}

const SUBJECT_CHIPS: { key: SubjectKey; label: string }[] = [
  { key: 'physics', label: 'Physics' },
  { key: 'chemistry', label: 'Chemistry' },
  { key: 'mathematics', label: 'Mathematics' },
]
const DIFFICULTY_CHIPS = [
  { key: 'easy', label: 'Easy' },
  { key: 'medium', label: 'Medium' },
  { key: 'hard', label: 'Hard' },
]
const TYPE_CHIPS = [
  { key: 'mcq_single', label: 'Single MCQ' },
  { key: 'mcq_multi', label: 'Multi MCQ' },
  { key: 'numerical', label: 'Numerical' },
]
const ATTEMPT_STATE_CHIPS: { key: AttemptStateFilter; label: string }[] = [
  { key: 'all', label: 'All questions' },
  { key: 'unattempted', label: 'Unattempted only' },
  { key: 'incorrect', label: 'Incorrect only' },
  { key: 'bookmarked', label: 'Bookmarked only' },
]

/** Multi-select chip in the builder form (same visual language as the practice filters). */
function BuilderChip({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'rounded-lg border px-3 py-1.5 text-sm transition-colors',
        active ? 'border-primary bg-primary/15 font-semibold text-primary' : 'border-border text-muted-foreground hover:border-primary/40'
      )}
    >
      {children}
    </button>
  )
}

export function MockView({ loggedIn, onRequireAuth }: { loggedIn: boolean; onRequireAuth: () => void }) {
  const [activeAttempt, setActiveAttempt] = useState<StartResponse | null>(null)
  const [viewingResult, setViewingResult] = useState<ResultView | null>(null)
  const list = useApi<{ exams: ExamListItem[] }>('/api/exam/list')
  const history = useApi<{ attempts: AttemptListItem[] }>(loggedIn ? '/api/exam/result' : null)

  const startExam = async (examId: string) => {
    if (!loggedIn) { onRequireAuth(); return }
    try {
      const r = await api<StartResponse>('/api/exam/start', { examId })
      setActiveAttempt(r)
    } catch (e) {
      toast({ title: 'Could not start exam', description: (e as Error).message, variant: 'destructive' })
    }
  }

  const openResult = async (attemptId: string) => {
    try {
      const r = await api<ResultView>(`/api/exam/result?attemptId=${attemptId}`)
      setViewingResult(r)
    } catch (e) {
      toast({ title: 'Could not load result', description: (e as Error).message, variant: 'destructive' })
    }
  }

  if (activeAttempt) {
    return (
      <ExamRunner
        data={activeAttempt}
        onFinish={async () => {
          setActiveAttempt(null)
          list.reload()
          history.reload()
        }}
      />
    )
  }

  if (viewingResult) {
    return <ResultScreen data={viewingResult} onBack={() => setViewingResult(null)} />
  }

  return (
    <ExamListView
      list={list}
      history={history}
      loggedIn={loggedIn}
      onStart={startExam}
      onOpenResult={openResult}
      onRequireAuth={onRequireAuth}
    />
  )
}

function ExamListView({ list, history, loggedIn, onStart, onOpenResult, onRequireAuth }: {
  list: { data: { exams: ExamListItem[] } | null; loading: boolean; error: string | null; reload: () => void }
  history: { data: { attempts: AttemptListItem[] } | null; loading: boolean }
  loggedIn: boolean
  onStart: (examId: string) => void
  onOpenResult: (attemptId: string) => void
  onRequireAuth: () => void
}) {
  const [createOpen, setCreateOpen] = useState(false)
  const [ctTitle, setCtTitle] = useState('My custom test')
  const [ctSubjects, setCtSubjects] = useState<SubjectKey[]>([])
  const [ctChapters, setCtChapters] = useState<string[]>([])
  const [ctDifficulties, setCtDifficulties] = useState<string[]>([])
  const [ctTypes, setCtTypes] = useState<string[]>([])
  const [ctYear, setCtYear] = useState<number | null>(null)
  const [ctShift, setCtShift] = useState('')
  const [ctAttemptState, setCtAttemptState] = useState<AttemptStateFilter>('all')
  const [ctCount, setCtCount] = useState(10)
  const [ctMinutes, setCtMinutes] = useState(30)
  const [creating, setCreating] = useState(false)
  const [warnings, setWarnings] = useState<string[]>([])
  const [generatingFull, setGeneratingFull] = useState(false)

  // saved-configuration actions
  const [saveName, setSaveName] = useState('')
  const [showSaveInput, setShowSaveInput] = useState(false)
  const [savingConfig, setSavingConfig] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  // builder reference data — loaded only while the dialog is open
  const taxonomyApi = useApi<{ subjects: TaxonomySubject[] }>(createOpen ? '/api/taxonomy' : null)
  const yearsApi = useApi<{ years: { year: number; total: number }[] }>(createOpen ? '/api/pyq' : null)
  const configsApi = useApi<{ configs: SavedConfig[] }>(createOpen && loggedIn ? '/api/exam/configs' : null)

  const taxonomy = taxonomyApi.data?.subjects ?? null
  const years = useMemo(
    () => [...(yearsApi.data?.years ?? [])].sort((a, b) => b.year - a.year).map((y) => y.year),
    [yearsApi.data]
  )
  const configs = configsApi.data?.configs ?? []

  // chapters visible in the picker — filtered by the chosen subjects
  const availableChapters = useMemo(() => {
    if (!taxonomy) return []
    const subs = ctSubjects.length ? taxonomy.filter((s) => ctSubjects.includes(s.key)) : taxonomy
    return subs.flatMap((s) => s.chapters.filter((c) => c.questionCount > 0))
  }, [taxonomy, ctSubjects])

  // keep selected chapters inside the visible set when subjects change
  useEffect(() => {
    if (!taxonomy) return
    const valid = new Set(availableChapters.map((c) => c.key))
    setCtChapters((cs) => (cs.every((c) => valid.has(c)) ? cs : cs.filter((c) => valid.has(c))))
  }, [taxonomy, availableChapters])

  const exams = list.data?.exams ?? []
  const hasDefault = exams.some((e) => e.kind === 'full_length')
  const allSubjects = ctSubjects.length === 0 || ctSubjects.length === SUBJECT_CHIPS.length

  const toggleSubject = (k: SubjectKey) =>
    setCtSubjects((ss) => (ss.includes(k) ? ss.filter((x) => x !== k) : [...ss, k]))
  const toggleIn = (arr: string[], set: (v: string[]) => void, v: string) =>
    set(arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v])

  /** The filters object sent to /api/exam/list (and persisted in saved configs). */
  const buildFilters = (): BuilderFilters => ({
    ...(ctSubjects.length > 0 && ctSubjects.length < SUBJECT_CHIPS.length ? { subjectKeys: ctSubjects } : {}),
    ...(ctChapters.length ? { chapterKeys: ctChapters } : {}),
    ...(ctDifficulties.length ? { difficulties: ctDifficulties } : {}),
    ...(ctTypes.length ? { types: ctTypes } : {}),
    ...(ctYear ? { year: ctYear } : {}),
    ...(ctShift.trim() ? { shift: ctShift.trim() } : {}),
    ...(ctAttemptState !== 'all' ? { attemptState: ctAttemptState } : {}),
  })

  const generateFullLength = async () => {
    if (!loggedIn) { onRequireAuth(); return }
    setGeneratingFull(true)
    try {
      const r = await api<{ examId: string; warnings: string[] }>('/api/exam/list', {
        title: 'JEE Main Full-Length Mock',
        kind: 'full_length',
      })
      list.reload()
      toast({
        title: 'Full-length mock created',
        description: r.warnings.length ? r.warnings.join(' ') : '75 questions · 180 minutes, straight from the PYQ bank.',
      })
    } catch (e) {
      toast({ title: 'Could not create mock', description: (e as Error).message, variant: 'destructive' })
    } finally {
      setGeneratingFull(false)
    }
  }

  const createCustom = async () => {
    setCreating(true)
    setWarnings([])
    try {
      const r = await api<{ examId: string; warnings: string[] }>('/api/exam/list', {
        title: ctTitle,
        kind: 'custom',
        durationMinutes: ctMinutes,
        totalQuestions: ctCount,
        filters: buildFilters(),
      })
      setCreateOpen(false)
      if (r.warnings.length) {
        setWarnings(r.warnings)
        toast({ title: 'Test generated with warnings', description: r.warnings.join(' ') })
      }
      list.reload()
      onStart(r.examId)
    } catch (e) {
      toast({ title: 'Generation failed', description: (e as Error).message, variant: 'destructive' })
    } finally {
      setCreating(false)
    }
  }

  const saveConfig = async () => {
    const name = saveName.trim()
    if (!name) return
    setSavingConfig(true)
    try {
      await api('/api/exam/configs', {
        name,
        config: { ...buildFilters(), totalQuestions: ctCount, durationMinutes: ctMinutes },
      })
      toast({ title: 'Configuration saved', description: `Load "${name}" any time from the saved list.` })
      setSaveName('')
      setShowSaveInput(false)
      configsApi.reload()
    } catch (e) {
      toast({ title: 'Could not save configuration', description: (e as Error).message, variant: 'destructive' })
    } finally {
      setSavingConfig(false)
    }
  }

  const loadConfig = (c: SavedConfig) => {
    const cfg = c.config ?? {}
    setCtSubjects((cfg.subjectKeys ?? []).filter((s) => SUBJECT_CHIPS.some((x) => x.key === s)))
    setCtChapters(cfg.chapterKeys ?? [])
    setCtDifficulties((cfg.difficulties ?? []).filter((d) => DIFFICULTY_CHIPS.some((x) => x.key === d)))
    setCtTypes((cfg.types ?? []).filter((t) => TYPE_CHIPS.some((x) => x.key === t)))
    setCtYear(typeof cfg.year === 'number' ? cfg.year : null)
    setCtShift(cfg.shift ?? '')
    setCtAttemptState(ATTEMPT_STATE_CHIPS.some((s) => s.key === cfg.attemptState) ? (cfg.attemptState as AttemptStateFilter) : 'all')
    setCtCount(Math.min(Math.max(cfg.totalQuestions ?? 10, 1), 90))
    setCtMinutes(Math.min(Math.max(cfg.durationMinutes ?? 30, 5), 240))
    toast({ title: `Loaded "${c.name}"`, description: 'Tweak anything, then generate & start.' })
    // bump the preset's last-used timestamp (fire and forget)
    api('/api/exam/configs', { id: c.id, config: cfg }, 'PATCH')
      .then(() => configsApi.reload())
      .catch(() => {})
  }

  const deleteConfig = async (c: SavedConfig) => {
    setDeletingId(c.id)
    try {
      await api(`/api/exam/configs?id=${encodeURIComponent(c.id)}`, undefined, 'DELETE')
      configsApi.reload()
    } catch (e) {
      toast({ title: 'Could not delete configuration', description: (e as Error).message, variant: 'destructive' })
    } finally {
      setDeletingId(null)
    }
  }

  return (
    <div className="mx-auto max-w-4xl">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2.5 text-2xl font-bold tracking-tight">
            <ClipboardList className="h-6 w-6 text-primary" /> Mock Tests
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            NTA-style computer based tests — question palette, mark for review, server-authoritative timer with auto-submit.
          </p>
        </div>
        <Button onClick={() => (loggedIn ? setCreateOpen(true) : onRequireAuth())}>
          <Plus className="mr-2 h-4 w-4" /> Create custom test
        </Button>
      </div>

      {warnings.length > 0 && (
        <div className="mb-4 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-300">
          {warnings.map((w, i) => <p key={i}><AlertTriangle className="mr-1.5 inline h-3.5 w-3.5" />{w}</p>)}
        </div>
      )}

      {list.loading && <div className="space-y-3"><Skeleton className="h-28" /><Skeleton className="h-28" /></div>}
      {list.error && <p className="text-sm text-rose-400">{list.error}</p>}

      {list.data && (
        <div className="space-y-3">
          {!hasDefault && (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-dashed border-border p-4">
              <p className="min-w-0 flex-1 text-sm text-muted-foreground">
                No full-length mock yet — generate one from the live PYQ bank (fresh question mix every time you create a new one).
              </p>
              <Button variant="outline" onClick={generateFullLength} disabled={generatingFull}>
                {generatingFull ? 'Generating…' : 'Generate full-length mock'}
              </Button>
            </div>
          )}
          {exams.map((e) => (
            <Card key={e.id} className="transition-colors hover:border-primary/40">
              <CardContent className="flex flex-wrap items-center justify-between gap-4 p-5">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="font-semibold">{e.title}</h3>
                    <Badge variant="outline" className="capitalize">{e.kind.replace('_', ' ')}</Badge>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {e.questionCount} questions · {e.durationMinutes} minutes · +4/−1 marking
                  </p>
                  {e.description && <p className="mt-1 line-clamp-1 text-xs text-muted-foreground/70">{e.description}</p>}
                </div>
                <Button onClick={() => onStart(e.id)}>
                  <RotateCcw className="mr-2 h-4 w-4" /> {e.attemptCount > 0 ? 'Re-attempt' : 'Start test'}
                </Button>
              </CardContent>
            </Card>
          ))}
          {exams.length === 0 && (
            <p className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
              No exams yet — create your first custom test.
            </p>
          )}
        </div>
      )}

      {loggedIn && (
        <div className="mt-8">
          <h2 className="flex items-center gap-2 text-lg font-semibold"><History className="h-5 w-5 text-primary" /> Attempt history</h2>
          {history.loading && <div className="mt-3 space-y-2"><Skeleton className="h-14" /><Skeleton className="h-14" /></div>}
          {history.data && history.data.attempts.length === 0 && (
            <p className="mt-3 text-sm text-muted-foreground">No exam attempts yet.</p>
          )}
          {history.data && history.data.attempts.length > 0 && (
            <div className="mt-3 space-y-2">
              {history.data.attempts.map((a) => (
                <button
                  key={a.id}
                  type="button"
                  onClick={() => a.status !== 'in_progress' && onOpenResult(a.id)}
                  className="flex w-full flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-card px-4 py-3 text-left text-sm transition-colors hover:border-primary/40"
                >
                  <div className="min-w-0">
                    <div className="font-medium">{a.examTitle}</div>
                    <div className="text-xs text-muted-foreground">
                      {new Date(a.startedAt).toLocaleString()} · {a.status === 'in_progress' ? 'in progress' : formatDuration(a.timeSpentSeconds ?? 0)}
                    </div>
                  </div>
                  {a.status !== 'in_progress' ? (
                    <div className="text-right">
                      <div className="font-bold">{a.totalMarks ?? 0} / {a.maxMarks ?? 0}</div>
                      <div className="text-[11px] text-muted-foreground">view result →</div>
                    </div>
                  ) : (
                    <Badge variant="outline" className={cn('text-amber-400')}>resume from list below</Badge>
                  )}
                </button>
              ))}
            </div>
          )}
          {history.data && history.data.attempts.some((a) => a.status === 'in_progress') && (
            <p className="mt-3 text-xs text-muted-foreground">
              To resume an in-progress test, press its exam&apos;s Start button — saved answers are restored automatically.
            </p>
          )}
        </div>
      )}

      {/* custom test builder dialog (Part F) */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>Create a custom test</DialogTitle>
            <DialogDescription>
              Generated instantly from the verified question bank — mix subjects, chapters, years, difficulty and more.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="ct-title">Title</Label>
              <Input id="ct-title" value={ctTitle} onChange={(e) => setCtTitle(e.target.value)} />
            </div>

            <div>
              <Label className="mb-2 block">Subjects</Label>
              <div className="flex flex-wrap gap-2">
                <BuilderChip active={allSubjects} onClick={() => setCtSubjects([])}>All subjects</BuilderChip>
                {SUBJECT_CHIPS.map((s) => (
                  <BuilderChip key={s.key} active={ctSubjects.includes(s.key)} onClick={() => toggleSubject(s.key)}>
                    {s.label}
                  </BuilderChip>
                ))}
              </div>
              <p className="mt-1.5 text-xs text-muted-foreground">
                {allSubjects
                  ? 'Mixed test across all three subjects.'
                  : `Mixed test across ${ctSubjects.length} subject${ctSubjects.length > 1 ? 's' : ''}.`}
              </p>
            </div>

            <div>
              <div className="flex items-center justify-between">
                <Label className="mb-2 block">
                  Chapters <span className="font-normal text-muted-foreground">(optional — leave empty for all)</span>
                </Label>
                {ctChapters.length > 0 && (
                  <Button variant="ghost" size="sm" className="h-7" onClick={() => setCtChapters([])}>Clear</Button>
                )}
              </div>
              {taxonomyApi.loading && <Skeleton className="h-24 w-full" />}
              {taxonomyApi.error && <p className="text-sm text-rose-400">{taxonomyApi.error}</p>}
              {taxonomy && availableChapters.length === 0 && (
                <p className="text-sm text-muted-foreground">No chapters with questions for the selected subjects.</p>
              )}
              {taxonomy && availableChapters.length > 0 && (
                <ScrollArea className="max-h-44 rounded-lg border border-border p-3">
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    {availableChapters.map((c) => (
                      <label key={c.key} className="flex cursor-pointer items-start gap-2 text-sm">
                        <Checkbox
                          checked={ctChapters.includes(c.key)}
                          onCheckedChange={(v) =>
                            setCtChapters((cs) => (v ? [...cs, c.key] : cs.filter((k) => k !== c.key)))
                          }
                          className="mt-0.5"
                        />
                        <span className="leading-tight">
                          {c.name}
                          <span className="ml-1 text-xs text-muted-foreground">({c.questionCount})</span>
                        </span>
                      </label>
                    ))}
                  </div>
                </ScrollArea>
              )}
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <Label className="mb-2 block">Difficulty <span className="font-normal text-muted-foreground">(optional)</span></Label>
                <div className="flex flex-wrap gap-2">
                  {DIFFICULTY_CHIPS.map((d) => (
                    <BuilderChip key={d.key} active={ctDifficulties.includes(d.key)} onClick={() => toggleIn(ctDifficulties, setCtDifficulties, d.key)}>
                      {d.label}
                    </BuilderChip>
                  ))}
                </div>
              </div>
              <div>
                <Label className="mb-2 block">Question type <span className="font-normal text-muted-foreground">(optional)</span></Label>
                <div className="flex flex-wrap gap-2">
                  {TYPE_CHIPS.map((t) => (
                    <BuilderChip key={t.key} active={ctTypes.includes(t.key)} onClick={() => toggleIn(ctTypes, setCtTypes, t.key)}>
                      {t.label}
                    </BuilderChip>
                  ))}
                </div>
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <Label className="mb-2 block">Year</Label>
                <div className="flex flex-wrap gap-2">
                  <BuilderChip active={ctYear === null} onClick={() => setCtYear(null)}>Any</BuilderChip>
                  {years.map((y) => (
                    <BuilderChip key={y} active={ctYear === y} onClick={() => setCtYear(ctYear === y ? null : y)}>
                      {y}
                    </BuilderChip>
                  ))}
                  {yearsApi.loading && years.length === 0 && (
                    <span className="text-sm text-muted-foreground">Loading years…</span>
                  )}
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="ct-shift">Shift <span className="font-normal text-muted-foreground">(optional)</span></Label>
                <Input
                  id="ct-shift"
                  placeholder="e.g. Shift 1"
                  value={ctShift}
                  onChange={(e) => setCtShift(e.target.value)}
                />
              </div>
            </div>

            <div>
              <Label className="mb-2 block">Question pool</Label>
              <div className="flex flex-wrap gap-2">
                {ATTEMPT_STATE_CHIPS.map((s) => (
                  <BuilderChip key={s.key} active={ctAttemptState === s.key} onClick={() => setCtAttemptState(s.key)}>
                    {s.label}
                  </BuilderChip>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="ct-count">Total questions (1–90)</Label>
                <Input id="ct-count" type="number" min={1} max={90} value={ctCount} onChange={(e) => setCtCount(Number(e.target.value))} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="ct-min">Duration (5–240 min)</Label>
                <Input id="ct-min" type="number" min={5} max={240} value={ctMinutes} onChange={(e) => setCtMinutes(Number(e.target.value))} />
              </div>
            </div>

            <Separator />

            {!showSaveInput ? (
              <Button variant="outline" size="sm" onClick={() => (loggedIn ? setShowSaveInput(true) : onRequireAuth())}>
                <Save className="mr-2 h-4 w-4" /> Save this configuration
              </Button>
            ) : (
              <div className="space-y-2">
                <Label htmlFor="ct-save-name">Configuration name</Label>
                <div className="flex flex-wrap gap-2">
                  <Input
                    id="ct-save-name"
                    placeholder="e.g. Weak chapters drill"
                    value={saveName}
                    onChange={(e) => setSaveName(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && saveConfig()}
                  />
                  <Button size="sm" onClick={saveConfig} disabled={savingConfig || !saveName.trim()}>
                    {savingConfig ? 'Saving…' : 'Save'}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => { setShowSaveInput(false); setSaveName('') }}>
                    Cancel
                  </Button>
                </div>
              </div>
            )}

            {loggedIn && (
              <div>
                <Label className="mb-2 block">Saved configurations</Label>
                {configsApi.loading && <Skeleton className="h-16 w-full" />}
                {configsApi.error && <p className="text-sm text-rose-400">{configsApi.error}</p>}
                {!configsApi.loading && !configsApi.error && configs.length === 0 && (
                  <p className="text-sm text-muted-foreground">
                    No saved configurations yet — save one to rebuild the same test any time.
                  </p>
                )}
                {configs.length > 0 && (
                  <div className="space-y-2">
                    {configs.map((c) => (
                      <div key={c.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border px-3 py-2">
                        <div className="min-w-0">
                          <div className="truncate text-sm font-medium">{c.name}</div>
                          <div className="text-xs text-muted-foreground">
                            {c.config.totalQuestions ?? '—'} questions · {c.config.durationMinutes ?? '—'} min · updated {new Date(c.updatedAt).toLocaleDateString()}
                          </div>
                        </div>
                        <div className="flex shrink-0 gap-1.5">
                          <Button variant="outline" size="sm" className="h-8" onClick={() => loadConfig(c)}>
                            <Upload className="mr-1.5 h-3.5 w-3.5" /> Load
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-8 text-rose-400 hover:text-rose-300"
                            onClick={() => deleteConfig(c)}
                            disabled={deletingId === c.id}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setCreateOpen(false)}>Cancel</Button>
            <Button
              onClick={createCustom}
              disabled={creating || ctCount < 1 || ctCount > 90 || ctMinutes < 5 || ctMinutes > 240}
            >
              {creating ? 'Generating…' : 'Generate & start'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
