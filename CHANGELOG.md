# Changelog

All notable changes to this project will be documented in this file.

## [1.2.0] - 2026-09-11

### Changed

- `code-review` mode now invokes Cursor `/review-bugbot` (aliases: `review-bugbot`, `bugbot`). `/review-security` and `/simplify` are unchanged. The GHA overlay still forbids launching IDE review subagents.

### Fixed

- Paginate `pulls.listFiles` (100 files per page) when prefetching the PR diff and building the comment line map. GitHub returns 30 files per page by default; PRs with more than 30 changed files were silently truncated.

### Added

- Prefetched PR context now includes `title` and `body`.
- Progressive diff slim when serialized patch JSON exceeds 1MB: `diffMode` is `full`, then `hunk_ranges`, then `paths_only`. Large PRs always get a file inventory instead of `DIFF_TOO_LARGE`.
- `post-clean-summary` input (default `true`): empty `post_review` findings post a visible LGTM COMMENT review instead of staying silent. `clean-summary-body` customizes that review.
- `auto-describe` input (default `false`): optional second agent pass that appends a structured PR description after the author body (once per PR; skipped when markers already exist).
- Describe pass infers PR type and review-effort labels, creates missing GitHub labels, and applies optional `describe-labels`. Requires `issues: write`.

### Credits

- Inspired by [@JuicyBurger](https://github.com/JuicyBurger)'s [JuicyBurger/bugbit](https://github.com/JuicyBurger/bugbit) fork (auto-describe, clean-summary LGTM, large-diff handling, and related review workflow).

## [1.1.1] - 2026-07-06

### Fixed

- `action.yml` no longer embeds `${{ inputs.pr_number }}` in the `pr-number` input description. That expression is only valid in workflow files, not action metadata, and caused `Failed to load action.yml` on all runs using `@v1`.
- `resolveEvent` fetches pull requests via the GitHub REST API with `fetch` instead of `@actions/github`, so the main action bundle no longer contains an unresolved `@actions/github` import that broke `workflow_dispatch` at runtime.

## [1.1.0] - 2026-07-06

### Added

- `pr-number` input for `workflow_dispatch` workflows that lack a native `pull_request` event payload

### Changed

- Improved error messages when pull request context is missing (actionable hints for `workflow_dispatch` vs other triggers)
- Event/PR validation now runs before the GitHub token permission preflight check, avoiding misleading permissions errors when the real issue is missing PR context

### Breaking

- None — this release is additive; existing `pull_request` workflows are unchanged
