// Debug: print canonical structure of a rendered latex (uses only, no defs)
import { mathjax } from 'mathjax3/js/mathjax.js'
import { TeX } from 'mathjax3/js/input/tex.js'
import { SVG } from 'mathjax3/js/output/svg.js'
import { liteAdaptor } from 'mathjax3/js/adaptors/liteAdaptor.js'
import { RegisterHTMLHandler } from 'mathjax3/js/handlers/html.js'
import { AllPackages } from 'mathjax3/js/input/tex/AllPackages.js'

const adaptor = liteAdaptor()
RegisterHTMLHandler(adaptor)
const tex = new TeX({ packages: AllPackages, formatError: (_j, err) => { throw err } })
const svg = new SVG({ fontCache: 'local' })
const doc = mathjax.document('', { InputJax: tex, OutputJax: svg })

const latex = Bun.argv[2]
const node = doc.convert(latex, { display: false, em: 16, ex: 8, containerWidth: 1280 })
const str = adaptor.outerHTML(node) as string
const idx = str.lastIndexOf('</defs>')
const body = idx >= 0 ? str.slice(idx) : str
const uses = [...body.matchAll(/<use[^>]*href="#(MJX-[^"]+)"([^>]*?)\/?>/g)].map(
  (m) => m[1].replace(/^MJX-\d+-/, 'MJX-') + ((m[2].match(/transform="([^"]*)"/)) ? '|T' : '')
)
console.log(uses.join('\n'))
