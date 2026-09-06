const { Client } = require('pg');
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

  await client.connect();
  await client.query('ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "profilePhotoUri" TEXT');
  await client.end();
  console.log('profile_schema_applied=true');
}

main().catch(async (error) => {
  console.error('profile_schema_applied=false');
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
