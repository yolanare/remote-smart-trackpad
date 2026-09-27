---
name: minimal-diff
description: Keep only changes required by the task, removing unrelated refactoring, formatting, and cosmetic edits. Use only at the end of implementation to trim an existing diff without expanding its scope.
---

Before trimming the diff, read the request, inspect modified files, review the full diff, and examine the original code in context. Identify the intended behavior and local conventions to distinguish necessary changes from style preferences.

Review changes in git history (unstaged, stages, timeline) to minimize the combined final diff. Do not stage changes; leave staging to the user unless you're on autopilot.

Simplify and centralize added code. Prefer deletions where they help.

- Preserve all changes needed for the intended behavior, relevant tests, affected documentation, and required generated artifacts.
- Remove unrelated formatting, whitespace, line-ending changes, reordering, renaming, comment edits, and syntax substitutions.
- Inline unnecessary single-use variables, constants, functions, types, and wrappers. Keep them when they clarify domain concepts, group defaults or configuration with related values, meet a technical constraint, or substantially improve readability.
- Remove unnecessary single-use helpers, redundant type annotations, speculative guards, and abstractions for hypothetical future needs.
- Keep out of functional changes : unrelated refactoring, code moves, migrations, and broad cleanup. When a move is necessary, preserve the moved code as much as possible.
- Limit dependency, lockfile, configuration, snapshot, and generated-file changes to those produced or required by the task.
- Follow the surrounding code style. Never reduce line count at the expense of readability, correctness, security, or maintainability.
