const { Client } = require('pg');
require('dotenv/config');

async function addEnumValues(client, enumName, values) {
  for (const value of values) {
    await client.query(`ALTER TYPE "${enumName}" ADD VALUE IF NOT EXISTS '${value}'`);
    console.log(`${enumName}.${value}=ok`);
  }
}

async function main() {
  const connectionString = process.env.DIRECT_URL || process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('DIRECT_URL or DATABASE_URL is required.');
  }

  const client = new Client({
    connectionString,
    connectionTimeoutMillis: 15000,
    ssl: { rejectUnauthorized: false },
  });

  await client.connect();
  try {
    await addEnumValues(client, 'RequestType', ['CALL', 'SMS', 'CHAT']);
    await addEnumValues(client, 'RequestStatus', ['CALLED', 'MESSAGED', 'CHAT']);
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
