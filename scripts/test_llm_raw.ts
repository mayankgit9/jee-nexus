import ZAI from 'z-ai-web-dev-sdk'
async function main() {
  const zai = await ZAI.create()
  const completion = await zai.chat.completions.create({
    messages: [
      { role: 'assistant', content: 'You are a helpful assistant. Return ONLY valid JSON with keys {keyConcept, body}.' },
      { role: 'user', content: 'Write a 2-sentence solution for: What is 2+2? Options: A.3 B.4 C.5 D.6. Correct: B. Return JSON only.' },
    ],
    thinking: { type: 'disabled' },
  })
  console.log('TYPE:', typeof completion)
  console.log('KEYS:', Object.keys(completion ?? {}))
  const choice = completion?.choices?.[0]
  console.log('CHOICE KEYS:', Object.keys(choice ?? {}))
  const msg = choice?.message
  console.log('MSG KEYS:', Object.keys(msg ?? {}))
  console.log('CONTENT:', JSON.stringify(msg?.content)?.slice(0, 500))
  console.log('REASONING:', JSON.stringify(msg?.reasoning_content ?? msg?.reasoning ?? null)?.slice(0, 200))
}
main().catch(e => { console.error('ERR', e?.message ?? e); process.exit(1) })
