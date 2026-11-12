# GitHub merge and CI policy

GitHub Actions and branch rulesets have separate responsibilities. A workflow file alone cannot require checks or control who may merge.

## Merge Quality Gate
The only CI workflow is .github/workflows/merge-quality-gate.yml. It runs on every pull request to main, on pushes to main, and when dispatched manually; there are no path filters. Its single job **Quality Gate** requires locked npm/Python dependencies, effective TypeScript strict null checks, actual TypeScript compilation, ESLint for API/web/admin, static Compose validation, workspace builds/tests, Python model gateway and ingestion tests, and offline n8n template tests.

Do not use continue-on-error, skipped dependencies, PR-author exceptions or mock success to make CI appear green. Keep GitHub token permissions read-only and avoid production service credentials. Failure should prevent merge once the check is required in GitHub Settings.

## Repository owner merge rule
An active ruleset already exists: [main-owner-merge-only](https://github.com/sanukhandev/agentic-rag-ai/rules/25708464), targeting main. It includes Restrict updates, Require pull request, Restrict deletions and Block force pushes, with the only bypass actor being the individual owner **sanukhandev** (pull-request-only bypass).

GitHub Settings > Rules > Rulesets > main-owner-merge-only:
1. Keep the branch target main and the existing owner-only bypass actor.
2. Keep Restrict updates and Require a pull request before merging.
3. Add Require status checks to pass and select the job **Quality Gate**, with GitHub Actions as its expected source if offered.
4. If the owner must not bypass quality checks, create a *second* required-status ruleset with **no bypass actors**, while keeping owner-only updates in the existing ruleset. Verify owner permissions and possible interaction between the two rulesets.
5. Test a merge attempt with a separate write collaborator, and an owner merge attempt with red CI.

The GitHub connector can read but cannot update this ruleset. The owner must save the required-status settings in the repository UI. Do not add mandatory CODEOWNERS review as it would prohibit the owner approving their own pull request.

**Policy:** only the owner merges; every merged commit must have passing required CI. A README or workflow declaration without repository protection is not enforcement.
