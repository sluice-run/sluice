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

## Two halves, one trace

Sluice does two things:

- **It observes pipelines that are still YAML.** `sluice trace` reads a finished pipeline
  from the platform API and turns it into a trace. The pipeline does not change. The
  trace stops at step level, because the API has nothing below it.
- **It runs pipelines as Effect programs.** This is goals 1 to 5. A job's shell script and
  YAML logic become a typed program, and the trace goes as deep as the code.

The first half shows a team where its time goes. The second half lets the team fix it.
They are one product only if they produce the same trace. When a team moves one job to
Sluice, the next trace must look the same as before, except that the job now has a full
tree of spans under it. A team can then move a pipeline one job at a time, and each step
shows in the trace.

The first half stays small. It is the way into Sluice, not a separate product.

### Who each half is for

The first half is for any team on GitLab or GitHub. It needs a read-only token and no
change to the pipeline.

The second half is for a smaller group: teams that already write Effect, or at least
TypeScript, and want their CI to be code. They get local runs, typed errors, retries,
parallelism, native log sections and deep traces through `Effect.withSpan`. Sluice
accepts this smaller audience. Two ways to make it larger, and the decision on each:

- **Hide Effect behind a plain step API**, with async functions outside and Effect
  inside. Not now. It works against the premise of the project, and it puts Sluice in
  direct competition with Dagger's TypeScript SDK and `@async/pipeline`.
