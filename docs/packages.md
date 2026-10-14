# Packages

Sluice is split into a platform-independent core and one package per platform. This
follows the way Effect itself is split: `effect` has no platform code, and
`@effect/platform-node` adds the Node.js parts.

Every package lives in `packages/` and is published under the `@sluice-run` npm scope.
The workspace has no `apps/` directory, because nothing here is deployed. Add one when
something deployable exists, such as a docs site.

| Directory         | Package              | Status  | Holds                                                                                                                 |
| ----------------- | -------------------- | ------- | --------------------------------------------------------------------------------------------------------------------- |
| `packages/core`   | `@sluice-run/core`   | started | `Step`, `Pipeline`, the workflow and cache model, and the platform adapter interface                                  |
| `packages/gitlab` | `@sluice-run/gitlab` | planned | The GitLab adapter: `section_start` log markers, child pipelines, the CI environment, finished pipelines from the API |
| `packages/github` | `@sluice-run/github` | planned | The GitHub adapter: `::group::` log markers, matrix generation, the CI environment, finished runs from the API        |
| `packages/cli`    | `@sluice-run/cli`    | planned | The `sluice` command that runs a pipeline locally or in CI, and `sluice trace`                                        |

## Rules

- `@sluice-run/core` depends only on `effect`. Code that knows about GitLab, GitHub or a
  terminal belongs in an adapter package or in the CLI.
- An adapter provides the platform as a `Layer`. The core defines the service, and each
  adapter implements it.
- Libraries take `effect` as a peer dependency, so a project that uses Sluice has one
  copy of Effect.

## Adding a package

1. Create `packages/<name>/` with a `package.json`, a `tsconfig.json` that extends
   `../../tsconfig.effect.json`, and `src/index.ts`. Copy them from `packages/core`.
2. Add `{ "path": "packages/<name>" }` to the `references` array in the root
   `tsconfig.json`.
3. Run `pnpm install`, then `pnpm pre-push`.
4. Change its status in the table above.
