# FixtureShrink result

Status: **reduced**. Final replay verified: **true**.

Oracle runs: 10/400.
Original: 4007 bytes. Normalized: 4007 bytes.
Result: 2760 bytes in reduced.json.

String-value reduction: disabled (structure only).

The matcher identifies an observed failure signature; it does not establish the same root cause or a global minimum.

## Replay command

Arguments (no shell):

```json
["node","examples/message/check.mjs","{input}"]
```

Replace the standalone {input} argument with the result file. Run from the recorded working directory, using the same program and environment.

## Evidence

Required exit code: 1. Required stream: stderr.

Literal signature:

```text
REPRO: truncated-message
```

See report.json for the exact matcher, protected pointers, hashes, ordered run observations, and reduction trace. Output previews are bounded; classification uses the complete captured output within the configured byte limit.

Review the fixture and report before sharing. No secret removal, process isolation, environment snapshot, or application source-drift verification is performed.
