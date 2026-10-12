import dotenv from "dotenv";
import pg from "pg";

dotenv.config();

const { Pool } = pg;

const pool = new Pool({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT || 5432),
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
});

try {
  const result = await pool.query(
    "SELECT column_name, data_type, column_default FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'user_profiles' AND column_name = 'profile_visibility';"
  );

  console.table(result.rows);

} catch (error) {

  console.error(
    "PROFILE PRIVACY VERIFY ERROR:",
    error.message
  );

} finally {

  await pool.end();

}
