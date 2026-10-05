import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';
import { PGlite } from '@electric-sql/pglite';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const stages = [
  'scripts/fixtures/finance_applicant_withdraw_pglite.sql',
  'supabase/migrations/20261005173534_applicant_withdraw_bill_invoice_v1.sql',
  'scripts/fixtures/finance_applicant_withdraw_assertions.sql',
  'scripts/finance_applicant_withdraw_postflight.sql',
];

const db = new PGlite();
try {
  for (const stage of stages) {
    const sql = await readFile(resolve(root, stage), 'utf8');
    try {
      await db.exec(sql);
    } catch (error) {
      throw new Error(`${stage}: ${error.message}`, { cause: error });
    }
    process.stdout.write(`PASS ${stage}\n`);
  }
} finally {
  await db.close();
}
