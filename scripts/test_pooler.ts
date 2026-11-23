// Test Supabase pooler connectivity as the jee_app role.
/// <reference types="bun-types" />
// Prints ONLY outcomes — never credentials.
export {}
const url = `postgresql://${encodeURIComponent(process.env.APP_USER!)}:${encodeURIComponent(process.env.APP_PASS!)}@${process.env.DB_HOST}:${process.env.DB_PORT}/${process.env.DB_NAME}?sslmode=require`;
try {
  const sql = new Bun.SQL(url);
  const who = await sql`select current_user as cu, (select count(*) from subjects) as subjects`;
  console.log(`OK current_user=${who[0].cu} subjects_visible=${who[0].subjects}`);
  const w = await sql`
    insert into subjects (id, key, name, icon, color_key, sort_order)
    values ('_conn_test', '_conn_test', 'Conn Test', null, null, 99)
    returning key`;
  console.log(`OK rls_write_test inserted key=${w[0].key}`);
  const d = await sql`delete from subjects where key = '_conn_test'`;
  console.log(`OK cleanup deleted=${d.length}`);
  await sql.end();
  console.log("POOLER_APP_ROLE_OK");
} catch (e: any) {
  const msg = String(e?.message ?? e).replace(/password=[^\s@]+/g, "password=***");
  console.log(`FAIL ${msg.slice(0, 300)}`);
  process.exit(1);
}
