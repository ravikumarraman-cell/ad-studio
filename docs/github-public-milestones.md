# Public GitHub milestone import

ADX can turn one **public GitHub milestone** into one feature-backed Change Case. The imported Change Case follows the normal retained-intent, risk-classification, story-generation, and independent-review workflow.

## Use it

1. Open **Real workspace** and select **Import GitHub milestone**.
2. Enter a public GitHub owner and repository, such as `octocat` and `Hello-World`.
3. Select an open milestone returned by GitHub.
4. Enter the ADX feature owner, target delivery repository, and an initial risk tier.
5. Select **Import milestone**.

ADX retrieves the selected milestone and its attached issues, excludes pull requests, retains the bounded source material, creates a Change Case, moves it through intake, and performs the normal deterministic initial risk classification. The resulting feature is ready for the usual Story Breakdown workflow, including an optional user-story template.

## Trust boundary

- This integration reads **public repositories only** from `api.github.com`.
- ADX accepts only a GitHub owner, repository name, and milestone number. It does not accept an arbitrary URL.
- No GitHub token, OAuth token, or personal access token is accepted in the browser or stored by ADX.
- GitHub issue content is untrusted source material. It is retained for review; it does not grant authority, approve stories, or start a coding agent.
- Pull requests are excluded from the feature source. Up to 100 attached issues are captured, and each issue body is bounded to 4,000 characters.
- Public GitHub rate limits are surfaced as a retryable response. A later private-repository integration must use a separately scoped, server-held GitHub App credential.