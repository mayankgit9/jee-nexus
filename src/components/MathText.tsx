'use client'

// JEE NEXUS — LaTeX + mhchem text renderer
// Parses $...$ (inline), $$...$$ (display) and \ce{...} chemistry inside math.
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

export function MathText({
  text,
  className,
}: {
  text: string
  className?: string
}) {
  const segments = useMemo(() => parseSegments(text), [text])
  return (
    <span className={cn('math-text', className)}>
      {segments.map((s, i) => {
        if (s.kind === 'text') return <span key={i}>{s.value}</span>
        if (s.kind === 'inline')
          return (
            <InlineMath
              key={i}
              math={s.value}
              renderError={(err) => <code title={err?.message ?? 'math error'}>${s.value}$</code>}
            />
          )
        return (
          <span key={i} className="block">
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
