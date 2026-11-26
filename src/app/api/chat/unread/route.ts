import { dbClient } from '@/lib/db'
import { requireUser, jsonError } from '@/lib/auth'

/**
 * GET /api/chat/unread — tiny summary for the GLOBAL nav badge.
 *
 * The shell (page.tsx) polls this every ~15s while logged in so pending DMs
 * and group messages are visible from ANY view — previously unread counts
 * only existed inside the Community view itself, so you had to open chat to
 * discover you had chat.
 *
 * Two bounded queries through ONE client (subrequest discipline):
 *  1. grouped count over all my conversations (same rule as the sidebar:
 *     newer than my lastReadAt, not mine, not deleted)
 *  2. the newest such message for the optional preview
 */
export async function GET() {
  try {
    const user = await requireUser()
    const client = dbClient()

    const rows = (await client.$queryRawUnsafe(
      `select coalesce(sum(n), 0)::int as total
         from (
           select count(*) as n
             from chat_messages m
             join chat_members cm
               on cm.conversation_id = m.conversation_id and cm.user_id = $1
            where m.sender_id <> $1
              and m.deleted_at is null
              and (cm.last_read_at is null or m.created_at > cm.last_read_at)
            group by m.conversation_id
         ) t`,
      user.id
    )) as { total: number }[]

    const latest = (await client.$queryRawUnsafe(
      `select m.id, m.conversation_id as "conversationId", m.body,
              m.created_at as "createdAt", c.type, c.name,
              s.name as "senderName",
              exists (
                select 1 from chat_mentions mm
                 where mm.message_id = m.id and mm.user_id = $1
              ) as mentioned
         from chat_messages m
         join chat_members cm
           on cm.conversation_id = m.conversation_id and cm.user_id = $1
         join chat_conversations c on c.id = m.conversation_id
         join app_users s on s.id = m.sender_id
        where m.sender_id <> $1
          and m.deleted_at is null
          and (cm.last_read_at is null or m.created_at > cm.last_read_at)
        order by m.created_at desc
        limit 1`,
      user.id
    )) as {
      id: string
      conversationId: string
      body: string
      createdAt: Date
      type: string
      name: string | null
      senderName: string | null
      mentioned: boolean
    }[]

    const l = latest[0] ?? null
    return Response.json({
      total: rows[0]?.total ?? 0,
      latest: l
        ? {
            id: l.id,
            conversationId: l.conversationId,
            body: l.body.length > 80 ? `${l.body.slice(0, 80)}…` : l.body,
            createdAt: new Date(l.createdAt).toISOString(),
            type: l.type,
            name: l.type === 'group' ? l.name : l.senderName,
            senderName: l.senderName ?? 'Student',
            mentioned: Boolean(l.mentioned),
          }
        : null,
    })
  } catch (err) {
    return jsonError(err)
  }
}
