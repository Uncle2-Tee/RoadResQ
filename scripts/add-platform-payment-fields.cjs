const { Client } = require('pg');
require('dotenv/config');

const statements = [
  'ALTER TABLE "Mechanic/TowShop" ADD COLUMN IF NOT EXISTS "bankName" TEXT',
  'ALTER TABLE "Mechanic/TowShop" ADD COLUMN IF NOT EXISTS "bankCode" TEXT',
  'ALTER TABLE "Mechanic/TowShop" ADD COLUMN IF NOT EXISTS "accountNumber" TEXT',
  'ALTER TABLE "Mechanic/TowShop" ADD COLUMN IF NOT EXISTS "accountName" TEXT',
  'ALTER TABLE "Mechanic/TowShop" ADD COLUMN IF NOT EXISTS "paystackSubaccountCode" TEXT',
  'ALTER TABLE "Payment" ADD COLUMN IF NOT EXISTS "platformFee" DECIMAL(10,2)',
  'ALTER TABLE "Payment" ADD COLUMN IF NOT EXISTS "commissionAmount" DECIMAL(10,2)',
  'ALTER TABLE "Payment" ADD COLUMN IF NOT EXISTS "mechanicAmount" DECIMAL(10,2)',
];

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
    for (const statement of statements) {
      await client.query(statement);
      console.log(`${statement}=ok`);
    }
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
