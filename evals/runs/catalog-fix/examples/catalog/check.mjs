import { readFile } from 'node:fs/promises';
import { indexCatalog } from './service.mjs';

// A local, read-only oracle. Validation failures share the target's exit code,
// but have different output so the reducer cannot mistake them for the bug.
try {
  if (process.argv.length !== 3) throw new Error('expected one JSON input path');
  const catalog = JSON.parse((await readFile(process.argv[2], 'utf8')).replace(/^\uFEFF/, ''));
  if (catalog === null || typeof catalog !== 'object' || Array.isArray(catalog)) throw new Error('expected a catalog object');
  if (catalog.schemaVersion !== 1) throw new Error('schemaVersion must be 1');
  if (!Array.isArray(catalog.products) || catalog.products.length === 0) throw new Error('products must be a nonempty array');
  for (const product of catalog.products) {
    if (product === null || typeof product !== 'object' || Array.isArray(product)) throw new Error('product must be an object');
    if (typeof product.sku !== 'string' || !product.sku.trim()) throw new Error('product requires a nonempty SKU');
    if (typeof product.name !== 'string' || !product.name.trim()) throw new Error('product requires a name');
    if (!Number.isSafeInteger(product.price_cents) || product.price_cents < 0) throw new Error('product requires a nonnegative integer price_cents');
  }
  const expectedCount = new Set(catalog.products.map(product => product.sku)).size;
  if (expectedCount !== catalog.products.length) throw new Error('raw SKUs must be unique');
  const actual = indexCatalog(catalog.products);
  if (actual.size !== expectedCount) {
    console.error('REPRO: normalized-sku-collision');
    process.exitCode = 1;
  } else {
    console.log('PASS: all distinct SKUs remain in the index');
  }
} catch (error) {
  console.error(`VALIDATION: ${error.message}`);
  process.exitCode = 1;
}
