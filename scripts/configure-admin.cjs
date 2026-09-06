require('dotenv/config');

const { Client } = require('pg');

async function main() {
  const adminEmail = String(process.env.ADMIN_EMAIL || '').trim().toLowerCase();
  const connectionString = process.env.DIRECT_URL || process.env.DATABASE_URL;

  if (!adminEmail || !connectionString) {
    throw new Error('ADMIN_EMAIL and DIRECT_URL or DATABASE_URL are required.');
  }

  const client = new Client({ connectionString });
  await client.connect();

  try {
    const result = await client.query(
      'UPDATE "Users" SET "role" = $1 WHERE LOWER("email") = $2 RETURNING "id", "email", "role"',
      ['admin', adminEmail]
    );

    if (result.rowCount !== 1) {
      throw new Error(`No user found for ADMIN_EMAIL=${adminEmail}. Create the account first.`);
    }

    console.log(`Admin configured: ${result.rows[0].email}`);
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
