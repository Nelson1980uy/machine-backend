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

  console.log("");
  console.log("========================================");
  console.log("MACHINE - PROFILE PRIVACY MIGRATION");
  console.log("========================================");

  console.log("");
  console.log("1. CREANDO profile_visibility...");

  await pool.query(`
    ALTER TABLE public.user_profiles
    ADD COLUMN IF NOT EXISTS profile_visibility VARCHAR(20) NOT NULL DEFAULT 'PUBLIC'
  `);

  console.log("   OK");

  console.log("");
  console.log("2. ELIMINANDO CONSTRAINT ANTERIOR SI EXISTE...");

  await pool.query(`
    ALTER TABLE public.user_profiles
    DROP CONSTRAINT IF EXISTS user_profiles_profile_visibility_check
  `);

  console.log("   OK");

  console.log("");
  console.log("3. CREANDO CONSTRAINT DE PRIVACIDAD...");

  await pool.query(`
    ALTER TABLE public.user_profiles
    ADD CONSTRAINT user_profiles_profile_visibility_check
    CHECK (profile_visibility IN ('PUBLIC', 'PRIVATE'))
  `);

  console.log("   OK");

  console.log("");
  console.log("========================================");
  console.log("PROFILE PRIVACY: MIGRACIÓN COMPLETADA");
  console.log("========================================");
  console.log("");

} catch (error) {

  console.error("");
  console.error("PROFILE PRIVACY MIGRATION ERROR:");
  console.error(error.message);
  console.error("");

  process.exitCode = 1;

} finally {

  await pool.end();

}
