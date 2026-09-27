---
name: clean-code
description: Clean up code by removing unnecessary code, redundant checks, and improving readability. Focus on observable behavior and maintain necessary security guards.
---

- Remove unnecessary fallback and legacy code.
- Remove redundant checks/guards for known types and values: String(), Number(), `${...}`, typeof, instanceof, Array.isArray, etc.
- Use String() or .toString() for string casting, and prefer template literals for string interpolation.
- Keep necessary security guards.
- Remove single-use functions that only call another function. Connect directly to the called function.
- Prefer implicit flows when using known utilities or instance functions, instead of regularly doing explicit and redundant checks.
- Remove silent and redundant early returns. We prefer the code to fail with a clear error rather than hiding a potential error behind a silent return and fake success.
- Prefer one-liners for simple ifs, ternaries, arrow functions, template literals, and returns. This makes the code more readable and concise.
- Remove self explanatory labels unless they are about unpredictable and unknown effects
