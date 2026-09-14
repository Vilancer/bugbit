# Agent notes

## Stacked PRs (empty integration branch)

Large changes ship as a `gh-stack` of small PRs that land on an **empty** integration branch first — never on `main` until the whole epic is merged layer by layer.

```
main ──●
        \
         feat/<epic>              ← starts empty (== main); never commit here
           └ PR 1  layer-a        ← base: feat/<epic>
               └ PR 2  layer-b    ← base: layer-a
                   └ PR 3  …
umbrella PR  feat/<epic> → main   ← open only after PR 1 has landed
```

### Setup (once)

```bash
git fetch origin main
git checkout -b feat/<epic> origin/main
git push -u origin feat/<epic>
gh stack init --base feat/<epic> <layer-1-branch>
```

Rules:

- Every commit goes on a **layer** branch, never on `feat/<epic>` and never on `main`.
- Each layer must be green on its own (`pnpm test`, `pnpm bundle` when `src/` or `scripts/lib/` change).
- Related dependent work = stack. Unrelated work = a separate PR off `main`.
- After committing the current layer: `gh stack add <layer-2-branch>`.
- Merge order = dependency order (schema/data → API → UI → docs). Split a layer rather than land a huge PR.

### Publish

Push/open PRs only when asked:

```bash
gh stack submit --auto --open
```

GitHub refuses an umbrella PR while `feat/<epic>` still equals `main`. Open `feat/<epic> → main` **after the first layer merges**.

### Merge (bottom-up)

```bash
gh stack checkout <pr-1>
gh stack merge
gh stack sync
# repeat for remaining layers, then merge the umbrella
```

Do not delete or force-push the integration branch; that orphans every stacked PR’s base.
