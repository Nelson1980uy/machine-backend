import pool from "./src/config/database.js";

const result = await pool.query(`
  SELECT
    table_name,
    column_name,
    data_type,
    is_nullable,
    column_default
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name IN (
      'chat_private_conversations',
      'chat_private_members',
      'chat_private_messages',
      'chat_attachments'
    )
  ORDER BY
    table_name,
    ordinal_position;
`);

console.table(result.rows);

await pool.end();
