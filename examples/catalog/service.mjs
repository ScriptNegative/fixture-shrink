// Contract: each distinct, case-sensitive SKU must remain addressable.
// Deliberate demo bug: normalization silently overwrites distinct identifiers.
export function indexCatalog(products) {
  return new Map(products.map(product => [product.sku.trim().toLowerCase(), product]));
}
