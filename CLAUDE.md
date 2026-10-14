# Repository guide

Sluice runs CI pipelines written as Effect programs on GitLab CI, GitHub Actions and a
local machine. `docs/vision.md` holds the goals, their order, and the design notes. Read
it before you design anything.

The workspace is a pnpm monorepo scaffolded from `project-setup`. Packages live in
`packages/*`. `docs/packages.md` lists the planned packages, the dependency rules between
them, and how to add one.

## Effect Source and Docs (`node_modules/`)

Effect is the exception to the usual rule of not reading `node_modules/`. Every Effect package ships its TypeScript source in `src/` next to the build output, so the installed copy is the source at exactly the version in the lockfile. Do not clone Effect into `.repos/deps/`, and do not read it on GitHub, where `main` shows APIs this lockfile does not have.

Each Effect package also ships agent documentation, and it is the first place to look:

- `AGENTS.md` (with `CLAUDE.md` beside it) covers how to write Effect code: `Effect.gen` and `Effect.fn`, services with `Context.Service` and `Layer`, tagged errors, `Schema`, resources and scopes, streams, HTTP servers and clients, and testing with `@effect/vitest`. Follow its conventions.
- `ai-docs/src/` holds the runnable examples that `AGENTS.md` links to, one file per topic.
- `src/` is the source itself, for when the question is "what does this actually do".

The packages are not hoisted to the root `node_modules/`. Reach them through a workspace package that depends on them, for example `packages/core/node_modules/effect/` and `packages/core/node_modules/@effect/vitest/`. They are symlinks into `node_modules/.pnpm/`, and the version in that path tells you which build you are reading.

`export` in the source does not mean public. Check for `/** @internal */`. When `tsc` says a name does not exist on a module that exports it, that is the likely reason. Do not cast or `@ts-ignore`; read the definition and inline it.

## Other Dependency Source (`.repos/`)

`.repos/deps/` is for upstream dependencies that do not ship their source, cloned at the exact version used here. `.repos/refs/` is for repositories read as prior art, tracked at branch tip. Entries go in the `deps` and `refs` arrays of `repos.config.js`; `pnpm deps:fetch` and `pnpm refs:fetch` populate them, and `pnpm deps:check` confirms nothing has drifted. `deps` is empty. `refs` holds the CI-as-code and CI-tracing projects that `docs/vision.md` names as prior art; each entry in `repos.config.js` has a comment that says why it is there. The directory is gitignored.

> **Location:** `.repos/` lives at the root of the **main repository checkout**, never inside a worktree. From a worktree such as `.claude/worktrees/agent-xxx/`, `git rev-parse --show-toplevel` returns the worktree and is the wrong answer. Use `--git-common-dir` instead. It returns the shared `.git` directory that every worktree points at, and the parent of that directory is the main checkout:
>
> ```sh
> "$(dirname "$(git rev-parse --path-format=absolute --git-common-dir)")/.repos"
> ```
>
> Keep `--path-format=absolute`. Without it, git answers relative to the current directory. That answer is right where it is evaluated and wrong once the path is stored or passed anywhere else.

## Before You Push

The git `pre-push` hook runs `pnpm pre-push`, which is `fmt:check`, `lint`, `typecheck` and `test`. Run it yourself before you claim work is done. Do not edit `.git/hooks/pre-push`; edit the `pre-push` script in `package.json` instead.

Generated and vendored files carry a "do not edit" banner: everything under `tools/oxlint/`, the five bundles in `scripts/`, `effect-rules.ts`, `correctness-rules.ts` and `tsconfig.effect.json`. They come from the `project-setup` scaffold, at the version in `.project-setup-version`, and are replaced wholesale on upgrade. Change the source there, not the copy here.

Commit messages must not carry a `Co-Authored-By` line naming Claude, because the `commit-msg` hook rejects them.

## Effect version and module paths

Use the stable Effect 4 release. Stable Effect has no `effect/unstable/*` tree. Modules
are one level up, for example `effect/workflow`, `effect/cluster` and `effect/process`.
Most Effect 4 material written before 4.0, including model memory, uses the old paths,
and a path that contains `unstable` will not resolve.

## Effect platform services, not `node:`

`effecttsgo/node-builtin-import` reports `node:` imports. Use `effect/FileSystem`,
`effect/Path` and `effect/process/ChildProcess`. When the platform cannot do something,
disable the rule at the call site with a comment that names what the service could not do.

## Linting

`pnpm lint` fails on any warning. A new anti-slop finding is a design question first:
prefer parsing at the boundary with a `Schema` decoder over an `oxlint-disable-next-line`.

## Documentation language (B2 English)

Write comments and docs in plain B2 English. One idea per sentence; keep sentences under
40 words. No figures of speech. Code identifiers stay verbatim in backticks.

TSDoc on anything exported says how the code works now. No "no longer", "previously" or
"renamed from".