- **Trace inside YAML jobs without Effect.** A small command such as
  `sluice span -- <command>` runs one command as one span, with the shared job span from
  [One trace for both halves](#one-trace-for-both-halves) as its parent. A YAML pipeline
  then gets one level below the API. `otel-cli exec` does the same thing without the
  shared parent. This belongs to the first half. It is a possible later addition.

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

### Marketplace actions, and Sluice as a JavaScript action

A Sluice job on GitHub still has a YAML wrapper, and marketplace actions still work in
it:

```yaml
steps:
  - uses: actions/checkout@v5
  - uses: actions/setup-node@v5
  - uses: actions/cache@v4
  - uses: sluice-run/run@v1 # the program replaces only this part
```

Users lose marketplace actions only in the middle of the logic, between steps that the
program controls. Most of those actions wrap a command-line tool or an API, such as
`setup-*`, deploys or pull request comments, and the program calls the tool or API
directly. A pipeline that must run the same way on GitLab and locally (goal 1) cannot
depend on marketplace actions in its logic anyway.

The cache and artifact actions are different, because they use GitHub's internal
services. The runner gives the tokens for these services only to actions, not to `run:`
steps. `NodeScriptActionHandler.cs` and `ContainerActionHandler.cs` in `actions/runner`
set `ACTIONS_RUNTIME_URL`, `ACTIONS_RUNTIME_TOKEN`, `ACTIONS_CACHE_URL` and
`ACTIONS_RESULTS_URL`. `ScriptHandler.cs`, which runs `run:` steps, sets only
`ACTIONS_ID_TOKEN_REQUEST_URL` and `ACTIONS_ID_TOKEN_REQUEST_TOKEN`, and only when the
job can request an OIDC token. A `run:` step inside a composite action also goes through
`ScriptHandler`, so a composite action does not help.

So on GitHub, Sluice ships as a JavaScript action, `uses: sluice-run/run@v1`, and not as
`run: npx sluice`. The program can then use `@actions/cache` and `@actions/artifact`
from inside, for example to cache one step's output (goal 4) or to upload a report.
This was checked against the `actions/runner` source on 2026-10-14.

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

The command reads the finished pipeline and builds the spans afterwards, with the
timestamps from the API. The pipeline does not send anything while it runs. The trace is
one root span for the pipeline, a `Queued` span, one span for each job, and one span for
each step or log section in a job. The API stops at step level. Spans inside a step need
code inside the job, and that is what a Sluice pipeline adds.

**Output.** The default output is OTLP, sent to the endpoint in
`OTEL_EXPORTER_OTLP_ENDPOINT`. Every trace backend accepts it: Jaeger, Grafana Tempo,
Honeycomb, Axiom and Dash0. Jaeger is the quickest way to try it, with the same
`docker run` command as the first-pipeline sketch. A second output writes the spans to a
JSONL file for the otelscope terminal viewer. Both outputs come from the same spans.

**Where it runs.** The same program runs in three places:

- On a laptop, as `sluice trace <pipeline-url>`. It needs no change to the pipeline, and it
  can trace old runs.
- On GitHub, as an action in a workflow that the `workflow_run` event starts when the
  traced workflow completes. This is how `otel-cicd-action` works.
- On GitLab, as a CI/CD component that adds a job in the last stage with `when: always`.

A run that is exported every time gives history, so a team can see changes over time. The
trace backend stores and compares the runs. Sluice only has to send clean spans with
stable names. A span name that contains an unfilled template, such as
`Evaluations (${{ matrix.name }})` from a skipped GitHub matrix job, cannot be compared
across runs.

**GitLab is the gap.** `otel-cicd-action` already does this well for GitHub, so a GitHub
version of `sluice trace` mostly repeats it. The only GitLab option today is the
Collector's `gitlabreceiver`, which needs a running Collector and a webhook. One command
for both platforms is the reason to build this.

Points to check before building it:

- The GitLab job runs inside the pipeline it traces, so the pipeline is not finished yet.
  The job must leave itself out of the trace and end the root span at the end of the last
  other job. `otel-cicd-action` has the same problem when it runs inside the traced
  workflow, which is why its documentation prefers `workflow_run`.
- Check whether `CI_JOB_TOKEN` can read the other jobs and their logs. If it cannot, the
  component needs a project access token with `read_api`.
- Since June 2026, GitHub Actions can run steps in parallel (`parallel`,
  `background: true` and `wait`). The jobs API then returns steps that overlap in time, so
  step spans must not assume that steps run one after another.
- `Effect.withSpan` cannot set a start time, because `SpanOptions` in `effect` 4.0.4 has
  no `startTime` and the span takes it from the clock. The `Tracer` service can:
  `Tracer.span` takes a `startTime`, and `Span.end` takes an `endTime`. The replay should
  build its spans through the `Tracer` service, so that the OTLP exporter sends the
  timestamps from the API. This has not been tried yet.

### One trace for both halves

The replay and the program inside a job cannot pass a trace context to each other. The
program runs during the pipeline, and the replay runs after it. Both know the platform's
IDs, so both can compute the same span IDs from them:

- trace ID = a hash of the pipeline or run ID, cut to 16 bytes
- job span ID = a hash of the job ID, cut to 8 bytes

The program inside a job uses the job span as its parent, through `Tracer.externalSpan`
and `Effect.withParentSpan`. The replay creates that job span later, with the same ID. The
trace backend joins the two into one trace. Neither side has to wait for the other.

Points to check:

- `NativeSpan` creates random IDs. The replay needs its own `Span` implementation, or
  another way to set `traceId` and `spanId`.
- If the replay never runs, the program's spans point at a parent that does not exist.
  Backends still show them, but as a separate tree with a missing parent.
- The hash must be the same in every Sluice version, or traces from different versions
  will not join. Include the platform and the project in it, so that IDs from different
  GitLab instances or repositories cannot collide.

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
  Actions run into spans and sends them over OTLP. On 2026-10-14 Christopher Ehrlich
  [posted a trace](https://x.com/ccccjjjjeeee/status/2110391954949488811) of his
  workflow in Axiom that it most likely produced: the span names and its `Queued` span
  match the action's source.
- [gitlabreceiver](https://github.com/open-telemetry/opentelemetry-collector-contrib/tree/main/receiver/gitlabreceiver):
  an OpenTelemetry Collector receiver that builds traces from GitLab pipeline webhooks. It
  is not in `repos.config.js`, because the repository is about 900 MB.

## Next steps

1. **Design the core types** in `packages/core`: `Step`, `Pipeline`, the platform adapter
   service, what a step's cache key contains, and how a run gets its trace ID and parent
   span from the platform's IDs. Shape steps so that goals 4 and 5 fit later without a
   rewrite.
2. **Build a thin end-to-end slice.** One real pipeline, this repository's own checks,
   runs locally and on GitLab CI from the same program, with traces. Start from
   [`sketches/first-pipeline.ts`](./sketches/first-pipeline.ts).
3. **Publish a placeholder** of `@sluice-run/core` as `0.0.1`, so the `@sluice-run` npm
   scope holds a real package. Remove `"private": true` from
   `packages/core/package.json` first. Publish exports that point at built `dist/` files,
   not at `src/index.ts`.
4. **Talk to the author of effect-ci-testbed** before Sluice overlaps with it.
5. **Try a `sluice trace` replay against Jaeger.** Read one finished GitLab pipeline,
   build its spans through the `Tracer` service with the API timestamps, and check that
   Jaeger shows them at the right times. Then run a Sluice program in one job of that pipeline, and check
   that its spans join the replayed trace under the job span.

## Open questions

- The core types: `Step`, `Pipeline`, the platform adapter `Layer`, what a step's cache
  key contains, and how trace and span IDs are computed from the platform's IDs.
- Where a run's state lives between jobs: a bucket, the platform's artifact store, or the
  platform's package registry.
