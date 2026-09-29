import fs from "fs";
import pool from "./src/config/database.js";

const schemaPath = "./database/chat-schema.sql";

try {
  console.log("");
  console.log("==============================================");
  console.log(" MACHINE CONTROL SYSTEM");
  console.log(" CHAT SCHEMA - CREACIÓN REAL");
  console.log("==============================================");
  console.log("");

  const sql = fs.readFileSync(schemaPath, "utf8");

  console.log("Archivo SQL cargado correctamente.");
  console.log(`Caracteres SQL: ${sql.length}`);
  console.log("");

  await pool.query("BEGIN");

  console.log("Transacción iniciada.");
  console.log("Creando tablas del sistema CHAT...");
  console.log("");

  await pool.query(sql);

  await pool.query("COMMIT");

  console.log("");
  console.log("==============================================");
  console.log(" ✓ CHAT SCHEMA CREADO CORRECTAMENTE");
  console.log("==============================================");
  console.log("");
  console.log("Las tablas del Chat fueron guardadas");
  console.log("definitivamente en PostgreSQL.");
  console.log("");
  console.log("✓ Transacción COMMIT completada.");
  console.log("");

} catch (error) {

  try {
    await pool.query("ROLLBACK");
    console.log("");
    console.log("✓ ROLLBACK EJECUTADO");
    console.log("✓ No se guardaron cambios parciales.");
  } catch {
    console.log("");
    console.log("No fue posible ejecutar ROLLBACK.");
  }

  console.error("");
  console.error("==============================================");
  console.error(" ✗ ERROR AL CREAR CHAT SCHEMA");
  console.error("==============================================");
  console.error("");
  console.error(error.message);
  console.error("");

  process.exitCode = 1;

} finally {

  await pool.end();

}