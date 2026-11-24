// JEE NEXUS — MathJax v3 SVG renderer for round-trip verification.
// Renders a LaTeX string to the same SVG markup examside produces
// (mjx-container with use hrefs into a glyph cache).
import { mathjax } from 'mathjax3/js/mathjax.js'
import { TeX } from 'mathjax3/js/input/tex.js'
import { SVG } from 'mathjax3/js/output/svg.js'
import { liteAdaptor } from 'mathjax3/js/adaptors/liteAdaptor.js'
import { RegisterHTMLHandler } from 'mathjax3/js/handlers/html.js'
import { AllPackages } from 'mathjax3/js/input/tex/AllPackages.js'

const adaptor = liteAdaptor()
RegisterHTMLHandler(adaptor)

const tex = new TeX({ packages: AllPackages, formatError: (_jax, err) => { throw err } })
const svg = new SVG({ fontCache: 'local' })
const doc = mathjax.document('', { InputJax: tex, OutputJax: svg })

export function renderToSvg(latex: string): string {
  const node = doc.convert(latex, { display: false, em: 16, ex: 8, containerWidth: 1280 })
  const container = adaptor.outerHTML(node) as string
  return container
}

if (import.meta.main) {
  const latex = process.argv[2] || '\\frac{L}{m}'
  try {
    const out = renderToSvg(latex)
    console.log(out.slice(0, 1500))
  } catch (e) {
    console.error('RENDER_FAIL', (e as Error).message)
    process.exit(1)
  }
}
