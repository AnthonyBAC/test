const { Pool } = require("pg");
require("dotenv").config();

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error("Falta DATABASE_URL: cópiala desde .env.example a .env.local");
}

const pool = new Pool({ connectionString });

module.exports = { pool };
