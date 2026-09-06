require('dotenv/config');

const { Client } = require('pg');

const ddl = `
CREATE TABLE IF NOT EXISTS "Mechanic/TowShop" (
  "id" TEXT NOT NULL,
  "shopId" TEXT NOT NULL,
  "mechanicId" TEXT,
  "shopName" TEXT NOT NULL,
  "phone" TEXT NOT NULL,
  "location" TEXT NOT NULL,
  "specialization" TEXT NOT NULL,
  "licenseNumber" TEXT NOT NULL,
  "latitude" DECIMAL(10, 7) NOT NULL,
  "longitude" DECIMAL(10, 7) NOT NULL,
  "providerType" TEXT NOT NULL DEFAULT 'registered',
  "status" TEXT NOT NULL DEFAULT 'active',
  "bankName" TEXT,
  "bankCode" TEXT,
  "accountNumber" TEXT,
  "accountName" TEXT,
  "paystackSubaccountCode" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY ("id"),
  FOREIGN KEY ("mechanicId") REFERENCES "Users"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "Mechanic_TowShop_shopId_key" ON "Mechanic/TowShop"("shopId");
CREATE UNIQUE INDEX IF NOT EXISTS "Mechanic_TowShop_licenseNumber_key" ON "Mechanic/TowShop"("licenseNumber");
CREATE INDEX IF NOT EXISTS "Mechanic_TowShop_mechanicId_idx" ON "Mechanic/TowShop"("mechanicId");
CREATE INDEX IF NOT EXISTS "Mechanic_TowShop_status_idx" ON "Mechanic/TowShop"("status");
CREATE INDEX IF NOT EXISTS "Mechanic_TowShop_latitude_longitude_idx" ON "Mechanic/TowShop"("latitude", "longitude");

ALTER TABLE "Mechanic/TowShop"
  ADD COLUMN IF NOT EXISTS "bankName" TEXT,
  ADD COLUMN IF NOT EXISTS "bankCode" TEXT,
  ADD COLUMN IF NOT EXISTS "accountNumber" TEXT,
  ADD COLUMN IF NOT EXISTS "accountName" TEXT,
  ADD COLUMN IF NOT EXISTS "paystackSubaccountCode" TEXT;
`;

async function main() {
  const connectionString = process.env.DIRECT_URL || process.env.DATABASE_URL;

  if (!connectionString) {
    throw new Error('DIRECT_URL or DATABASE_URL is required.');
  }

  const client = new Client({ connectionString });
  await client.connect();

  try {
    await client.query('BEGIN');
    await client.query(ddl);
    await client.query('COMMIT');

    const result = await client.query(`
      SELECT column_name, data_type
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'Mechanic/TowShop'
      ORDER BY ordinal_position
    `);

    console.log('MechanicShop schema pushed.');
    console.log(`columns=${result.rowCount}`);
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
