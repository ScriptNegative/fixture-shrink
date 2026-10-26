# Independent FixtureShrink workflow evaluation

FixtureShrink produced a focused reproducer and the scratch decoder was fixed. This is a developer workflow test of the supplied intentional demonstration bug, not a blind production bug discovery. I read the skill, its CLI reference, and the four raw example files. I did not read the reducer implementation, its product tests, or the project README. No network, installation, or publication was used.

The copied project lives in `examples/message/`, which keeps the supplied oracle's relative checker command valid. The original project was untouched. The copied input, checker, and oracle also retain their original bytes; only the scratch service was fixed. A byte-identical buggy service is retained as `examples/message/service.before.mjs`.

## Observed comparison

Both modes used Node v22.14.0 and the same maximum budget of 400 oracle invocation attempts. The input was 4,007 bytes. Its normalized representation was also 4,007 bytes. The oracle requires exit 1 **and** `REPRO: truncated-message` on stderr, with `/schemaVersion` pinned. Merely failing validation is insufficient.

| Mode | Result bytes | Bytes removed | Actual oracle runs | Candidates tested | Accepted reductions | Status / verification |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| Default | 2,760 | 1,247 (31.121%) | 10 / 400 | 3 | 1 | `reduced`, `verified: true` |
| Text option, final implementation | 48 | 3,959 (98.802%) | 117 / 400 | 92 | 19 | `reduced`, `verified: true` |

Both reports say `fixed_point`, with two successful final confirmations. Neither exhausted its budget. Default had 8 interesting and 2 uninteresting invocations; final text mode had 44 interesting and 73 uninteresting invocations. Neither recorded a timeout, output overflow, or unresolved run. The candidate failures that reported `VALIDATION: ...` were correctly rejected despite also exiting 1.

Default removed irrelevant object data but retained the entire original 2,526-code-point message. The text option reduced the message to six code points and retained `schemaVersion: 1`. Its exact 48-byte, pretty-printed output is copied to `focused-fixture.json`:

```json
{
  "schemaVersion": 1,
  "message": "note::"
}
```

For this input, expected decoded content is `:`, while the buggy `split(':')[1]` returns the empty string. The focused fixture makes that error easy to inspect. These observations do not establish a global minimum, or a performance, token, or cost benefit.

A text run began before the implementation was announced frozen. It is retained in `results/strings/`. A fresh run after that announcement is in `results/strings-final/` and is the final comparison above. Both text runs produced the same fixture hash, 48 bytes, 117 invocations, 92 candidates, and 19 accepted reductions. No assumption about the implementation's effect was used.

## Actual commands and failures

All commands below were run from this evaluation directory. The unchanged oracle runs `node examples/message/check.mjs {input}`. Its timeout is 3,000 ms and its combined output limit is 65,536 bytes.

```text
node ../fixture-shrink/skills/fixture-shrink/scripts/shrink.mjs --help
node examples/message/check.mjs examples/message/input.json
node ../fixture-shrink/skills/fixture-shrink/scripts/shrink.mjs examples/message/input.json --oracle examples/message/oracle.json --out results/default --max-runs 400
node examples/message/check.mjs results/default/reduced.json
node ../fixture-shrink/skills/fixture-shrink/scripts/shrink.mjs examples/message/input.json --oracle examples/message/oracle.json --out results/strings --max-runs 400 --shrink-strings
node examples/message/check.mjs results/strings/reduced.json
node ../fixture-shrink/skills/fixture-shrink/scripts/shrink.mjs examples/message/input.json --oracle examples/message/oracle.json --out results/strings-final --max-runs 400 --shrink-strings
node examples/message/check.mjs results/strings-final/reduced.json
node --test tests/service.test.mjs
```

The first default CLI attempt exited 1 because `results/` did not yet exist: `FixtureShrink: ENOENT: no such file or directory, mkdir './results/default'` (path sanitized). It produced no reduction report. I created the parent and retried the same command successfully. The reference says the output directory must be new but does not state that its parent must already exist; the minimal `--help` output does not resolve that prerequisite. This was an actual usability failure, and its full captured observation remains in `reduction-commands.json`.

