// MathJax 4.0.0 renderer for delimiter sizing comparison
import mj from 'mathjax4'

const MathJax = await mj.init({
  loader: { load: ['input/tex', 'output/svg'] },
  startup: { typeset: false },
})

function render(latex: string, display: boolean): string {
  try {
    const node = MathJax.tex2svg(latex, { display })
    return MathJax.startup.adaptor.outerHTML(node) as string
  } catch {
    return ''
  }
}
console.log(render(Bun.argv[2], Bun.argv[3] === 'display'))
