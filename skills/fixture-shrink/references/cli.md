# Local JSON reducer

Use this reference when executing or adapting the bundled helper. It requires Node.js 18 or later and uses only built-in modules. The oracle can call another installed runtime or test tool.

## Command

```text
node <skill-directory>/scripts/shrink.mjs <input.json> --oracle <oracle.json> --out <new-directory> [--max-runs N]
node <skill-directory>/scripts/shrink.mjs --help
```

`--out` must name a new directory. Keep it outside the source fixture and choose another name for each run. The original JSON is never the output target. `--max-runs` defaults to 80 and accepts integers from 6 to 10000. It counts oracle invocation attempts, including baselines, rejected candidates, and final replays. Failed process starts consume attempts too.

Input must be a UTF-8 JSON file no larger than 1 MiB; the oracle configuration must be no larger than 64 KiB. A leading UTF-8 BOM is accepted. Invalid UTF-8 is rejected.

Run from the directory where the oracle's relative executable and arguments make sense. Paths in the command are ordinary argument strings; JSON backslashes need escaping. Use an absolute executable path when the desired program is not on `PATH`.

## Oracle configuration

```json
{
  "command": ["node", "examples/catalog/check.mjs", "{input}"],
  "expect": {
    "exit_code": 1,
    "stream": "stderr",
    "includes": "REPRO: normalized-sku-collision"
  },
  "timeout_ms": 3000,
  "max_output_bytes": 65536,
  "preserve": ["/schemaVersion"]
}
```

Unknown fields are rejected. The configuration describes:

| Field | Meaning |
| --- | --- |
| `command` | Nonempty argument array, executed directly without a shell. Exactly one argument must be the standalone string `{input}`. |
| `expect.exit_code` | Exact nonzero exit code the target failure produces, from 1 to 255. |
| `expect.stream` | `stdout` or `stderr`; only the selected stream is matched. |
| `expect.includes` | A nonempty, case-sensitive substring identifying the intended failure. |
| `timeout_ms` | Maximum time per invocation, from 50 to 60000 milliseconds; defaults to 3000. An invocation that times out cannot be accepted. |
| `max_output_bytes` | Combined stdout and stderr limit, from 1024 to 1048576 bytes; defaults to 65536. Overflow cannot be accepted. |
| `preserve` | JSON pointers that must exist initially and retain their original values in every candidate; defaults to `[]`. |

The placeholder becomes the current candidate's path inside the output directory, including for the original-byte baseline. Your command must accept an arbitrary input path; filename-sensitive behavior or loading sibling files may require a wrapper. Shell operators, redirections, wildcards, `$VARIABLE`, and command substitution have no shell meaning here. Put test logic in an existing executable or a small wrapper instead. The wrapper should return a distinctive signature only after it observes the intended condition.

Each invocation receives a fresh, exclusively created candidate file. The helper rejects modifications or file replacements and removes that exact temporary path after the run. Both output streams must be valid UTF-8; malformed output is unresolved. On timeout or overflow, cleanup requests termination of the owned process group on POSIX or its process tree on Windows, with bounded pipe cleanup. Escaped descendants may remain; this does not isolate the oracle.

JSON pointer examples: `/schemaVersion`, `/request/method`, `/items/0/id`. Escape a literal `~` as `~0` and `/` as `~1`. Protecting a subtree preserves its whole value and can prevent substantial reduction. Array pointers refer to positions; use an oracle invariant if the requirement concerns an entity's identity after elements move.

## What the helper verifies

1. Run a copy of the original bytes twice and require the specified signature both times.
2. Parse and serialize JSON; run that normalized input twice. Stop if formatting or duplicate-key normalization changes the observed failure.
3. Try removing object members and chunks of arrays. Keep a smaller candidate only after two matching executions. Keep protected values unchanged.
4. Replay the final selected candidate twice before writing `reduced.json`.

There is no scalar simplification: strings, numbers, booleans, and null values are not rewritten. Numbers outside JavaScript's safe integer range and nonfinite numeric results are rejected to avoid silently changing their values. Whitespace and duplicate object keys do not survive normalization; this is unsuitable for reducing a JSON parser's formatting or duplicate-key bug.

Matching the signature is an observation, not evidence that every failure has the same underlying cause. Choose a precise oracle and inspect the result. Two repetitions catch some instability; they do not establish determinism.

## Artifacts and outcomes

The output directory contains `report.json` and `report.md` with the actual attempts. A verified run also writes `reduced.json`. An unstable final candidate or changed source may leave `candidate.json`, which is explicitly unverified. Inspect the status and final replay evidence before reusing it. Errors discovered before the output directory is created do not produce a report.

The JSON report includes source and result sizes and hashes, normalized size, the working directory, oracle settings, ordered run observations, and a reduction trace. Each observation records its phase, verdict, exit code, timeout and output-limit flags, duration, and bounded output previews. Previews are limited to 2048 JavaScript characters per stream; the matcher uses the complete captured output within the configured byte limit.

| Exit | Meaning |
| --- | --- |
| `0` | Final replays matched. Reduction may be partial when status is `budget_exhausted`. |
| `1` | Invalid arguments, configuration, file access, or another operational error. |
| `2` | Original or normalized baseline did not reproduce consistently, or the source changed during the run; no verified reduced fixture. |
| `3` | Final replays did not both match; no verified reduced fixture. |

At the minimum budget of six runs, four baseline checks and two final checks leave no runs for candidate search. Raising the budget permits more attempts; it does not guarantee a smaller result. If a run is interrupted, treat unfinished artifacts as incomplete and start with a new output directory.

The reducer does not make network requests itself. Your oracle is an arbitrary program: it can access files, network, services, and credentials available to that process. Review it first, keep it read-only when possible, and use disposable resources when a test inherently mutates state. A timeout is a limit on the invocation, not a system-wide isolation guarantee.
