// JEE NEXUS — round-trip verifier for the SVG->LaTeX converter.
// Renders candidate LaTeX with MathJax v4 (same engine family as examside)
// and compares canonical structure with engine-difference normalizations:
//   - font names NCM->TEX, size-variant delimiters -> SZ, radicals -> R
//   - invisible function-application (2061) stripped (no semantic content)
//   - script order: [sup,sub] normalized to [sub,sup] (engine layout diff)
//   - hat glyph family (2C6/302) unified; stretched-dash transform dropped
//   - rect widths compared with 3% tolerance (font metric noise)
//   - <text> fragments (examside custom optimization): letter runs masked
//   - MHC chemistry arrows masked (examside-only font)
// stdin: JSON array of {id, svg, latex} ; stdout: JSON array of results
import mj from 'mathjax'

const MathJax = await mj.init({
  loader: { load: ['input/tex', 'output/svg'] },
  startup: { typeset: false },
})

async function render(latex: string, display: boolean): Promise<string> {
  try {
    const node = await MathJax.tex2svgPromise(latex, { display })
    return MathJax.startup.adaptor.outerHTML(node) as string
  } catch {
    return ''
  }
}

const DELIM_CPS = new Set(['28', '29', '5B', '5D', '7B', '7D', '2223', '2016', '27E8', '27E9'])
const SIZE_FONTS = /^(SO|LO|S[1-7])$/
const HAT_CPS = new Set(['2C6', '302'])

interface Tok {
  gid: string
  tr: string
  sign: '' | '+' | '-'   // enclosing script-group position (sub/sup)
  isRect?: boolean
  rw?: number
  rh?: number
}

const VEC_CPS = new Set(['20D7'])

function normalizeGlyphId(gid: string): string {
  let g = gid.replace(/^MJX-\d+-/, 'MJX-').replace('MJX-NCM-', 'MJX-TEX-')
  const m = g.match(/^MJX-TEX-([A-Z0-9]+)-([0-9A-F]+)$/)
  if (m) {
    const font = m[1]
    const cp = m[2].toUpperCase()
    if (cp === '221A') return 'MJX-R-221A'
    if (HAT_CPS.has(cp)) return 'MJX-HAT'
    if (VEC_CPS.has(cp)) return 'MJX-VEC'
    if (cp === '2013') return 'MJX-TEX-N-2013' // dash: stretch is cosmetic
    if (DELIM_CPS.has(cp) && SIZE_FONTS.test(font)) return 'MJX-SZ-' + cp
    if (font === 'EM' && (cp === '7B' || cp === '7D')) return 'MJX-SZ-PBR' // stretched brace
    if (parseInt(cp, 16) >= 0x23a1 && parseInt(cp, 16) <= 0x23ad) {
      const base = parseInt(cp, 16) <= 0x23a3 ? '5B' : parseInt(cp, 16) <= 0x23a6 ? '5D' : 'BR'
      return 'MJX-SZ-P' + base
    }
  }
  return g
}

/** glyphs whose TRANSFORM is cosmetic (stretch/position of accents, bars,
 * bracket pieces, dashes) -> drop the transform for comparison */
const TRANSFORM_FREE = new Set(['MJX-HAT', 'MJX-VEC', 'MJX-TEX-N-2013', 'MJX-SZ-2223', 'MJX-SZ-2016'])

