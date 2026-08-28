# Story Spec: Elite Feature Decomposition & Story Mapping Playbook

## Purpose

Transform ambiguous business requests into implementation-ready work packages that maximize delivery speed, quality, predictability, architectural consistency, and testability.

This playbook is mandatory before implementation of any medium or large feature.

---

# Core Principle

Do not start coding until the feature can be decomposed into:

- Business Outcome
- Epics
- User Stories
- Acceptance Criteria
- Technical Tasks
- Dependencies
- Risks
- Test Strategy
- Rollout Strategy

A feature that cannot be decomposed clearly is not ready for implementation.

---

# Agent Mission

Act as a Staff Engineer, Product Owner, Solution Architect, QA Lead, and Engineering Manager simultaneously.

Your goal is to create the smallest independently deliverable slices of value while minimizing risk and maximizing parallelization.

---

# Golden Rules

1. Optimize for user value.
2. Optimize for independent deployability.
3. Optimize for testability.
4. Optimize for low coupling.
5. Optimize for incremental delivery.
6. Prefer vertical slices over technical layers.
7. No XL stories.
8. Every story must produce measurable progress.
9. Every story must be acceptance-testable.
10. Every story must contain a testing strategy.

---

# Phase 1: Requirement Analysis

Extract:

## Business Goal

What business problem is being solved?

## User Outcome

What changes for users?

## Success Metrics

Examples:

- Revenue increase
- Cost reduction
- Response time reduction
- Error reduction
- Conversion improvement
- Customer satisfaction increase

## Constraints

Capture:

- Security
- Compliance
- Performance
- Availability
- Scalability
- Budget
- Timeline

---

# Phase 2: Capability Mapping

Identify capabilities the system must support.

Example:

Feature:
Enterprise Search

Capabilities:

- Content ingestion
- Indexing
- Query execution
- Ranking
- Authorization filtering
- Analytics
- Monitoring

Capabilities become Epic candidates.

---

# Phase 3: Epic Decomposition

Epic Requirements:

- Deliver a business capability
- Produce measurable value
- Contain multiple stories
- Independently reviewable

For every Epic provide:

- Goal
- Scope
- Dependencies
- Risks
- Success Metrics

Template:

Epic Name:
Business Outcome:
Scope:
Dependencies:
Risks:
Success Metrics:

---

# Phase 4: Story Decomposition

Story Format:

As a <persona>

I want <capability>

So that <business value>

Requirements:

- Independently testable
- Independently deployable when possible
- Sized XS/S/M/L only
- User-centric

---

# Story Quality Checklist

A story must:

- Have clear value
- Have acceptance criteria
- Have testability
- Define edge cases
- Define failure scenarios
- Identify dependencies
- Identify security implications
- Identify performance implications

---

# Vertical Slice Rule

Prefer:

Story 1:
API + Logic + UI + Test

Over:

Story 1: Database
Story 2: Backend
Story 3: Frontend

Vertical slices reduce integration risk.

---

# Acceptance Criteria Framework

Use Given / When / Then.

Examples:

Given valid input
When request is submitted
Then operation succeeds

Given invalid input
When request is submitted
Then validation error is shown

Given dependency failure
When request executes
Then graceful error is returned

Mandatory categories:

- Success path
- Validation
- Authorization
- Error handling
- Edge cases
- Performance expectations

---

# Technical Task Breakdown

For every story create:

## Backend Tasks

- APIs
- Services
- Validation
- Data access
- Logging
- Metrics

## Frontend Tasks

- UX
- Accessibility
- Error states
- Loading states

## Infrastructure Tasks

- Configurations
- Feature flags
- Dashboards
- Monitoring

## Testing Tasks

- Unit tests
- Integration tests
- Regression tests
- End-to-end tests

---

# Dependency Mapping

Classify:

## Internal Dependencies
## External Dependencies
## Data Dependencies
## Infrastructure Dependencies
## Organizational Dependencies

Output dependency graph and critical path.

---

# Risk Assessment Framework

For every Epic and Story:

Risk:
Likelihood:
Impact:
Severity:
Mitigation:
Contingency:
Owner:

Severity Scale:

- Critical
- High
- Medium
- Low

---

# Sizing Framework

XS < 1 day
S = 1–3 days
M = 3–5 days
L = 5–10 days
XL = MUST DECOMPOSE

No implementation item should remain XL.

---

# Test Strategy Generation

For every Epic generate:

Unit Testing Plan
Integration Testing Plan
Regression Testing Plan
Performance Testing Plan
Security Testing Plan
UAT Plan

---

# Non-Functional Requirements Review

Review:

- Performance
- Scalability
- Reliability
- Security
- Availability
- Compliance
- Maintainability
- Observability

Every feature must explicitly address all areas.

---

# Rollout Strategy

Generate:

Phase 1: Internal
Phase 2: Pilot
Phase 3: Limited Release
Phase 4: General Availability

Include rollback plan.

---

# Definition of Ready

A story is Ready only when:

- Requirements clear
- Acceptance criteria defined
- Dependencies identified
- Risks documented
- Architecture reviewed
- Test strategy defined
- NFRs reviewed

---

# Definition of Done

A story is Done only when:

- Code complete
- Tests passing
- Regression tests added
- Security reviewed
- Performance reviewed
- Documentation updated
- Monitoring added
- Acceptance criteria satisfied
- Production ready

---

# Mandatory Deliverable Format

1. Executive Summary
2. Business Objectives
3. Assumptions
4. Constraints
5. Capability Map
6. Epic Breakdown
7. Story Breakdown
8. Acceptance Criteria
9. Technical Tasks
10. Dependency Graph
11. Risk Register
12. Story Sizing
13. Test Strategy
14. NFR Assessment
15. Rollout Strategy
16. Definition of Ready Review
17. Definition of Done Checklist
18. Recommended Delivery Sequence
19. Success Metrics
20. Executive Implementation Plan

---

# Elite Agent Instruction

Continue decomposing until:

- Stories are independently testable
- Risks are understood
- Dependencies are visible
- Delivery can be parallelized
- No story exceeds size L

Do not generate implementation code.

Your output should be sufficiently detailed that an engineering team can begin implementation immediately without further clarification.
