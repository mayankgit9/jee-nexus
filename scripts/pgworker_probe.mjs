// Dual micro-probe: how can a Worker reach the Supabase pooler over TLS?
//  A) node:tls upgrade with rejectUnauthorized:false  (pg / adapter-pg path)
//  B) cloudflare:sockets startTls                     (@prisma/pg-worker path)
import tls from "node:tls"
import net from "node:net"
import pgw from "@prisma/pg-worker"

const HOST = "aws-0-ap-south-1.pooler.supabase.com"
const PORT = 5432

function sslRequest() {
  return Buffer.from([0, 0, 0, 8, 4, 0xd2, 0x16, 0x2f])
}

function probeNodeTls() {
  return new Promise((resolve) => {
    const sock = net.connect(PORT, HOST, () => {
      sock.write(sslRequest())
      sock.once("data", (d) => {
        if (d[0] !== 0x53) return resolve(`node:tls: server refused SSL (${d[0]})`)
        const t = tls.connect(
          { socket: sock, rejectUnauthorized: false, servername: HOST },
          () => resolve(`node:tls: CONNECTED, authorized=${t.authorized}, proto=${t.getProtocol()}`)
        )
        t.on("error", (e) => resolve(`node:tls: FAIL ${String(e.message).slice(0, 120)}`))
      })
    })
    sock.on("error", (e) => resolve(`node:tls: TCP FAIL ${String(e.message).slice(0, 120)}`))
  })
}

async function probeStartTls() {
  const { connect } = await import("cloudflare:sockets")
  const sock = connect(`${HOST}:${PORT}`, { secureTransport: "starttls" })
  const writer = sock.writable.getWriter()
  const reader = sock.readable.getReader()
  await writer.write(sslRequest())
  const { value } = await reader.read()
  if (new Uint8Array(value)[0] !== 0x53) return `startTls: server refused SSL`
  writer.releaseLock()
  reader.releaseLock()
  const secure = sock.startTls({ expectedServerHostname: HOST })
  const r2 = secure.readable.getReader()
  const w2 = secure.writable.getWriter()
  await w2.write(Buffer.from([0, 0, 0, 13, 0, 3, 0, 0, 120, 0, 0, 0, 0]))
  const res = await Promise.race([
    r2.read().then((x) => `startTls: TLS OK, got ${new Uint8Array(x.value).length}B reply`),
    new Promise((r) => setTimeout(() => r("startTls: TLS OK (no reply, handshake passed)"), 4000)),
  ])
  return res
}

export default {
  async fetch(req) {
    const url = new URL(req.url)
    try {
      if (url.pathname === "/a") return new Response(await probeNodeTls())
      if (url.pathname === "/b") {
        try {
          return new Response(await probeStartTls())
        } catch (e) {
          return new Response(`startTls: FAIL ${String(e?.message ?? e).slice(0, 160)}`)
        }
      }
      if (url.pathname === "/c") {
        try {
          const { connect } = await import("cloudflare:sockets")
          const sock = connect(`${HOST}:${PORT}`, { secureTransport: "starttls" })
          const writer = sock.writable.getWriter()
          const reader = sock.readable.getReader()
          await writer.write(sslRequest())
          const { value } = await reader.read()
          if (new Uint8Array(value)[0] !== 0x53) return new Response("startTls-noverify: server refused SSL")
          writer.releaseLock()
          reader.releaseLock()
          const secure = sock.startTls() // no expectedServerHostname => no validation?
          const w2 = secure.writable.getWriter()
          const r2 = secure.readable.getReader()
          await w2.write(Buffer.from([0, 0, 0, 13, 0, 3, 0, 0, 120, 0, 0, 0, 0]))
          const res = await Promise.race([
            r2.read().then((x) => `startTls-noverify: TLS OK, got ${new Uint8Array(x.value).length}B`),
            new Promise((r) => setTimeout(() => r("startTls-noverify: TLS OK (handshake passed, no reply)"), 4000)),
          ])
          return new Response(res)
        } catch (e) {
          return new Response(`startTls-noverify: FAIL ${String(e?.message ?? e).slice(0, 160)}`)
        }
      }
      if (url.pathname === "/z") {
        const dbUrl = process.env.DATABASE_URL
        const pool = new pgw.Pool({ connectionString: dbUrl, ssl: { rejectUnauthorized: false }, max: 1 })
        const r = await pool.query("select current_user as cu, (select count(*)::int as n from subjects) as subjects")
        await pool.end()
        return new Response(`pg-worker Pool: OK user=${r.rows[0].cu} subjects=${r.rows[0].subjects}`)
      }
      return new Response("routes: /a node:tls · /b startTls · /z pg-worker pool")
    } catch (e) {
      return new Response(`probe crash: ${String(e?.message ?? e).slice(0, 200)}`, { status: 500 })
    }
  },
}
