# Vision

Sluice runs CI pipelines written as Effect programs. One TypeScript program runs on your
laptop, on GitLab CI and on GitHub Actions. The YAML each platform needs is a thin wrapper
that calls it.

## The problem

CI pipelines are written in YAML. YAML has no types, no functions and no tests. You cannot
run a pipeline locally, so every change is a commit and a wait. When a pipeline is slow,
the platform shows a list of jobs and durations. It does not show where the time goes
inside a job.

## Goals, in order

1. **One program, every platform.** A pipeline is an Effect program. It runs the same way
   locally, on GitLab CI and on GitHub Actions. `.gitlab-ci.yml` and
   `.github/workflows/*.yml` only call it.
2. **Traces for free.** Every step is an `Effect.withSpan`. A run exports OpenTelemetry
   traces, so one trace view shows where a pipeline spends its time.
3. **Native log output on each platform.** GitLab gets `section_start` / `section_end`
   markers and GitHub gets `::group::`, so the platform's own job page still reads well.
4. **Step caching keyed by inputs.** A step is skipped when a hash of its inputs matches a
   result that already passed. This is the Turborepo, Nx and Bazel model.
5. **Durable workflows for deploys.** Manual approvals, freeze windows and long rollouts,
   built on `effect/workflow`.

Goals 1 to 3 already improve on YAML. Goals 4 and 5 come later, but steps are shaped for
them from the start: each step has a name, is idempotent, and declares its result with a
`Schema`.

## Design notes

### `effect/workflow`, not `effect/cluster`

`effect/workflow` gives the right words for CI: an `Activity` is a step with a memoized
result, a `DurableDeferred` waits for an approval, and a `DurableClock` waits for a time.

`effect/cluster` is the wrong runtime. `ClusterWorkflowEngine` needs sharding, runners and
SQL message storage, so it expects long-lived processes. CI runners start, run one job,
and stop. A SQLite file on a runner is deleted with the runner.

`WorkflowEngine` is an interface, so an engine can store its state somewhere CI already
has, such as an S3 or R2 bucket. Known problems to check before building one:

- Engine methods have `never` in their error channel, so a storage failure can only be a
  defect, not a typed error.
- Activities are memoized by `executionId/name/attempt`. Two calls to the same named
  activity in one run return the first result.
- Both shipped engines have open replay bugs, for example
  [#8951](https://github.com/Effect-TS/effect/issues/8951) and
  [#8995](https://github.com/Effect-TS/effect/issues/8995).

### Two kinds of memoization

A workflow engine memoizes by **execution**: "this run already did step X". CI users want
memoization by **inputs**: "this lockfile and these sources already passed typecheck, on
any run". These are different features. Goal 4 is the second kind. Durable execution
matters mainly for deploys (goal 5).

### Fan-out across runners

One program in one job can use only one runner. To use more, a plan phase generates a
GitLab child pipeline or a GitHub matrix, and each job runs one slice of the same program.
The jobs then need a shared store to coordinate, and that store is where a durable engine
earns its place. No existing tool solves this for both GitLab and GitHub.

## Prior art

- [effect-ci-testbed](https://github.com/ericclemmons/effect-ci-testbed): CI workflows as
  Effect programs that run locally, on GitHub, and later on Cloudflare Workflows. An
  experimental prototype. Read its design, and talk to its author before overlapping.
- [Alchemy](https://alchemy.run/): infrastructure as code on Effect. Its
  [observability page](https://alchemy.run/testing/observability/) shows the same
  "OpenTelemetry as a Layer" approach.
- [@async/pipeline](https://github.com/async/pipeline): a local-first TypeScript task
  graph that generates a thin GitHub Actions workflow. GitHub only.
- [Trellis](https://github.com/charliermarsh/trellis): Dockerfiles and CI pipelines in
  TypeScript, on Deno.
- [Dagger](https://dagger.io/): pipelines as code with a container engine and caching. A
  possible execution backend, not a competitor to the Effect layer.

## Open questions

- The core types: `Step`, `Pipeline`, the platform adapter `Layer`, and what a step's
  cache key contains.
- Where a run's state lives between jobs: a bucket, the platform's artifact store, or the
  platform's package registry.
