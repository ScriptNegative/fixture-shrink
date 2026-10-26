# Contributing

Start with a concrete failing JSON and a repeatable oracle. A useful issue includes the tool version, Node version, operating system, command arguments, expected signature, and observed result. Remove credentials, personal data, and private application code before sharing fixtures or reports.

Run `npm test` with Node.js 18 or later. No dependencies need installing. Keep product tests separate from deliberately failing demo checkers. For a behavioral change, add a case that fails for the old behavior and checks an observable invariant rather than matching documentation wording.

The helper must keep the original fixture intact, distinguish the target symptom from unrelated errors, account for every oracle invocation attempt, and report incomplete evidence honestly. Keep the installed skill self-contained and its core instructions short. Broader reduction strategies belong in a focused proposal with examples and bounded behavior.

Test-case reduction is established prior art. Describe what a contribution actually demonstrates; do not infer cost savings, root-cause identity, or global minimality from a smaller fixture. Report unresolved runs and failed replays alongside successful ones.
