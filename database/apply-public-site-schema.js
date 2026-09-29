import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

import pool from "../src/config/database.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const schemaPath =
  path.join(
    __dirname,
    "public-site-schema.sql"
  );

const sql =
  fs.readFileSync(
    schemaPath,
    "utf8"
  );

try {

  console.log("");
  console.log("========================================");
  console.log("MACHINE PUBLIC SITE");
  console.log("APPLYING DATABASE SCHEMA");
  console.log("========================================");

  await pool.query(sql);

  console.log(
    "PUBLIC SITE SCHEMA: READY"
  );

  console.log(
    "TABLE: public.site_comments"
  );

  console.log(
    "TABLE: public.site_support_requests"
  );

  console.log("========================================");
  console.log("");

} catch (error) {

  console.error(
    "PUBLIC SITE SCHEMA ERROR:",
    error
  );

  process.exitCode = 1;

} finally {

  await pool.end();

}
