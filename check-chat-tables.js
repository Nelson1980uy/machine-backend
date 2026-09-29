import pool from "./src/config/database.js";

try {
  console.log("");
  console.log("==============================================");
  console.log(" MACHINE CONTROL SYSTEM");
  console.log(" VERIFICACIÓN DE TABLAS CHAT");
  console.log("==============================================");
  console.log("");

  const result = await pool.query(`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name LIKE 'chat_%'
    ORDER BY table_name;
  `);

  console.table(result.rows);

  console.log("");
  console.log(`Total de tablas CHAT: ${result.rows.length}`);
  console.log("");

} catch (error) {

  console.error("");
  console.error("==============================================");
  console.error(" ✗ ERROR");
  console.error("==============================================");
  console.error("");
  console.error(error.message);
  console.error("");

  process.exitCode = 1;

} finally {

  await pool.end();

}