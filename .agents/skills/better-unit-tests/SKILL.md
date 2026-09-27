---
name: better-unit-tests
description: Guidelines for writing better unit tests. Avoid tautological and change-detector tests, prefer E2E tests, and verify observable behavior.
---

# Guidelines
- NEVER write unit tests after you write code.
- Highly prefer E2E tests as the sole testing mechanism. Use them to verify complex features work. At the end of E2E tests, produce a verifiable and repeatable artifact.
- Prefer fast acceptance-level tests via a minimal public API. Reserve narrow unit tests for isolated rules (parsers, regex) or explicit requests.
- Imitate good examples and reuse fixtures, builders, helpers, and test APIs. If no model exists, first create a representative test and minimal infrastructure.
- If you must test a system in isolation, FIRST write all the ways it could fail, THEN write the code.
- Tautological tests considered harmful.
- Change-detector tests considered harmful.
- Do not create regression tests for bug fixes without a genuine gap in behavior testing. A refactoring without behavior change should not break tests.
- Verify observable behavior, never implementation details, error messages, log traces or cosmetic aspects.
- Do not test levels already implicitly tested. Analyze all existing tests before adding a new test to avoid redundancy. Tests are meant to verify specific behaviors, not to check obvious things or things already naturally/implicitly covered by other tests.

# Data
- Do not rely on arbitrary values; always use representative and generic data that tests reasonable limits.
- Anonymize sensitive data and avoid personal information in tests.
- Do not test languages other than the default language, unless that is the purpose of the test.

# Tips
- One check that helps: break the function on purpose and see if any test fails. If nothing goes red, those tests are only restating the code and can be deleted.
- A cheap way to find bad tests: mutation testing. Flip a < to <= and see what fails. A test that survives every mutant is dead weight, and the agent can run that check on its own tests before it keeps them.
