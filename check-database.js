import pool from "./src/config/database.js";

try {
  console.log("\n========================================");
  console.log("PRIMARY KEYS");
  console.log("========================================");

  const primaryKeys = await pool.query(`
    SELECT
      tc.table_name,
      kcu.column_name,
      tc.constraint_name
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu
      ON tc.constraint_name = kcu.constraint_name
      AND tc.table_schema = kcu.table_schema
    WHERE tc.table_schema = 'public'
      AND tc.constraint_type = 'PRIMARY KEY'
    ORDER BY tc.table_name;
  `);

  console.table(primaryKeys.rows);

  console.log("\n========================================");
  console.log("FOREIGN KEYS");
  console.log("========================================");

  const foreignKeys = await pool.query(`
    SELECT
      tc.table_name,
      kcu.column_name,
      ccu.table_name AS referenced_table,
      ccu.column_name AS referenced_column,
      tc.constraint_name
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu
      ON tc.constraint_name = kcu.constraint_name
      AND tc.table_schema = kcu.table_schema
    JOIN information_schema.constraint_column_usage ccu
      ON ccu.constraint_name = tc.constraint_name
      AND ccu.table_schema = tc.table_schema
    WHERE tc.table_schema = 'public'
      AND tc.constraint_type = 'FOREIGN KEY'
    ORDER BY tc.table_name;
  `);

  console.table(foreignKeys.rows);

  console.log("\n========================================");
  console.log("UNIQUE CONSTRAINTS");
  console.log("========================================");

  const uniqueConstraints = await pool.query(`
    SELECT
      tc.table_name,
      kcu.column_name,
      tc.constraint_name
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu
      ON tc.constraint_name = kcu.constraint_name
      AND tc.table_schema = kcu.table_schema
    WHERE tc.table_schema = 'public'
      AND tc.constraint_type = 'UNIQUE'
    ORDER BY tc.table_name, kcu.ordinal_position;
  `);

  console.table(uniqueConstraints.rows);

} catch (error) {
  console.error("ERROR:", error);
} finally {
  await pool.end();
}