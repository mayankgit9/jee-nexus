'use client'

// JEE NEXUS — admin dashboard: bank overview, import, question management, reports
import { useRef, useState } from 'react'
import {
  ShieldCheck, Upload, ListChecks, Flag, BarChart3, Search, CheckCircle2, XCircle,
  AlertTriangle, FileJson, Loader2,
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
  const [tab, setTab] = useState<'overview' | 'import' | 'questions' | 'reports'>('overview')

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
      </div>
    </div>
  )
}

function OverviewTab() {
  const { data, loading, error } = useApi<AdminStats>('/api/admin/stats')
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
