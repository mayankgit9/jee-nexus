// Probe the preparena Supabase project via the session pooler (port 5432).
// Prints ONLY outcomes — never credentials.
export {}
const REF = "mxfiazcjcgqzqynmsefp"
const pw = process.env.PROBE_PASS!
for (const host of ["aws-0-ap-south-1.pooler.supabase.com", "aws-1-ap-south-1.pooler.supabase.com"]) {
  const url = `postgresql://postgres.${REF}:${encodeURIComponent(pw)}@${host}:5432/postgres?sslmode=require`
  try {
    const sql = new Bun.SQL(url)
    const who = await sql`select current_user as cu`
    const tables = await sql`select count(*)::int as n from pg_tables where schemaname = 'public'`
    const roles = await sql`select rolname from pg_roles where rolname in ('jee_app','postgres') order by 1`
    console.log(`OK host=${host} current_user=${who[0].cu} public_tables=${tables[0].n} roles=${roles.map((r: any) => r.rolname).join(",")}`)
    await sql.end()
  } catch (e: any) {
    const msg = String(e?.message ?? e).replace(pw, "***")
    console.log(`FAIL host=${host} ${msg.slice(0, 200)}`)
  }
}
