# Engineering Implementation Specification

## Goal

Implement the requested change as a production-ready solution that is:

- Architecture-consistent
- High-performance
- Robust and reliable
- Secure
- Maintainable
- Fully tested
- Backward compatible

---

## Architecture

Before coding:

1. Analyze the existing codebase.
2. Identify and follow:
   - Architecture patterns
   - Project structure
   - Naming conventions
   - Error handling patterns
   - Logging conventions
   - Testing conventions
   - Dependency injection patterns
   - Data access patterns

Rules:

- Match existing architecture and coding style.
- Reuse existing utilities and frameworks.
- Do not introduce new patterns or dependencies without strong justification.
- Prefer consistency over personal preference.

---

## Implementation Standards

Follow:

- SOLID
- DRY
- KISS
- Separation of Concerns

Requirements:

- Production-ready code only
- No hacks or temporary fixes
- No dead code
- No duplicated logic
- Strong typing where available
- Clear naming and abstractions

---

## Performance

Treat performance as a core requirement.

Validate:

- Time complexity
- Memory usage
- Database efficiency
- Network efficiency
- Concurrency behavior

Avoid:

- N+1 queries
- Redundant work
- Excessive allocations
- Unnecessary I/O
- Unnecessary API calls

Optimize only where it provides measurable value.

---

## Reliability & Error Handling

Handle explicitly:

- Invalid inputs
- Null values
- Empty collections
- Timeout scenarios
- External service failures
- Transient errors
- Concurrency conflicts
- Resource exhaustion

Requirements:

- No silent failures
- No swallowed exceptions
- Actionable error messages
- Meaningful logs
- Graceful failure behavior

---

## Security

Review for:

- Authentication issues
- Authorization issues
- Injection vulnerabilities
- Sensitive data exposure
- Secret leakage
- Unsafe logging

Validate all inputs and follow least-privilege principles.

---

## Testing (Mandatory)

Create comprehensive automated tests.

### Unit Tests
Cover:
- Happy paths
- Edge cases
- Boundaries
- Error paths

### Integration Tests
Cover:
- Service interactions
- Database operations
- API behavior
- External dependencies

### End-to-End Tests
Cover critical user workflows when applicable.

---

## Regression Protection

For every change:

1. Identify impacted functionality.
2. Add regression tests.
3. Verify existing behavior remains unchanged.
4. Protect bug fixes with dedicated tests.

No change is complete without regression coverage.

---

## Coverage Expectations

Target:

- ≥95% coverage for changed code
- 100% coverage for critical logic
- 100% coverage for bug fixes

Prioritize meaningful coverage over metric inflation.

---

## Observability

Maintain or improve:

- Logging
- Metrics
- Tracing

Add logs only where they provide operational value.

Never log sensitive information.

---

## Backward Compatibility

Do not break:

- Public APIs
- Existing contracts
- Existing integrations
- Existing data formats

If a breaking change is unavoidable:

- Document it
- Justify it
- Provide a migration path

---

## Validation Checklist

Before completion verify:

- Architecture aligned with existing codebase
- No unnecessary dependencies introduced
- Error handling reviewed
- Performance reviewed
- Security reviewed
- Tests added
- Regression coverage added
- Existing tests pass
- Backward compatibility maintained
- Documentation updated

---

## Required Final Output

Provide:

1. Implementation summary
2. Architectural alignment notes
3. Files changed
4. Key design decisions
5. Edge cases handled
6. Performance considerations
7. Security review
8. Test coverage summary
9. Regression tests added
10. Risks and mitigations
11. Technical debt (if any)

Do not mark the task complete until the implementation is production-ready, thoroughly tested, regression-protected, and aligned with the existing architecture.

---

### Agent Operating Instruction

Think deeply before making changes. Analyze the existing codebase first, then implement the smallest, simplest solution that fully satisfies the requirements while preserving architectural consistency. Prefer extending existing patterns over introducing new abstractions.
