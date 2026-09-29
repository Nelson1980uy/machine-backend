import pool from "./src/config/database.js";

const result = await pool.query(`
  SELECT
    tablename,
    indexname,
    indexdef
  FROM pg_indexes
  WHERE schemaname = 'public'
    AND tablename IN (
      'chat_private_conversations',
      'chat_private_members',
      'chat_private_messages'
    )
  ORDER BY
    tablename,
    indexname;
`);

console.table(result.rows);

await pool.end();
