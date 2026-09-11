# Changelog

All notable changes to this project will be documented in this file.

## [Unreleased]

### Changed

- `code-review` mode now invokes Cursor `/review-bugbot` (aliases: `review-bugbot`, `bugbot`). `/review-security` and `/simplify` are unchanged. The GHA overlay still forbids launching IDE review subagents.

### Fixed

- Paginate `pulls.listFiles` (100 files per page) when prefetching the PR diff and building the comment line map. GitHub returns 30 files per page by default; PRs with more than 30 changed files were silently truncated.

### Added

- Prefetched PR context now includes `title` and `body`.
- Progressive diff slim when serialized patch JSON exceeds 1MB: `diffMode` is `full`, then `hunk_ranges`, then `paths_only`. Large PRs always get a file inventory instead of `DIFF_TOO_LARGE`.

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
