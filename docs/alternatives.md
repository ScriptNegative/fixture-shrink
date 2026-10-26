# Existing reducers and where FixtureShrink fits

Test-case reduction is established work. FixtureShrink applies structural deletion to JSON and packages a constrained, local workflow for agents; it does not introduce a new reduction algorithm.

| Project | Documented focus | When to consider it |
| --- | --- | --- |
| [JS Delta](https://github.com/wala/jsdelta) | JavaScript reduction, with JSON inputs and configurable predicates also supported. | You need JavaScript-aware transformations or its existing predicate workflow. |
| [Shrink Ray](https://github.com/DRMacIver/shrinkray) | General test-case reduction with generic and format-specific passes, including JSON. | You need broader formats and transformations than deleting JSON members and array chunks. |
| [Picire](https://github.com/renatahodovan/picire) | A configurable Python delta-debugging framework with command-line and library interfaces and optional parallelism. | You need configurable reduction strategies or parallel reduction. |
| FixtureShrink | A portable Agent Skill plus a dependency-free Node.js helper for structurally reducing JSON against an explicit command, exit code, and output fragment. | You want a small, bounded JSON workflow with repeated checks, protected values, and a reviewable local report. |

These are capability descriptions from the linked project documentation, not comparative benchmarks. FixtureShrink has not established a speed, output-size, or reliability advantage over these tools. More powerful transformations can produce a smaller reproducer; a strict oracle matters with every reducer.

FixtureShrink currently removes object members and array chunks only. It does not reduce source code, edit strings or numbers, parallelize oracle runs, infer a root cause, or prove global minimality. Its Agent Skill is useful for setting up and interpreting a reduction, while the oracle remains responsible for identifying the failure.
