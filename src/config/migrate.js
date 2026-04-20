// backend/src/config/migrate.js

const fs = require('fs');
const path = require('path');
const pool = require('./database.js'); // your db config

const runMigration = async () => {
  try {
    console.log('🚀 Running DB migration...');

    // 🔧 read schema.sql
    const filePath = path.join(__dirname, 'schema.sql'); //  same folder
    const sql = fs.readFileSync(filePath, 'utf8');

    // 🔧 execute SQL
    await pool.query(sql);

    console.log('✅ Migration completed successfully');

    process.exit(0);
  } catch (error) {
    console.error('❌ Migration failed:', error);
    process.exit(1);
  }
};

runMigration();