import pool from "./src/config/database.js";

try {
  const result = await pool.query(`
    SELECT
      table_name,
      column_name,
      data_type,
      is_nullable,
      column_default
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name IN ('users', 'user_profiles')
    ORDER BY table_name, ordinal_position;
  `);

  console.table(result.rows);

} catch (error) {
  console.error("ERROR:", error);
} finally {
  await pool.end();
}
