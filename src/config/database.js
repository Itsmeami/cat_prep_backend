const { Pool } = require("pg");
require("dotenv").config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL, // 🔥 use Neon URL
  ssl: {
    rejectUnauthorized: false, // 🔥 required for Neon
  },
});

// Test connection
pool
  .query("SELECT NOW()")
  .then((res) => console.log("✅ Neon DB connected at:", res.rows[0].now))
  .catch((err) => console.error("❌ Neon DB connection error:", err));

pool.on("error", (err) => {
  console.error("❌ Unexpected error on idle client", err);
  process.exit(-1);
});

module.exports = pool;