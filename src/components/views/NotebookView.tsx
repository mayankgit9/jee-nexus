'use client'

// JEE NEXUS — Mistake Notebook: every wrong practice answer collects here
// automatically. Categorize the miss, jot a personal note, expand the full
// solution, retry the question, or remove the entry once it's nailed.
import { useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import {
  NotebookPen, Search, X, RotateCcw, Trash2, CheckCircle2, XCircle, Repeat,
  CalendarClock, ChevronDown, ChevronLeft, ChevronRight, Loader2, StickyNote,
  Check, ZoomIn, BookOpenCheck, AlertTriangle,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { Textarea } from '@/components/ui/textarea'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { MathText } from '@/components/MathText'
import { SUBJECT_META, DIFFICULTY_META } from '@/lib/types'
import type { Difficulty, SubjectKey } from '@/lib/types'
import { api, navigate, useApi, SUBJECT_COLORS } from '@/lib/client'
import { cn } from '@/lib/utils'
import { toast } from '@/hooks/use-toast'

// ---------- types ----------
type MistakeCategory =
  | 'conceptual' | 'calculation' | 'formula_forgotten' | 'misread'
  | 'time_management' | 'incorrect_guess' | 'other'

const MISTAKE_CATEGORIES: MistakeCategory[] = [
  'conceptual', 'calculation', 'formula_forgotten', 'misread',
  'time_management', 'incorrect_guess', 'other',
]

const CATEGORY_META: Record<MistakeCategory, { label: string; chip: string }> = {
  conceptual: { label: 'Conceptual', chip: 'border-amber-400/30 bg-amber-400/10 text-amber-400' },
  calculation: { label: 'Calculation', chip: 'border-rose-400/30 bg-rose-400/10 text-rose-400' },
  formula_forgotten: { label: 'Formula forgotten', chip: 'border-violet-400/30 bg-violet-400/10 text-violet-300' },
  misread: { label: 'Misread question', chip: 'border-orange-400/30 bg-orange-400/10 text-orange-300' },
  time_management: { label: 'Time management', chip: 'border-teal-400/30 bg-teal-400/10 text-teal-300' },
  incorrect_guess: { label: 'Incorrect guess', chip: 'border-fuchsia-400/30 bg-fuchsia-400/10 text-fuchsia-300' },
  other: { label: 'Other', chip: 'border-border/70 bg-muted text-muted-foreground' },
}

interface MistakeEntry {
  id: string
  questionId: string
  publicId: string
  category: MistakeCategory
  personalNote: string | null
  mistakeCount: number
  corrected: boolean
  lastAttemptAt: string
  lastAnswer: { selectedOptions?: number[]; numericalValue?: string; at: string } | null
  nextRevisionAt: string | null
  lastReviewedAt: string | null
  subject: string
  chapter: { key: string; name: string }
  type: 'mcq_single' | 'mcq_multi' | 'numerical'
  text: string
  options: { idx: number; text: string }[]
  images: { url: string; altText: string; caption?: string }[]
  correctOptions?: number[]
  numericalAnswer?: number
  solution: {
    keyConcept?: string
    formulas: string[]
    body: string
    commonMistakes?: string
    verification?: string
    reviewStatus?: string
  } | null
  sourceYear?: number
  sourceShift?: string
  difficulty: string
}

interface NotebookData {
  total: number
  corrected: number
  page: number
  pageSize: number
  subjectWise: Record<string, number>
  chapterWise: Record<string, { name: string; subject: string; count: number }>
  categoryWise: Record<string, number>
  entries: MistakeEntry[]
}

const SUBJECT_ORDER: SubjectKey[] = ['physics', 'chemistry', 'mathematics']

const TYPE_SHORT: Record<MistakeEntry['type'], string> = {
  mcq_single: 'Single correct',
  mcq_multi: 'Multiple correct',
  numerical: 'Numerical',
}

const SORTS = [
  { value: 'recent', label: 'Most recent' },
  { value: 'most_repeated', label: 'Most repeated' },
  { value: 'least_revised', label: 'Least revised' },
] as const

const OPTION_LABELS = ['A', 'B', 'C', 'D', 'E', 'F']

const fmtDate = (iso: string) =>
  new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })

