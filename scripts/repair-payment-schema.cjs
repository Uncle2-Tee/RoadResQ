require('dotenv/config');
const { Client } = require('pg');
const client = new Client({ connectionString: process.env.DIRECT_URL || process.env.DATABASE_URL });
(async () => {
  await client.connect();
  await client.query(`
    ALTER TABLE "Payment"
      ADD COLUMN IF NOT EXISTS "releaseStatus" TEXT NOT NULL DEFAULT 'pending',
      ADD COLUMN IF NOT EXISTS "releasedAt" TIMESTAMP(3),
      ADD COLUMN IF NOT EXISTS "releaseNote" TEXT;
    CREATE INDEX IF NOT EXISTS "Payment_releaseStatus_idx" ON "Payment"("releaseStatus");
  `);
  const result = await client.query(`
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'Payment'
      AND column_name IN ('releaseStatus', 'releasedAt', 'releaseNote')
    ORDER BY column_name
  `);
  console.log(`payment_release_columns=${result.rows.map((row) => row.column_name).join(',')}`);
  await client.end();
})().catch(async (error) => {
  console.error(error.message);
  await client.end().catch(() => {});
  process.exit(1);
});
