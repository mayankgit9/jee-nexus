'use client'

// JEE NEXUS — year-wise PYQ library
import { useState } from 'react'
import { motion } from 'framer-motion'
import { Library, Calendar, ChevronRight, ChevronLeft, ArrowLeft, Search, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Input } from '@/components/ui/input'
import { QuestionCard } from '@/components/QuestionCard'
import { useApi, navigate, SUBJECT_COLORS } from '@/lib/client'
import type { PublicQuestion } from '@/lib/types'
import { toast } from '@/hooks/use-toast'
import { cn } from '@/lib/utils'

const ALL_YEARS = [2026, 2025, 2024, 2023, 2022, 2021, 2020, 2019]

interface YearData { year: number; total: number; subjects: Record<string, number> }
interface YearBreakdown {
  year: number
  subjects: { key: string; name: string; chapters: { key: string; name: string; unit: string | null; questionCount: number; attempted: number; accuracy: number | null }[] }[]
}
interface QuestionList {
  total: number; page: number; pageCount: number; questions: PublicQuestion[]
}

export function PyqView({ yearParam, subjectParam, chapterParam, loggedIn, onRequireAuth }: {
  yearParam?: string; subjectParam?: string; chapterParam?: string
  loggedIn: boolean; onRequireAuth: () => void
}) {
  const year = yearParam ? Number(yearParam) : null
  const [openedQuestion, setOpenedQuestion] = useState<PublicQuestion | null>(null)
  // full-text search across the whole bank (independent of the year browse flow)
  const [searchInput, setSearchInput] = useState('')
  const [searchQuery, setSearchQuery] = useState('')
  const [searchPage, setSearchPage] = useState(1)

  const yearsData = useApi<{ years: YearData[] }>(year == null && !searchQuery ? '/api/pyq' : null)
  const searchResults = useApi<QuestionList & { search?: string }>(
    searchQuery && year == null ? `/api/pyq?q=${encodeURIComponent(searchQuery)}&page=${searchPage}` : null,
    [searchQuery, searchPage]
  )
  const breakdown = useApi<YearBreakdown>(year != null && !subjectParam ? `/api/pyq?year=${year}` : null)
  const listKey = year != null && subjectParam
    ? `/api/pyq?year=${year}&subject=${subjectParam}${chapterParam ? `&chapter=${encodeURIComponent(chapterParam)}` : ''}`
    : null
  const [page, setPage] = useState(1)
  const list = useApi<QuestionList>(listKey ? `${listKey}&page=${page}` : null, [page])

  const openQuestion = async (q: PublicQuestion) => {
    // Attempt-first: open the card fresh so the student can try it before
    // seeing the answer. "Just show solution" (allowReveal) covers readers
    // who only want the reference-book experience — it fetches the solution
    // without grading and without recording an attempt.
    setOpenedQuestion(q)
  }

  // ---------- single question browse ----------
  if (openedQuestion) {
    return (
      <div className="mx-auto max-w-3xl">
        <Button variant="ghost" size="sm" onClick={() => setOpenedQuestion(null)} className="mb-4">
          <ArrowLeft className="mr-2 h-4 w-4" /> Back to list
        </Button>
        <QuestionCard
          question={openedQuestion}
          allowReveal
          loggedIn={loggedIn}
          onRequireAuth={onRequireAuth}
        />
      </div>
    )
  }

  // ---------- year overview ----------
  if (year == null) {
    return (
      <div className="mx-auto max-w-4xl">
        <div className="mb-6">
          <h1 className="flex items-center gap-2.5 text-2xl font-bold tracking-tight">
            <Library className="h-6 w-6 text-primary" /> PYQ Library
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Browse previous year questions: year → subject → chapter → shift. Every question carries its original exam metadata.
          </p>
          <form
            className="mt-4 flex gap-2"
            onSubmit={(e) => {
              e.preventDefault()
              const t = searchInput.trim()
              if (t.length < 3) {
                toast({ title: 'Search needs at least 3 characters', description: 'Try a keyword like "projectile" or "adiabatic".' })
                return
              }
              setSearchPage(1)
              setSearchQuery(t)
            }}
          >
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                placeholder="Search questions — e.g. projectile, adiabatic, determinant…"
                className="pl-9"
                aria-label="Search question text"
              />
            </div>
            <Button type="submit" variant="secondary">Search</Button>
          </form>
        </div>

        {searchQuery && (
          <div className="mt-2">
            <div className="flex items-center justify-between">
              <p className="text-sm text-muted-foreground">
                Results for <span className="font-medium text-foreground">“{searchQuery}”</span>
                {searchResults.data && ` · ${searchResults.data.total} found`}
              </p>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => { setSearchQuery(''); setSearchInput('') }}
              >
                <X className="mr-1.5 h-3.5 w-3.5" /> Clear
              </Button>
            </div>
            {searchResults.loading && <div className="mt-4 space-y-3"><Skeleton className="h-28" /><Skeleton className="h-28" /><Skeleton className="h-28" /></div>}
            {searchResults.error && <p className="mt-4 text-sm text-rose-400">{searchResults.error}</p>}
            {searchResults.data && searchResults.data.questions.length === 0 && (
              <div className="mt-6 rounded-xl border border-dashed border-border p-10 text-center text-sm text-muted-foreground">
                No question mentions “{searchQuery}” yet. Try a shorter or more common keyword.
              </div>
            )}
            {searchResults.data && searchResults.data.questions.length > 0 && (
              <>
                <p className="mt-2 text-xs text-muted-foreground">page {searchResults.data.page}/{searchResults.data.pageCount}</p>
                <div className="mt-4 space-y-3">
                  {searchResults.data.questions.map((q) => (
                    <button
                      key={q.id}
                      type="button"
                      onClick={() => setOpenedQuestion(q)}
                      className="w-full rounded-xl border border-border bg-card p-4 text-left transition-colors hover:border-primary/50"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
                        <span className="flex items-center gap-2">
                          <span className="rounded-md px-1.5 py-0.5 font-medium" style={{ color: SUBJECT_COLORS[q.subject.key], background: `color-mix(in oklab, ${SUBJECT_COLORS[q.subject.key]} 12%, transparent)` }}>
                            {q.sourceYear ?? ''} · {q.subject.name}
                          </span>
                          {q.chapter.name}
                        </span>
                        <span>{q.sourceShift ?? ''} {q.sourceQuestionNumber != null ? `· Q${q.sourceQuestionNumber}` : ''}</span>
                      </div>
                      <div className="mt-2 line-clamp-2 text-sm leading-relaxed opacity-90">
                        {q.text.replace(/\$\$?[^$]*\$\$?/g, m => m.replace(/[$\\]/g, '').slice(0, 60)).slice(0, 180)}
                      </div>
                    </button>
                  ))}
                </div>
                {searchResults.data.pageCount > 1 && (
                  <div className="mt-6 flex items-center justify-center gap-3">
                    <Button variant="outline" size="sm" disabled={searchPage <= 1} onClick={() => setSearchPage(searchPage - 1)}>
                      <ChevronLeft className="h-4 w-4" /> Prev
                    </Button>
                    <span className="text-sm text-muted-foreground">{searchPage} / {searchResults.data.pageCount}</span>
                    <Button variant="outline" size="sm" disabled={searchPage >= searchResults.data.pageCount} onClick={() => setSearchPage(searchPage + 1)}>
                      Next <ChevronRight className="h-4 w-4" />
                    </Button>
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {!searchQuery && (
          <>
        {yearsData.loading && <div className="grid gap-4 sm:grid-cols-2"><Skeleton className="h-28" /><Skeleton className="h-28" /><Skeleton className="h-28" /><Skeleton className="h-28" /></div>}
        {yearsData.error && <p className="text-sm text-rose-400">{yearsData.error}</p>}
        {yearsData.data && (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {ALL_YEARS.map((y) => {
              const d = yearsData.data?.years.find((x) => x.year === y)
              const total = d?.total ?? 0
              return (
                <motion.div key={y} whileHover={total > 0 ? { y: -3 } : undefined}>
                  <button
                    type="button"
                    disabled={total === 0}
                    onClick={() => navigate(`/pyq/${y}`)}
                    className={cn(
                      'w-full rounded-2xl border p-5 text-left transition-colors',
                      total > 0 ? 'border-border bg-card hover:border-primary/50' : 'border-dashed border-border/50 opacity-50'
                    )}
                  >
                    <div className="flex items-center justify-between">
                      <Calendar className="h-5 w-5 text-primary" />
                      <ChevronRight className="h-4 w-4 text-muted-foreground" />
                    </div>
                    <div className="mt-3 text-xl font-bold">{y}</div>
                    <div className="mt-0.5 text-xs text-muted-foreground">
                      {total > 0 ? `${total} questions` : 'coming soon'}
                    </div>
                    {d && (
                      <div className="mt-3 flex flex-wrap gap-1.5">
                        {Object.entries(d.subjects).map(([k, v]) => (
                          <span key={k} className="rounded-md px-1.5 py-0.5 text-[11px] font-medium"
                            style={{ color: SUBJECT_COLORS[k], background: `color-mix(in oklab, ${SUBJECT_COLORS[k]} 12%, transparent)` }}>
                            {v}
                          </span>
                        ))}
                      </div>
                    )}
                  </button>
                </motion.div>
              )
            })}
          </div>
        )}
          </>
        )}
      </div>
    )
  }

  // ---------- year -> subject/chapter breakdown ----------
  if (!subjectParam) {
    return (
      <div className="mx-auto max-w-4xl">
        <Button variant="ghost" size="sm" onClick={() => navigate('/pyq')} className="mb-4">
          <ArrowLeft className="mr-2 h-4 w-4" /> All years
        </Button>
        <h1 className="text-2xl font-bold tracking-tight">JEE Main {year}</h1>
        <p className="mt-1 text-sm text-muted-foreground">Pick a subject to see its chapter-wise breakdown and analysis.</p>
        {breakdown.loading && <div className="mt-6 space-y-3"><Skeleton className="h-24" /><Skeleton className="h-24" /></div>}
        {breakdown.data && (
          <div className="mt-6 space-y-5">
            {breakdown.data.subjects.map((s) => {
              const totalQ = s.chapters.reduce((a, c) => a + c.questionCount, 0)
              const attempted = s.chapters.reduce((a, c) => a + c.attempted, 0)
              return (
                <Card key={s.key}>
                  <CardContent className="p-5">
                    <button type="button" className="flex w-full items-center justify-between text-left"
                      onClick={() => navigate(`/pyq/${year}/${s.key}`)}>
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="text-lg font-bold" style={{ color: SUBJECT_COLORS[s.key] }}>{s.name}</span>
                          <Badge variant="secondary">{totalQ} questions</Badge>
                          {attempted > 0 && <Badge variant="outline" className="border-primary/30 text-primary">{attempted} attempted</Badge>}
                        </div>
                        <p className="mt-1 text-sm text-muted-foreground">{s.chapters.length} chapters</p>
                      </div>
                      <ChevronRight className="h-5 w-5 text-muted-foreground" />
                    </button>
                    <div className="mt-4 grid gap-1.5 sm:grid-cols-2">
                      {s.chapters.map((c) => (
                        <button
                          key={c.key}
                          type="button"
                          onClick={() => navigate(`/pyq/${year}/${s.key}?chapter=${encodeURIComponent(c.key)}`)}
                          className="flex items-center justify-between gap-2 rounded-lg border border-border/60 px-3 py-2 text-left text-sm transition-colors hover:border-primary/40 hover:bg-primary/[0.04]"
                        >
                          <span className="truncate">{c.name}</span>
                          <span className="flex shrink-0 items-center gap-2 text-xs text-muted-foreground">
                            {c.accuracy != null && (
                              <span className={cn('font-semibold', c.accuracy >= 70 ? 'text-emerald-400' : c.accuracy >= 40 ? 'text-amber-400' : 'text-rose-400')}>
                                {c.accuracy}%
                              </span>
                            )}
                            <span>{c.questionCount} Q</span>
                          </span>
                        </button>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              )
            })}
          </div>
        )}
      </div>
    )
  }

  // ---------- question list ----------
  return (
    <div className="mx-auto max-w-3xl">
      <Button variant="ghost" size="sm" onClick={() => navigate(`/pyq/${year}`)} className="mb-4">
        <ArrowLeft className="mr-2 h-4 w-4" /> {year} breakdown
      </Button>
      <h1 className="text-2xl font-bold tracking-tight capitalize">
        JEE Main {year} · <span style={{ color: SUBJECT_COLORS[subjectParam] }}>{subjectParam}</span>
      </h1>
      {chapterParam && <p className="mt-1 text-sm text-muted-foreground">Chapter filter: {chapterParam.split(':')[1]?.replace(/-/g, ' ')}</p>}

      {list.loading && <div className="mt-6 space-y-3"><Skeleton className="h-28" /><Skeleton className="h-28" /></div>}
      {list.error && <p className="mt-6 text-sm text-rose-400">{list.error}</p>}
      {list.data && list.data.questions.length === 0 && (
        <div className="mt-8 rounded-xl border border-dashed border-border p-10 text-center text-sm text-muted-foreground">
          No questions match this filter yet. This library grows as verified questions are imported.
        </div>
      )}
      {list.data && list.data.questions.length > 0 && (
        <>
          <p className="mt-2 text-xs text-muted-foreground">{list.data.total} questions · page {list.data.page}/{list.data.pageCount}</p>
          <div className="mt-4 space-y-3">
            {list.data.questions.map((q) => (
              <button
                key={q.id}
                type="button"
                onClick={() => openQuestion(q)}
                className="w-full rounded-xl border border-border bg-card p-4 text-left transition-colors hover:border-primary/50"
              >
                <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
                  <span>{q.publicId} · {q.chapter.name}</span>
                  <span>{q.sourceShift ?? ''} {q.sourceQuestionNumber != null ? `· Q${q.sourceQuestionNumber}` : ''}</span>
                </div>
                <div className="mt-2 line-clamp-2 text-sm leading-relaxed opacity-90">
                  {q.text.replace(/\$\$?[^$]*\$\$?/g, m => m.replace(/[$\\]/g, '').slice(0, 60)).slice(0, 180)}
                </div>
                <div className="mt-2 flex items-center gap-1.5">
                  <Badge variant="outline" className="text-[11px]">{q.type.replace('_', ' ')}</Badge>
                  <Badge variant="outline" className="text-[11px] capitalize">{q.difficulty}</Badge>
                  {q.bookmarked && <Badge variant="outline" className="text-[11px] text-primary">bookmarked</Badge>}
                </div>
              </button>
            ))}
          </div>
          {list.data.pageCount > 1 && (
            <div className="mt-6 flex items-center justify-center gap-3">
              <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>
                <ChevronLeft className="h-4 w-4" /> Prev
              </Button>
              <span className="text-sm text-muted-foreground">{page} / {list.data.pageCount}</span>
              <Button variant="outline" size="sm" disabled={page >= list.data.pageCount} onClick={() => setPage(page + 1)}>
                Next <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  )
}
