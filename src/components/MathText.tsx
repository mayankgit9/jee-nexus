'use client'

// JEE NEXUS — LaTeX + mhchem text renderer
// Parses $...$ (inline), $$...$$ (display) and \ce{...} chemistry inside math.
//
// Overflow hardening (fixes the "text overlapping / overridden" artifacts):
// - text segments render inside a whitespace-pre-line wrapper so corpus
//   newlines (\n\n between steps, table-ish blocks) survive rendering
// - the root span carries .math-text which gets overflow-wrap rules in
//   globals.css (break long tokens / formulas instead of overflowing)
// - block math stays horizontally scrollable (never pushes layout wider)
import { InlineMath, BlockMath } from 'react-katex'
import 'katex/contrib/mhchem'
import 'katex/dist/katex.min.css'
import { useMemo } from 'react'
import { cn } from '@/lib/utils'

type Segment =
  | { kind: 'text'; value: string }
  | { kind: 'inline'; value: string }
  | { kind: 'block'; value: string }

/** Split raw text into text / inline math / display math segments */
export function parseSegments(input: string): Segment[] {
  const segments: Segment[] = []
  // $$...$$ first (display), then $...$ (inline); \$ escapes a literal dollar
  const re = /\$\$([\s\S]+?)\$\$|\$([^$\n]+?)\$|\\\$/g
  let last = 0
  let m: RegExpExecArray | null
  while ((m = re.exec(input))) {
    if (m.index > last) segments.push({ kind: 'text', value: input.slice(last, m.index) })
    if (m[0] === '\\$') {
      segments.push({ kind: 'text', value: '$' })
    } else if (typeof m[1] === 'string') {
      segments.push({ kind: 'block', value: m[1] })
    } else if (typeof m[2] === 'string') {
      segments.push({ kind: 'inline', value: m[2] })
    }
    last = re.lastIndex
  }
  if (last < input.length) segments.push({ kind: 'text', value: input.slice(last) })
  return segments
}

/** Split a text segment on newlines so each line renders in its own block
 *  row — whitespace-pre-line alone collapses inside flex parents oddly.
 *  SINGLE-LINE segments must stay INLINE: multi-line blocks around inline
 *  math ($...$ between two text segments) would push the formula onto its
 *  own line and visually "break" the sentence (prod bug 2026-11-28). */
function TextChunk({ value }: { value: string }) {
  const lines = value.split('\n')
  if (lines.length === 1) {
    return <span className="inline whitespace-pre-wrap break-words">{value === '' ? '\u00A0' : value}</span>
  }
  return (
    <>
      {lines.map((line, li) => (
        <span
          key={li}
          className={cn('block whitespace-pre-wrap break-words', li !== lines.length - 1 && 'min-h-[0.9em]')}
        >
          {line === '' ? '\u00A0' : line}
        </span>
      ))}
    </>
  )
}

export function MathText({
  text,
  className,
}: {
  text: string
  className?: string
}) {
  const segments = useMemo(() => parseSegments(text), [text])
  return (
    <span className={cn('math-text block', className)}>
      {segments.map((s, i) => {
        if (s.kind === 'text') return <TextChunk key={i} value={s.value} />
        if (s.kind === 'inline')
          return (
            <span key={i} className="inline-block max-w-full align-middle overflow-x-auto overflow-y-hidden katex-inline-scroll">
              <InlineMath
                math={s.value}
                renderError={(err) => <code title={err?.message ?? 'math error'}>${s.value}$</code>}
              />
            </span>
          )
        return (
          <span key={i} className="block max-w-full">
            <BlockMath
              math={s.value}
              renderError={(err) => <code title={err?.message ?? 'math error'}>$${s.value}$$</code>}
            />
          </span>
        )
      })}
    </span>
  )
}