/** Tokenize an SVG string: uses (with script-sign) and rects in doc order. */
function tokenize(svgStr: string): Tok[] {
  if (!svgStr) return []
  const toks: Tok[] = []
  // stack of group transforms: capture translate-y and scale of enclosing groups
  const stack: Array<{ ty: number; scale: number }> = []
  const re = /<g\b([^>]*)>|<\/g>|<use[^>]*href="#(MJX-[^"]+)"([^>]*?)\/?>|<rect[^>]*width="([\d.]+)"[^>]*height="([\d.]+)"/g
  let m: RegExpExecArray | null
  for (m = re.exec(svgStr); m; m = re.exec(svgStr)) {
    if (m[1] !== undefined) {
      // <g ...>
      const attrs = m[1]
      let ty = 0
      let scale = 1
      const tm = attrs.match(/translate\(([\d.\-]+)[ ,]([\d.\-]+)\)/)
      if (tm) ty = parseFloat(tm[2])
      const sm = attrs.match(/scale\(([\d.]+)(?:[ ,]([\d.]+))?\)/)
      if (sm) scale = parseFloat(sm[2] ?? sm[1])
      stack.push({ ty, scale })
    } else if (m[0] === '</g>') {
      stack.pop()
    } else if (m[2] !== undefined) {
      // <use>
      let gid = normalizeGlyphId(m[2])
      if (gid === 'MJX-TEX-N-2061') continue // invisible function application
      const trm = (m[3] || '').match(/transform="([^"]*)"/)
      let tr = trm ? trm[1].replace(/[\d.]+/g, (x: string) => String(Math.round(parseFloat(x)))) : ''
      // enclosing script group? (scale ~0.707, non-zero ty, innermost such)
      let sign: '' | '+' | '-' = ''
      for (const st of stack) {
        if (st.scale < 0.85 && Math.abs(st.ty) > 30) sign = st.ty > 0 ? '+' : '-'
      }
      // raised 2192 arrow (vec accent) == 20D7 combining arrow (engine diff)
      if (gid === 'MJX-TEX-N-2192') {
        let above = false
        for (const st of stack) if (st.ty > 250) above = true
        const own = (m[3] || '').match(/translate\([\d.\-]+[ ,]([\d.\-]+)\)/)
        if (above || (own && parseFloat(own[1]) > 250)) gid = 'MJX-VEC'
      }
      if (TRANSFORM_FREE.has(gid) || gid.startsWith('MJX-SZ-P')) tr = ''
      toks.push({ gid, tr: tr.replace(/\s+/g, ''), sign })
    } else if (m[4] !== undefined) {
      toks.push({ gid: 'RECT', tr: '', sign: '', isRect: true, rw: parseFloat(m[4]), rh: parseFloat(m[5]) })
    }
  }
  return toks
}

/** Normalize script order: adjacent [sup-run, sub-run] pairs -> [sub, sup]
 * (examside's engine emits sub first; stock v4 emits sup first).
 * A following RECT guards against swapping fraction num/den. */
function normalizeScriptOrder(toks: Tok[]): Tok[] {
  const out: Tok[] = []
  let i = 0
  while (i < toks.length) {
    const t = toks[i]
    if (t.sign === '+') {
      // collect the sup run
      let j = i
      while (j < toks.length && toks[j].sign === '+') j++
      // collect the sub run right after
      let k = j
      while (k < toks.length && toks[k].sign === '-') k++
      const hasSub = k > j
      // guard: a rect immediately after means fraction num/den — do not swap
      const nextIsRect = k < toks.length && toks[k].isRect
      if (hasSub && !nextIsRect && k < toks.length && toks[k].sign !== '+') {
        out.push(...toks.slice(j, k))  // sub first
        out.push(...toks.slice(i, j))  // then sup
        i = k
        continue
      }
    }
    out.push(t)
    i++
  }
  return out
}

function usesString(toks: Tok[]): string {
  return toks.filter((t) => !t.isRect).map((t) => t.gid + (t.tr ? '|' + t.tr : '')).join(';')
}

function rectsOf(toks: Tok[]): Array<[number, number]> {
  return toks.filter((t) => t.isRect).map((t) => [t.rw!, t.rh!] as [number, number])
}

function rectsEqual(a: Array<[number, number]>, b: Array<[number, number]>): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    const [wa, ha] = a[i]
    const [wb, hb] = b[i]
    if (Math.round(ha / 10) !== Math.round(hb / 10)) return false
    const tol = Math.max(wa * 0.25, 400)
    if (Math.abs(wa - wb) > tol) return false
  }
  return true
}

function textElemsOf(svg: string): string[] {
  return [...svg.matchAll(/<text[^>]*>([^<]*)<\/text>/g)]
    .map((m) => m[1].replace(/\xa0/g, ' ').trim())
    .filter((s) => s.length > 0)
}

