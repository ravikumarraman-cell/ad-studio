# EEAOS Tiering Strategy Guide

# Engineering Agent Tiering & Orchestration Framework

## Executive Summary

The biggest mistake teams make with coding agents is providing either too little context or too much context.

Elite engineering organizations operate using layered governance. Agents should consume guidance in tiers, with each tier serving a specific purpose.

The objective is:

- Maximum signal
- Minimum noise
- Predictable outcomes
- Architectural consistency
- Enterprise-grade quality
- Scalable collaboration across humans and AI agents

---

# First Principle

Never give an agent every document.

Instead:

Tier 0 defines behavior.
Tier 1 defines execution.
Tier 2 defines specialization.
Tier 3 defines review.
Tier 4 defines approval.

The agent should only receive the minimum set of specifications required to complete the objective.

---

# Tier 0: Constitutional Layer

Purpose:
Establish immutable engineering principles.

Always Include:

- Master Charter
- Engineering Principles
- Definition of Done
- Decision Framework
- Risk Model

Use Cases:

- Every task
- Every repository
- Every agent
- Every review cycle

Expected Outcome:

Consistent decisions regardless of agent.

---

# Tier 1: Execution Layer

Purpose:
Define how engineering work gets performed.

Include:

- Feature Delivery Playbook
- Testing Playbook
- Regression Playbook
- Production Readiness Framework
- Observability Standards

Use When:

- Code changes are expected
- Features are built
- Bugs are fixed
- Refactoring is performed

Outcome:

Consistent implementation quality.

---

# Tier 2: Domain Specialization Layer

Purpose:
Adapt behavior to the problem being solved.

Feature Development:
- Feature Delivery
- Story Mapping
- API Governance
- Database Governance (if applicable)

Bug Fix:
- Bug RCA
- Testing Playbook
- Risk Model

Security Initiative:
- Security Playbook
- Threat Modeling
- Compliance Standards

Performance Project:
- Performance Playbook
- Scalability Framework
- Reliability Framework

Architecture Initiative:
- Architecture Playbook
- ADR Framework
- Migration Strategy

---

# Tier 3: Independent Review Layer

Purpose:
Create adversarial review.

Recommended Review Agents:

1. Security Reviewer
2. Performance Reviewer
3. Architecture Reviewer
4. Reliability Reviewer
5. Quality Reviewer

Rule:

Reviewers should receive implementation artifacts but should not participate in implementation.

---

# Tier 4: Approval Layer

Purpose:
Determine production readiness.

Include:

- Production Readiness Scorecard
- Release Governance
- Operational Readiness
- Reliability Standards

Approval Categories:

- Approved
- Approved with Conditions
- Rework Required
- Reject

---

# Canonical Workflows

## Small Change

Tier 0
+
One Tier 2 Spec

Example:
Bug Fix = Tier 0 + Bug RCA

---

## Standard Feature

Tier 0
+
Tier 1
+
Feature Delivery
+
Story Mapping

---

## Enterprise Feature

Tier 0
+
Tier 1
+
Story Mapping
+
Architecture
+
Security
+
Performance

Then:

Security Review
Performance Review
Architecture Review

---

## Platform Initiative

Tier 0
+
Tier 1
+
Architecture
+
Scalability
+
Reliability
+
Migration

---

# Multi-Agent Operating Model

Agent 1: Architect
Produces:
- Capabilities
- Boundaries
- ADRs

Agent 2: Planner
Produces:
- Epics
- Stories
- Tasks

Agent 3: Implementer
Produces:
- Code

Agent 4: Security Reviewer
Finds vulnerabilities.

Agent 5: Performance Reviewer
Finds bottlenecks.

Agent 6: Test Engineer
Expands test coverage.

Agent 7: Release Approver
Determines readiness.

---

# Recommended Spec Matrix

Feature Decomposition:
Tier 0 + Story Mapping

Feature Implementation:
Tier 0 + Tier 1 + Feature Delivery

API Feature:
Tier 0 + Tier 1 + API Governance

Database Change:
Tier 0 + Database Governance + Migration Strategy

Bug Fix:
Tier 0 + Bug RCA

Performance Optimization:
Tier 0 + Performance + Scalability

Security Review:
Tier 0 + Security + Compliance

Architecture Review:
Tier 0 + Architecture + ADR

Production Release:
Tier 0 + Production Readiness + Release Governance

---

# Golden Rule

Load globally:
- Tier 0

Load per task:
- One relevant Tier 2 set

Load after implementation:
- Tier 3 Reviewers

Load before release:
- Tier 4 Approval

This produces the highest quality-to-context ratio and the most predictable engineering outcomes.
