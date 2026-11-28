'use client'

// JEE NEXUS — admin dashboard: bank overview, import, question management, reports
import { useEffect, useRef, useState } from 'react'
import {
  ShieldCheck, Upload, ListChecks, Flag, BarChart3, Search, CheckCircle2, XCircle,
  AlertTriangle, FileJson, Loader2, ClipboardCheck, Image as ImageIcon, Sparkles,
  BadgeCheck, Cpu, Pencil, Save, RotateCcw, Eye, EyeOff, ImagePlus, ScanSearch, History,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Separator } from '@/components/ui/separator'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Checkbox } from '@/components/ui/checkbox'
import { MathText } from '@/components/MathText'
import { api, useApi, SUBJECT_COLORS } from '@/lib/client'
import { toast } from '@/hooks/use-toast'
import { cn } from '@/lib/utils'

interface AdminStats {
  pipeline: Record<string, number>
  subjects: { key: string; count: number }[]
  years: { year: number | null; count: number }[]
  totals: {
    questions: number; solutions: number; images: number; users: number
    practiceAttempts: number; examAttempts: number; openReports: number; bookmarks: number
  }
  importJobs: { id: string; fileName: string; total: number; inserted: number; duplicates: number; rejected: number; status: string; createdAt: string }[]
}
interface AdminQuestion {
  id: string; publicId: string; subject: string; chapter: string; type: string
  fullText: string; options: { idx: number; text: string; isCorrect: boolean }[]
  correctOptions: number[] | null; numericalAnswer: string | null
  difficulty: string; sourceYear: number | null; verificationStatus: string
  hasSolution: boolean; openReports: number
}
interface ReportItem {
  id: string; reason: string; details: string | null; createdAt: string; reporter: string
  question: { publicId: string; text: string; subject: string; verificationStatus: string }
}

const STATUS_STYLE: Record<string, string> = {
  imported: 'border-border bg-muted text-muted-foreground',
  needs_review: 'border-amber-500/40 bg-amber-500/10 text-amber-400',
  verified: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-400',
  rejected: 'border-rose-500/40 bg-rose-500/10 text-rose-400',
}

