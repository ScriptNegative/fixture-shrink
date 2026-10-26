import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { indexCatalog } from './examples/catalog/service.mjs';

function assertAddressable(products) {
  const index = indexCatalog(products);
  assert.equal(index.size, products.length, 'every distinct SKU needs an entry');
  for (const product of products) {
    assert.equal(index.get(product.sku), product, `original SKU must retrieve its product: ${JSON.stringify(product.sku)}`);
  }
}

for (const [label, path] of [
  ['reduced collision fixture', './reduction/reduced.json'],
  ['original full catalog', './examples/catalog/input.json'],
]) {
  test(`${label}: every original SKU remains addressable`, async () => {
    const catalog = JSON.parse(await readFile(new URL(path, import.meta.url), 'utf8'));
    assertAddressable(catalog.products);
  });
}

test('case and surrounding whitespace distinguish SKU identifiers', () => {
  const products = ['ABC', 'abc', ' ABC', 'ABC '].map((sku, i) => ({
    sku, name: `Product ${i}`, price_cents: i,
  }));
  assertAddressable(products);
});

test('one mixed-case SKU is retrievable by its original spelling', () => {
  assertAddressable([{ sku: 'Mixed-Case-1', name: 'Single product', price_cents: 99 }]);
});
