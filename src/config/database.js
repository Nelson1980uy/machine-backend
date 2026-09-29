import pg from "pg";
import dotenv from "dotenv";

dotenv.config();

const { Pool } = pg;

console.log("========================================");
console.log("DATABASE CONFIG");
console.log("HOST:", process.env.DB_HOST);
console.log("PORT:", process.env.DB_PORT);
console.log("DATABASE:", process.env.DB_NAME);
console.log("USER:", process.env.DB_USER);
console.log("SSL:", "DISABLED");
console.log("========================================");

const pool = new Pool({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT || 5432),
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
});

pool.on("connect", () => {
  console.log("DATABASE: CONNECTED");
});

pool.on("error", (error) => {
  console.error("DATABASE ERROR:", error);
});

export default pool;