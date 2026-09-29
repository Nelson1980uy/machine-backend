import pool from "./src/config/database.js";

try {
  const result = await pool.query(`
    SELECT
      id,
      email,
      employee_id,
      status
    FROM public.users
    ORDER BY created_at DESC;
  `);

  console.table(result.rows);

} catch (error) {

  console.error(
    "ERROR CONSULTANDO USUARIOS:",
    error
  );

} finally {

  await pool.end();

}