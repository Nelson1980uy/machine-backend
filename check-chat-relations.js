import pool from "./src/config/database.js";

try {
  console.log("");
  console.log("==============================================");
  console.log(" MACHINE CONTROL SYSTEM");
  console.log(" VERIFICACIÓN DE RELACIONES CHAT");
  console.log("==============================================");
  console.log("");

  const result = await pool.query(`
    SELECT
      tc.table_name,
      kcu.column_name,
      ccu.table_name AS referenced_table,
      ccu.column_name AS referenced_column
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu
      ON tc.constraint_name = kcu.constraint_name
      AND tc.table_schema = kcu.table_schema
    JOIN information_schema.constraint_column_usage ccu
      ON ccu.constraint_name = tc.constraint_name
      AND ccu.table_schema = tc.table_schema
    WHERE tc.constraint_type = 'FOREIGN KEY'
      AND tc.table_schema = 'public'
      AND tc.table_name LIKE 'chat_%'
    ORDER BY
      tc.table_name,
      kcu.column_name;
  `);

  console.table(result.rows);

  console.log("");
  console.log(
    `Total de relaciones FOREIGN KEY: ${result.rows.length}`
  );
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