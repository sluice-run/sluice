# Sluice

Effect-native CI pipelines for GitLab and GitHub.

You write a pipeline as an [Effect](https://effect.website/) program. The same program
runs on your laptop, on GitLab CI and on GitHub Actions, and every step exports an
OpenTelemetry span. See [`docs/vision.md`](./docs/vision.md) for the goals and the design
notes.

**Status:** early design. Nothing here is usable yet.

## Development

Requires Node.js 22.18 or later and pnpm 10.

```bash
pnpm install    # installs tooling, patches tsgo, writes the git hooks
pnpm typecheck
pnpm lint
pnpm fmt:check
pnpm test
```

`pnpm pre-push` runs all four checks, and the `pre-push` git hook runs it for you.

The workspace was scaffolded from `project-setup`. The scaffold version is in
`.project-setup-version`.

## License

MIT