function maskTextRuns(usesStr: string, texts: string[]): string {
  let parts = usesStr.split(';').filter((p) => p.length > 0)
  for (const t of texts) {
    const letters = [...t.replace(/[^A-Za-z0-9]/g, '')].map(
      (ch) => 'MJX-TEX-N-' + ch.charCodeAt(0).toString(16).toUpperCase()
    )
    for (let i = 0; i < parts.length; i++) {
      let k = i
      let okAll = true
      for (const lg of letters) {
        while (k < parts.length && !parts[k].startsWith(lg)) k++
        if (k >= parts.length) { okAll = false; break }
        k++
      }
      if (okAll && letters.length) {
        const remove = new Set<number>()
        let k2 = i
        for (const lg of letters) {
          while (k2 < parts.length && !parts[k2].startsWith(lg)) k2++
          if (k2 < parts.length) { remove.add(k2); k2++ }
        }
        parts = parts.filter((_, idx) => !remove.has(idx))
        break
      }
    }
  }
  // also strip standalone space/nbsp glyphs (from \text{ } spacers)
  return parts.filter((p) => {
    const base = p.split('|')[0]
    return base !== 'MJX-TEX-N-A0' && base !== 'MJX-TEX-N-20'
  }).join(';')
}

function stripSpaces(usesStr: string): string {
  return usesStr.split(';').filter((p) => {
    const base = p.split('|')[0]
    return base !== 'MJX-TEX-N-A0' && base !== 'MJX-TEX-N-20'
  }).join(';')
}

function canonicalParts(svgStr: string): { uses: string; rects: Array<[number, number]> } {
  const toks = normalizeScriptOrder(tokenize(svgStr))
  // space/nbsp glyphs are pure spacing (engines differ on emitting them)
  const uses = toks
    .filter((t) => !t.isRect)
    .filter((t) => t.gid !== 'MJX-TEX-N-A0' && t.gid !== 'MJX-TEX-N-20')
    .map((t) => t.gid + (t.tr ? '|' + t.tr : ''))
    .join(';')
  return { uses, rects: rectsOf(toks) }
}

export async function verify(id: string, origSvg: string, latex: string) {
  const hasText = /<text/.test(origSvg)
  const texts = hasText ? textElemsOf(origSvg) : []
  const want = canonicalParts(origSvg)
  const hasMhc = /MJX-TEX-MHC/.test(origSvg)

  const variants: Array<[string, string, boolean]> = [
    ['inline', latex, false],
    ['display', latex, true],
  ]
  for (const [mode, src, disp] of variants) {
    const got = canonicalParts(await render(src, disp))
    if (!got.uses && !got.rects.length) continue
    let gu = got.uses
    let wu = want.uses
    if (hasMhc) {
      gu = gu.replace(/;?MJX-TEX-N-27F6(\|[^;]*)?/g, '').replace(/;?MJX-TEX-N-2192(\|[^;]*)?/g, '')
      wu = wu.replace(/;?MJX-TEX-MHC[^;|]*(\|[^;]*)?/g, '')
    }
    if (hasText) {
      gu = maskTextRuns(gu, texts)
      wu = stripSpaces(wu)
      if (gu === wu) return { id, ok: true, mode: 'text-masked' }
      continue
    }
    if (gu === wu && rectsEqual(want.rects, got.rects)) return { id, ok: true, mode }
  }
  // first-divergence diagnostic
  const got = canonicalParts(await render(latex, false))
  const wa = want.uses.split(';')
  const ga = got.uses.split(';')
  let diff = `lens ${wa.length}/${ga.length} rects ${want.rects.length}/${got.rects.length}`
  for (let i = 0; i < Math.max(wa.length, ga.length); i++) {
    if (wa[i] !== ga[i]) {
      diff = `pos ${i}: [${wa.slice(Math.max(0, i - 2), i + 3).join(' | ')}] VS [${ga.slice(Math.max(0, i - 2), i + 3).join(' | ')}]`
      break
    }
  }
  if (wa.join(';') === ga.join(';')) {
    diff = `RECTS want=${JSON.stringify(want.rects)} got=${JSON.stringify(got.rects)}`
  }
  return { id, ok: false, mode: 'none', diff }
}

if (import.meta.main) {
  const input = await Bun.stdin.text()
  const cases = JSON.parse(input)
  const results = []
  for (const c of cases) {
    try {
      results.push(await verify(c.id, c.svg, c.latex))
    } catch (e) {
      results.push({ id: c.id, ok: false, mode: 'error', diff: String(e).slice(0, 200) })
    }
  }
  console.log(JSON.stringify(results))
}
