'use client'

// JEE NEXUS — formula cards library: search/filter, favourites, learned
// tracking, personal notes, hide-and-reveal revision mode and a self-graded
// quiz. Cards are served by GET /api/formulas; progress actions POST to it.
import { useEffect, useMemo, useState } from 'react'
import {
  ArrowLeft, Brain, Check, CheckCheck, ChevronDown, Eye, EyeOff, RefreshCw,
  Search, SquareRadical, Star, StickyNote, Undo2, X,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { ToastAction } from '@/components/ui/toast'
import { MathText } from '@/components/MathText'
import { api, navigate, useApi } from '@/lib/client'
import { SUBJECT_META, type SubjectKey } from '@/lib/types'
import { cn } from '@/lib/utils'
import { toast } from '@/hooks/use-toast'

// ---------- types ----------

interface FormulaCardData {
  id: string
  subject: SubjectKey
  chapterKey: string
  topic?: string
  title: string
  formula: string
  explanation?: string
  conditions?: string
  units?: string
  tags: string[]
  favorite: boolean
  learned: boolean
  personalNote?: string
  quizSeen: number
  quizCorrect: number
}

interface FormulasResponse {
  cards: FormulaCardData[]
  /** true when favourites were requested while signed out */
  cardsRestricted?: boolean
}

interface TaxonomySubject {
  key: SubjectKey
  name: string
  chapters: { key: string; name: string; unit?: string | null }[]
}

interface Props {
  /** app shell passes its shared taxonomy; otherwise fetched standalone */
  taxonomy?: TaxonomySubject[] | null
  loggedIn?: boolean
  onRequireAuth?: () => void
}

const QUIZ_LENGTH = 10

const SUBJECT_CHIPS: { key: 'all' | SubjectKey; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'physics', label: SUBJECT_META.physics.name },
  { key: 'chemistry', label: SUBJECT_META.chemistry.name },
  { key: 'mathematics', label: SUBJECT_META.mathematics.name },
]

function shuffle<T>(items: T[]): T[] {
  const arr = [...items]
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[arr[i], arr[j]] = [arr[j], arr[i]]
  }
  return arr
}

// ---------- main view ----------

