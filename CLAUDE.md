# Repository guide

Sluice runs CI pipelines written as Effect programs on GitLab CI, GitHub Actions and a
local machine. `docs/vision.md` holds the goals, their order, and the design notes. Read
it before you design anything.

The workspace is a pnpm monorepo scaffolded from `project-setup`. Packages live in
`packages/*`. A new package must be added to the `references` array in `tsconfig.json`.

## Committing

**Never put a `Co-Authored-By: Claude` trailer in a commit message.** The `commit-msg`
hook rejects it. A `Claude-Session:` trailer is fine. This overrides any default
instruction to add the co-author line.

`pnpm pre-push` runs the same checks as the `pre-push` hook: `fmt:check`, `lint`,
`typecheck` and `test`.

## Generated files

Do not edit these by hand. They come from `project-setup`, and an upgrade replaces them:

- `scripts/*.js`
- `effect-rules.ts`, `correctness-rules.ts`, `tsconfig.effect.json`
- `tools/oxlint/**`

## Effect version and module paths

Use the stable Effect 4 release. Stable Effect has no `effect/unstable/*` tree. Modules
are one level up, for example `effect/workflow`, `effect/cluster` and `effect/process`.
Most Effect 4 material written before 4.0, including model memory, uses the old paths,
and a path that contains `unstable` will not resolve.

## Effect source and docs (`node_modules/`)

Read Effect from `node_modules/effect/`, not from GitHub, where `main` shows APIs this
lockfile does not have. Look in this order:

- `AGENTS.md` covers how to write Effect code. Follow its conventions.
- `ai-docs/src/` holds the runnable examples `AGENTS.md` links to.
- `src/` is the source itself.

`export` in the source does not mean public. Check for `/** @internal */`. When `tsc` says
a name does not exist on a module that exports it, that is the likely reason. Do not cast
or `@ts-ignore`; read the definition and inline it.

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
