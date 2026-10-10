# bugbit

**Your own Cursor or Claude Code agent, reviewing every pull request.**

bugbit is a lightweight, self-hosted GitHub Action that reviews pull requests using your own Cursor or Claude account and agent runtime. No opaque hosted reviewer in the middle — bugbit calls the Cursor SDK or the Claude Agent SDK directly from inside the workflow, so every review runs with the same models, context handling, and codebase understanding you already get in your editor or terminal.

## How it works

1. Validates `GITHUB_TOKEN` permissions and prefetches PR context and diff
2. Invokes the provider's built-in review skills — Cursor `/review-bugbot`, `/review-security`, `/simplify`, or Claude Code `/code-review`, `/security-review`, `/simplify` — with a GitHub Actions overlay for read-only, line-anchored findings
3. Posts findings as **inline PR review comments** on the exact diff lines via custom tools (`post_review`)

No walls of text at the bottom of the conversation — just line-anchored feedback from the agent you already trust.

## Providers

Pick the agent with the `provider` input. The review/describe workflow, tools, and comment format are the same for every provider.

| Provider | Status |
|----------|--------|
| [Cursor](https://cursor.com) | **Supported** — default (`provider: cursor`, `cursor-api-key`) |
| [Claude Code](https://claude.com/claude-code) | **Supported** — `provider: claude`, `claude-code-oauth-token` or `anthropic-api-key` (see [Claude Code provider](#claude-code-provider)) |
| [OpenAI Codex](https://openai.com/codex) | **Planned** — future provider integration |

Workflows without a `provider` input keep using Cursor.

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
    # (code-review invokes /review-bugbot; aliases: review-bugbot, bugbot.
    #  security-review alias: review-security)
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
    # walkthrough, and test plan. Needs pull-requests: write and
    # issues: write (inferred and describe-labels use the issues API).
    # Set review-modes to an empty string for describe-only.
    # auto-describe: true

    # Comma-separated labels to apply after the describe pass.
    # Needs issues: write permission.
    # describe-labels: "Review effort 4/5"
```

| Input | Required | Default | Notes |
|-------|----------|---------|-------|
| `provider` | no | `cursor` | `cursor` or `claude` |
| `cursor-api-key` | cursor | — | Repository secret with your Cursor API key |
| `claude-code-oauth-token` | claude* | — | Token from `claude setup-token` (Claude Pro/Max subscription). Wins over `anthropic-api-key` |
| `anthropic-api-key` | claude* | — | Anthropic API key, alternative to the OAuth token |
| `github-token` | yes | `${{ github.token }}` | Needs job `permissions` below |
| `model` | no | `composer-2.5` (cursor) / Claude Code default (claude) | Model id, e.g. `composer-2.5`, `claude-opus-5-5`, `claude-sonnet-5-5` |
| `review-level` | no | `''` | claude only: `/code-review` level `low`, `medium`, `high`, `xhigh`, `max` |
| `review-modes` | no | `code-review` | Comma-separated: `code-review` (`/review-bugbot`), `security-review`, `simplify`. Aliases: `review-bugbot`, `bugbot`, `review-security` |
| `save-stream-log` | no | `false` | JSONL debug artifact; needs `actions: write` |
| `pr-number` | no | — | Required for `workflow_dispatch` when the event has no `pull_request`; ignored otherwise |
| `post-clean-summary` | no | `true` | Post a visible LGTM COMMENT review when `post_review` receives zero findings |
| `clean-summary-body` | no | LGTM markdown | Body used for the clean-summary review |
| `auto-describe` | no | `false` | Append a structured PR description once per PR (skipped if markers already present) |
| `describe-labels` | no | `''` | Extra labels to apply after describe; needs `issues: write`. Describe pass also infers type + review-effort labels |

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

Each `review-modes` value maps to a built-in skill of the selected provider:

| Mode | Cursor skill | Claude Code skill | Purpose |
|------|--------------|-------------------|---------|
| `code-review` | `/review-bugbot` | `/code-review [level]` | General code review (aliases: `review-bugbot`, `bugbot`) |
| `security-review` | `/review-security` | `/security-review` | Security-focused review (alias: `review-security`) |
| `simplify` | `/simplify` | `/simplify` | Complexity and simplification suggestions (reported, never applied) |

Pass multiple modes as a comma-separated list: `code-review, security-review, simplify`.

## Claude Code provider

bugbit runs Claude Code's own review skills headless through the [Claude Agent SDK](https://code.claude.com/docs/en/agent-sdk/overview), so CI findings match what `/code-review`, `/security-review`, and `/simplify` give you locally.

**1. Create a token.** On a machine where you are logged in to Claude Code with a Pro or Max subscription:

```bash
claude setup-token
```

It opens a browser login and prints a long-lived OAuth token (`sk-ant-oat01-…`). Save it as a repository secret, for example `CLAUDE_CODE_OAUTH_TOKEN`. With API billing instead, store an Anthropic API key and pass `anthropic-api-key`.

**2. Use it in the workflow:**

```yaml
- uses: Vilancer/bugbit@v1
  with:
    provider: claude
    claude-code-oauth-token: ${{ secrets.CLAUDE_CODE_OAUTH_TOKEN }}
    review-modes: code-review, security-review, simplify
    review-level: high        # low | medium | high | xhigh | max
    # model: claude-opus-5-5  # empty = Claude Code default
```

**`review-level`** is passed to `/code-review`: `low` reports a few high-confidence findings, `max` reports many, some of them uncertain. Higher levels take longer and use more of your plan. Empty uses the skill's default.

How the session is locked down:

- Read-only: `permissionMode: dontAsk` with an allowlist (`Read`, `Grep`, `Glob`, `Skill`, subagents, bugbit's tools). `Edit`, `Write`, `WebFetch`, and `WebSearch` are denied, and the skills' `--fix`/`--comment` paths are disabled by the overlay.
- A guard checks every Bash and file call, including subagents': Bash may only run one plain read-only `git` command (`diff`, `log`, `show`, `blame`, `status`, `rev-parse`, `ls-files`, `merge-base`, no `--output`/`--no-index`, no pipes or chaining), and `Read`/`Grep`/`Glob` can't open `.git/config`, `.env*`, keys, `/proc` or `$RUNNER_TEMP`.
- Ignores everything the PR head could control: no `.claude/settings.json`, hooks, `.mcp.json`, or plugins are loaded (`settingSources: []`, `strictMcpConfig`). The token account's claude.ai connectors and synced skills/plugins are off.
- The agent process gets the Claude token only; `INPUT_*`, `GITHUB_TOKEN`, and Actions runtime tokens are stripped from its environment. PR comments go through bugbit's in-process MCP tools.
- The SDK (`@anthropic-ai/claude-agent-sdk`, pinned) is installed into `$RUNNER_TEMP` on each run (~10–30s, ~250MB native binary) because it cannot be bundled into `dist/`.

## What each provider is allowed to do

| | Claude (`provider: claude`) | Cursor (`provider: cursor`) |
|---|---|---|
| File edits | Blocked | Asked not to; the Cursor SDK has no per-tool deny rules |
| Shell | One plain read-only `git` command, arguments checked | Not restricted: the Cursor SDK can't check commands, and its sandbox doesn't start on GitHub-hosted runners |
| `.git/config`, `.env*`, keys, `/proc` | Refused | Readable |
| Settings, rules, MCP servers from the PR branch | Never loaded | Never loaded (`settingSources: []`) |
| Credentials in the agent's environment | Claude credential only | None: bugbit removes its secret inputs and the Actions runtime token from the environment before any agent starts |
| What gets posted (comments, description, labels) | Scrubbed of credentials | Scrubbed of credentials |

Scrubbing is the backstop for both: before anything reaches GitHub, bugbit replaces the GitHub token (and the basic-auth header `actions/checkout` stores), the provider key, and anything token-shaped with `[redacted]`. GitHub masks secrets in logs, but not in PR comments.

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

**With auto-describe labels (`auto-describe: true` and inferred / `describe-labels`):**

```yaml
permissions:
  contents: read
  pull-requests: write
  issues: write
```

# Limitations

### Pull request file pagination

bugbit paginates GitHub's `pulls.listFiles` API (100 files per page) for both the review diff and comment line-map. PRs with more than 30 changed files are fully covered.

GitHub itself still caps that endpoint at **3,000 files** per pull request. Beyond that, the API truncates and bugbit can only review the returned set.

### Large diffs

Prefetched / `get_diff` payloads are capped at ~1MB of JSON. When the full parsed hunk body would exceed that, bugbit progressively slims the payload (`diffMode`: `full` → `hunk_ranges` → `paths_only`) so the agent still receives changed paths. For slim modes, the agent reads files for targeted context. Inline comments are still validated against the full GitHub line map (not the slimmed prefetch). If even `paths_only` exceeds the cap, the inventory is truncated (`truncated: true`).

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

The action uses the `node24` runtime (`action.yml`). Use `runs-on: ubuntu-latest` for the supported vendored `rg` path. `provider: claude` also needs `npm` on the runner (preinstalled on GitHub-hosted runners) to install the Claude Agent SDK.

### Action pinning

`@v1` tracks the latest compatible v1 release. Pin to `@v1.0.0` or a full commit SHA for an exact version.

# Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for local development, testing, and bundle instructions.

# Credits

The 1.2.0 auto-describe, LGTM clean-summary, large-diff slimming, and related workflow ideas were inspired by [@JuicyBurger](https://github.com/JuicyBurger)'s fork [JuicyBurger/bugbit](https://github.com/JuicyBurger/bugbit).

# License

[MIT](LICENSE)
