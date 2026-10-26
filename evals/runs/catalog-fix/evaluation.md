# FixtureShrink catalog evaluation

The scratch service now keeps every product addressable by its original SKU. The unchanged checker passes for both the 235-byte reduced fixture and the original 13,548-byte catalog. Four regression tests failed before the fix and passed afterward.

## Scope and setup

This evaluation started from only the FixtureShrink skill, its CLI reference, and the catalog's `input.json`, `service.mjs`, `check.mjs`, and `oracle.json`. The project README, reducer implementation, and product tests were not read. The four catalog files were copied into an isolated scratch project, retaining the `examples/catalog` layout expected by the oracle. Only the scratch service was fixed. The original input, checker, and oracle were preserved byte-for-byte, with SHA-256 evidence in `evidence/preservation.json`.

Node.js v22.14.0 was already installed. No network, installation, or publication was performed. The oracle was reviewed before repeated execution: it reads the supplied file, validates it, imports the scratch service, and writes a result message. Its target requires exit code 1 and the exact stderr substring `REPRO: normalized-sku-collision`. Validation errors use another prefix and therefore do not count as the target. `/schemaVersion` was protected. The selected budget was 240 oracle invocations.

The provided service explicitly labelled its normalization as a deliberate demo bug. This is evidence of a completed reduction-and-fix workflow on the supplied fixture, not a blind discovery of an unknown production defect.

## Commands actually executed

Commands ran from the scratch-project root. In the reducer command only, the machine-specific checkout prefix has been replaced with `<workspace>`; the remaining argument strings are unchanged.

```text
node --version
node examples/catalog/check.mjs examples/catalog/input.json
node "<workspace>/work/fixture-shrink/skills/fixture-shrink/scripts/shrink.mjs" examples/catalog/input.json --oracle examples/catalog/oracle.json --out reduction --max-runs 240
node evidence/verify.mjs before
node evidence/verify.mjs after
node evidence/export.mjs
```

Each `verify.mjs` invocation actually launched these three commands using the current Node executable and recorded exit status, stdout, and stderr in `evidence/before.json` or `evidence/after.json`:

```text
node examples/catalog/check.mjs reduction/reduced.json
node examples/catalog/check.mjs examples/catalog/input.json
node --test regression.test.mjs
```

The verification wrapper exits successfully only when all child results match that stage's expectations: failures before the fix and passes after it. The child exit codes below are the application/test outcomes.

## Reduction result

| Measure | Actual result |
| --- | --- |
| Reducer exit code | 0 |
| Status | `reduced` |
| Verified | `true` |
| Original input | 13,548 bytes; 34 products |
| Normalized input | 13,016 bytes |
| Reduced input | 235 bytes; 2 products |
| Bytes removed from original | 13,313 (98.27%) |
| Oracle attempts | 81 of 240 |
| Phase counts | 2 original baselines, 2 normalized baselines, 75 candidate attempts, 2 final replays |
| Search result | `fixed_point`; 66 candidates tested; 9 accepted reductions |
| Verdicts | 24 interesting, 57 uninteresting |
| Timeouts / output overflows / operational errors | 0 / 0 / 0 |

Both final replays exited 1 and emitted the required collision signature. Of the 57 uninteresting attempts, 28 produced validation errors and 29 had no target failure. The budget was not exhausted. Published sanitized observations and the reduction trace are in `reduction/report.json`; `reduction/report.md` is the generated summary.

The reduced file was inspected before sharing. It contains schema version 1 and two products with SKU, name, and price only; it contains no credentials or personal fields. The products are:

```json
{
  "schemaVersion": 1,
  "products": [
    { "sku": "USB-C-001", "name": "USB-C cable", "price_cents": 1499 },
    { "sku": " usb-c-001 ", "name": "USB adapter", "price_cents": 2499 }
  ]
}
```

## Bug and fix

The service used `product.sku.trim().toLowerCase()` as each Map key. Both distinct identifiers above became `usb-c-001`; inserting the second product replaced the first. The contract says distinct, case-sensitive SKUs remain addressable. Normalization also made a single mixed-case SKU unavailable under its original identifier even without a collision.

The scratch fix uses `product.sku` unchanged as the key:

```js
export function indexCatalog(products) {
  return new Map(products.map(product => [product.sku, product]));
}
```

`regression.test.mjs` checks the reduced fixture, full catalog, case/whitespace distinctions, and single mixed-case lookup. Each test asserts both the expected index size and retrieval of the exact original product object by its original SKU.

| Check | Before fix | After fix |
| --- | --- | --- |
| Reduced fixture, unchanged checker | Exit 1, target signature | Exit 0, PASS |
| Full input, unchanged checker | Exit 1, target signature | Exit 0, PASS |
| Regression tests | Exit 1; 0 passed, 4 failed | Exit 0; 4 passed, 0 failed |
| Reduced index count | 1 instead of 2 | 2 |
| Full index count | 33 instead of 34 | 34 |

The pre-fix failures are preserved in the evidence rather than omitted. Post-fix verification confirms the target failure no longer occurs on either required input.

## Artifacts and limits

- `examples/catalog/input.json`, `check.mjs`, and `oracle.json`: preserved originals.
- `examples/catalog/service.mjs`: fixed scratch service.
- `regression.test.mjs`: regression coverage.
- `reduction/reduced.json`: verified focused reproducer for the pre-fix service.
- `reduction/report.json` and `report.md`: original reducer evidence.
- `evidence/service.before.mjs`: pre-fix service.
- `evidence/before.json`, `after.json`, and `preservation.json`: actual checks and file hashes.
- Published JSON evidence is sanitized: local scratch paths are replaced with `<scratch>`. Verification/export driver scripts were retained in the local evaluation workspace; the recorded commands describe what actually ran there.

The skill and reference were sufficient to run this fixture without the project README. The oracle's relative checker path required retaining its expected working-directory layout. The result is a fixed point under the helper's supported deletions and this oracle, not a proof of a global minimum. Scalar values were not simplified. The existing checker validates count only; the added regression tests cover original-key lookup. The generated reducer report describes the pre-fix service, while the after evidence describes the fixed scratch service. No cost or time benefit was measured.
