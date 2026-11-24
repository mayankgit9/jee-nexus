'use client'

// JEE NEXUS — bookmarks view
import { useState } from 'react'
import { BookMarked, ArrowLeft } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { QuestionCard } from '@/components/QuestionCard'
import type { PublicQuestion } from '@/lib/types'
import { useApi, navigate } from '@/lib/client'

interface BookmarksData {
  bookmarks: { id: string; createdAt: string; question: PublicQuestion }[]
}

export function BookmarksView({ loggedIn, onRequireAuth }: { loggedIn: boolean; onRequireAuth: () => void }) {
  const { data, loading, error, reload } = useApi<BookmarksData>(loggedIn ? '/api/bookmarks' : null)
  const [opened, setOpened] = useState<PublicQuestion | null>(null)

  if (!loggedIn) {
    return (
      <div className="mx-auto max-w-lg rounded-2xl border border-dashed border-border p-10 text-center">
        <BookMarked className="mx-auto h-10 w-10 text-muted-foreground" />
        <h2 className="mt-4 text-lg font-semibold">Bookmarks need an account</h2>
        <p className="mt-2 text-sm text-muted-foreground">Sign in free to save questions for later revision.</p>
        <Button className="mt-5" onClick={onRequireAuth}>Sign in / Create account</Button>
      </div>
    )
  }

  const open = async (q: PublicQuestion) => {
    // Attempt-first (same as the PYQ library): the student can retry a
    // bookmarked question; "Just show solution" reveals without grading.
    setOpened(q)
  }

  if (opened) {
    return (
      <div className="mx-auto max-w-3xl">
        <Button variant="ghost" size="sm" onClick={() => { setOpened(null); reload() }} className="mb-4">
          <ArrowLeft className="mr-2 h-4 w-4" /> Back to bookmarks
        </Button>
        <QuestionCard question={opened} allowReveal loggedIn={loggedIn} onRequireAuth={onRequireAuth} />
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="flex items-center gap-2.5 text-2xl font-bold tracking-tight">
        <BookMarked className="h-6 w-6 text-primary" /> Bookmarks
      </h1>
      <p className="mt-1 text-sm text-muted-foreground">Questions you saved for later — tap any to review with its full solution.</p>

      {loading && <div className="mt-6 space-y-3"><Skeleton className="h-20" /><Skeleton className="h-20" /><Skeleton className="h-20" /></div>}
      {error && <p className="mt-6 text-sm text-rose-400">{error}</p>}
      {data && data.bookmarks.length === 0 && (
        <div className="mt-8 rounded-xl border border-dashed border-border p-10 text-center">
          <p className="text-sm text-muted-foreground">No bookmarks yet.</p>
          <Button variant="outline" className="mt-4" onClick={() => navigate('/practice')}>Find questions to save</Button>
        </div>
      )}
      {data && data.bookmarks.length > 0 && (
        <div className="mt-5 space-y-3">
          {data.bookmarks.map((b) => (
            <button
              key={b.id}
              type="button"
              onClick={() => open(b.question)}
              className="w-full rounded-xl border border-border bg-card p-4 text-left transition-colors hover:border-primary/50"
            >
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>{b.question.publicId} · {b.question.subject.name} · {b.question.chapter.name}</span>
                <span>saved {new Date(b.createdAt).toLocaleDateString()}</span>
              </div>
              <div className="mt-2 line-clamp-2 text-sm leading-relaxed">
                {b.question.text.replace(/\$\$?[^$]*\$\$?/g, m => m.replace(/[$\\]/g, '').slice(0, 60)).slice(0, 180)}
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
