// Contract: each distinct, case-sensitive SKU must remain addressable.
export function indexCatalog(products) {
  return new Map(products.map(product => [product.sku, product]));
}
