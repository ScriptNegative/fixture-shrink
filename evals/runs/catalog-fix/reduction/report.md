# FixtureShrink result

Status: **reduced**. Final replay verified: **true**.

Oracle runs: 81/240.
Original: 13548 bytes. Normalized: 13016 bytes.
Result: 235 bytes in reduced.json.

The matcher identifies an observed failure signature; it does not establish the same root cause or a global minimum.

## Replay command

Arguments (no shell):

```json
["node","examples/catalog/check.mjs","{input}"]
```

Replace the standalone {input} argument with the result file. Run from the recorded working directory, using the same program and environment.

## Evidence

Required exit code: 1. Required stream: stderr.

Literal signature:

```text
REPRO: normalized-sku-collision
```

See report.json for the exact matcher, protected pointers, hashes, ordered run observations, and reduction trace. Output previews are bounded; classification uses the complete captured output within the configured byte limit.

Review the fixture and report before sharing. No secret removal, process isolation, environment snapshot, or source-drift verification is performed.
