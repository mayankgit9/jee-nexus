import mj from process.env.MJX_PKG
const MathJax = await mj.init({
  loader: { load: ['input/tex', 'output/svg'] },
  startup: { typeset: false },
})
const node = MathJax.tex2svg(process.argv[2], { display: false })
console.log(MathJax.startup.adaptor.outerHTML(node))
