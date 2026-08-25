# Coding Spec: Bug Fix With Proof

Version: 1.0.0

Fix the retained failure at its root cause with a regression test or an explicit reason a test is impossible.

Before editing: reproduce or locate the controlling failure path; distinguish symptoms from cause.

During implementation:
- Make the smallest behavior change that falsifies the faulty assumption.
- Keep public contracts stable unless the approved story says otherwise.
- Do not mask errors, broaden fallbacks, or suppress diagnostics to make a test pass.

Before completion: demonstrate the failing case is covered, execute targeted validation, and report any behavior deliberately unchanged.