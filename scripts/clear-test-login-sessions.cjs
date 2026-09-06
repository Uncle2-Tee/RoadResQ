const { Client } = require('pg');
require('dotenv/config');

async function main() {
  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    connectionTimeoutMillis: 15000,
    ssl: { rejectUnauthorized: false },
  });

  await client.connect();
  await client.query(`
    update "User"
    set "activeSessionId" = null, "activeSessionStartedAt" = null
    where email like 'codex-login-test-%@example.com'
  `);
  await client.end();
  console.log('test_login_sessions_cleared=true');
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
