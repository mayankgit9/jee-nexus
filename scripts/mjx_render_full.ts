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
const node = doc.convert(Bun.argv[2], { display: Bun.argv[3] === 'display', em: 16, ex: 8, containerWidth: 1280 })
console.log(adaptor.outerHTML(node))
