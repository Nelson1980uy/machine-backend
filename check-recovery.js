import "dotenv/config";
import pg from "pg";

const { Pool } = pg;

const pool = new Pool({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT),
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  ssl: false,
});

try {
  const result = await pool.query(`
    SELECT
      id,
      email,
      employee_id,
      recovery_question,
      recovery_answer_hash IS NOT NULL AS has_recovery_answer
    FROM public.users
    WHERE email = 'nelsson.lapizaga@machine.local'
       OR employee_id = '333333'
  `);

  console.log(result.rows);
} catch (error) {
  console.error(error);
} finally {
  await pool.end();
}