export function FormulasView({ taxonomy: taxonomyProp, loggedIn: loggedInProp, onRequireAuth }: Props) {
  // taxonomy: prop first, standalone fetch as fallback
  const taxonomyApi = useApi<{ subjects: TaxonomySubject[] }>(
    taxonomyProp && taxonomyProp.length > 0 ? null : '/api/taxonomy'
  )
  const subjects = taxonomyProp && taxonomyProp.length > 0 ? taxonomyProp : taxonomyApi.data?.subjects ?? null

  // login state: prop first, /api/auth/me as fallback
  const meApi = useApi<{ user: { id: string } | null }>(loggedInProp === undefined ? '/api/auth/me' : null)
  const signedIn = loggedInProp ?? !!meApi.data?.user

  // ---------- filters ----------
  const [searchInput, setSearchInput] = useState('')
  const [search, setSearch] = useState('')
  const [subject, setSubject] = useState<'all' | SubjectKey>('all')
  const [chapter, setChapter] = useState('all')
  const [favoritesOnly, setFavoritesOnly] = useState(false)
  const [unlearnedOnly, setUnlearnedOnly] = useState(false)

  useEffect(() => {
    const t = setTimeout(() => setSearch(searchInput.trim()), 300)
    return () => clearTimeout(t)
  }, [searchInput])

  const query = useMemo(() => {
    const sp = new URLSearchParams()
    if (subject !== 'all') sp.set('subject', subject)
    if (chapter !== 'all') sp.set('chapter', chapter)
    if (search) sp.set('search', search)
    if (favoritesOnly) sp.set('favorites', '1')
    if (unlearnedOnly) sp.set('unlearned', '1')
    const qs = sp.toString()
    return qs ? `?${qs}` : ''
  }, [subject, chapter, search, favoritesOnly, unlearnedOnly])

  const { data, loading, error, reload } = useApi<FormulasResponse>(`/api/formulas${query}`)

  // optimistic local overrides (PATCH/UPDATE actions) — cleared automatically
  // when the query changes because the override is keyed by its query string
  const [override, setOverride] = useState<{ query: string; cards: FormulaCardData[] } | null>(null)
  const cards = override && override.query === query ? override.cards : (data?.cards ?? [])
  const restricted = !!data?.cardsRestricted

  // keep the override in sync with the live copy when a background reload lands
  const applyToCards = (fn: (prev: FormulaCardData[]) => FormulaCardData[]) =>
    setOverride({ query, cards: fn(cards) })

  // ---------- revision (hide-and-reveal) mode ----------
  const [revision, setRevision] = useState(false)
  const [revealedIds, setRevealedIds] = useState<Set<string>>(new Set())
  const revealCard = (id: string) =>
    setRevealedIds((prev) => {
      const next = new Set(prev)
      next.add(id)
      return next
    })
  const hideAll = () => setRevealedIds(new Set())
  const toggleRevision = () => {
    setRevision((v) => !v)
    setRevealedIds(new Set())
  }

  // ---------- explanation collapse ----------
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const toggleExpand = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  // ---------- personal notes ----------
  const [noteEdit, setNoteEdit] = useState<{ cardId: string; draft: string } | null>(null)
  const [savingNote, setSavingNote] = useState(false)

  // ---------- quiz mode ----------
  interface QuizResult {
    card: FormulaCardData
    correct: boolean
  }
  interface QuizState {
    queue: FormulaCardData[]
    index: number
    revealed: boolean
    results: QuizResult[]
    done: boolean
  }
  const [quiz, setQuiz] = useState<QuizState | null>(null)

  // ---------- taxonomy helpers ----------
  const chapterOptions = useMemo(() => {
    if (!subjects) return []
    if (subject === 'all') {
      return subjects.flatMap((s) => s.chapters.map((c) => ({ key: c.key, label: `${s.name} — ${c.name}` })))
    }
    return (subjects.find((s) => s.key === subject)?.chapters ?? []).map((c) => ({ key: c.key, label: c.name }))
  }, [subjects, subject])

  const chapterNames = useMemo(() => {
    const m = new Map<string, string>()
    subjects?.forEach((s) => s.chapters.forEach((c) => m.set(c.key, c.name)))
    return m
  }, [subjects])

  const pickSubject = (key: 'all' | SubjectKey) => {
    setSubject(key)
    if (chapter !== 'all' && key !== 'all') {
      const stillValid = subjects?.find((s) => s.key === key)?.chapters.some((c) => c.key === chapter) ?? false
      if (!stillValid) setChapter('all')
    }
  }

  const hasActiveFilters =
    subject !== 'all' || chapter !== 'all' || search !== '' || favoritesOnly || unlearnedOnly

  const clearFilters = () => {
    setSearchInput('')
    setSearch('')
    setSubject('all')
    setChapter('all')
    setFavoritesOnly(false)
    setUnlearnedOnly(false)
  }

  const learnedCount = cards.filter((c) => c.learned).length
  const favoriteCount = cards.filter((c) => c.favorite).length

  // ---------- progress actions ----------

  const promptSignIn = () => {
    if (onRequireAuth) {
      onRequireAuth()
      return
    }
    toast({
      title: 'Sign in to save progress',
      description: 'Favourites, learned marks and notes sync to your free account.',
      action: <ToastAction altText="Sign in" onClick={() => navigate('/profile')}>Sign in</ToastAction>,
    })
  }

  const runAction = async (cardId: string, action: string, extra?: Record<string, unknown>) => {
    try {
      await api('/api/formulas', { cardId, action, ...extra })
      return true
    } catch (e) {
      toast({ title: 'Could not save', description: (e as Error).message, variant: 'destructive' })
      reload()
      return false
    }
  }

  const toggleFavorite = (c: FormulaCardData) => {
    if (!signedIn) {
      promptSignIn()
      return
    }
    const next = !c.favorite
    applyToCards((cur) => cur.map((x) => (x.id === c.id ? { ...x, favorite: next } : x)))
    if (!next && favoritesOnly) applyToCards((cur) => cur.filter((x) => x.id !== c.id))
    void runAction(c.id, next ? 'favorite' : 'unfavorite')
  }

  const toggleLearned = (c: FormulaCardData) => {
    if (!signedIn) {
      promptSignIn()
      return
    }
    const next = !c.learned
    applyToCards((cur) => cur.map((x) => (x.id === c.id ? { ...x, learned: next } : x)))
    if (next && unlearnedOnly) applyToCards((cur) => cur.filter((x) => x.id !== c.id))
    void runAction(c.id, next ? 'learned' : 'unlearned')
  }

  const startNote = (c: FormulaCardData) => {
    if (!signedIn) {
      promptSignIn()
      return
    }
    setNoteEdit({ cardId: c.id, draft: c.personalNote ?? '' })
  }

  const saveNote = async () => {
    if (!noteEdit) return
    setSavingNote(true)
    const { cardId, draft } = noteEdit
    const ok = await runAction(cardId, 'note', { note: draft })
    setSavingNote(false)
    if (!ok) return
    applyToCards((cur) => cur.map((x) => (x.id === cardId ? { ...x, personalNote: draft } : x)))
    setNoteEdit(null)
    toast({ title: 'Note saved' })
  }

  // ---------- quiz ----------

  const startQuiz = () => {
    if (cards.length === 0) {
      toast({
        title: 'Nothing to quiz on',
        description: 'No cards match the current filters — clear them first.',
      })
      return
    }
    const queue = shuffle(cards).slice(0, QUIZ_LENGTH)
    if (queue.length < QUIZ_LENGTH) {
      toast({
        title: `Quiz with ${queue.length} card${queue.length === 1 ? '' : 's'}`,
        description: 'Only this many cards match your current filters.',
      })
    }
    setQuiz({ queue, index: 0, revealed: false, results: [], done: false })
  }

  const gradeCard = (correct: boolean) => {
    if (!quiz || quiz.done) return
    const card = quiz.queue[quiz.index]
    if (signedIn) void runAction(card.id, 'quiz', { correct })
    else if (quiz.results.length === 0 && quiz.index === 0) {
      toast({
        title: 'Quiz progress is not saved',
        description: 'Self-grading still works — sign in so known/unknown stats stick to each card.',
        action: <ToastAction altText="Sign in" onClick={() => navigate('/profile')}>Sign in</ToastAction>,
      })
    }
    const results = [...quiz.results, { card, correct }]
    const index = quiz.index + 1
    setQuiz({ ...quiz, results, index, revealed: false, done: index >= quiz.queue.length })
  }

  // ---------- render ----------

  // QUIZ MODE — focused panel instead of the grid
  if (quiz) {
    const total = quiz.queue.length
    const known = quiz.results.filter((r) => r.correct).length
    const card = quiz.done ? null : quiz.queue[quiz.index]
    const meta = card ? SUBJECT_META[card.subject] : null
    return (
      <div className="mx-auto max-w-2xl">
        <Button variant="ghost" size="sm" onClick={() => setQuiz(null)} className="mb-4">
          <ArrowLeft className="mr-2 h-4 w-4" /> Back to the library
        </Button>

        {!quiz.done && card && (
          <Card className="overflow-hidden">
            <div className="h-1 w-full" style={{ background: meta ? `linear-gradient(90deg, ${meta.colorVar}, transparent)` : 'var(--primary)' }} />
            <CardContent className="p-5 sm:p-6">
              <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
                <span className="flex items-center gap-1.5 font-medium">
                  <Brain className="h-3.5 w-3.5 text-primary" /> Quiz · card {quiz.index + 1} of {total}
                </span>
                <span>{known} known so far</span>
              </div>
              <div
                className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted"
                role="progressbar"
                aria-valuenow={quiz.index}
                aria-valuemin={0}
                aria-valuemax={total}
              >
                <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${(quiz.index / total) * 100}%` }} />
              </div>

              <h2 className="mt-4 text-lg font-semibold leading-snug">{card.title}</h2>
              <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
                <span className="flex items-center gap-1">
                  <span className="h-1.5 w-1.5 rounded-full" style={{ background: meta?.colorVar }} />
                  {meta?.name}
                </span>
                <span>· {chapterNames.get(card.chapterKey) ?? card.chapterKey}</span>
                {card.topic && <Badge variant="outline" className="px-1.5 py-0 text-[10px]">{card.topic}</Badge>}
              </div>

              {card.conditions && (
                <div className="mt-3 rounded-lg border border-border/60 bg-muted/40 p-3 text-sm">
                  <span className="text-xs font-semibold text-muted-foreground">When to use: </span>
                  <MathText text={card.conditions} className="inline text-sm" />
                </div>
              )}
              {card.units && (
                <p className="mt-1.5 text-xs text-muted-foreground">Units: {card.units}</p>
              )}

              {quiz.revealed ? (
                <div className="mt-4 rounded-xl border border-primary/25 bg-primary/5 p-4 text-center">
                  <MathText text={card.formula} className="text-lg" />
                </div>
              ) : (
                <Button className="mt-4 w-full" onClick={() => setQuiz({ ...quiz, revealed: true })}>
                  <Eye className="mr-2 h-4 w-4" /> Reveal formula
                </Button>
              )}

              {quiz.revealed && (
                <div className="mt-4 grid grid-cols-2 gap-2">
                  <Button
                    variant="outline"
                    className="border-rose-400/30 text-rose-300 hover:bg-rose-400/10 hover:text-rose-200"
                    onClick={() => gradeCard(false)}
                  >
                    <X className="mr-2 h-4 w-4" /> Didn&rsquo;t know
                  </Button>
                  <Button
                    variant="outline"
                    className="border-emerald-400/30 text-emerald-300 hover:bg-emerald-400/10 hover:text-emerald-200"
                    onClick={() => gradeCard(true)}
                  >
                    <CheckCheck className="mr-2 h-4 w-4" /> I knew it
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {quiz.done && (
          <Card className="overflow-hidden">
            <div className="h-1 w-full" style={{ background: 'linear-gradient(90deg, var(--primary), transparent)' }} />
            <CardContent className="p-6 text-center">
              <Brain className="mx-auto h-10 w-10 text-primary" />
              <h2 className="mt-3 text-xl font-bold">
                You knew {known} of {total}
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">
                {known === total
                  ? 'Perfect recall — nothing to fix here.'
                  : `${total - known} card${total - known === 1 ? '' : 's'} to revise — they are listed below.`}
              </p>
              <div className="mx-auto mt-4 h-2 max-w-xs overflow-hidden rounded-full bg-muted">
                <div className="h-full rounded-full bg-primary" style={{ width: `${(known / total) * 100}%` }} />
              </div>
              {quiz.results.filter((r) => !r.correct).length > 0 && (
                <div className="mt-5 space-y-2 text-left">
                  {quiz.results
                    .filter((r) => !r.correct)
                    .map((r) => (
                      <div key={r.card.id} className="rounded-lg border border-border/60 p-3">
                        <div className="text-sm font-medium">{r.card.title}</div>
                        <MathText text={r.card.formula} className="mt-1 text-sm text-muted-foreground" />
                      </div>
                    ))}
                </div>
              )}
              <div className="mt-5 flex flex-wrap justify-center gap-2">
                <Button variant="outline" onClick={startQuiz}>
                  <RefreshCw className="mr-2 h-4 w-4" /> Quiz me again
                </Button>
                <Button onClick={() => setQuiz(null)}>
                  <SquareRadical className="mr-2 h-4 w-4" /> Back to the library
                </Button>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-6xl">
      {/* header */}
      <h1 className="flex items-center gap-2.5 text-2xl font-bold tracking-tight">
        <SquareRadical className="h-6 w-6 text-primary" /> Formula Cards
        {!loading && (
          <span className="text-sm font-normal text-muted-foreground">
            {cards.length} card{cards.length === 1 ? '' : 's'}
          </span>
        )}
      </h1>
      <p className="mt-1 text-sm text-muted-foreground">
        The results you must recall — star the tricky ones, mark them learned, quiz yourself.
      </p>

      {/* filters */}
      <div className="mt-5 space-y-3">
        <div className="flex flex-col gap-2 sm:flex-row">
          <div className="relative flex-1">
            <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Search formulas, topics, conditions…"
              className="pl-8"
              aria-label="Search formula cards"
            />
          </div>
          <Select value={chapter} onValueChange={setChapter}>
            <SelectTrigger className="w-full sm:w-60" aria-label="Filter by chapter">
              <SelectValue placeholder="All chapters" />
            </SelectTrigger>
            <SelectContent className="max-h-72">
              <SelectItem value="all">All chapters</SelectItem>
              {chapterOptions.map((c) => (
                <SelectItem key={c.key} value={c.key}>{c.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          {SUBJECT_CHIPS.map((chip) => {
            const active = subject === chip.key
            const meta = chip.key === 'all' ? null : SUBJECT_META[chip.key]
            return (
              <button
                key={chip.key}
                type="button"
                onClick={() => pickSubject(chip.key)}
                className={cn(
                  'rounded-full border px-3 py-1 text-xs font-medium transition-colors',
                  active
                    ? 'font-semibold'
                    : 'border-border text-muted-foreground hover:text-foreground'
                )}
                style={
                  active && meta
                    ? {
                        color: meta.colorVar,
                        borderColor: meta.colorVar,
                        background: `color-mix(in srgb, ${meta.colorVar} 12%, transparent)`,
                      }
                    : active
                      ? {
                          color: 'var(--primary)',
                          borderColor: 'var(--primary)',
                          background: 'color-mix(in srgb, var(--primary) 12%, transparent)',
                        }
                      : undefined
                }
              >
                {chip.label}
              </button>
            )
          })}

          <div className="ml-auto flex flex-wrap items-center gap-x-4 gap-y-2">
            <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
              <Switch
                id="favorites-only"
                checked={favoritesOnly}
                onCheckedChange={setFavoritesOnly}
                aria-label="Show favourites only"
              />
              <button type="button" onClick={() => setFavoritesOnly((v) => !v)} className="flex items-center gap-1">
                <Star className="h-3.5 w-3.5 text-amber-400" /> Favourites only
              </button>
            </div>
            <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
              <Switch
                id="unlearned-only"
                checked={unlearnedOnly}
                onCheckedChange={setUnlearnedOnly}
                aria-label="Show unlearned cards only"
              />
              <button type="button" onClick={() => setUnlearnedOnly((v) => !v)} className="flex items-center gap-1">
                <EyeOff className="h-3.5 w-3.5" /> Unlearned only
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* action row + counts */}
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <Button size="sm" variant="outline" onClick={startQuiz} disabled={cards.length === 0}>
          <Brain className="mr-1.5 h-3.5 w-3.5" /> Quiz me
        </Button>
        <Button
          size="sm"
          variant={revision ? 'default' : 'outline'}
          onClick={toggleRevision}
          className={revision ? 'nexus-glow' : undefined}
        >
          <EyeOff className="mr-1.5 h-3.5 w-3.5" />
          {revision ? 'Exit hide-and-reveal' : 'Hide formulas'}
        </Button>
        {revision && (
          <Button size="sm" variant="ghost" onClick={hideAll}>
            <Undo2 className="mr-1.5 h-3.5 w-3.5" /> Hide all
          </Button>
        )}
        <div className="ml-auto flex items-center gap-1.5">
          <span className="flex items-center gap-1 rounded-full border border-border bg-card px-2.5 py-1 text-[11px] font-medium text-muted-foreground">
            <CheckCheck className="h-3 w-3 text-emerald-400" />
            {learnedCount}/{cards.length} learned
          </span>
          <span className="flex items-center gap-1 rounded-full border border-border bg-card px-2.5 py-1 text-[11px] font-medium text-muted-foreground">
            <Star className="h-3 w-3 text-amber-400" />
            {favoriteCount} starred
          </span>
        </div>
      </div>

      {revision && (
        <p className="mt-2 text-xs text-muted-foreground">
          Revision mode — every formula is hidden. Tap a card to reveal it, and use{' '}
          <span className="font-medium text-foreground">Hide all</span> to cover them again.
        </p>
      )}

      {/* states */}
      {loading && (
        <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="overflow-hidden rounded-xl border border-border">
              <Skeleton className="h-1 w-full rounded-none" />
              <div className="space-y-3 p-4">
                <Skeleton className="h-4 w-2/3" />
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-3 w-1/2" />
                <Skeleton className="h-3 w-1/3" />
              </div>
            </div>
          ))}
        </div>
      )}

      {!loading && error && (
        <div className="mt-6 rounded-xl border border-rose-400/30 bg-rose-400/5 p-6 text-center">
          <p className="text-sm text-rose-300">{error}</p>
          <Button variant="outline" size="sm" className="mt-3" onClick={reload}>
            <RefreshCw className="mr-1.5 h-3.5 w-3.5" /> Retry
          </Button>
        </div>
      )}

      {!loading && !error && cards.length === 0 && favoritesOnly && restricted && (
        <div className="mt-6 rounded-2xl border border-dashed border-border p-10 text-center">
          <Star className="mx-auto h-10 w-10 text-muted-foreground" />
          <h2 className="mt-4 text-lg font-semibold">Favourites need an account</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            Sign in free to star cards, mark them learned and keep notes in sync.
          </p>
          <div className="mt-5 flex flex-wrap justify-center gap-2">
            <Button onClick={() => navigate('/profile')}>Sign in / Create account</Button>
            <Button variant="outline" onClick={() => setFavoritesOnly(false)}>Show all cards</Button>
          </div>
        </div>
      )}

      {!loading && !error && cards.length === 0 && !(favoritesOnly && restricted) && (
        <div className="mt-6 rounded-2xl border border-dashed border-border p-10 text-center">
          <SquareRadical className="mx-auto h-10 w-10 text-muted-foreground" />
          <h2 className="mt-4 text-lg font-semibold">
            {hasActiveFilters ? 'No formula cards match' : 'No formula cards yet'}
          </h2>
          <p className="mt-2 text-sm text-muted-foreground">
            {hasActiveFilters
              ? 'No formula cards match — try clearing filters.'
              : 'The library is being curated — check back soon.'}
          </p>
          {hasActiveFilters && (
            <Button variant="outline" className="mt-5" onClick={clearFilters}>
              Clear filters
            </Button>
          )}
        </div>
      )}

      {/* grid */}
      {!loading && !error && cards.length > 0 && (
        <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {cards.map((c) => (
            <FormulaCardTile
              key={c.id}
              card={c}
              chapterName={chapterNames.get(c.chapterKey)}
              revisionHidden={revision && !revealedIds.has(c.id)}
              expanded={expanded.has(c.id)}
              onToggleExpand={() => toggleExpand(c.id)}
              onReveal={() => revealCard(c.id)}
              onToggleFavorite={() => toggleFavorite(c)}
              onToggleLearned={() => toggleLearned(c)}
              editing={noteEdit?.cardId === c.id}
              noteDraft={noteEdit?.cardId === c.id ? noteEdit.draft : null}
              savingNote={savingNote}
              onNoteDraftChange={(draft) => setNoteEdit((prev) => (prev ? { ...prev, draft } : prev))}
              onStartNote={() => startNote(c)}
              onCancelNote={() => setNoteEdit(null)}
              onSaveNote={() => void saveNote()}
            />
          ))}
        </div>
      )}
    </div>
  )
}

// ---------- card tile ----------

interface TileProps {
  card: FormulaCardData
  chapterName?: string
  revisionHidden: boolean
  expanded: boolean
  onToggleExpand: () => void
  onReveal: () => void
  onToggleFavorite: () => void
  onToggleLearned: () => void
  editing: boolean
  noteDraft: string | null
  savingNote: boolean
  onNoteDraftChange: (draft: string) => void
  onStartNote: () => void
  onCancelNote: () => void
  onSaveNote: () => void
}

function FormulaCardTile({
  card,
  chapterName,
  revisionHidden,
  expanded,
  onToggleExpand,
  onReveal,
  onToggleFavorite,
  onToggleLearned,
  editing,
  noteDraft,
  savingNote,
  onNoteDraftChange,
  onStartNote,
  onCancelNote,
  onSaveNote,
}: TileProps) {
  const meta = SUBJECT_META[card.subject] ?? SUBJECT_META.physics
  return (
    <div className="relative overflow-hidden rounded-xl border border-border bg-card transition-colors hover:border-primary/40">
      <div className="absolute inset-y-0 left-0 w-1" style={{ background: meta.colorVar }} aria-hidden="true" />

      <div className="p-4 pl-5">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-muted-foreground">
              <span className="flex items-center gap-1">
                <span className="h-1.5 w-1.5 rounded-full" style={{ background: meta.colorVar }} />
                {meta.name}
              </span>
              {chapterName && <span className="truncate">· {chapterName}</span>}
              {card.topic && (
                <Badge variant="outline" className="px-1.5 py-0 text-[10px]">
                  {card.topic}
                </Badge>
              )}
            </div>
            <h3 className="mt-1.5 text-sm font-semibold leading-snug">{card.title}</h3>
          </div>

          <div className="flex shrink-0 items-center gap-1">
            <button
              type="button"
              onClick={onToggleFavorite}
              aria-label={card.favorite ? 'Remove from favourites' : 'Add to favourites'}
              className={cn(
                'rounded-lg border p-1.5 transition-colors',
                card.favorite
                  ? 'border-amber-400/40 bg-amber-400/10 text-amber-400'
                  : 'border-border text-muted-foreground hover:text-foreground'
              )}
            >
              <Star className={cn('h-4 w-4', card.favorite && 'fill-current')} />
            </button>
            <button
              type="button"
              onClick={onToggleLearned}
              aria-label={card.learned ? 'Mark as unlearned' : 'Mark as learned'}
              className={cn(
                'rounded-lg border p-1.5 transition-colors',
                card.learned
                  ? 'border-emerald-400/40 bg-emerald-400/10 text-emerald-400'
                  : 'border-border text-muted-foreground hover:text-foreground'
              )}
            >
              <Check className={cn('h-4 w-4', card.learned && 'font-bold')} />
            </button>
          </div>
        </div>

        {/* formula — hidden (blurred) in revision mode until tapped */}
        <div className="relative mt-3 overflow-hidden rounded-lg border border-border/70 bg-muted/40 px-3 py-3 text-center">
          <MathText
            text={card.formula}
            className={cn('text-base font-medium', revisionHidden && 'pointer-events-none blur-[7px] select-none')}
          />
          {revisionHidden && (
            <button
              type="button"
              onClick={onReveal}
              className="absolute inset-0 flex items-center justify-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground"
              aria-label={`Reveal formula for ${card.title}`}
            >
              <Eye className="h-3.5 w-3.5" /> Tap to reveal
            </button>
          )}
        </div>

        {card.conditions && (
          <div className="mt-2.5 text-xs leading-relaxed">
            <span className="font-medium text-muted-foreground">When to use: </span>
            <MathText text={card.conditions} className="inline text-foreground/85" />
          </div>
        )}
        {card.units && (
          <div className="mt-1 text-xs leading-relaxed">
            <span className="font-medium text-muted-foreground">Units: </span>
            <MathText text={card.units} className="inline text-foreground/85" />
          </div>
        )}

        {card.explanation && (
          <Collapsible open={expanded} onOpenChange={onToggleExpand}>
            <CollapsibleTrigger className="mt-2 flex items-center gap-1 text-xs font-medium text-primary/90 transition-colors hover:text-primary">
              <ChevronDown className={cn('h-3.5 w-3.5 transition-transform', expanded && 'rotate-180')} />
              Why it works
            </CollapsibleTrigger>
            <CollapsibleContent className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
              <MathText text={card.explanation} />
            </CollapsibleContent>
          </Collapsible>
        )}

        {card.tags.length > 0 && (
          <div className="mt-2.5 flex flex-wrap gap-1">
            {card.tags.map((t) => (
              <Badge key={t} variant="secondary" className="px-1.5 py-0 text-[10px]">
                {t}
              </Badge>
            ))}
          </div>
        )}

        {/* personal note — edit in place */}
        {editing ? (
          <div className="mt-3 rounded-lg border border-primary/25 bg-primary/5 p-2.5">
            <Textarea
              value={noteDraft ?? ''}
              onChange={(e) => onNoteDraftChange(e.target.value)}
              placeholder="Your note — a mnemonic, a trap to avoid, an edge case…"
              className="min-h-[64px] text-xs"
              aria-label={`Personal note for ${card.title}`}
            />
            <div className="mt-1.5 flex items-center gap-2">
              <Button size="sm" className="h-7 text-xs" onClick={onSaveNote} disabled={savingNote}>
                {savingNote ? 'Saving…' : 'Save note'}
              </Button>
              <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={onCancelNote} disabled={savingNote}>
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={onStartNote}
            className="mt-3 flex w-full items-start gap-1.5 rounded-lg border border-dashed border-border px-2.5 py-2 text-left text-xs text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
            aria-label={card.personalNote ? 'Edit personal note' : 'Add a personal note'}
          >
            <StickyNote className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            {card.personalNote ? (
              <MathText text={card.personalNote} className="line-clamp-3 min-w-0 text-foreground/85" />
            ) : (
              <span>Add a personal note</span>
            )}
          </button>
        )}
      </div>
    </div>
  )
}
