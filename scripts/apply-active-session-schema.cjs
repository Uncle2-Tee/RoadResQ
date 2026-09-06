const { Client } = require('pg');
const fs = require('fs');
const path = require('path');
require('dotenv/config');

async function main() {
  const connectionString = process.env.DATABASE_URL;

  if (!connectionString) {
    throw new Error('DATABASE_URL is not configured');
  }

  const client = new Client({
    connectionString,
    connectionTimeoutMillis: 15000,
    query_timeout: 30000,
    statement_timeout: 30000,
    ssl: { rejectUnauthorized: false },
  });

  const sql = fs.readFileSync(path.join(__dirname, 'add-active-session.sql'), 'utf8');

  await client.connect();
  await client.query(sql);
  await client.end();
  console.log('active_session_schema_applied=true');
}

main().catch((error) => {
  console.error('active_session_schema_applied=false');
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
