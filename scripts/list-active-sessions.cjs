const { Client } = require('pg');
require('dotenv/config');

async function main() {
  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    connectionTimeoutMillis: 15000,
    ssl: { rejectUnauthorized: false },
  });

  await client.connect();
  const result = await client.query(`
    select email, role, "activeSessionId" is not null as locked, "activeSessionStartedAt"
    from "User"
    order by "updatedAt" desc
    limit 20
  `);
  await client.end();

  console.table(result.rows);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
