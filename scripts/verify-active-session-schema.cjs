const { Client } = require('pg');
require('dotenv/config');

async function main() {
  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    connectionTimeoutMillis: 15000,
    ssl: { rejectUnauthorized: false },
  });

  await client.connect();
  const result = await client.query(
    'select column_name from information_schema.columns where table_name = $1 and column_name in ($2, $3)',
    ['User', 'activeSessionId', 'activeSessionStartedAt']
  );
  await client.end();

  console.log(`active_session_columns=${result.rowCount}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
