require('dotenv/config');

const { Client } = require('pg');

const createTables = `
CREATE TABLE IF NOT EXISTS "MechanicShops" (
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
  "status" TEXT NOT NULL DEFAULT 'active',
  "approvalStatus" TEXT NOT NULL DEFAULT 'approved',
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

CREATE TABLE IF NOT EXISTS "TowShops" (
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
  "status" TEXT NOT NULL DEFAULT 'active',
  "approvalStatus" TEXT NOT NULL DEFAULT 'approved',
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

CREATE UNIQUE INDEX IF NOT EXISTS "MechanicShops_shopId_key" ON "MechanicShops"("shopId");
CREATE UNIQUE INDEX IF NOT EXISTS "MechanicShops_licenseNumber_key" ON "MechanicShops"("licenseNumber");
CREATE UNIQUE INDEX IF NOT EXISTS "TowShops_shopId_key" ON "TowShops"("shopId");
CREATE UNIQUE INDEX IF NOT EXISTS "TowShops_licenseNumber_key" ON "TowShops"("licenseNumber");
CREATE INDEX IF NOT EXISTS "MechanicShops_mechanicId_idx" ON "MechanicShops"("mechanicId");
CREATE INDEX IF NOT EXISTS "MechanicShops_status_idx" ON "MechanicShops"("status");
CREATE INDEX IF NOT EXISTS "MechanicShops_latitude_longitude_idx" ON "MechanicShops"("latitude", "longitude");
CREATE INDEX IF NOT EXISTS "TowShops_mechanicId_idx" ON "TowShops"("mechanicId");
CREATE INDEX IF NOT EXISTS "TowShops_status_idx" ON "TowShops"("status");
CREATE INDEX IF NOT EXISTS "TowShops_latitude_longitude_idx" ON "TowShops"("latitude", "longitude");
`;

const copyRows = `
INSERT INTO "MechanicShops" (
  "id", "shopId", "mechanicId", "shopName", "phone", "location", "specialization",
  "licenseNumber", "latitude", "longitude", "status", "approvalStatus", "bankName",
  "bankCode", "accountNumber", "accountName", "paystackSubaccountCode", "createdAt", "updatedAt"
)
SELECT "id", "shopId", "mechanicId", "shopName", "phone", "location", "specialization",
  "licenseNumber", "latitude", "longitude", "status", "approvalStatus", "bankName",
  "bankCode", "accountNumber", "accountName", "paystackSubaccountCode", "createdAt", "updatedAt"
FROM "Mechanic/TowShop"
WHERE COALESCE("providerType", 'registered') = 'registered'
ON CONFLICT ("id") DO NOTHING;

INSERT INTO "TowShops" (
  "id", "shopId", "mechanicId", "shopName", "phone", "location", "specialization",
  "licenseNumber", "latitude", "longitude", "status", "approvalStatus", "bankName",
  "bankCode", "accountNumber", "accountName", "paystackSubaccountCode", "createdAt", "updatedAt"
)
SELECT "id", "shopId", "mechanicId", "shopName", "phone", "location", "specialization",
  "licenseNumber", "latitude", "longitude", "status", "approvalStatus", "bankName",
  "bankCode", "accountNumber", "accountName", "paystackSubaccountCode", "createdAt", "updatedAt"
FROM "Mechanic/TowShop"
WHERE "providerType" = 'tow'
ON CONFLICT ("id") DO NOTHING;
`;

const moveTowRowsFromMechanicTable = `
INSERT INTO "TowShops" (
  "id", "shopId", "mechanicId", "shopName", "phone", "location", "specialization",
  "licenseNumber", "latitude", "longitude", "status", "approvalStatus", "bankName",
  "bankCode", "accountNumber", "accountName", "paystackSubaccountCode", "createdAt", "updatedAt"
)
SELECT "id", "shopId", "mechanicId", "shopName", "phone", "location", "specialization",
  "licenseNumber", "latitude", "longitude", "status", "approvalStatus", "bankName",
  "bankCode", "accountNumber", "accountName", "paystackSubaccountCode", "createdAt", "updatedAt"
FROM "MechanicShops"
WHERE lower("providerType") = 'tow'
ON CONFLICT DO NOTHING;

DELETE FROM "MechanicShops"
WHERE lower("providerType") = 'tow';
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
    await client.query(createTables);
    const mechanicColumns = await client.query(`
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'MechanicShops'
        AND column_name = 'providerType'
    `);
    if (mechanicColumns.rowCount) {
      await client.query(`
        ALTER TABLE "MechanicShops"
          ADD COLUMN IF NOT EXISTS "approvalStatus" TEXT NOT NULL DEFAULT 'approved';
      `);
      await client.query(moveTowRowsFromMechanicTable);
      await client.query('ALTER TABLE "MechanicShops" DROP COLUMN IF EXISTS "providerType"');
    }
    const legacyTable = await client.query(`SELECT to_regclass('"Mechanic/TowShop"') AS name`);
    if (legacyTable.rows[0]?.name) {
      await client.query(`
        ALTER TABLE "Mechanic/TowShop"
          ADD COLUMN IF NOT EXISTS "approvalStatus" TEXT NOT NULL DEFAULT 'approved';
      `);
      await client.query(copyRows);
      await client.query('DROP TABLE "Mechanic/TowShop"');
    }
    await client.query('COMMIT');
    console.log('Shop tables split successfully.');
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
