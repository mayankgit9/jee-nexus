import { mathjax } from 'mathjax-full/cjs/mathjax.js'
import { TeX } from 'mathjax-full/cjs/input/tex.js'
import { SVG } from 'mathjax-full/cjs/output/svg.js'
import { liteAdaptor } from 'mathjax-full/cjs/adaptors/liteAdaptor.js'
import { RegisterHTMLHandler } from 'mathjax-full/cjs/handlers/html.js'
import { AllPackages } from 'mathjax-full/cjs/input/tex/AllPackages.js'
const adaptor = liteAdaptor()
RegisterHTMLHandler(adaptor)
const tex = new TeX({ packages: AllPackages, formatError: (_j, err) => { throw err } })
const svg = new SVG({ fontCache: 'local' })
const doc = mathjax.document('', { InputJax: tex, OutputJax: svg })
const node = doc.convert(Bun.argv[2], { display: Bun.argv[3] === 'display', em: 16, ex: 8, containerWidth: 1280 })
console.log(adaptor.outerHTML(node))
