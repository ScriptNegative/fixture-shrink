---
name: fixture-shrink
description: Reduce a failing JSON fixture to a smaller reproducer using an existing local command and a specific failure signature. Use when an input is too large to debug or share; requires a repeatable oracle, not just any nonzero exit.
license: MIT
metadata:
  version: "0.2.0"
---

# FixtureShrink

Find a smaller JSON input that still reproduces the user's observed failure. Preserve the original fixture and application behavior while reducing the input.

First identify the actual failing command, expected exit code, and a distinctive output fragment. A parse error or unrelated validation failure must not count as the target. If the failure is not reproducible, establish a useful oracle before reducing. Use a local, read-only test command where possible: the oracle executes repeatedly with the user's normal permissions; the helper does not isolate it or undo its side effects.

For the optional Node.js helper, read [references/cli.md](references/cli.md) and use the script relative to this skill's directory. It removes object members and array chunks by default. When the failure depends on long string contents, opt into `--shrink-strings` to remove Unicode code-point chunks from string values too. Pin JSON pointers whose values must survive, such as a schema version or an exact identifier. Do not automatically install a runtime or replace the user's chosen test framework.

Review the oracle and run budget before starting. The helper checks the original input and its normalized JSON representation twice each, accepts a candidate only after two matching executions, and reserves two final replays. Timeouts, command failures to start, and output overflows do not count as interesting failures.

Use `reduced.json` only when the final replays succeeded. Review the report for budget exhaustion and rejected runs; a smaller input is not proof of a root cause or a global minimum. If reduction changes or loses the failure, report that outcome and keep the original available. Finish with the paths, measured size change, target signature, actual run count, and any remaining uncertainty. Inspect the reduced data before sharing: reduction does not redact secrets.
