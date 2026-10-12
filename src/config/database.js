
import pg from "pg";
import dotenv from "dotenv";
import { readFileSync } from "node:fs";

dotenv.config();

const { Pool } = pg;

const useSSL = process.env.DB_SSL === "true";

const sslConfig = useSSL
  ? {
      ca: readFileSync(
        new URL("./certs/prod-ca-2021.crt", import.meta.url),
        "utf8"
      ),
      rejectUnauthorized: true,
    }
  : false;

console.log("========================================");
console.log("DATABASE CONFIG");
console.log("HOST:", process.env.DB_HOST);
console.log("PORT:", process.env.DB_PORT || 5432);
console.log("DATABASE:", process.env.DB_NAME);
console.log("USER:", process.env.DB_USER);
console.log("SSL:", useSSL ? "ENABLED" : "DISABLED");
console.log("========================================");

const pool = new Pool({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT || 5432),
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,

  ssl: sslConfig,

  max: Number(process.env.DB_POOL_MAX || 10),
  connectionTimeoutMillis: 10000,
  idleTimeoutMillis: 30000,
});

pool.on("connect", () => {
  console.log("DATABASE: CONNECTED");
});

pool.on("error", (error) => {
  console.error("DATABASE ERROR:", error.message);
});

export default pool;
