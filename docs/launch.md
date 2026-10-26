# Launch draft

These are drafts for the maintainer to review and publish. No outreach or social posts have been sent.

## Core message

FixtureShrink turns a bulky failing JSON fixture into a smaller reproducer you can inspect. It deletes JSON structure and reruns your existing command, requiring the intended exit code and output signature before accepting a change.

The portable Agent Skill helps an agent establish a useful oracle and interpret the evidence. The optional Node.js helper needs no package installation and can run independently. Version 0.2 adds opt-in Unicode code-point deletion inside string values, using the same failure checks, protected values, and process budget as structural reduction.

## GitHub description

Shrink failing JSON into smaller reproducible fixtures. Portable Agent Skill, zero-dependency Node.js CLI, explicit failure signatures, protected values, and replay reports.

## Demo outline: under three minutes

1. Open `examples/catalog/input.json` and show its products and unrelated metadata.
2. Run `node examples/catalog/check.mjs examples/catalog/input.json`. Explain that two distinct SKUs collide in the actual index.
3. Open `examples/catalog/oracle.json`: pin `/schemaVersion`, require the exact failure fragment, and set invocation limits.
4. Run the README command and open the actual report and `reduced.json`.
5. Replay the reduced fixture with the checker. Point to the remaining products and the unchanged target signature.
6. Show the recorded run budget and final replays. Explain that this is a smaller observed reproducer, not a proof of the cause or smallest possible input.

Use measured values from that run. Do not substitute illustrative counts for real timings, byte sizes, or oracle invocations.

## Version 0.2 demo: noise inside one string

Use `examples/message/input.json` and its local decoder checker. Run structural mode and `--shrink-strings` into separate directories, then compare the message values and actual reports. The planted service loses everything after a second colon. Replay the final candidate to show the same `REPRO: truncated-message` signature. Explain that string mode is optional and operates on code points, not grapheme clusters; it does not rewrite object keys or numeric values. Quote only sizes and invocation counts produced by the recorded run.

## Developer community draft

I built FixtureShrink because a giant failing JSON fixture is a poor starting point for debugging — whether you or a coding agent is doing the investigation.

You supply a local test command and the specific failure to preserve. FixtureShrink removes object members and array chunks, keeps only candidates that reproduce twice, then replays the final candidate twice before writing a verified fixture. It has a process-run budget, JSON pointer protection, and local reports.

It is a small JSON-focused tool, built on established test-case reduction ideas. JS Delta, Shrink Ray, and Picire are worth knowing if you need broader reduction capabilities.

I'd value real examples where the oracle was hard to define, a reduction stalled, or an unrelated failure slipped through. A redacted fixture and a read-only reproduction command make especially useful contributions.

## Suggested first distribution

Publish the tested repository and a release archive first. Record the catalog walkthrough from a real run; share the result with the command and report visible. If sharing in a developer community, follow its self-promotion rules, explain the narrow use case, and ask for difficult fixtures rather than stars alone. Never upload user fixtures or reports without reviewing their contents and having permission to share them.
