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

  await pool.query(`
    CREATE TABLE IF NOT EXISTS public.password_recovery_attempts (
      user_id uuid PRIMARY KEY
        REFERENCES public.users(id)
        ON DELETE CASCADE,

      failed_attempts integer NOT NULL DEFAULT 0,

      locked_until timestamptz NULL,

      updated_at timestamptz NOT NULL DEFAULT NOW()
    );
  `);

  console.log(
    "RECOVERY ATTEMPTS TABLE OK"
  );

} catch (error) {

  console.error(
    "ERROR CREATING RECOVERY ATTEMPTS TABLE:",
    error
  );

} finally {

  await pool.end();

}