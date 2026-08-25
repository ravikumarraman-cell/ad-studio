# Story Spec: Assurance Boundaries

Version: 1.0.0

Decompose the feature while preserving authorization, consent, privacy, audit, and recovery boundaries that are explicitly present in retained context.

Rules:
- Do not assert clinical, legal, identity, or privacy policy that the retained context does not establish.
- Make the actor, protected resource, permitted action, and observable audit/recovery outcome explicit when relevant.
- Separate a safety boundary into its own story only if a user or operator can independently accept it.
- Do not turn a technical control into a story unless it creates an observable operational outcome.

For every story provide: user value, protected boundary, BDD scenario, evidence of completion, non-goals, and questions that require a human decision.