The successful default CLI process exited 0 in 921.633 ms; its reports sum 811 ms of oracle durations. The first text CLI process exited 0 in 10,768.270 ms, with 10,367 ms summed oracle durations. The final text CLI process exited 0 in 12,502.478 ms, with 11,995 ms summed oracle durations. These are single-run observations on this machine, not a speed comparison or benchmark.

Another sharing limitation was observed directly: generated reports and CLI stdout included absolute local paths. I sanitized those paths in the saved JSON records and report Markdown after execution. Report metrics, statuses, signatures, fixture contents, and hashes were retained. The sanitization is performed by `finalize-evidence.mjs`; it is evaluation packaging, not a claim that the CLI redacts paths. The synthetic fixture was reviewed before sharing; reduction itself is not redaction.

## Before failure and after fix

Before changing the service, the original input and each reduced output were run directly through the unchanged checker. Every one exited 1 with exactly `REPRO: truncated-message` on stderr. The reducer's two final replays independently match that signature for both modes.

I added eight direct regression cases covering ordinary content, several internal delimiters, a colon as the entire content, leading/trailing/consecutive content delimiters, Unicode and combining marks, and whitespace/newlines. Three end-to-end tests use the unchanged checker with the original, default, and final text fixtures. A final test checks the initial hashes of the input, checker, and oracle. Expected strings are explicit rather than copied from the decoder implementation.

The same `node --test tests/service.test.mjs` command was executed before and after the fix:

| Service state | Exit | Tests | Passed | Failed | Test runner duration | Captured process duration |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Buggy scratch service | 1 | 12 | 2 | 10 | 313.2741 ms | 374.553 ms |
| Fixed scratch service | 0 | 12 | 12 | 0 | 340.0281 ms | 404.806 ms |

The fix returns the substring after the first colon using `message.slice(message.indexOf(':')+1)`, preserving all subsequent colons and content. The checker still owns input validation; no broader decoder contract was invented. Direct post-fix checker executions on the original, default, first text, and final text fixtures all exited 0 with `PASS: all content after the first delimiter is preserved` on stdout and empty stderr. Full before/after outputs are retained in `test-commands.json`.

## Preservation and evidence

SHA-256 checks before and after confirm both the original and copied input/checker/oracle are unchanged:

| File | Initial, final original, and final scratch SHA-256 |
| --- | --- |
| `input.json` | `792e5589a0215e3ca8648b1491a8e09de6520d8ea8d63bd90ef4ede390d0c3a1` |
| `check.mjs` | `bb94d321618b225d412f0823bc995a3b45eafbb276abad35d840d6d4823cfd73` |
| `oracle.json` | `488a1dbd6865c96a41ad5e85b66523285bb51524caacca01b597c9194995dadf` |

The original service remains `cb811e2c3f6b78e98a60b6db315d345816681003571d2383bd6f0729d19f2ced`; that is also the saved buggy backup's hash. The fixed scratch service is `e55a91215e8d04e74a968c651397b3fd85abf94d03d8c6e12c6bb75af95064eb`. The focused fixture is `6d9ee36f09d92ca4494e80cba48ec7198c3f9c022f99b17be0d1e34a60bc853d`.

`records.json` is the sanitized relative-path summary. `preservation.json` records all hash comparisons. Each `results/*/report.json` retains every oracle observation, and each `report.md` provides the CLI report. `reduction-commands.json` and `test-commands.json` contain the exact argument arrays, actual exits, durations, and captured output. `examples/message/service.mjs` and `tests/service.test.mjs` are the fixed service and regression suite.

The evidence supports this supplied deterministic local workflow. Repeated matching executions do not prove determinism for arbitrary real applications; string reduction can remove Unicode grapheme components, and the focused result alone does not retain the original Unicode coverage. The separate Unicode regression case addresses that service behavior.

## Publication note

Capture and finalization scripts were retained in the local evaluation workspace; the published reports and command records are sanitized sharing copies. The missing-output-parent message and prerequisite documentation were improved before release. The CLI reference also now explicitly identifies absolute paths in local reports and stdout; it does not promise automatic sharing sanitization. The captured failed attempt is retained as observed.

Replay the saved fixed service from the repository root with `node --test evals/runs/strings-forward/tests/service.test.mjs`. These tests replay the saved implementation and fixtures, not a new agent session.
