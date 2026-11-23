'use client'

// JEE NEXUS — mock test hub: exam list, custom test creation, attempt history
import { useState } from 'react'
import { ClipboardList, AlertTriangle, Plus, History, RotateCcw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { ExamRunner, type StartResponse } from '@/components/exam/ExamRunner'
import { ResultScreen, type ResultView } from '@/components/exam/ResultScreen'
import { api, useApi, formatDuration } from '@/lib/client'
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
  list: { data: { exams: ExamListItem[] } | null; loading: boolean; error: string | null }
  history: { data: { attempts: AttemptListItem[] } | null; loading: boolean }
  loggedIn: boolean
  onStart: (examId: string) => void
  onOpenResult: (attemptId: string) => void
  onRequireAuth: () => void
}) {
  const [createOpen, setCreateOpen] = useState(false)
  const [ctTitle, setCtTitle] = useState('My custom test')
  const [ctSubject, setCtSubject] = useState('')
  const [ctCount, setCtCount] = useState(10)
  const [ctMinutes, setCtMinutes] = useState(30)
  const [creating, setCreating] = useState(false)
  const [warnings, setWarnings] = useState<string[]>([])

  const createCustom = async () => {
    setCreating(true)
    setWarnings([])
    try {
      const r = await api<{ examId: string; warnings: string[] }>('/api/exam/list', {
        title: ctTitle,
        kind: ctSubject ? 'subject' : 'custom',
        subjectKey: ctSubject || undefined,
        questionsPerSubject: ctCount,
        durationMinutes: ctMinutes,
      })
      setCreateOpen(false)
      if (r.warnings.length) setWarnings(r.warnings)
      list.reload()
      onStart(r.examId)
    } catch (e) {
      toast({ title: 'Generation failed', description: (e as Error).message, variant: 'destructive' })
    } finally {
      setCreating(false)
    }
  }

  const exams = list.data?.exams ?? []
  const hasDefault = exams.some((e) => e.kind === 'full_length')

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
            <p className="rounded-xl border border-dashed border-border p-4 text-sm text-muted-foreground">
              No full-length mock available yet — the question bank needs more questions per subject.
              Create a custom test below with the questions currently available.
            </p>
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

      {/* custom test dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create a custom test</DialogTitle>
            <DialogDescription>Generated instantly from the verified question bank.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="ct-title">Title</Label>
              <Input id="ct-title" value={ctTitle} onChange={(e) => setCtTitle(e.target.value)} />
            </div>
            <div>
              <Label className="mb-2 block">Subject</Label>
              <div className="flex flex-wrap gap-2">
                {[{ k: '', l: 'All subjects' }, { k: 'physics', l: 'Physics' }, { k: 'chemistry', l: 'Chemistry' }, { k: 'mathematics', l: 'Mathematics' }].map((s) => (
                  <button key={s.k} type="button" onClick={() => setCtSubject(s.k)}
                    className={cn('rounded-lg border px-3 py-1.5 text-sm', ctSubject === s.k ? 'border-primary bg-primary/15 font-semibold text-primary' : 'border-border')}>
                    {s.l}
                  </button>
                ))}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="ct-count">Questions {ctSubject ? '' : '(per subject)'}</Label>
                <Input id="ct-count" type="number" min={1} max={25} value={ctCount} onChange={(e) => setCtCount(Number(e.target.value))} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="ct-min">Duration (minutes)</Label>
                <Input id="ct-min" type="number" min={5} max={240} value={ctMinutes} onChange={(e) => setCtMinutes(Number(e.target.value))} />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setCreateOpen(false)}>Cancel</Button>
            <Button onClick={createCustom} disabled={creating || ctCount < 1}>{creating ? 'Generating…' : 'Generate & start'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
