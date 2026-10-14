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

### Execution model

Sluice starts as an Effect program that runs inside one CI job. GitLab or GitHub still
provides the runner, the checkout and the artifacts, and the program replaces the shell
script and the YAML logic in that job. The platform's job page shows one job instead of
several, and the trace shows the steps inside it.

A later option is to run steps through Dagger (wrap its TypeScript SDK in
`Effect.tryPromise`). Dagger gives containers and content-addressed caching, and Effect
gives composition, typed errors and traces. It is more powerful, but users must learn two
new tools at once, so it is not the starting point.

[`sketches/first-pipeline.ts`](./sketches/first-pipeline.ts) is a working sketch of the
first model. It runs `pnpm install` with retries, then `lint`, `typecheck` and `test` in
parallel, fails with a typed `StepFailed` error, and exports a trace over OTLP. It uses
only `effect` and `@effect/platform-node` 4.0.4, because Effect 4 ships OTLP export in
`effect/observability`. On 2026-10-14 it passed `typecheck` and `lint` inside
`packages/core`, ran against this repository, and its trace showed in Jaeger as `ci` with
the four steps below it. Two limits: output from parallel steps is interleaved, and steps
have no platform log sections yet (goal 3).

To run it, copy it into a package that depends on `@effect/platform-node`, start Jaeger
with `docker run -p 16686:16686 -p 4318:4318 jaegertracing/all-in-one`, and run
`node <file>.ts`.

### Tracing pipelines that are still YAML

A team can get traces before it moves any pipeline to Sluice. For GitLab, the API gives
each job's `created_at`, `started_at`, `finished_at` and `queued_duration`. Each job log
contains `section_start:<timestamp>:<name>` and `section_end` markers for steps such as
`prepare_executor`, `get_sources`, `restore_cache`, `step_script` and
`upload_artifacts`. Together they give a full trace of a finished pipeline, with no change
to the pipeline. GitHub has the same data in its workflow run and job APIs.

This could be a command such as `sluice trace <pipeline-url>`. It shows a team where its
time goes, which is the best argument for moving to Sluice, and it needs only a read-only
API token. Span attributes should follow the OpenTelemetry `cicd.*` semantic conventions.

### `effect/workflow`, not `effect/cluster`

`effect/workflow` gives the right words for CI: an `Activity` is a step with a memoized
result, a `DurableDeferred` waits for an approval, and a `DurableClock` waits for a time.

`effect/cluster` is the wrong runtime. `ClusterWorkflowEngine` needs sharding, runners and
SQL message storage, so it expects long-lived processes. CI runners start, run one job,
and stop. `SingleRunner` runs the cluster in one process against SQL, but that does not
help: a SQLite file on a runner is deleted with the runner, and a hosted database is a
service every user would have to run.

Effect ships two engines: `WorkflowEngine.layerMemory`, which is not durable, and
`ClusterWorkflowEngine`. `WorkflowEngine` is an interface, so a third engine can store its
state somewhere CI already has, such as an S3 or R2 bucket. In `effect` 4.0.4 its
`Encoded` interface has eleven methods: `register`, `execute`, `poll`, `interrupt`,
`interruptUnsafe`, `resume`, `awaitComplete`, `activityExecute`, `deferredResult`,
`deferredDone` and `scheduleClock`.
[TeXRA issue #12081](https://github.com/LionSR/TeXRA/issues/12081) describes a project
that builds its own engine for the same reason, against a release candidate that had ten
of these. Known problems to check before building one:

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

`effect/workflow` also has `DurableQueue`. A workflow offers a payload to a persisted
queue and suspends, and a worker runs the handler and resumes the workflow with the
result. Delivery is at least once, so handlers must be idempotent. A CI job that acts as
a worker is one possible shape for fan-out.

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
- [OpenTelemetry semantic conventions](https://github.com/open-telemetry/semantic-conventions):
  `model/cicd` defines the `cicd.*` attributes that CI spans should carry.
- [otel-cicd-action](https://github.com/dash0hq/otel-cicd-action): turns a finished GitHub
  Actions run into spans.
- [gitlabreceiver](https://github.com/open-telemetry/opentelemetry-collector-contrib/tree/main/receiver/gitlabreceiver):
  an OpenTelemetry Collector receiver that builds traces from GitLab pipeline webhooks. It
  is not in `repos.config.js`, because the repository is about 900 MB.

## Next steps

1. **Design the core types** in `packages/core`: `Step`, `Pipeline`, the platform adapter
   service, and what a step's cache key contains. Shape steps so that goals 4 and 5 fit
   later without a rewrite.
2. **Build a thin end-to-end slice.** One real pipeline, this repository's own checks,
   runs locally and on GitLab CI from the same program, with traces. Start from
   [`sketches/first-pipeline.ts`](./sketches/first-pipeline.ts).
3. **Publish a placeholder** of `@sluice-run/core` as `0.0.1`, so the `@sluice-run` npm
   scope holds a real package. Remove `"private": true` from
   `packages/core/package.json` first. Publish exports that point at built `dist/` files,
   not at `src/index.ts`.
4. **Talk to the author of effect-ci-testbed** before Sluice overlaps with it.

## Open questions

- The core types: `Step`, `Pipeline`, the platform adapter `Layer`, and what a step's
  cache key contains.
- Where a run's state lives between jobs: a bucket, the platform's artifact store, or the
  platform's package registry.