export function AdminView({ isAdmin }: { isAdmin: boolean }) {
  const [tab, setTab] = useState<'overview' | 'import' | 'questions' | 'reports' | 'solutions' | 'images'>('overview')

  if (!isAdmin) {
    return (
      <div className="mx-auto max-w-lg rounded-2xl border border-dashed border-border p-10 text-center">
        <ShieldCheck className="mx-auto h-10 w-10 text-muted-foreground" />
        <h2 className="mt-4 text-lg font-semibold">Administrator access required</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          This area is restricted. Admin role is assigned server-side — the first registered account
          or a whitelisted ADMIN_EMAILS entry.
        </p>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-5xl">
      <h1 className="flex items-center gap-2.5 text-2xl font-bold tracking-tight">
        <ShieldCheck className="h-6 w-6 text-primary" /> Admin Dashboard
      </h1>
      <div className="mt-5 flex flex-wrap gap-2">
        {[
          { k: 'overview', label: 'Overview', icon: BarChart3 },
          { k: 'import', label: 'Import', icon: Upload },
          { k: 'questions', label: 'Questions', icon: ListChecks },
          { k: 'reports', label: 'Reports', icon: Flag },
          { k: 'solutions', label: 'Solutions review', icon: ClipboardCheck },
          { k: 'images', label: 'Image manager', icon: ImageIcon },
        ].map((t) => (
          <button key={t.k} type="button" onClick={() => setTab(t.k as typeof tab)}
            className={cn('flex items-center gap-1.5 rounded-lg border px-4 py-2 text-sm font-medium',
              tab === t.k ? 'border-primary bg-primary/15 text-primary' : 'border-border hover:border-primary/40')}>
            <t.icon className="h-4 w-4" /> {t.label}
          </button>
        ))}
      </div>
      <div className="mt-6">
        {tab === 'overview' && <OverviewTab />}
        {tab === 'import' && <ImportTab />}
        {tab === 'questions' && <QuestionsTab />}
        {tab === 'reports' && <ReportsTab />}
        {tab === 'solutions' && <SolutionsTab />}
        {tab === 'images' && <ImagesTab />}
      </div>
    </div>
  )
}

function OverviewTab() {
  const { data, loading, error } = useApi<AdminStats>('/api/admin/stats')
  const sol = useApi<{ total: number; thin: number; detailed: number }>('/api/solutions/enrich')
  if (loading) return <div className="space-y-3"><Skeleton className="h-24" /><Skeleton className="h-40" /></div>
  if (error) return <p className="text-sm text-rose-400">{error}</p>
  if (!data) return null

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          { label: 'Questions', value: data.totals.questions },
          { label: 'Solutions', value: data.totals.solutions },
          { label: 'Users', value: data.totals.users },
          { label: 'Open reports', value: data.totals.openReports },
          { label: 'Practice attempts', value: data.totals.practiceAttempts },
          { label: 'Exam attempts', value: data.totals.examAttempts },
          { label: 'Bookmarks', value: data.totals.bookmarks },
          { label: 'Diagrams', value: data.totals.images },
        ].map((s) => (
          <Card key={s.label}><CardContent className="p-4">
            <div className="text-2xl font-bold">{s.value}</div>
            <div className="text-xs text-muted-foreground">{s.label}</div>
          </CardContent></Card>
        ))}
      </div>

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm">Solution quality (web-grounded enrichment)</CardTitle></CardHeader>
        <CardContent>
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <span className="rounded-lg border border-emerald-400/30 bg-emerald-400/10 px-3 py-1.5 text-emerald-300">
              Detailed: <b>{sol.data?.detailed ?? '…'}</b>
            </span>
            <span className="rounded-lg border border-amber-400/30 bg-amber-400/10 px-3 py-1.5 text-amber-300">
              Thin (batch/JIT pending): <b>{sol.data?.thin ?? '…'}</b>
            </span>
            <span className="text-xs text-muted-foreground">
              Students can also tap “Generate detailed solution” on any question — enrichment runs live from web research.
            </span>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm">Verification pipeline</CardTitle></CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-2">
            {['imported', 'needs_review', 'verified', 'rejected'].map((s) => (
              <span key={s} className={cn('rounded-lg border px-3 py-1.5 text-sm capitalize', STATUS_STYLE[s])}>
                {s.replace('_', ' ')}: <b>{data.pipeline[s] ?? 0}</b>
              </span>
            ))}
          </div>
          <Separator className="my-4" />
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">By subject</p>
              {data.subjects.map((s) => (
                <div key={s.key} className="flex items-center justify-between text-sm">
                  <span className="capitalize" style={{ color: SUBJECT_COLORS[s.key] }}>{s.key}</span>
                  <span className="font-semibold">{s.count}</span>
                </div>
              ))}
            </div>
            <div>
              <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">By year</p>
              <div className="flex flex-wrap gap-1.5">
                {data.years.map((y) => (
                  <Badge key={y.year} variant="outline">{y.year}: {y.count}</Badge>
                ))}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm">Recent import jobs</CardTitle></CardHeader>
        <CardContent>
          {data.importJobs.length === 0 ? (
            <p className="text-sm text-muted-foreground">No imports yet.</p>
          ) : (
            <div className="space-y-1.5">
              {data.importJobs.map((j) => (
                <div key={j.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border/60 px-3 py-2 text-sm">
                  <span className="flex items-center gap-2"><FileJson className="h-3.5 w-3.5 text-primary" />{j.fileName}</span>
                  <span className="text-xs text-muted-foreground">
                    {j.inserted} inserted · {j.duplicates} duplicates · {j.rejected} rejected · of {j.total}
                  </span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

function ImportTab() {
  const [json, setJson] = useState('')
  const [busy, setBusy] = useState(false)
  const [importProgress, setImportProgress] = useState<{ done: number; total: number } | null>(null)
  const [result, setResult] = useState<{ inserted: number; skippedDuplicate: number; rejected: number; total: number; errors: { row: number; error: string }[] } | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const loadFile = (f: File) => {
    const reader = new FileReader()
    reader.onload = () => setJson(String(reader.result ?? ''))
    reader.readAsText(f)
  }

  const runImport = async () => {
    setBusy(true)
    setResult(null)
    try {
      let questions: unknown
      try {
        const parsed = JSON.parse(json)
        questions = Array.isArray(parsed) ? parsed : parsed.questions
      } catch {
        throw new Error('Invalid JSON — paste a question array or {"questions": [...]}')
      }
      if (!Array.isArray(questions) || questions.length === 0) {
        throw new Error('No questions found in the JSON')
      }
      // Chunked import: one request per 100 questions keeps each Worker
      // invocation well inside runtime limits (a 500-question single batch
      // would run minutes of sequential inserts) and shows live progress.
      const CHUNK = 100
      const all = questions as unknown[]
      const chunks: unknown[][] = []
      for (let i = 0; i < all.length; i += CHUNK) chunks.push(all.slice(i, i + CHUNK))

      const acc = { inserted: 0, skippedDuplicate: 0, rejected: 0, total: all.length, errors: [] as { row: number; error: string }[] }
      for (let c = 0; c < chunks.length; c++) {
        setImportProgress({ done: c * CHUNK, total: all.length })
        const r = await api<typeof acc & { jobId: string }>('/api/admin/import', {
          questions: chunks[c],
          fileName: `admin-dashboard-${c + 1}-${chunks.length}.json`,
        })
        acc.inserted += r.inserted
        acc.skippedDuplicate += r.skippedDuplicate
        acc.rejected += r.rejected
        acc.errors.push(...r.errors.slice(0, 10))
      }
      setImportProgress(null)
      setResult(acc)
      toast({
        title: `Imported ${acc.inserted}/${acc.total}`,
        description: `${acc.skippedDuplicate} duplicates skipped, ${acc.rejected} rejected`,
      })
    } catch (e) {
      toast({ title: 'Import failed', description: (e as Error).message, variant: 'destructive' })
      setImportProgress(null)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-sm"><Upload className="h-4 w-4 text-primary" /> Bulk import questions</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Paste a JSON array of questions (or upload a .json file). Every row is validated
            (subject/chapter keys, options, answers, solution minimums), deduplicated by normalized
            content hash, and inserted with status <b>imported</b> — never auto-verified.
          </p>
          <input ref={fileRef} type="file" accept=".json" className="hidden"
            onChange={(e) => e.target.files?.[0] && loadFile(e.target.files[0])} />
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" onClick={() => fileRef.current?.click()}>Upload .json file</Button>
            <Button variant="ghost" size="sm" onClick={() => setJson(EXAMPLE_IMPORT)}>Load example</Button>
          </div>
          <Textarea value={json} onChange={(e) => setJson(e.target.value)} rows={10}
            placeholder='[{"publicId":"...","subjectKey":"physics","chapterKey":"physics:kinematics","type":"mcq_single","text":"...","options":["..."],"correctOptions":[0],"difficulty":"easy","solution":{"body":"...","keyConcept":"..."}}]'
            className="font-mono text-xs" />
          <Button onClick={runImport} disabled={busy || !json.trim()}>
            {busy
              ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> {importProgress ? `Importing ${importProgress.done}/${importProgress.total}…` : 'Importing…'}</>
              : 'Validate & import'}
          </Button>

          {result && (
            <div className="rounded-xl border border-border p-4 text-sm">
              <div className="flex flex-wrap gap-4">
                <span><CheckCircle2 className="mr-1 inline h-4 w-4 text-emerald-400" /><b>{result.inserted}</b> inserted</span>
                <span><AlertTriangle className="mr-1 inline h-4 w-4 text-amber-400" /><b>{result.skippedDuplicate}</b> duplicates skipped</span>
                <span><XCircle className="mr-1 inline h-4 w-4 text-rose-400" /><b>{result.rejected}</b> rejected</span>
                <span className="text-muted-foreground">of {result.total} rows</span>
              </div>
              {result.errors.length > 0 && (
                <ScrollArea className="mt-3 max-h-40">
                  <div className="space-y-1">
                    {result.errors.map((e, i) => (
                      <p key={i} className="text-xs text-rose-400">Row {e.row}: {e.error}</p>
                    ))}
                  </div>
                </ScrollArea>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

const EXAMPLE_IMPORT = JSON.stringify([
  {
    publicId: 'JEM-2024-PHY-099',
    subjectKey: 'physics',
    chapterKey: 'physics:oscillations',
    subtopic: 'Simple pendulum',
    type: 'mcq_single',
    text: 'The time period of a simple pendulum measured inside a lift accelerating upwards with acceleration $a$ is:',
    options: [
      '$2\\pi\\sqrt{\\dfrac{l}{g}}$',
      '$2\\pi\\sqrt{\\dfrac{l}{g+a}}$',
      '$2\\pi\\sqrt{\\dfrac{l}{g-a}}$',
      '$2\\pi\\sqrt{\\dfrac{l}{a}}$',
    ],
    correctOptions: [1],
    difficulty: 'easy',
    sourceYear: 2024,
    solution: {
      keyConcept: 'In a non-inertial frame accelerating up, effective gravity increases: $g_{eff} = g + a$.',
      body: '**Step 1.** Effective gravity inside the lift: $g_{eff}=g+a$.\n\n**Step 2.** Time period: $T=2\\pi\\sqrt{l/g_{eff}}=2\\pi\\sqrt{\\dfrac{l}{g+a}}$.',
      commonMistakes: 'Using $g-a$ (confusing upward acceleration with free fall).',
    },
  },
], null, 2)

function QuestionsTab() {
  const [page, setPage] = useState(1)
  const [status, setStatus] = useState('all')
  const [search, setSearch] = useState('')
  const [searchInput, setSearchInput] = useState('')
  const query = `/api/admin/questions?page=${page}&status=${status}${search ? `&search=${encodeURIComponent(search)}` : ''}`
  const { data, loading, error, reload } = useApi<{
    total: number; page: number; pageCount: number; questions: AdminQuestion[]
  }>(query, [page, status, search])
  const [expanded, setExpanded] = useState<string | null>(null)

  const setStatusFor = async (id: string, newStatus: string) => {
    try {
      await api('/api/admin/questions', { id, verificationStatus: newStatus }, 'PATCH')
      toast({ title: `Marked ${newStatus.replace('_', ' ')}` })
      reload()
    } catch (e) {
      toast({ title: 'Failed', description: (e as Error).message, variant: 'destructive' })
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[220px] flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={searchInput} onChange={(e) => setSearchInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && (setSearch(searchInput), setPage(1))}
            placeholder="Search text or publicId…" className="pl-9" />
        </div>
        <Select value={status} onValueChange={(v) => { setStatus(v); setPage(1) }}>
          <SelectTrigger className="w-[170px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            <SelectItem value="imported">Imported</SelectItem>
            <SelectItem value="needs_review">Needs review</SelectItem>
            <SelectItem value="verified">Verified</SelectItem>
            <SelectItem value="rejected">Rejected</SelectItem>
          </SelectContent>
        </Select>
        <Button size="sm" onClick={() => { setSearch(searchInput); setPage(1) }}>Search</Button>
      </div>

      {loading && <div className="space-y-2"><Skeleton className="h-16" /><Skeleton className="h-16" /><Skeleton className="h-16" /></div>}
      {error && <p className="text-sm text-rose-400">{error}</p>}

      {data && (
        <>
          <p className="text-xs text-muted-foreground">{data.total} questions · page {data.page}/{data.pageCount}</p>
          <div className="space-y-2">
            {data.questions.map((q) => (
              <Card key={q.id}>
                <CardContent className="p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
                    <span className="flex items-center gap-2">
                      <span className="font-mono">{q.publicId}</span>
                      <span style={{ color: SUBJECT_COLORS[q.subject] }} className="capitalize">{q.subject}</span>
                      <span>· {q.chapter}</span>
                      <span>· {q.type.replace('_', ' ')}</span>
                    </span>
                    <span className="flex items-center gap-1.5">
                      {q.openReports > 0 && <Badge variant="outline" className="border-amber-500/40 text-amber-400">{q.openReports} reports</Badge>}
                      {!q.hasSolution && <Badge variant="outline" className="border-rose-500/40 text-rose-400">no solution</Badge>}
                      <Badge variant="outline" className={cn('capitalize', STATUS_STYLE[q.verificationStatus])}>
                        {q.verificationStatus.replace('_', ' ')}
                      </Badge>
                    </span>
                  </div>
                  <button type="button" className="mt-2 block w-full text-left text-sm" onClick={() => setExpanded(expanded === q.id ? null : q.id)}>
                    <span className="line-clamp-2"><MathText text={q.fullText} /></span>
                  </button>
                  {expanded === q.id && (
                    <div className="mt-3 space-y-2 rounded-lg border border-border/60 p-3">
                      {q.options.map((o) => (
                        <div key={o.idx} className={cn('rounded border px-2.5 py-1.5 text-sm',
                          o.isCorrect ? 'border-emerald-400/40 bg-emerald-400/10' : 'border-border/50')}>
                          <span className="font-semibold text-muted-foreground">{String.fromCharCode(65 + o.idx)}.</span>{' '}
                          <MathText text={o.text} />
                        </div>
                      ))}
                      {q.numericalAnswer && (
                        <p className="text-sm"><span className="text-muted-foreground">Answer: </span><span className="font-mono font-semibold text-primary">{q.numericalAnswer}</span></p>
                      )}
                      {q.sourceYear && <p className="text-xs text-muted-foreground">Source: JEE Main {q.sourceYear} {q.difficulty}</p>}
                      <div className="flex flex-wrap gap-2 pt-1">
                        <Button size="sm" variant="outline" className="border-emerald-500/40 text-emerald-400 hover:bg-emerald-500/10"
                          onClick={() => setStatusFor(q.id, 'verified')}>
                          <CheckCircle2 className="mr-1 h-3.5 w-3.5" /> Verify
                        </Button>
                        <Button size="sm" variant="outline" className="border-amber-500/40 text-amber-400 hover:bg-amber-500/10"
                          onClick={() => setStatusFor(q.id, 'needs_review')}>
                          <AlertTriangle className="mr-1 h-3.5 w-3.5" /> Needs review
                        </Button>
                        <Button size="sm" variant="outline" className="border-rose-500/40 text-rose-400 hover:bg-rose-500/10"
                          onClick={() => setStatusFor(q.id, 'rejected')}>
                          <XCircle className="mr-1 h-3.5 w-3.5" /> Reject
                        </Button>
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
          {data.pageCount > 1 && (
            <div className="flex items-center justify-center gap-3">
              <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>Prev</Button>
              <span className="text-sm text-muted-foreground">{page} / {data.pageCount}</span>
              <Button variant="outline" size="sm" disabled={page >= data.pageCount} onClick={() => setPage(page + 1)}>Next</Button>
            </div>
          )}
        </>
      )}
    </div>
  )
}

function ReportsTab() {
  const { data, loading, error, reload } = useApi<{ counts: Record<string, number>; reports: ReportItem[] }>('/api/admin/reports')

  const act = async (id: string, action: 'resolved' | 'dismissed') => {
    try {
      await api('/api/admin/reports', { id, action }, 'PATCH')
      toast({ title: action === 'resolved' ? 'Report resolved — question flagged for re-review' : 'Report dismissed' })
      reload()
    } catch (e) {
      toast({ title: 'Failed', description: (e as Error).message, variant: 'destructive' })
    }
  }

  if (loading) return <div className="space-y-2"><Skeleton className="h-20" /><Skeleton className="h-20" /></div>
  if (error) return <p className="text-sm text-rose-400">{error}</p>
  if (!data) return null

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        Open: <b>{data.counts.open ?? 0}</b> · Resolved: {data.counts.resolved ?? 0} · Dismissed: {data.counts.dismissed ?? 0}
      </p>
      {data.reports.length === 0 && (
        <div className="rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
          No open reports. Users can report incorrect answers, solutions or missing diagrams from any question.
        </div>
      )}
      {data.reports.map((r) => (
        <Card key={r.id}>
          <CardContent className="p-4">
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
              <span className="flex items-center gap-2">
                <Flag className="h-3.5 w-3.5 text-amber-400" />
                <Badge variant="outline" className="capitalize">{r.reason.replace('_', ' ')}</Badge>
                <span className="font-mono">{r.question.publicId}</span>
              </span>
              <span>{r.reporter} · {new Date(r.createdAt).toLocaleDateString()}</span>
            </div>
            <p className="mt-2 line-clamp-2 text-sm text-muted-foreground">{r.question.text.slice(0, 200)}</p>
            {r.details && <p className="mt-1.5 rounded-lg border border-border/60 p-2 text-xs">&ldquo;{r.details}&rdquo;</p>}
            <div className="mt-3 flex gap-2">
              <Button size="sm" variant="outline" className="border-emerald-500/40 text-emerald-400 hover:bg-emerald-500/10"
                onClick={() => act(r.id, 'resolved')}>
                <CheckCircle2 className="mr-1 h-3.5 w-3.5" /> Resolve (flag question)
              </Button>
              <Button size="sm" variant="ghost" onClick={() => act(r.id, 'dismissed')}>Dismiss</Button>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  )
}

// ===================================================================
// Solutions review (Part A, migration 0019) — verification workflow
// ===================================================================

interface SolutionRow {
  id: string
  questionId: string
  publicId: string
  year: number | null
  subject: string
  chapter: string
  reviewStatus: string
  reviewedBy: string | null
  reviewedAt: string | null
  isAiGenerated: boolean
  version: number
  thin: boolean
  keyConcept: string | null
  bodyLength: number
  bodyPreview: string
  formulas: string[]
  commonMistakes: string | null
  verification: string | null
  updatedAt: string
}
interface SolutionsPage {
  total: number
  page: number
  pageSize: number
  statusCounts: Record<string, number>
  generation: { runs: number; failed: number; promptTokens: number; completionTokens: number; costUsd: number }
  priorityQueue: { question_id: string; public_id: string; attempts: number; wrong: number; reports: number }[]
  rows: SolutionRow[]
}
interface SolutionDetail {
  keyConcept: string | null
  formulas: unknown
  body: string
  commonMistakes: string | null
  alternativeMethod: string | null
  verification: string | null
  sourceReferences: unknown
  isAiGenerated: boolean
  version: number
  updatedAt: string
  question: {
    publicId: string
    text: string
    sourceYear: number | null
    sourceExam: string | null
    type: string
    correctOptions: number[] | null
    numericalAnswer: string | null
  }
  revisions: { id: string; version: number; editedBy: string | null; note: string | null; createdAt: string }[]
}

const SOL_STATUS_STYLE: Record<string, string> = {
  ai_generated: 'border-amber-500/40 bg-amber-500/10 text-amber-400',
  independently_checked: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-400',
  expert_verified: 'border-emerald-400/60 bg-emerald-400/20 font-semibold text-emerald-300',
  reported_for_correction: 'border-rose-500/40 bg-rose-500/10 text-rose-400',
}
const SOL_STATUS_LABEL: Record<string, string> = {
  ai_generated: 'AI generated',
  independently_checked: 'independently checked',
  expert_verified: 'expert verified',
  reported_for_correction: 'reported',
}
const SOL_FILTERS = [
  { key: 'ai_generated', label: 'AI-generated' },
  { key: 'independently_checked', label: 'Independently checked' },
  { key: 'expert_verified', label: 'Expert verified' },
  { key: 'reported_for_correction', label: 'Reported' },
  { key: 'thin', label: 'Thin solutions' },
]

/** Prisma Json columns arrive as unknown — coerce to a clean string array. */
function toStringArray(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []
}

function fmtCost(usd: number): string {
  return usd > 0 && usd < 1 ? usd.toFixed(4) : usd.toFixed(2)
}

function SolutionsTab() {
  const [filter, setFilter] = useState('ai_generated')
  const [page, setPage] = useState(1)
  const { data, loading, error, reload } = useApi<SolutionsPage>(
    `/api/admin/solutions?filter=${filter}&page=${page}`, [filter, page]
  )
  // 'thin' is not a review status — its count comes from the enrich stats endpoint
  const enrich = useApi<{ total: number; thin: number; detailed: number }>('/api/solutions/enrich')
  const [selected, setSelected] = useState<SolutionRow | null>(null)
  const [detailOpen, setDetailOpen] = useState(false)
  const [genCount, setGenCount] = useState(3)
  const [genPriority, setGenPriority] = useState<'usage' | 'oldest'>('usage')
  const [generating, setGenerating] = useState(false)

  const pageCount = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1
  const queue = data?.priorityQueue ?? []
  const genN = Math.min(10, Math.max(1, Math.round(genCount) || 1))

  const reloadAll = () => { reload(); enrich.reload() }

  const runBatch = async () => {
    setGenerating(true)
    try {
      const r = await api<{ requested: number; results: { questionId: string; ok: boolean; error?: string }[] }>(
        '/api/admin/solutions', { count: genN, priority: genPriority }
      )
      const ok = r.results.filter((x) => x.ok).length
      const failed = r.results.filter((x) => !x.ok)
      toast({
        title: `Generated ${ok}/${r.results.length} solutions`,
        description: failed.length > 0
          ? failed.map((f) => `${f.questionId.slice(0, 10)}: ${f.error ?? 'failed'}`).join(' · ')
          : 'Bounded batch enrichment finished — review the refreshed queue.',
      })
      reloadAll()
    } catch (e) {
      toast({ title: 'Generation failed', description: (e as Error).message, variant: 'destructive' })
    } finally {
      setGenerating(false)
    }
  }

  return (
    <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_280px]">
      <div className="min-w-0 space-y-3">
        {/* filter chips with live counts */}
        <div className="flex flex-wrap gap-1.5">
          {SOL_FILTERS.map((f) => {
            const n = f.key === 'thin'
              ? enrich.data?.thin
              : data ? (data.statusCounts[f.key] ?? 0) : undefined
            return (
              <button key={f.key} type="button" onClick={() => { setFilter(f.key); setPage(1) }}
                className={cn('flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors',
                  filter === f.key ? 'border-primary bg-primary/15 text-primary' : 'border-border text-muted-foreground hover:border-primary/40 hover:text-foreground')}>
                {f.label}
                <span className={cn('rounded-full px-1.5 py-0.5 text-[10px] font-semibold tabular-nums',
                  filter === f.key ? 'bg-primary/20 text-primary' : 'bg-muted text-muted-foreground')}>
                  {n ?? '…'}
                </span>
              </button>
            )
          })}
        </div>

        {/* generation telemetry */}
        {data && (
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 rounded-xl border border-border/60 px-3.5 py-2.5 text-xs text-muted-foreground">
            <span className="flex items-center gap-1.5 font-semibold text-foreground">
              <Cpu className="h-3.5 w-3.5 text-primary" /> AI generation telemetry
            </span>
            <span><b className="text-foreground tabular-nums">{data.generation.runs}</b> runs</span>
            <span className="text-rose-400"><b className="tabular-nums">{data.generation.failed}</b> failed</span>
            <span><b className="text-foreground tabular-nums">
              {(data.generation.promptTokens + data.generation.completionTokens).toLocaleString()}
            </b> tokens</span>
            <span>cost <b className="text-foreground tabular-nums">${fmtCost(data.generation.costUsd)}</b></span>
          </div>
        )}

        {loading && !data && (
          <div className="space-y-2"><Skeleton className="h-16" /><Skeleton className="h-16" /><Skeleton className="h-16" /></div>
        )}
        {error && <p className="text-sm text-rose-400">{error}</p>}

        {data && (
          <>
            <p className="text-xs text-muted-foreground">{data.total.toLocaleString()} solutions · page {page}/{pageCount}</p>
            {data.rows.length === 0 ? (
              <div className="rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
                {filter === 'thin'
                  ? 'No thin solutions — the whole corpus is detailed.'
                  : 'Nothing in this queue. Generate a batch or switch filters.'}
              </div>
            ) : (
              <div className="space-y-2">
                {data.rows.map((r) => (
                  <Card key={r.id} className="cursor-pointer py-0 transition-colors hover:border-primary/40"
                    onClick={() => { setSelected(r); setDetailOpen(true) }}>
                    <CardContent className="p-3.5">
                      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
                        <span className="flex min-w-0 items-center gap-2">
                          <span className="font-mono text-foreground/90">{r.publicId}</span>
                          {r.year ? <span>{r.year}</span> : null}
                          <span style={{ color: SUBJECT_COLORS[r.subject] }} className="capitalize">{r.subject}</span>
                          <span className="min-w-0 truncate">· {r.chapter}</span>
                        </span>
                        <span className="flex shrink-0 items-center gap-1.5">
                          {r.thin && <Badge variant="outline" className="border-rose-500/40 text-rose-400">thin</Badge>}
                          {r.isAiGenerated && <Sparkles className="h-3.5 w-3.5 text-amber-400" />}
                          <Badge variant="outline" className={SOL_STATUS_STYLE[r.reviewStatus]}>
                            {SOL_STATUS_LABEL[r.reviewStatus] ?? r.reviewStatus.replace('_', ' ')}
                          </Badge>
                        </span>
                      </div>
                      <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
                        <span>v{r.version}</span>
                        <span>{r.bodyLength.toLocaleString()} chars</span>
                        {r.formulas.length > 0 && <span>{r.formulas.length} formulas</span>}
                        {r.reviewedBy && (
                          <span>reviewed by {r.reviewedBy}{r.reviewedAt ? ` · ${new Date(r.reviewedAt).toLocaleDateString()}` : ''}</span>
                        )}
                        <span className="ml-auto">updated {new Date(r.updatedAt).toLocaleDateString()}</span>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
            {pageCount > 1 && (
              <div className="flex items-center justify-center gap-3">
                <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>Prev</Button>
                <span className="text-sm text-muted-foreground">{page} / {pageCount}</span>
                <Button variant="outline" size="sm" disabled={page >= pageCount} onClick={() => setPage(page + 1)}>Next</Button>
              </div>
            )}
          </>
        )}
      </div>

      {/* priority queue + bounded batch generation */}
      <Card className="h-fit py-4 lg:sticky lg:top-4">
        <CardHeader className="px-4 pb-2">
          <CardTitle className="flex items-center gap-2 text-sm">
            <AlertTriangle className="h-4 w-4 text-amber-400" /> Priority queue
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 px-4">
          <p className="text-xs text-muted-foreground">
            Thin solutions ranked by student reports, wrong attempts and usage — what the next batch should target.
          </p>
          {queue.length === 0 ? (
            <p className="text-sm text-muted-foreground">Queue empty — every solution is detailed.</p>
          ) : (
            <div className="space-y-1.5">
              {queue.slice(0, 10).map((q) => (
                <div key={q.question_id} className="rounded-lg border border-border/60 px-2.5 py-1.5">
                  <div className="font-mono text-xs text-foreground/90">{q.public_id}</div>
                  <div className="mt-0.5 flex gap-2 text-[11px] text-muted-foreground">
                    <span>{q.attempts} attempts</span>
                    <span className="text-rose-400">{q.wrong} wrong</span>
                    <span className="text-amber-400">{q.reports} reports</span>
                  </div>
                </div>
              ))}
            </div>
          )}
          <Separator />
          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Generate batch</p>
            <div className="flex items-center gap-2">
              <Input type="number" min={1} max={10} value={genCount}
                onChange={(e) => setGenCount(Math.min(10, Math.max(1, Math.round(Number(e.target.value)) || 1)))}
                className="h-8 w-16 text-xs" />
              <Select value={genPriority} onValueChange={(v) => setGenPriority(v as 'usage' | 'oldest')}>
                <SelectTrigger className="h-8 min-w-0 flex-1 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="usage">Priority: usage</SelectItem>
                  <SelectItem value="oldest">Priority: oldest</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Button size="sm" className="w-full" disabled={generating} onClick={runBatch}>
              {generating
                ? <><Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> Generating…</>
                : <><Sparkles className="mr-1.5 h-3.5 w-3.5" /> Generate ({genN})</>}
            </Button>
            <p className="text-[10px] leading-relaxed text-muted-foreground">
              Bounded run (max 10 per batch) — existing solutions are only replaced by richer versions.
            </p>
          </div>
        </CardContent>
      </Card>

      {selected && (
        <SolutionDetailDialog row={selected} open={detailOpen} onOpenChange={setDetailOpen} onDone={reloadAll} />
      )}
    </div>
  )
}

function DetailField({ label, text }: { label: string; text: string | null | undefined }) {
  if (!text) return null
  return (
    <div>
      <p className="mb-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">{label}</p>
      <div className="rounded-lg border border-border/60 p-3 text-sm">
        <MathText text={text} />
      </div>
    </div>
  )
}

function SolutionDetailDialog({ row, open, onOpenChange, onDone }: {
  row: SolutionRow
  open: boolean
  onOpenChange: (v: boolean) => void
  onDone: () => void
}) {
  const detail = useApi<{ solution: SolutionDetail }>(
    open ? `/api/admin/solutions?solutionId=${row.id}` : null, [row.id, open]
  )
  const [mode, setMode] = useState<'view' | 'edit' | 'reject'>('view')
  const [note, setNote] = useState('')
  const [form, setForm] = useState({ keyConcept: '', body: '', commonMistakes: '', verification: '' })
  const [busy, setBusy] = useState(false)

  // fresh view state whenever the dialog (re)opens or switches to another solution
  useEffect(() => {
    if (open) { setMode('view'); setNote('') }
  }, [row.id, open])

  const sol = detail.data?.solution
  const keyConcept = sol?.keyConcept ?? row.keyConcept
  const body = sol?.body ?? row.bodyPreview
  const commonMistakes = sol?.commonMistakes ?? row.commonMistakes
  const verification = sol?.verification ?? row.verification
  const formulas = sol ? toStringArray(sol.formulas) : row.formulas
  const sourceRefs = sol ? toStringArray(sol.sourceReferences) : []

  const startEdit = () => {
    setForm({
      keyConcept: keyConcept ?? '',
      body: body ?? '',
      commonMistakes: commonMistakes ?? '',
      verification: verification ?? '',
    })
    setMode('edit')
  }

  const act = async (
    action: 'edit' | 'approve_independent' | 'approve_expert' | 'reject' | 'mark_reviewed',
    fields?: Record<string, string>,
    rejectNote?: string
  ) => {
    setBusy(true)
    try {
      const payload: Record<string, unknown> = { solutionId: row.id, action }
      if (fields) payload.fields = fields
      if (rejectNote) payload.note = rejectNote
      await api('/api/admin/solutions', payload, 'PATCH')
      toast({
        title: {
          edit: 'Saved — snapshot stored, marked independently checked',
          approve_independent: 'Approved as independently checked',
          approve_expert: 'Approved as expert verified',
          reject: 'Flagged for correction',
          mark_reviewed: 'Reset to AI-generated',
        }[action],
      })
      setMode('view')
      setNote('')
      detail.reload()
      onDone()
    } catch (e) {
      toast({ title: 'Action failed', description: (e as Error).message, variant: 'destructive' })
    } finally {
      setBusy(false)
    }
  }

  const saveEdit = () => {
    const fields: Record<string, string> = {}
    if (form.keyConcept.trim()) fields.keyConcept = form.keyConcept
    if (form.body.trim()) fields.body = form.body
    if (form.commonMistakes.trim()) fields.commonMistakes = form.commonMistakes
    if (form.verification.trim()) fields.verification = form.verification
    act('edit', fields)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[88vh] flex-col sm:max-w-2xl">
        <DialogHeader className="shrink-0">
          <DialogTitle className="flex flex-wrap items-center gap-2 font-mono text-base">
            {row.publicId}
            <Badge variant="outline" className={cn('font-sans', SOL_STATUS_STYLE[row.reviewStatus] ?? '')}>
              {SOL_STATUS_LABEL[row.reviewStatus] ?? row.reviewStatus.replace('_', ' ')}
            </Badge>
            {row.thin && <Badge variant="outline" className="border-rose-500/40 font-sans text-rose-400">thin</Badge>}
          </DialogTitle>
          <DialogDescription className="flex flex-wrap items-center gap-x-2">
            <span style={{ color: SUBJECT_COLORS[row.subject] }} className="capitalize">{row.subject}</span>
            <span>{row.chapter}</span>
            <span>v{sol?.version ?? row.version}</span>
            {row.year ? <span>JEE {row.year}</span> : null}
            {sol?.question.sourceExam ? <span>{sol.question.sourceExam}</span> : null}
            <span>{(sol?.isAiGenerated ?? row.isAiGenerated) ? 'AI-generated' : 'human-authored'}</span>
            {row.reviewedBy && (
              <span>reviewed by {row.reviewedBy}{row.reviewedAt ? ` · ${new Date(row.reviewedAt).toLocaleDateString()}` : ''}</span>
            )}
          </DialogDescription>
        </DialogHeader>

        <ScrollArea className="min-h-0 flex-1">
          <div className="space-y-3 pr-3">
            {detail.error && <p className="text-sm text-rose-400">{detail.error} — showing the row preview.</p>}

            {mode === 'reject' && (
              <div className="rounded-lg border border-rose-500/30 bg-rose-500/5 p-3">
                <p className="text-xs font-semibold uppercase tracking-wider text-rose-400">Reject / needs correction</p>
                <Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3} className="mt-2"
                  placeholder="What is wrong? The note is stored in the revision history…" />
                <div className="mt-2 flex gap-2">
                  <Button size="sm" variant="ghost" onClick={() => setMode('view')}>Cancel</Button>
                  <Button size="sm" variant="outline" className="border-rose-500/40 text-rose-400 hover:bg-rose-500/10"
                    disabled={busy} onClick={() => act('reject', undefined, note)}>
                    {busy ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <XCircle className="mr-1.5 h-3.5 w-3.5" />}
                    Confirm rejection
                  </Button>
                </div>
              </div>
            )}

            {mode === 'edit' ? (
              <div className="space-y-3">
                <div>
                  <p className="mb-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Key concept</p>
                  <Textarea value={form.keyConcept} onChange={(e) => setForm({ ...form, keyConcept: e.target.value })}
                    rows={2} placeholder="One-paragraph concept recap (LaTeX allowed)…" className="font-mono text-xs leading-relaxed" />
                </div>
                <div>
                  <p className="mb-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Step-by-step body</p>
                  <Textarea value={form.body} onChange={(e) => setForm({ ...form, body: e.target.value })}
                    rows={12} placeholder="**Step 1.** …" className="font-mono text-xs leading-relaxed" />
                </div>
                <div>
                  <p className="mb-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Common mistakes</p>
                  <Textarea value={form.commonMistakes} onChange={(e) => setForm({ ...form, commonMistakes: e.target.value })}
                    rows={3} placeholder="Where students usually slip…" className="font-mono text-xs leading-relaxed" />
                </div>
                <div>
                  <p className="mb-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Verification (sanity check)</p>
                  <Textarea value={form.verification} onChange={(e) => setForm({ ...form, verification: e.target.value })}
                    rows={3} placeholder="Final sanity check…" className="font-mono text-xs leading-relaxed" />
                </div>
                <p className="text-[11px] text-muted-foreground">
                  Saving snapshots the previous version into the revision history and marks the solution
                  <b> independently checked</b> — AI-generated content is never auto-verified.
                </p>
              </div>
            ) : (
              <>
                {detail.loading && !sol && (
                  <div className="space-y-2"><Skeleton className="h-16" /><Skeleton className="h-28" /></div>
                )}

                <DetailField label="Question" text={sol?.question.text} />
                <DetailField label="Key concept" text={keyConcept} />
                {formulas.length > 0 && (
                  <div>
                    <p className="mb-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Formulas</p>
                    <div className="flex flex-wrap gap-1.5">
                      {formulas.map((f, i) => (
                        <span key={i} className="rounded-md border border-border/60 bg-muted/40 px-2 py-1 text-sm">
                          <MathText text={f} />
                        </span>
                      ))}
                    </div>
                  </div>
                )}
                <DetailField label={sol ? 'Body' : 'Body preview'} text={body} />
                <DetailField label="Common mistakes" text={commonMistakes} />
                <DetailField label="Verification" text={verification} />
                <DetailField label="Alternative method" text={sol?.alternativeMethod} />
                {sourceRefs.length > 0 && (
                  <div>
                    <p className="mb-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Source references</p>
                    <ul className="list-inside list-disc space-y-0.5 text-xs text-muted-foreground">
                      {sourceRefs.map((s, i) => <li key={i}>{s}</li>)}
                    </ul>
                  </div>
                )}

                {(sol?.revisions?.length ?? 0) > 0 && (
                  <div>
                    <p className="mb-1 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      <History className="h-3 w-3" /> Revision history ({sol!.revisions!.length})
                    </p>
                    <div className="space-y-1">
                      {sol!.revisions!.slice(0, 8).map((rev) => (
                        <div key={rev.id}
                          className="flex flex-wrap items-center justify-between gap-x-3 rounded-md border border-border/50 px-2.5 py-1.5 text-xs text-muted-foreground">
                          <span>v{rev.version} · {rev.editedBy ?? 'system'}</span>
                          <span className="min-w-0 truncate">{rev.note ?? ''}</span>
                          <span className="shrink-0">{new Date(rev.createdAt).toLocaleDateString()}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        </ScrollArea>

        <DialogFooter className="shrink-0 flex-wrap gap-2">
          {mode === 'edit' ? (
            <>
              <Button size="sm" variant="ghost" onClick={() => setMode('view')}>Cancel</Button>
              <Button size="sm" disabled={busy || !form.body.trim()} onClick={saveEdit}>
                {busy ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Save className="mr-1.5 h-3.5 w-3.5" />}
                Save changes
              </Button>
            </>
          ) : (
            <>
              <Button size="sm" variant="secondary" onClick={startEdit}>
                <Pencil className="mr-1.5 h-3.5 w-3.5" /> Edit
              </Button>
              <Button size="sm" variant="ghost" disabled={busy} onClick={() => act('mark_reviewed')}>
                <RotateCcw className="mr-1.5 h-3.5 w-3.5" /> Mark AI-generated
              </Button>
              <Button size="sm" variant="outline" className="border-rose-500/40 text-rose-400 hover:bg-rose-500/10"
                disabled={busy} onClick={() => setMode(mode === 'reject' ? 'view' : 'reject')}>
                <XCircle className="mr-1.5 h-3.5 w-3.5" /> Reject / needs correction
              </Button>
              <Button size="sm" variant="outline" className="border-emerald-500/40 text-emerald-400 hover:bg-emerald-500/10"
                disabled={busy} onClick={() => act('approve_independent')}>
                <CheckCircle2 className="mr-1.5 h-3.5 w-3.5" /> Approve (independently checked)
              </Button>
              <Button size="sm" variant="outline" className="border-emerald-400/60 bg-emerald-500/15 text-emerald-300 hover:bg-emerald-500/25"
                disabled={busy} onClick={() => act('approve_expert')}>
                <BadgeCheck className="mr-1.5 h-3.5 w-3.5" /> Approve (expert verified)
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ===================================================================
// Image manager (Part B, migration 0019) — audit + replacement
// ===================================================================

interface ImageRow {
  id: string
  questionId: string
  publicId: string
  subject: string
  year: number | null
  url: string
  altText: string
  caption: string | null
  kind: string
  order: number
  hidden: boolean
  status: string
  contentHash: string | null
  replacedFromUrl: string | null
  reconstructed: boolean
  isOriginalExamImage: boolean
  lastCheckedAt: string | null
}
interface ImagesPage {
  total: number
  page: number
  pageSize: number
  rows: ImageRow[]
}
interface ImagesSummary {
  total: number
  hidden: number
  statusCounts: Record<string, number>
  duplicateGroups: number
}

const IMG_STATUS_STYLE: Record<string, string> = {
  ok: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-400',
  broken: 'border-rose-500/40 bg-rose-500/10 text-rose-400',
  missing: 'border-rose-500/40 bg-rose-500/10 text-rose-400',
  duplicate: 'border-amber-500/40 bg-amber-500/10 text-amber-400',
  low_res: 'border-amber-500/40 bg-amber-500/10 text-amber-400',
  unverified: 'border-border bg-muted text-muted-foreground',
}
const IMG_FILTERS: { k: string; label: string; count: (s: ImagesSummary) => number }[] = [
  { k: 'all', label: 'All', count: (s) => s.total },
  { k: 'hidden', label: 'Hidden', count: (s) => s.hidden },
  { k: 'broken', label: 'Broken', count: (s) => s.statusCounts.broken ?? 0 },
  { k: 'duplicate', label: 'Duplicates', count: (s) => s.statusCounts.duplicate ?? 0 },
  { k: 'ok', label: 'OK', count: (s) => s.statusCounts.ok ?? 0 },
]

/** The shared api() helper always JSON-encodes its body, so multipart
 *  uploads (image replacement) go through plain fetch. */
async function uploadImageFile(imageId: string, file: File, reconstructed: boolean) {
  const form = new FormData()
  form.append('imageId', imageId)
  form.append('file', file)
  form.append('reconstructed', reconstructed ? 'true' : 'false')
  const res = await fetch('/api/admin/images', { method: 'POST', body: form })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error((data as { error?: string }).error ?? `Request failed (${res.status})`)
  return data as { ok: boolean; url: string; preservedOriginal: string }
}

function ImagesTab() {
  const [listFilter, setListFilter] = useState('all')
  const [page, setPage] = useState(1)
  const summary = useApi<ImagesSummary>('/api/admin/images?filter=summary')
  const list = useApi<ImagesPage>(`/api/admin/images?filter=${listFilter}&page=${page}`, [listFilter, page])
  const [sample, setSample] = useState(500)
  const [auditing, setAuditing] = useState(false)
  const [pendingReplace, setPendingReplace] = useState<{ row: ImageRow; file: File } | null>(null)
  const [markReconstructed, setMarkReconstructed] = useState(false)
  const [uploading, setUploading] = useState(false)

  const pageCount = list.data ? Math.max(1, Math.ceil(list.data.total / list.data.pageSize)) : 1
  const s = summary.data

  const reloadAll = () => { summary.reload(); list.reload() }

  const runAudit = async () => {
    setAuditing(true)
    try {
      const n = Math.min(2000, Math.max(1, Math.round(sample) || 500))
      const r = await api<{ checked: number; ok: number; broken: number; duplicates: number }>(
        '/api/admin/images', { action: 'audit', sample: n }
      )
      toast({
        title: `Audit finished — ${r.checked} images checked`,
        description: `${r.ok} ok · ${r.broken} broken · ${r.duplicates} duplicates`,
      })
      reloadAll()
    } catch (e) {
      toast({ title: 'Audit failed', description: (e as Error).message, variant: 'destructive' })
    } finally {
      setAuditing(false)
    }
  }

  const toggleHidden = async (row: ImageRow) => {
    try {
      await api('/api/admin/images', { imageId: row.id, hidden: !row.hidden }, 'PATCH')
      toast({
        title: row.hidden ? 'Image shown again' : 'Image hidden',
        description: row.hidden ? undefined : 'Students no longer see it — the file stays in the record.',
      })
      reloadAll()
    } catch (e) {
      toast({ title: 'Failed', description: (e as Error).message, variant: 'destructive' })
    }
  }

  const pickFile = (row: ImageRow, file: File) => {
    setMarkReconstructed(false)
    setPendingReplace({ row, file })
  }

  const confirmReplace = async () => {
    if (!pendingReplace) return
    setUploading(true)
    try {
      const r = await uploadImageFile(pendingReplace.row.id, pendingReplace.file, markReconstructed)
      toast({
        title: 'Image replaced',
        description: `Live at ${r.url}. Original preserved at ${r.preservedOriginal}.`,
      })
      setPendingReplace(null)
      reloadAll()
    } catch (e) {
      toast({ title: 'Upload failed', description: (e as Error).message, variant: 'destructive' })
    } finally {
      setUploading(false)
    }
  }

  return (
    <div className="space-y-3">
      {/* summary cards */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Card><CardContent className="p-4">
          <div className="text-2xl font-bold tabular-nums">{s ? s.total.toLocaleString() : '…'}</div>
          <div className="text-xs text-muted-foreground">Total images</div>
        </CardContent></Card>
        <Card><CardContent className="p-4">
          <div className="text-2xl font-bold tabular-nums text-rose-400">{s ? s.hidden.toLocaleString() : '…'}</div>
          <div className="text-xs text-muted-foreground">Hidden (watermark-destroyed)</div>
        </CardContent></Card>
        <Card><CardContent className="p-4">
          <div className="text-2xl font-bold tabular-nums text-amber-400">{s ? s.duplicateGroups : '…'}</div>
          <div className="text-xs text-muted-foreground">Duplicate groups</div>
        </CardContent></Card>
        <Card><CardContent className="p-4">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">By status</p>
          <div className="mt-1.5 flex flex-wrap gap-x-2.5 gap-y-0.5 text-xs capitalize">
            {!s || Object.keys(s.statusCounts).length === 0 ? (
              <span className="text-muted-foreground">none audited yet</span>
            ) : (
              Object.entries(s.statusCounts).map(([k, v]) => (
                <span key={k}>{k.replace('_', ' ')}: <b className="tabular-nums">{v}</b></span>
              ))
            )}
          </div>
        </CardContent></Card>
      </div>

      {/* audit runner */}
      <Card className="py-3">
        <CardContent className="flex flex-wrap items-center gap-2.5 px-4">
          <ScanSearch className="h-4 w-4 shrink-0 text-primary" />
          <span className="text-sm font-semibold">Asset audit</span>
          <span className="hidden min-w-0 flex-1 truncate text-xs text-muted-foreground sm:block">
            Verifies each non-hidden URL resolves to a real file, recomputes content hashes and flags duplicates.
          </span>
          <div className="ml-auto flex items-center gap-2">
            <span className="text-xs text-muted-foreground">Sample</span>
            <Input type="number" min={1} max={2000} value={sample}
              onChange={(e) => setSample(Math.min(2000, Math.max(1, Math.round(Number(e.target.value)) || 500)))}
              className="h-8 w-24 text-xs" />
            <Button size="sm" disabled={auditing} onClick={runAudit}>
              {auditing ? <><Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> Auditing…</> : 'Run audit'}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* filter chips */}
      <div className="flex flex-wrap gap-1.5">
        {IMG_FILTERS.map((f) => (
          <button key={f.k} type="button" onClick={() => { setListFilter(f.k); setPage(1) }}
            className={cn('flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors',
              listFilter === f.k ? 'border-primary bg-primary/15 text-primary' : 'border-border text-muted-foreground hover:border-primary/40 hover:text-foreground')}>
            {f.label}
            <span className={cn('rounded-full px-1.5 py-0.5 text-[10px] font-semibold tabular-nums',
              listFilter === f.k ? 'bg-primary/20 text-primary' : 'bg-muted text-muted-foreground')}>
              {s ? f.count(s) : '…'}
            </span>
          </button>
        ))}
      </div>

      {list.loading && !list.data && (
        <div className="space-y-2"><Skeleton className="h-20" /><Skeleton className="h-20" /><Skeleton className="h-20" /></div>
      )}
      {list.error && <p className="text-sm text-rose-400">{list.error}</p>}

      {list.data && (
        <>
          <p className="text-xs text-muted-foreground">
            {list.data.total.toLocaleString()} images · page {page}/{pageCount} · least-recently-checked first
          </p>
          {list.data.rows.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
              No images in this view — switch filters or run an audit to populate statuses.
            </div>
          ) : (
            <div className="space-y-2">
              {list.data.rows.map((r) => (
                <ImageRowCard key={r.id} row={r} onSaved={reloadAll} onToggleHidden={toggleHidden} onPickFile={pickFile} />
              ))}
            </div>
          )}
          {pageCount > 1 && (
            <div className="flex items-center justify-center gap-3">
              <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>Prev</Button>
              <span className="text-sm text-muted-foreground">{page} / {pageCount}</span>
              <Button variant="outline" size="sm" disabled={page >= pageCount} onClick={() => setPage(page + 1)}>Next</Button>
            </div>
          )}
        </>
      )}

      {/* replace-image confirmation */}
      <Dialog open={!!pendingReplace} onOpenChange={(v) => { if (!v) setPendingReplace(null) }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base">
              <ImagePlus className="h-4 w-4 text-primary" /> Replace image
            </DialogTitle>
            <DialogDescription>
              The original file is preserved in the record; label the replacement as an AI reconstruction?
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2.5 rounded-lg border border-border/60 p-3">
            <p className="text-xs text-muted-foreground">
              {pendingReplace?.row.publicId} · new file <span className="font-mono text-foreground/90">{pendingReplace?.file.name}</span>
              {' '}({Math.round((pendingReplace?.file.size ?? 0) / 1024)} KB)
            </p>
            <label htmlFor="mark-reconstructed" className="flex cursor-pointer items-center gap-2 text-sm">
              <Checkbox id="mark-reconstructed" checked={markReconstructed}
                onCheckedChange={(v) => setMarkReconstructed(v === true)} />
              Mark as AI-reconstructed
            </label>
            <p className="text-[11px] text-muted-foreground">
              The previous URL stays in the provenance field, and the reconstruction label is shown to students.
            </p>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setPendingReplace(null)}>Cancel</Button>
            <Button onClick={confirmReplace} disabled={uploading}>
              {uploading ? <><Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> Uploading…</> : 'Upload replacement'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function ImageRowCard({ row, onSaved, onToggleHidden, onPickFile }: {
  row: ImageRow
  onSaved: () => void
  onToggleHidden: (row: ImageRow) => void
  onPickFile: (row: ImageRow, file: File) => void
}) {
  const [alt, setAlt] = useState(row.altText ?? '')
  const [savingAlt, setSavingAlt] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const altDirty = alt !== (row.altText ?? '')

  const saveAlt = async () => {
    setSavingAlt(true)
    try {
      await api('/api/admin/images', { imageId: row.id, altText: alt.slice(0, 300) }, 'PATCH')
      toast({ title: 'Alt text saved' })
      onSaved()
    } catch (e) {
      toast({ title: 'Failed to save alt text', description: (e as Error).message, variant: 'destructive' })
    } finally {
      setSavingAlt(false)
    }
  }

  return (
    <Card className="py-0">
      <CardContent className="p-3.5">
        <div className="flex flex-wrap items-start gap-3">
          <img src={row.url} alt={row.altText || row.publicId} loading="lazy"
            className={cn('h-12 w-20 shrink-0 rounded-md border border-border/60 bg-muted/30 object-contain p-0.5', row.hidden && 'opacity-50')} />
          <div className="min-w-0 flex-1 space-y-2">
            <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
              <span className="font-mono text-foreground/90">{row.publicId}</span>
              <span style={{ color: SUBJECT_COLORS[row.subject] }} className="capitalize">{row.subject}</span>
              {row.year ? <span>· {row.year}</span> : null}
              <Badge variant="outline" className={cn('capitalize', IMG_STATUS_STYLE[row.status] ?? IMG_STATUS_STYLE.unverified)}>
                {row.status.replace('_', ' ')}
              </Badge>
              {row.hidden && <Badge variant="outline" className="border-rose-500/40 text-rose-400">hidden</Badge>}
              {row.reconstructed && <Badge variant="outline" className="border-amber-500/40 text-amber-400">AI reconstruction</Badge>}
              {row.isOriginalExamImage && <Badge variant="outline">original exam scan</Badge>}
              <span className="ml-auto whitespace-nowrap">
                {row.lastCheckedAt ? `checked ${new Date(row.lastCheckedAt).toLocaleDateString()}` : 'never checked'}
              </span>
            </div>
            {row.replacedFromUrl && (
              <p className="text-[11px] text-muted-foreground">
                Original preserved: <span className="font-mono">{row.replacedFromUrl}</span>
              </p>
            )}
            <div className="flex flex-wrap items-center gap-2">
              <Input value={alt} onChange={(e) => setAlt(e.target.value)}
                placeholder="Alt text (describe the figure)" className="h-8 min-w-[180px] flex-1 text-xs" />
              <Button size="sm" variant="outline" disabled={!altDirty || savingAlt} onClick={saveAlt}>
                {savingAlt && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />} Save alt
              </Button>
              <Button size="sm" variant="outline" onClick={() => onToggleHidden(row)}>
                {row.hidden
                  ? <><Eye className="mr-1 h-3.5 w-3.5" /> Show</>
                  : <><EyeOff className="mr-1 h-3.5 w-3.5" /> Hide</>}
              </Button>
              <Button size="sm" variant="outline" onClick={() => fileRef.current?.click()}>
                <ImagePlus className="mr-1 h-3.5 w-3.5" /> Replace
              </Button>
              <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml" className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0]
                  if (f) onPickFile(row, f)
                  e.target.value = ''
                }} />
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
