// Inspect preparena public schema tables + row counts (read-only).
export {}
const url = process.env.PROBE_URL!
const sql = new Bun.SQL(url)
const tables = await sql`
  select c.relname as name,
         pg_size_pretty(pg_total_relation_size(c.oid)) as size,
         coalesce((select count(*)::int from pg_class x join pg_namespace n on n.oid = x.relnamespace
                    where n.nspname='public' and x.relname = c.relname and false), 0) as dummy
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind = 'r' order by 1`
for (const t of tables as any[]) {
  let n = "?"
  try { n = String((await sql.unsafe(`select count(*)::int as n from "${t.name}"`))[0].n) } catch {}
  console.log(`${t.name.padEnd(28)} rows=${n.padStart(7)}  size=${t.size}`)
}
const enums = await sql`select t.typname from pg_type t join pg_namespace n on n.oid=t.typnamespace where n.nspname='public' and t.typtype='e' order by 1`
console.log("enums:", (enums as any[]).map((e) => e.typname).join(", ") || "(none)")
await sql.end()