// ================================================================ main view
export function NotebookView() {
  // ---------- filters ----------
  const [subject, setSubject] = useState('all')
  const [chapter, setChapter] = useState('all')
  const [category, setCategory] = useState('all')
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [sort, setSort] = useState<string>('recent')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [page, setPage] = useState(1)

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search.trim()), 350)
    return () => clearTimeout(t)
  }, [search])

  const hasFilters =
    subject !== 'all' || chapter !== 'all' || category !== 'all' ||
    search.trim() !== '' || dateFrom !== '' || dateTo !== ''

  const qs = useMemo(() => {
    const sp = new URLSearchParams()
    if (subject !== 'all') sp.set('subject', subject)
    if (chapter !== 'all') sp.set('chapter', chapter)
    if (category !== 'all') sp.set('category', category)
    if (debouncedSearch) sp.set('search', debouncedSearch)
    if (sort !== 'recent') sp.set('sort', sort)
    if (dateFrom) sp.set('dateFrom', dateFrom)
    if (dateTo) sp.set('dateTo', dateTo)
    if (page > 1) sp.set('page', String(page))
    return sp.toString()
  }, [subject, chapter, category, debouncedSearch, sort, dateFrom, dateTo, page])

  const { data, error, loading, reload } = useApi<NotebookData>(
    `/api/mistakes${qs ? `?${qs}` : ''}`,
    [qs]
  )

  // derived list with optimistic overrides: the override is keyed by the
  // query string, so it auto-invalidates when filters/page change (skeletons
  // take over because the override no longer matches) without effects.
  const [override, setOverride] = useState<{ qs: string; entries: MistakeEntry[] } | null>(null)
  const entries =
    override && override.qs === qs ? override.entries : data ? data.entries : null
  const applyToEntries = (fn: (prev: MistakeEntry[]) => MistakeEntry[]) =>
    setOverride({ qs, entries: fn(entries ?? []) })

  const totalPages = useMemo(
    () => Math.max(1, Math.ceil((data?.total ?? 0) / (data?.pageSize ?? 20))),
    [data]
  )

  const chapterOptions = useMemo(() => {
    const all = Object.entries(data?.chapterWise ?? {})
      .map(([key, c]) => ({ key, ...c }))
      .filter((c) => subject === 'all' || c.subject === subject)
    return all.sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
  }, [data, subject])

  const patchEntry = (id: string, patch: Partial<MistakeEntry>) => {
    applyToEntries((cur) => cur.map((e) => (e.id === id ? { ...e, ...patch } : e)))
  }

  const removeEntry = (id: string) => {
    const remaining = (entries ?? []).filter((e) => e.id !== id)
    setOverride({ qs, entries: remaining })
    // deleting the last entry on a page > 1 → step back one page
    if (remaining.length === 0 && page > 1) setPage(Math.max(1, page - 1))
    reload()
  }

  const clearFilters = () => {
    setSubject('all')
    setChapter('all')
    setCategory('all')
    setSearch('')
    setDebouncedSearch('')
    setDateFrom('')
    setDateTo('')
    setSort('recent')
    setPage(1)
  }

  // ---------- states ----------
  if (error?.includes('Not authenticated')) {
    return (
      <div className="mx-auto max-w-lg rounded-2xl border border-dashed border-border p-10 text-center">
        <NotebookPen className="mx-auto h-10 w-10 text-muted-foreground" />
        <h2 className="mt-4 text-lg font-semibold">The Mistake Notebook needs an account</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Sign in free — wrong answers from practice collect here automatically so you can revise them.
        </p>
        <Button className="mt-5" onClick={() => navigate('/profile')}>Sign in / Create account</Button>
      </div>
    )
  }

  const skeleton = (
    <div className="mt-4 space-y-3">
      <Skeleton className="h-10" />
      <Skeleton className="h-44" />
      <Skeleton className="h-44" />
      <Skeleton className="h-44" />
    </div>
  )

  if (loading && !entries) return (
    <div className="mx-auto max-w-4xl">
      <h1 className="flex items-center gap-2.5 text-2xl font-bold tracking-tight">
        <NotebookPen className="h-6 w-6 text-primary" /> Mistake Notebook
      </h1>
      {skeleton}
    </div>
  )

  if (error && !entries) {
    return (
      <div className="mx-auto max-w-lg rounded-2xl border border-dashed border-border p-10 text-center">
        <AlertTriangle className="mx-auto h-10 w-10 text-muted-foreground" />
        <h2 className="mt-4 text-lg font-semibold">Could not load your notebook</h2>
        <p className="mt-2 text-sm text-muted-foreground">{error}</p>
        <Button className="mt-5" onClick={reload}>Try again</Button>
      </div>
    )
  }

  if (data && entries && entries.length === 0) {
    return (
      <div className="mx-auto max-w-3xl">
        <h1 className="flex items-center gap-2.5 text-2xl font-bold tracking-tight">
          <NotebookPen className="h-6 w-6 text-primary" /> Mistake Notebook
        </h1>
        <div className="mt-8 rounded-2xl border border-dashed border-border p-10 text-center">
          <NotebookPen className="mx-auto h-10 w-10 text-muted-foreground" />
          {hasFilters ? (
            <>
              <h2 className="mt-4 text-lg font-semibold">No mistakes match these filters</h2>
              <p className="mt-2 text-sm text-muted-foreground">Try widening the subject, category or date range.</p>
              <Button variant="outline" className="mt-5" onClick={clearFilters}>
                <X className="mr-1.5 h-4 w-4" /> Clear filters
              </Button>
            </>
          ) : (
            <>
              <h2 className="mt-4 text-lg font-semibold">No mistakes saved yet</h2>
              <p className="mt-2 text-sm text-muted-foreground">
                They&apos;ll collect here automatically when you answer incorrectly in practice
              </p>
              <Button className="mt-5" onClick={() => navigate('/practice')}>Start practicing</Button>
            </>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-4xl">
      <h1 className="flex items-center gap-2.5 text-2xl font-bold tracking-tight">
        <NotebookPen className="h-6 w-6 text-primary" /> Mistake Notebook
      </h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Every wrong practice answer, auto-collected — categorize it, note why, and retry until it sticks.
      </p>

      {/* headline: total + corrected */}
      <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-1.5 text-sm">
        <span>
          <span className="text-xl font-bold">{data?.total ?? 0}</span>{' '}
          <span className="text-muted-foreground">mistake{(data?.total ?? 0) === 1 ? '' : 's'} saved</span>
        </span>
        <span className="flex items-center gap-1.5">
          <CheckCircle2 className="h-4 w-4 text-emerald-400" />
          <span className="font-semibold">{data?.corrected ?? 0}</span>{' '}
          <span className="text-muted-foreground">corrected on retry</span>
        </span>
      </div>

      {/* stat chips: subject-wise + category-wise breakdowns */}
      {data && data.total > 0 && (
        <div className="mt-4 space-y-1.5">
          <div className="flex flex-wrap items-center gap-1.5">
            {SUBJECT_ORDER.filter((k) => (data.subjectWise[k] ?? 0) > 0).map((k) => (
              <span key={k} className="flex items-center gap-1.5 rounded-full border border-border/70 px-2.5 py-1 text-xs">
                <span className="h-2 w-2 rounded-full" style={{ background: SUBJECT_COLORS[k] }} />
                <span className="text-muted-foreground">{SUBJECT_META[k].name}</span>
                <span className="font-semibold">{data.subjectWise[k]}</span>
              </span>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            {MISTAKE_CATEGORIES.filter((c) => (data.categoryWise[c] ?? 0) > 0).map((c) => (
              <span key={c} className={cn('flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium', CATEGORY_META[c].chip)}>
                {CATEGORY_META[c].label}
                <span className="font-semibold">{data.categoryWise[c]}</span>
              </span>
            ))}
          </div>
        </div>
      )}

      {/* filters */}
      <Card className="mt-4">
        <CardContent className="p-4">
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-4">
            <FilterField label="Subject">
              <Select
                value={subject}
                onValueChange={(v) => { setSubject(v); setChapter('all'); setPage(1) }}
              >
                <SelectTrigger className="w-full" aria-label="Filter by subject">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All subjects</SelectItem>
                  {SUBJECT_ORDER.map((k) => (
                    <SelectItem key={k} value={k}>{SUBJECT_META[k].name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FilterField>
            <FilterField label="Chapter">
              <Select value={chapter} onValueChange={(v) => { setChapter(v); setPage(1) }}>
                <SelectTrigger className="w-full" aria-label="Filter by chapter">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All chapters</SelectItem>
                  {chapterOptions.map((c) => (
                    <SelectItem key={c.key} value={c.key}>{c.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FilterField>
            <FilterField label="Category">
              <Select value={category} onValueChange={(v) => { setCategory(v); setPage(1) }}>
                <SelectTrigger className="w-full" aria-label="Filter by mistake category">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All categories</SelectItem>
                  {MISTAKE_CATEGORIES.map((c) => (
                    <SelectItem key={c} value={c}>{CATEGORY_META[c].label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FilterField>
            <FilterField label="Sort by">
              <Select value={sort} onValueChange={(v) => { setSort(v); setPage(1) }}>
                <SelectTrigger className="w-full" aria-label="Sort entries">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SORTS.map((s) => (
                    <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FilterField>
            <div className="col-span-2 sm:col-span-3 lg:col-span-2">
              <FilterField label="Search">
                <div className="relative">
                  <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    value={search}
                    onChange={(e) => { setSearch(e.target.value); setPage(1) }}
                    placeholder="Search question text or ID…"
                    className="pl-8"
                    aria-label="Search mistakes"
                  />
                </div>
              </FilterField>
            </div>
            <FilterField label="From">
              <Input
                type="date"
                value={dateFrom}
                onChange={(e) => { setDateFrom(e.target.value); setPage(1) }}
                aria-label="Mistakes from date"
                className="[color-scheme:dark]"
              />
            </FilterField>
            <FilterField label="To">
              <Input
                type="date"
                value={dateTo}
                onChange={(e) => { setDateTo(e.target.value); setPage(1) }}
                aria-label="Mistakes to date"
                className="[color-scheme:dark]"
              />
            </FilterField>
          </div>
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs text-muted-foreground">
              {data ? `${data.total} entr${data.total === 1 ? 'y' : 'ies'}` : ''}
            </p>
            <Button variant="ghost" size="sm" onClick={clearFilters} disabled={!hasFilters}>
              <X className="mr-1.5 h-3.5 w-3.5" /> Clear filters
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* refetch failure while a list is already on screen */}
      {error && entries && (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-rose-400/30 bg-rose-400/[0.06] px-3 py-2 text-sm text-rose-300">
          <span>Could not refresh — {error}</span>
          <Button variant="outline" size="sm" onClick={reload}>Try again</Button>
        </div>
      )}

      {/* entries */}
      {entries && entries.length > 0 && (
        <div className="mt-4 space-y-3">
          {entries.map((e) => (
            <EntryCard key={e.id} entry={e} onPatch={patchEntry} onRemove={removeEntry} />
          ))}
        </div>
      )}

      {/* pagination */}
      {entries && entries.length > 0 && totalPages > 1 && (
        <div className="mt-4 flex items-center justify-between gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={page <= 1 || loading}
            onClick={() => { setPage(Math.max(1, page - 1)); window.scrollTo({ top: 0 }) }}
          >
            <ChevronLeft className="mr-1 h-4 w-4" /> Previous
          </Button>
          <span className="text-xs text-muted-foreground">
            Page {page} of {totalPages}
          </span>
          <Button
            variant="outline"
            size="sm"
            disabled={page >= totalPages || loading}
            onClick={() => { setPage(Math.min(totalPages, page + 1)); window.scrollTo({ top: 0 }) }}
          >
            Next <ChevronRight className="ml-1 h-4 w-4" />
          </Button>
        </div>
      )}
    </div>
  )
}

// ================================================================ helpers
function FilterField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        {label}
      </span>
      {children}
    </div>
  )
}

/** question image with a click-to-zoom dialog (same pattern as QuestionCard) */
function ZoomableImage({ src, alt, caption }: { src: string; alt: string; caption?: string }) {
  const [zoom, setZoom] = useState(false)
  return (
    <figure className="min-w-0">
      <button
        type="button"
        onClick={() => setZoom(true)}
        className="group relative block w-full overflow-hidden rounded-lg border border-border bg-black/20"
        aria-label={`Zoom image: ${alt}`}
      >
        <img src={src} alt={alt} className="mx-auto max-h-40 w-auto max-w-full p-1.5" loading="lazy" />
        <span className="absolute right-1.5 top-1.5 rounded-md bg-black/60 p-1 opacity-0 transition-opacity group-hover:opacity-100">
          <ZoomIn className="h-3.5 w-3.5 text-white" />
        </span>
      </button>
      {caption && <figcaption className="mt-1 truncate text-center text-[11px] text-muted-foreground">{caption}</figcaption>}
      <Dialog open={zoom} onOpenChange={setZoom}>
        <DialogContent className="max-w-4xl">
          <DialogTitle className="sr-only">{alt}</DialogTitle>
          <img src={src} alt={alt} className="mx-auto max-h-[75vh] w-auto max-w-full" />
          <DialogDescription className="text-center">{caption ?? alt}</DialogDescription>
        </DialogContent>
      </Dialog>
    </figure>
  )
}

// ================================================================ entry card
function EntryCard({
  entry,
  onPatch,
  onRemove,
}: {
  entry: MistakeEntry
  onPatch: (id: string, patch: Partial<MistakeEntry>) => void
  onRemove: (id: string) => void
}) {
  const [cat, setCat] = useState<MistakeCategory>(entry.category)
  const [catSaving, setCatSaving] = useState(false)
  const [expanded, setExpanded] = useState(false)

  // personal note editing
  const [noteOpen, setNoteOpen] = useState(false)
  const [noteText, setNoteText] = useState(entry.personalNote ?? '')
  const [savingNote, setSavingNote] = useState(false)
  // set on mousedown of Cancel so the textarea blur handler skips saving
  const cancelRef = useRef(false)

  // delete confirm
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [deleting, setDeleting] = useState(false)

  // keep local state in sync when a background refresh swaps the entry
  useEffect(() => { setCat(entry.category) }, [entry.category])
  useEffect(() => {
    if (!noteOpen) setNoteText(entry.personalNote ?? '')
  }, [entry.personalNote, noteOpen])

  const subjectMeta = SUBJECT_META[entry.subject as SubjectKey]
  const diff = DIFFICULTY_META[entry.difficulty as Difficulty] ?? {
    label: entry.difficulty, className: 'text-muted-foreground',
  }
  const picked = entry.lastAnswer?.selectedOptions
  const yourAnswer = !entry.lastAnswer
    ? null
    : picked && picked.length > 0
      ? `${picked.length > 1 ? 'Options' : 'Option'} ${picked.map((i) => OPTION_LABELS[i]).join(', ')}`
      : entry.lastAnswer.numericalValue?.trim()
        ? entry.lastAnswer.numericalValue.trim()
        : null
  const correctAnswer = entry.correctOptions?.length
    ? entry.correctOptions.map((i) => OPTION_LABELS[i]).join(', ')
    : entry.numericalAnswer != null
      ? String(entry.numericalAnswer)
      : null
  const overdue = entry.nextRevisionAt ? new Date(entry.nextRevisionAt).getTime() < Date.now() : false
  const sol = entry.solution

  // ---------- mutations ----------
  const changeCategory = async (next: string) => {
    const value = next as MistakeCategory
    if (value === cat || catSaving) return
    const prev = cat
    setCat(value)
    setCatSaving(true)
    try {
      await api('/api/mistakes', { id: entry.id, category: value }, 'PATCH')
      onPatch(entry.id, { category: value })
      toast({ title: 'Category updated' })
    } catch (e) {
      setCat(prev)
      toast({ title: 'Could not update category', description: (e as Error).message, variant: 'destructive' })
    } finally {
      setCatSaving(false)
    }
  }

  const saveNote = async () => {
    if (savingNote) return
    const trimmed = noteText.trim()
    if (trimmed === (entry.personalNote ?? '').trim()) {
      setNoteOpen(false)
      return
    }
    setSavingNote(true)
    try {
      await api('/api/mistakes', { id: entry.id, personalNote: trimmed }, 'PATCH')
      onPatch(entry.id, { personalNote: trimmed })
      setNoteOpen(false)
      toast({ title: 'Note saved' })
    } catch (e) {
      toast({ title: 'Could not save note', description: (e as Error).message, variant: 'destructive' })
    } finally {
      setSavingNote(false)
    }
  }

  const cancelNote = () => {
    cancelRef.current = false
    setNoteText(entry.personalNote ?? '')
    setNoteOpen(false)
  }

  const doDelete = async () => {
    if (deleting) return
    setDeleting(true)
    try {
      await api(`/api/mistakes?id=${encodeURIComponent(entry.id)}`, undefined, 'DELETE')
      toast({ title: 'Removed from notebook' })
      setConfirmDelete(false)
      onRemove(entry.id)
    } catch (e) {
      toast({ title: 'Could not remove entry', description: (e as Error).message, variant: 'destructive' })
      setDeleting(false)
    }
  }

  return (
    <div className="rounded-xl border border-border bg-card p-4">
      {/* top meta row */}
      <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1.5 text-xs text-muted-foreground">
        <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
          <span className="font-mono text-[11px]">{entry.publicId}</span>
          <span className="font-medium" style={{ color: SUBJECT_COLORS[entry.subject] }}>
            {subjectMeta?.name ?? entry.subject}
          </span>
          <span className="opacity-60">·</span>
          <span className="max-w-[240px] truncate">{entry.chapter.name}</span>
          {entry.sourceYear != null && (
            <Badge variant="outline" className="border-border/70 font-normal">{entry.sourceYear}</Badge>
          )}
          {entry.sourceShift && (
            <Badge variant="outline" className="border-border/70 font-normal">{entry.sourceShift}</Badge>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-2.5">
          <span className="flex items-center gap-1 font-medium text-rose-300/90">
            <Repeat className="h-3.5 w-3.5" /> Missed {entry.mistakeCount}×
          </span>
          {entry.corrected && (
            <span className="flex items-center gap-1 font-medium text-emerald-400">
              <CheckCircle2 className="h-3.5 w-3.5" /> Corrected
            </span>
          )}
        </div>
      </div>

      {/* question text */}
      <div className="mt-2.5 text-sm leading-relaxed">
        <MathText text={entry.text} />
      </div>

      {/* question images */}
      {entry.images.length > 0 && (
        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
          {entry.images.map((img, i) => (
            <ZoomableImage key={i} src={img.url} alt={img.altText} caption={img.caption} />
          ))}
        </div>
      )}

      {/* meta badges row */}
      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        {/* editable mistake category */}
        <Select value={cat} onValueChange={changeCategory}>
          <SelectTrigger
            size="sm"
            disabled={catSaving}
            aria-label="Edit mistake category"
            className={cn('rounded-full border px-3 text-[11px] font-medium', CATEGORY_META[cat].chip)}
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {MISTAKE_CATEGORIES.map((c) => (
              <SelectItem key={c} value={c} className="text-xs">{CATEGORY_META[c].label}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Badge variant="outline" className={cn('font-normal', diff.className)}>{diff.label}</Badge>
        <Badge variant="outline" className="border-border/70 font-normal">{TYPE_SHORT[entry.type]}</Badge>
        {correctAnswer != null && (
          <Badge variant="outline" className="border-emerald-400/30 bg-emerald-400/10 font-normal text-emerald-300">
            Answer: {correctAnswer}
          </Badge>
        )}
        {yourAnswer != null && (
          <span className="text-xs text-muted-foreground">
            Your answer: <span className="font-medium text-rose-300">{yourAnswer}</span>
          </span>
        )}
        <span className="text-xs text-muted-foreground">Attempted {fmtDate(entry.lastAttemptAt)}</span>
        {entry.nextRevisionAt && (
          <span
            className={cn(
              'flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium',
              overdue ? 'border-amber-400/40 bg-amber-400/10 text-amber-400' : 'border-border/70 text-muted-foreground'
            )}
          >
            <CalendarClock className="h-3 w-3" />
            {overdue ? 'Revision due · ' : 'Revise by '}
            {fmtDate(entry.nextRevisionAt)}
          </span>
        )}
      </div>

      {/* personal note */}
      <div className="mt-3 rounded-lg border border-border/70 bg-muted/30 p-3">
        {noteOpen ? (
          <div>
            <Textarea
              value={noteText}
              onChange={(e) => setNoteText(e.target.value)}
              onFocus={() => { cancelRef.current = false }}
              onBlur={() => { if (!cancelRef.current) void saveNote() }}
              placeholder="Why did you miss this? What should you remember next time?"
              maxLength={2000}
              autoFocus
              className="min-h-[72px] bg-background/60 text-sm"
              aria-label="Personal note"
            />
            <div className="mt-2 flex items-center gap-2">
              <Button size="sm" onClick={() => void saveNote()} disabled={savingNote}>
                {savingNote
                  ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                  : <Check className="mr-1.5 h-3.5 w-3.5" />}
                {savingNote ? 'Saving…' : 'Save note'}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onMouseDown={() => { cancelRef.current = true }}
                onClick={cancelNote}
                disabled={savingNote}
              >
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => { setNoteText(entry.personalNote ?? ''); setNoteOpen(true) }}
            className="group flex w-full items-start gap-2 text-left"
          >
            <StickyNote className={cn('mt-0.5 h-3.5 w-3.5 shrink-0', entry.personalNote ? 'text-amber-400/80' : 'text-muted-foreground/60')} />
            {entry.personalNote ? (
              <span className="text-sm italic leading-relaxed text-muted-foreground">{entry.personalNote}</span>
            ) : (
              <span className="text-sm text-muted-foreground/60 transition-colors group-hover:text-muted-foreground">
                Add a personal note — why you missed it, what to remember…
              </span>
            )}
          </button>
        )}
      </div>

      {/* actions */}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button size="sm" onClick={() => navigate(`/practice?retry=${entry.questionId}`)}>
          <RotateCcw className="mr-1.5 h-3.5 w-3.5" /> Retry
        </Button>
        <Button size="sm" variant="outline" onClick={() => setExpanded(!expanded)}>
          <BookOpenCheck className="mr-1.5 h-3.5 w-3.5" />
          {expanded ? 'Hide solution' : 'Show solution'}
          <ChevronDown className={cn('ml-1 h-3.5 w-3.5 transition-transform', expanded && 'rotate-180')} />
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="ml-auto text-rose-400 hover:bg-rose-400/10 hover:text-rose-300"
          onClick={() => setConfirmDelete(true)}
        >
          <Trash2 className="mr-1.5 h-3.5 w-3.5" /> Remove
        </Button>
      </div>

      {/* expandable: options + full solution */}
      {expanded && (
        <div className="mt-3 space-y-3">
          {/* options with correct / your-pick highlighting */}
          {entry.options.length > 0 && (
            <div className="space-y-1.5">
              {entry.options.map((o) => {
                const isCorrect = entry.correctOptions?.includes(o.idx) ?? false
                const isPicked = picked?.includes(o.idx) ?? false
                return (
                  <div
                    key={o.idx}
                    className={cn(
                      'flex items-start gap-2.5 rounded-lg border px-3 py-2 text-sm',
                      isCorrect && 'border-emerald-400/40 bg-emerald-400/[0.07]',
                      !isCorrect && isPicked && 'border-rose-400/40 bg-rose-400/[0.07]',
                      !isCorrect && !isPicked && 'border-border/60'
                    )}
                  >
                    <span
                      className={cn(
                        'mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-[11px] font-semibold',
                        isCorrect ? 'border-emerald-400/50 text-emerald-400'
                          : isPicked ? 'border-rose-400/50 text-rose-400'
                            : 'border-border text-muted-foreground'
                      )}
                    >
                      {OPTION_LABELS[o.idx]}
                    </span>
                    <div className="min-w-0 flex-1 leading-relaxed">
                      <MathText text={o.text} />
                    </div>
                    {isCorrect && <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" />}
                    {!isCorrect && isPicked && <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-rose-400" />}
                  </div>
                )
              })}
            </div>
          )}

          {/* numerical compare */}
          {entry.type === 'numerical' && (
            <div className="flex flex-wrap gap-x-6 gap-y-1 rounded-lg border border-border/60 px-3 py-2.5 text-sm">
              <span className="text-muted-foreground">
                Your answer: <span className="font-semibold text-rose-400">{entry.lastAnswer?.numericalValue?.trim() || '—'}</span>
              </span>
              <span className="text-muted-foreground">
                Correct: <span className="font-semibold text-primary">{entry.numericalAnswer ?? '—'}</span>
              </span>
            </div>
          )}

          {/* solution */}
          {sol ? (
            <div className="rounded-xl border border-primary/25 bg-primary/[0.04] p-4">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <h4 className="text-sm font-semibold text-primary">Solution</h4>
                {sol.reviewStatus === 'ai_generated' && (
                  <Badge variant="outline" className="border-amber-500/30 bg-amber-500/10 text-[11px] font-normal text-amber-400">
                    AI-generated · pending verification
                  </Badge>
                )}
              </div>

              {sol.keyConcept && (
                <div className="mb-3 min-w-0 rounded-lg border border-border bg-card/60 p-3.5">
                  <p className="mb-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Concept</p>
                  <div className="text-sm leading-relaxed"><MathText text={sol.keyConcept} /></div>
                </div>
              )}

              {(sol.formulas ?? []).length > 0 && (
                <div className="mb-3 rounded-lg border border-violet-400/20 bg-violet-400/[0.06] p-3.5">
                  <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-violet-300/90">Formulas used</p>
                  <ul className="space-y-1.5">
                    {(sol.formulas ?? []).map((f, i) => (
                      <li key={i} className="min-w-0 break-words border-l-2 border-violet-400/40 pl-3 text-sm">
                        <MathText text={`$${f}$`} />
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              <div className="text-sm leading-relaxed">
                <MathText text={sol.body} />
              </div>

              {sol.commonMistakes && (
                <div className="mt-3 rounded-lg border border-rose-400/20 bg-rose-400/[0.06] p-3.5">
                  <p className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-rose-300/90">Common mistakes</p>
                  <div className="text-sm leading-relaxed"><MathText text={sol.commonMistakes} /></div>
                </div>
              )}

              {sol.verification && (
                <div className="mt-3 rounded-lg border border-emerald-400/20 bg-emerald-400/[0.06] p-3.5">
                  <p className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-emerald-300/90">Final verification</p>
                  <div className="text-sm leading-relaxed"><MathText text={sol.verification} /></div>
                </div>
              )}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">No solution available for this question yet.</p>
          )}
        </div>
      )}

      {/* delete confirm */}
      <Dialog open={confirmDelete} onOpenChange={(open) => { if (!deleting) setConfirmDelete(open) }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Remove from notebook?</DialogTitle>
            <DialogDescription>
              This entry will be deleted. If you miss the question again in practice, it will be re-added automatically.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setConfirmDelete(false)} disabled={deleting}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={() => void doDelete()} disabled={deleting}>
              {deleting
                ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                : <Trash2 className="mr-1.5 h-4 w-4" />}
              {deleting ? 'Removing…' : 'Remove'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
