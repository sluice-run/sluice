import { NodeRuntime, NodeServices } from "@effect/platform-node";
import { Effect, Layer, Schedule, Schema } from "effect";
import { FetchHttpClient } from "effect/http";
import { OtlpSerialization, OtlpTracer } from "effect/observability";
import { ChildProcess, ChildProcessSpawner } from "effect/process";

class StepFailed extends Schema.TaggedError<StepFailed>()("StepFailed", {
    step: Schema.String,
    exitCode: Schema.Finite,
}) {}

const sh = (step: string, command: string, args: ReadonlyArray<string>) =>
    Effect.gen(function* () {
        const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
        const exitCode = yield* spawner.exitCode(
            ChildProcess.make(command, args, { stdout: "inherit", stderr: "inherit" }),
        );
        if (exitCode !== ChildProcessSpawner.ExitCode(0)) {
            return yield* new StepFailed({ step, exitCode });
        }
    }).pipe(Effect.withSpan(step));

const pipeline = Effect.gen(function* () {
    yield* sh("install", "pnpm", ["install", "--frozen-lockfile"]).pipe(Effect.retry(Schedule.recurs(2)));
    yield* Effect.all(
        [sh("lint", "pnpm", ["lint"]), sh("typecheck", "pnpm", ["typecheck"]), sh("test", "pnpm", ["test"])],
        {
            concurrency: "unbounded",
        },
    );
}).pipe(Effect.withSpan("ci"));

const Tracing = OtlpTracer.layer({
    url: "http://localhost:4318/v1/traces",
    resource: { serviceName: "sluice-sketch" },
}).pipe(Layer.provide(OtlpSerialization.layerJson), Layer.provide(FetchHttpClient.layer));

pipeline.pipe(Effect.provide(Layer.merge(Tracing, NodeServices.layer)), NodeRuntime.runMain);
