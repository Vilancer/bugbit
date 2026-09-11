# Contributing to bugbit

Thanks for your interest in contributing to bugbit.

## Prerequisites

- **Node.js** 22 or newer (matches `@cursor/sdk` engine requirements)
- **pnpm** 11.x (see `devEngines` in `package.json`)

## Local setup

```bash
git clone https://github.com/Vilancer/bugbit.git
cd bugbit
pnpm install
pnpm test
pnpm bundle
```

`pnpm bundle` compiles TypeScript, bundles the action entrypoint into `dist/index.js`, copies runtime scripts under `dist/scripts/`, and vendors the linux-x64 `rg` binary under `dist/vendor/`.

## Project layout

| Path | Purpose |
|------|---------|
| `src/main.ts` | Action entrypoint (orchestration) |
| `src/agent/` | Cursor agent runner, timeout, stream logging |
| `src/github/` | Custom tools, PR prefetch, shared GitHub types |
| `src/prompts/` | Review mode parsing and skill prompt assembly |
| `src/runtime/` | Action path resolution, checkout checks, artifacts, SDK bootstrap |
| `scripts/lib/` | ESM modules loaded at runtime (`operations`, `preflight`, etc.) |
| `dist/` | **Shipped** bundle consumed by `uses: Vilancer/bugbit@…` |
| `prompts/` | Agent system prompt overlay |
| `__tests__/` | Jest unit tests |
| `action.yml` | Action metadata and input definitions |

## Build and release checklist

bugbit is distributed as a **pre-bundled** JavaScript action. Consumers do not run `pnpm install` on the runner — only committed files under `dist/` are used at runtime.

After changing `src/` or `scripts/lib/`:

1. Run `pnpm test`
2. Run `pnpm bundle`
3. Commit any changed files under:
   - `dist/index.js`
   - `dist/scripts/`
   - `dist/vendor/`

Do not hand-edit `dist/` except by running the bundle scripts.

## Stacked PRs

For epics that are too large for one PR, use an **empty integration branch** (`feat/<epic>` from `main`, no commits on it) and a `gh stack` of small PRs that land there first. See [AGENTS.md](AGENTS.md) / [CLAUDE.md](CLAUDE.md). Do not open `feat/<epic> → main` until the first layer has merged.

## Pull request expectations

- Keep diffs focused; match existing TypeScript and Jest conventions
- Add or update tests for behavior changes
- Update `action.yml` input descriptions when inputs change
- Update `README.md` when user-facing behavior changes
- Ensure `pnpm test` passes before opening a PR

## License

By contributing, you agree that your contributions will be licensed under the [MIT License](LICENSE).
