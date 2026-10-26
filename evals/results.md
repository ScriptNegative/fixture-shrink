# Recorded results

Recorded on 26 October 2026. These are bounded correctness checks and one exploratory coding workflow, not a benchmark of assistant productivity or a universal host-compatibility claim.

## Final-version catalog reduction

The supplied catalog deliberately contains a normalization bug: indexing two distinct SKUs by a trimmed, lowercase key loses a product. The input contains 34 products and unrelated metadata. Its checker distinguishes this failure from invalid JSON or missing required fields.

```sh
node skills/fixture-shrink/scripts/shrink.mjs examples/catalog/input.json --oracle examples/catalog/oracle.json --out catalog-repro --max-runs 200
```

On Windows with Node v22.14.0, the final helper reduced 13,548 original bytes (13,016 normalized) to 235 bytes and two products, using 81 of 200 oracle invocation attempts. Both final replays matched exit code 1 and `REPRO: normalized-sku-collision`. The original input hash remained unchanged. The demo input's exact bytes are preserved in Git so its recorded size and hash can be checked.

The [reduced fixture](runs/catalog-reduction/reduced.json) and [sanitized full report](runs/catalog-reduction/report.json) preserve the actual run observations and reduction trace. Only source-path and working-directory fields were changed to repository-relative locations for publication.

## Independent coding workflow

A fresh-context evaluator read the installed skill and CLI reference, copied only the raw catalog files, and reduced the failing input without reading the project README, reducer implementation, or product tests. It then added four regression tests, observed all four fail against the buggy service, fixed the scratch service, and verified that the same tests and unchanged full/reduced checkers passed.

Its separate run also produced 235 bytes in 81 attempts, under a 240-attempt budget. The [evaluation](runs/catalog-fix/evaluation.md) includes before failures, after results, hashes, a saved fixed implementation, and limits. The fixture's source explicitly labels its deliberate bug; this was not blind discovery of a production incident. This evaluation preceded final temporary-file hardening; the final-version demo above independently repeated the reduction after that fix.

Replay the saved fix:

```sh
node --test evals/runs/catalog-fix/regression.test.mjs
```

## Product checks and review

The root suite has 41 tests covering the pure reducer, protected JSON pointers, literal oracle commands, failure matching, Unicode and numeric limits, timeouts/output caps, source preservation, file replacement, run budgets, unstable results, and a copied skill with no installation. On Windows, 40 passed and one POSIX signal test skipped because Windows does not expose the same signal semantics. GitHub Actions runs the suite and four saved regression checks on Linux with Node 18/22 and Windows with Node 22; consult the matching workflow run for each platform's actual result.

Independent review found a temporary-path replacement defect before publication: an oracle-created hardlink could make a subsequent helper write reach the original input. Fresh exclusive candidates plus file-identity/link/content checks fixed it. The original probe now rejects the first attempt and preserves source bytes, and a regression test covers it.

Two matching runs provide repeat observations, not proof of determinism, identical root cause, or a global minimum. No token, cost, or end-to-end productivity benefit was measured. Other hosts' live discovery and invocation have not been exercised. The helper does not isolate the oracle, snapshot application code/environment, remove secrets, or guarantee termination of escaped descendant processes.
