# Changelog

All notable changes to this project will be documented in this file.

## [1.3.2] - 2026-10-10

### Fixed

- `action.yml` description is under the Marketplace's 125-character limit, so the release can be published to the GitHub Marketplace.

## [1.3.1] - 2026-10-10

### Fixed

- A review pass that ended without posting now resumes the agent (up to two follow-ups) and fails the job if it still hasn't called `post_review`, instead of going green with nothing on the PR. Same for the describe pass and `update_pr_description`. Seen on `provider: claude` when the model ended its turn after `/security-review` printed its report.
- `.cursor/permissions.json` is only copied into the checkout for `provider: cursor`.

## [1.3.0] - 2026-10-10

### Added

- `provider` input (`cursor` default, `claude`). `provider: claude` runs Claude Code's built-in `/code-review`, `/security-review`, and `/simplify` skills through the Claude Agent SDK, posting findings through the same `post_review` tool.
- `claude-code-oauth-token` (from `claude setup-token`) and `anthropic-api-key` inputs for Claude auth.
- `review-level` input (`low` | `medium` | `high` | `xhigh` | `max`) passed to Claude's `/code-review`.

### Changed

- `cursor-api-key` is now only required when `provider` is `cursor`. `model` defaults to `composer-2.5` on cursor and to Claude Code's default model on claude.
- The Cursor agent no longer loads settings, rules or MCP servers from the PR checkout (`settingSources: []`).

### Security

- Everything an agent posts (review comments, PR description, labels) is scrubbed of the GitHub token, its basic-auth header, the provider key and token-shaped strings, on both providers.
- bugbit removes its credential inputs and the Actions runtime token from the environment before any agent starts; the runtime token comes back only for the stream-log upload.

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
