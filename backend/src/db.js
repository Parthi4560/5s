require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
  connectionString:
    process.env.DATABASE_URL || 'postgres://fives:fives@localhost:5432/fives',
});

module.exports = pool;
