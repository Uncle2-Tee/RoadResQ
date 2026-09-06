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
    'select column_name from information_schema.columns where table_name = $1 and column_name = $2',
    ['User', 'profilePhotoUri']
  );
  await client.end();

  console.log(`profile_column_exists=${result.rowCount === 1}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
