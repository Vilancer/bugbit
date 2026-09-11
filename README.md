# bugbit

**Your own Cursor agent, reviewing every pull request.**

bugbit is a lightweight, self-hosted GitHub Action that reviews pull requests using your own Cursor account and agent runtime. No opaque hosted reviewer in the middle — bugbit calls the Cursor SDK directly from inside the workflow, so every review runs with the same models, context handling, and codebase understanding you already get inside the Cursor editor.

## How it works

1. Validates `GITHUB_TOKEN` permissions and prefetches PR context and diff
2. Invokes Cursor built-in review skills (`/review-bugbot`, `/review-security`, `/simplify`) with a GitHub Actions overlay for read-only, line-anchored findings
3. Posts findings as **inline PR review comments** on the exact diff lines via custom tools (`post_review`)

No walls of text at the bottom of the conversation — just line-anchored feedback from the agent you already trust.

> **Version pinning:** Examples use `Vilancer/bugbit@v1` (latest v1.x). Pin to `@v1.0.0` or a commit SHA for an exact version.
>
> **Marketplace:** The listing name is `vilancer-bugbit` (GitHub user `bugbit` owns that short name). Workflows still reference the repo: `uses: Vilancer/bugbit@v1`.

# Usage

## Supported workflow triggers

| Trigger | Support | Notes |
|---------|---------|-------|
| `pull_request` | **Recommended** | Native support — GitHub provides `pull_request` in the event payload. No extra inputs. |
| `workflow_dispatch` | Supported | Pass the `pr-number` input (see [Full workflow](#full-workflow-pr-open--manual-dispatch-checkout-head-sha)). Checkout the PR head SHA for accurate review scope. |
| `push`, `schedule`, `issue_comment`, etc. | Not supported | bugbit requires pull request context. |

If you trigger via `workflow_dispatch` without `pull_request` in the event and without `pr-number`, bugbit fails with:

> bugbit requires pull request context. Pass `pr-number` when triggering via `workflow_dispatch`, or use `on: pull_request`. See README: Supported workflow triggers.

## Workflow requirements

1. **`actions/checkout` before bugbit** (required) — bugbit reviews the checked-out tree on the runner.
2. **Checkout the PR head SHA** — use the PR head commit, not the merge ref, so the review matches the diff.
3. **Permissions** — `contents: read`, `pull-requests: write` (see [Recommended permissions](#recommended-permissions)).
4. **Runner** — `ubuntu-latest` (bundled `rg`; see [Limitations](#limitations)).
5. **Fork PRs** — not supported (see [Fork pull requests](#fork-pull-requests)).

Minimal workflow — review on every pull request:

```yaml
name: PR Review

on:
  pull_request:

permissions:
  contents: read
  pull-requests: write

jobs:
  review:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v6

      - uses: Vilancer/bugbit@v1
        with:
          cursor-api-key: ${{ secrets.CURSOR_API_KEY }}
```

`github-token` defaults to `${{ github.token }}`. The job still needs `pull-requests: write` (see [Recommended permissions](#recommended-permissions)).

# Inputs

```yaml
- uses: Vilancer/bugbit@v1
  with:
    # Cursor API key (required). Store as a repository secret.
    cursor-api-key: ${{ secrets.CURSOR_API_KEY }}

    # Token for reading PR context and posting review comments.
    # Default: ${{ github.token }}
    # Requires job permissions: contents: read, pull-requests: write
    github-token: ${{ github.token }}

    # Cursor model id.
    # Default: composer-2.5
    model: composer-2.5

    # Comma-separated review modes: code-review, security-review, simplify
    # (code-review invokes /review-bugbot; aliases: review-bugbot, bugbot, review-security)
    # Default: code-review
    review-modes: code-review

    # When true, upload a JSONL stream log artifact after the agent finishes.
    # Requires actions: write on the job. Default: false
    save-stream-log: false

    # Pull request number. Required for workflow_dispatch unless the event
    # already includes pull_request. Ignored on pull_request triggers.
    pr-number: ${{ github.event.pull_request.number }}

    # When true (default), empty findings post a visible LGTM COMMENT review.
    post-clean-summary: true

    # Optional override for the clean-summary review body.
    # clean-summary-body: |
    #   ## bugbit: LGTM — no findings
    #
    #   No issues reported on this diff.

    # When true, run an additional agent pass first that updates the PR
    # description with: type, summary bullets, mermaid diagram, file
    # walkthrough, and test plan. Needs pull-requests: write permission.
    # auto-describe: true
```

| Input | Required | Default | Notes |
|-------|----------|---------|-------|
| `cursor-api-key` | yes | — | Repository secret with your Cursor API key |
| `github-token` | yes | `${{ github.token }}` | Needs job `permissions` below |
| `model` | no | `composer-2.5` | Cursor model id |
| `review-modes` | no | `code-review` | Comma-separated: `code-review` (`/review-bugbot`), `security-review`, `simplify`. Aliases: `review-bugbot`, `bugbot`, `review-security` |
| `save-stream-log` | no | `false` | JSONL debug artifact; needs `actions: write` |
| `pr-number` | no | — | Required for `workflow_dispatch` when the event has no `pull_request`; ignored otherwise |
| `post-clean-summary` | no | `true` | Post a visible LGTM COMMENT review when `post_review` receives zero findings |
| `clean-summary-body` | no | LGTM markdown | Body used for the clean-summary review |
| `auto-describe` | no | `false` | Append a structured PR description once per PR (skipped if markers already present) |

# Scenarios

## PR review with explicit token and multiple modes

```yaml
permissions:
  contents: read
  pull-requests: write

steps:
  - uses: actions/checkout@v6

  - uses: Vilancer/bugbit@v1
    with:
      cursor-api-key: ${{ secrets.CURSOR_API_KEY }}
      github-token: ${{ github.token }}
      review-modes: code-review, security-review, simplify
```

## Full workflow: PR open + manual dispatch (checkout head SHA)

This pattern checks out the PR **head commit** (not the merge commit), supports manual re-runs via `workflow_dispatch`, and optionally uploads a stream log artifact for debugging.

```yaml
name: PR Review (bugbit)

on:
  pull_request:
    types: [opened]
    branches:
      - dev
  workflow_dispatch:
    inputs:
      pr_number:
        description: PR number to review
        required: true
        type: number

permissions:
  contents: read
  pull-requests: write
  actions: write   # only needed when save-stream-log: true

jobs:
  bugbit_review:
    runs-on: ubuntu-latest
    timeout-minutes: 45

    steps:
      - name: Resolve PR head SHA
        id: pr
        env:
          GH_TOKEN: ${{ github.token }}
        run: |
          set -euo pipefail
          if [ "${{ github.event_name }}" = "pull_request" ]; then
            echo "number=${{ github.event.pull_request.number }}" >> "$GITHUB_OUTPUT"
            echo "head_sha=${{ github.event.pull_request.head.sha }}" >> "$GITHUB_OUTPUT"
          else
            echo "number=${{ inputs.pr_number }}" >> "$GITHUB_OUTPUT"
            HEAD_SHA="$(gh api "repos/${GITHUB_REPOSITORY}/pulls/${{ inputs.pr_number }}" --jq .head.sha)"
            echo "head_sha=${HEAD_SHA}" >> "$GITHUB_OUTPUT"
          fi

      - uses: actions/checkout@v6
        with:
          ref: ${{ steps.pr.outputs.head_sha }}

      - uses: Vilancer/bugbit@v1
        with:
          cursor-api-key: ${{ secrets.CURSOR_API_KEY }}
          github-token: ${{ github.token }}
          model: composer-2.5
          review-modes: code-review, security-review, simplify
          save-stream-log: true
          pr-number: ${{ steps.pr.outputs.number }}
```

Store `CURSOR_API_KEY` as a repository secret (`Settings → Secrets and variables → Actions`).

### Legacy: synthesizing `GITHUB_EVENT_PATH` (deprecated)

Before v1.1.0, `workflow_dispatch` required overwriting `GITHUB_EVENT_PATH` with a synthetic `pull_request` payload:

```yaml
- name: Synthesize pull_request event (manual runs)
  if: github.event_name == 'workflow_dispatch'
  env:
    GH_TOKEN: ${{ github.token }}
  run: |
    set -euo pipefail
    gh api "repos/${GITHUB_REPOSITORY}/pulls/${{ steps.pr.outputs.number }}" \
      | jq '{ pull_request: . }' > "${GITHUB_EVENT_PATH}"
```

This pattern is **deprecated** — pass `pr-number` to bugbit instead. The synthesis step will be removed from docs in a future release.

## Review modes

Each `review-modes` value maps to a Cursor built-in skill:

| Mode | Cursor skill | Purpose |
|------|--------------|---------|
| `code-review` | `/review-bugbot` | General code review (aliases: `review-bugbot`, `bugbot`) |
| `security-review` | `/review-security` | Security-focused review (alias: `review-security`) |
| `simplify` | `/simplify` | Complexity and simplification suggestions |

Pass multiple modes as a comma-separated list: `code-review, security-review, simplify`.

# Recommended permissions

bugbit preflights the token before starting the agent (read PR metadata + create/delete a pending review probe). Grant only what you need.

**Minimum (post review comments only):**

```yaml
permissions:
  contents: read
  pull-requests: write
```

**With stream log artifacts (`save-stream-log: true`):**

```yaml
permissions:
  contents: read
  pull-requests: write
  actions: write
```

If `save-stream-log` is `false`, omit `actions: write` to keep the token scope minimal.

# Limitations

### Pull request file pagination

bugbit paginates GitHub's `pulls.listFiles` API (100 files per page) for both the review diff and comment line-map. PRs with more than 30 changed files are fully covered.

GitHub itself still caps that endpoint at **3,000 files** per pull request. Beyond that, the API truncates and bugbit can only review the returned set.

### Large diffs

Prefetched / `get_diff` payloads are capped at ~1MB of JSON. When the full parsed hunk body would exceed that, bugbit progressively slims the payload (`diffMode`: `full` → `hunk_ranges` → `paths_only`) so the agent still receives every changed path. For slim modes, the agent reads files for targeted context and still anchors comments via the full line map.

### PR title and body

`get_pr_context` (and prefetch) includes the PR `title` and `body`. A clear summary and test plan in the PR description helps the agent stay on the stated objective.

### Fork pull requests

bugbit cannot post review comments on pull requests from forks. `GITHUB_TOKEN` is read-only for fork PR heads, so the action fails fast with a clear error. Use same-repository branches or a dedicated token/workflow pattern if you need fork coverage.

### Ripgrep (`rg`)

The Cursor SDK uses ripgrep for ignore-aware file search (`.gitignore`, `.cursorignore`). GitHub-hosted `ubuntu-latest` runners do not ship `rg` by default.

bugbit works around this by vendoring the `@cursor/sdk-linux-x64` binary at `dist/vendor/linux-x64/rg` and setting `CURSOR_RIPGREP_PATH` at startup.

- **Bundled platform:** linux-x64 only
- **Tested on:** `ubuntu-latest` (linux) only
- **macOS / Windows runners:** install `rg` on the runner or set `CURSOR_RIPGREP_PATH` to an absolute path
- If `rg` is unavailable, reviews still run but ignore-mapping may be degraded (noisy logs, weaker exclude behavior)

### Runner runtime

The action uses the `node24` runtime (`action.yml`). Use `runs-on: ubuntu-latest` for the supported vendored `rg` path.

### Action pinning

`@v1` tracks the latest compatible v1 release. Pin to `@v1.0.0` or a full commit SHA for an exact version.

# Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for local development, testing, and bundle instructions.

# License

[MIT](LICENSE)
