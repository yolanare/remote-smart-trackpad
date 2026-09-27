---
name: comment-code
description: Guidelines for self-explanatory code and meaningful documentation. Activate when working with comments, docstrings, documentation, code clarity, API documentation, JSDoc, or discussing code commenting strategies. Guides on why over what, anti-patterns, decision frameworks, and language-specific examples.
---

## Self-explanatory code
- Write self-explanatory code. Comment only when necessary to explain the WHY, not the WHAT.
- Refactor code to be clearer rather than commenting on confusing code. A good variable name or an extracted function can eliminate the need for comments.

## Commenting
- Systematically document public methods and functions with parameters, return values, exceptions, and usage examples in JSDoc or docstrings.
- Avoid obvious, redundant, outdated, or noisy comments that do not add value to code understanding.
- Ignore all obvious implicit bootstrap.
- Use comments to explain logic, complex algorithms, design trade-offs, bug workarounds, API contracts, regex patterns, performance considerations, and surprising behaviors.
- No need to comment on known utility callbacks, let the functionality be implicitly understood.
- No need for examples when arguments are self-explanatory. But examples are essential for complex functions or public APIs.

## Priority order
1. **Clear code**: Self-explanatory through naming and structure
2. **Good comments**: Explain WHY when necessary
3. **Documentation**: API docs, docstrings for public interfaces
4. **Maintain accuracy**: Update comments when code changes, or remove them if they become misleading
