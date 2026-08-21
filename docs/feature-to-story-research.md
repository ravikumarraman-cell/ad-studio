# Feature-to-story decomposition research

## Decision adopted in ADX

Feature intake remains the parent record and source of intent. After the feature has complete intake and risk classification, ADX opens **Gate A.5 — Shape user stories**. The author creates small, user-value stories with an observable Given / When / Then example. That retained story set is then submitted to **Gate B — Independent story approval**. Design and implementation remain blocked until that approval is recorded.

This keeps product discovery and requirements shaping separate from independent approval. It also avoids splitting work by technical layer: a story must describe a usable outcome, not “build the API” or “create the table.”

## Sources reviewed

| # | Source | Applied lesson |
| --- | --- | --- |
| 1 | [GOV.UK — Writing user stories](https://www.gov.uk/service-manual/agile-delivery/writing-user-stories) | Capture actor, need, goal, and observable acceptance criteria. |
| 2 | [Agile Alliance — User stories](https://agilealliance.org/glossary/user-stories/) | Use testable criteria and split/rephrase stories that are not ready. |
| 3 | [Atlassian — Epics](https://www.atlassian.com/agile/project-management/epics) | Break larger work by persona or user-journey step. |
| 4 | [Atlassian — Epics, stories, initiatives](https://www.atlassian.com/agile/project-management/epics-stories-themes) | Preserve a clear hierarchy from larger outcome to smaller work. |
| 5 | [Atlassian — User stories](https://www.atlassian.com/agile/project-management/user-stories) | Keep stories user-centred and acceptance criteria testable. |
| 6 | [Atlassian — Story mapping](https://www.atlassian.com/agile/product-management/story-mapping) | Organize story slices around the user journey and release value. |
| 7 | [Miro — User story map](https://miro.com/templates/user-story-map/) | Map persona, tasks, stories, and priority together. |
| 8 | [Miro — Create a story map](https://miro.com/product-development/how-to-create-a-user-story-map/) | Discover gaps and prevent oversized, unfocused stories. |
| 9 | [ProductPlan — Break features into stories](https://www.productplan.com/learn/break-product-features-into-user-stories) | Features are not implementation units; independently valuable stories are. |
| 10 | [ProductPlan — Story mapping](https://www.productplan.com/glossary/story-mapping) | Keep a whole-journey view rather than a flat backlog. |
| 11 | [ProductPlan — Backlog refinement](https://www.productplan.com/glossary/backlog-grooming/) | Refinement prepares prioritized stories for delivery. |
| 12 | [Figma — Feature list template](https://www.figma.com/templates/feature-list-template/) | Clarify scope, stakeholders, and priority early. |
| 13 | [Figma — Product requirements document](https://www.figma.com/resource-library/product-requirements-document/) | Keep goals, users, risks, constraints, and evaluation context attached. |
| 14 | [Aha! — Define product requirements](https://www.aha.io/roadmaps/requirements) | Link customer journey, research, requirements, and gated progress. |
| 15 | [Aha! — Requirements introduction](https://support.aha.io/aha-roadmaps/support-articles/features/requirements-introduction~7444651445959581541) | Child work should remain traceable to its parent feature. |
| 16 | [Aha! — Product development framework](https://www.aha.io/roadmapping/guide/the-aha-framework/the-aha-framework-for-product-development) | Validate and refine requirements before committing implementation. |
| 17 | [Aha! — Stories vs. requirements](https://www.aha.io/blog/user-stories-vs-product-requirements) | Use stories for experience and requirements for functional/system context. |
| 18 | [Productboard — From idea to user story](https://www.productboard.com/customers/skillingup/) | Pressure-test the idea before drafting a development-ready story. |
| 19 | [Productboard — Backlog grooming](https://www.productboard.com/glossary/backlog-grooming/) | Decompose, clarify, and reorder broad work during refinement. |
| 20 | [Asana — Product backlog](https://asana.com/resources/product-backlog) | Maintain a flexible, prioritized source of upcoming work. |
| 21 | [Asana — Agile and Scrum](https://help.asana.com/s/article/asana-for-agile-and-scrum?language=en_US) | Stories are actionable pieces under a feature; tasks sit below stories. |
| 22 | [Asana — Product backlog template](https://asana.com/templates/product-backlog) | Consistent fields improve readiness and planning. |
| 23 | [Linear — Write issues, not user stories](https://linear.app/method/write-issues-not-user-stories) | Do not turn story syntax into ceremony; clear context and discussion matter. |
| 24 | [airfocus — User story template](https://airfocus.com/templates/user-story/) | Capture role, goal, benefit, criteria, priority, and dependencies. |
| 25 | [airfocus — Initiative, feature, epic, story hierarchy](https://airfocus.com/product-learn/initiatives-opportunities-features-epics-stories/) | Do discovery before committing to story-level delivery work. |

## Resulting ADX workflow

`Imported feature / new Change Case → intake → risk classification → Gate A.5 story breakdown → Gate B independent story approval → design review → execution and later gates`

The Story Breakdown screen does not call a coding agent or fabricate requirements. It captures author-supplied stories, retains the exact revision and digest, and only then makes it reviewable.

## AI-assisted option

When the API has `ADX_STORY_AI_PROVIDER` and `ADX_STORY_AI_MODEL` configured, the Story Breakdown screen can request an AI-generated preview. Supported providers are `openai` (the default for existing configurations), `gemini`, and `ollama`. OpenAI and Gemini require `ADX_STORY_AI_API_KEY`; local Ollama does not. `ADX_STORY_AI_MODELS` optionally supplies a comma-separated, server-approved model allow-list; the author chooses from those models in the Story Generation screen. The API rejects all other model names. Only the feature title, retained outcome, acceptance criteria, repository, risk tier, and asset classifications are sent to the model. The user must select one or more suggestions, can edit every accepted story, and must explicitly submit the final set. Suggestions are not persisted, not automatically approved, and never start a coding agent.

For Gemini, create a server-side key in Google AI Studio and configure:

```env
ADX_STORY_AI_PROVIDER=gemini
ADX_STORY_AI_API_KEY=your_google_ai_studio_key
ADX_STORY_AI_MODEL=your_preferred_free-tier-enabled_gemini_model
ADX_STORY_AI_MODELS=your_preferred_free-tier-enabled_gemini_model,another-approved-free-tier-model
```

Use a model marked Free Tier in Google AI Studio for local experimentation, and keep the API key out of browser variables and source control. Gemini Free Tier inputs and outputs may be used by Google to improve its products; do not send company, customer, or regulated data without approval. See [Google's Gemini pricing and data-use table](https://ai.google.dev/gemini-api/docs/pricing).

For a fully local model, run Ollama on the same machine and configure its loopback endpoint:

```env
ADX_STORY_AI_PROVIDER=ollama
ADX_STORY_AI_API_KEY=
ADX_STORY_AI_MODEL=your-installed-ollama-model
ADX_STORY_AI_MODELS=your-installed-ollama-model,another-installed-ollama-model
ADX_STORY_AI_OLLAMA_BASE_URL=http://127.0.0.1:11434
```

ADX accepts only `http://127.0.0.1`, `http://localhost`, or `http://[::1]` for this provider, so the generated feature context remains local. Ollama's generation API is called with structured JSON output and no streaming. See [Ollama's local API documentation](https://docs.ollama.com/api/generate).
