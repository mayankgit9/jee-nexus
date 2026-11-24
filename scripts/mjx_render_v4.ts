// MathJax v4 (examside-compatible?) renderer — full SVG output
import mj from 'mathjax'

const MathJax = await mj.init({
  loader: { load: ['input/tex', 'output/svg'] },
  startup: { typeset: false },
})

function render(latex: string, display: boolean): string {
  const node = MathJax.tex2svg(latex, { display })
  return MathJax.startup.adaptor.outerHTML(node) as string
}

const latex = Bun.argv[2]
const display = Bun.argv[3] === 'display'
console.log(render(latex, display))
