# Contributing to RobotLab-X

Thanks for your interest! This guide covers how the repo is maintained, what's
directly editable, and how to get a change merged.

## How this repo is maintained

RobotLab-X is developed in an upstream monorepo and **published to this public
repo**. This repo is the canonical *open-source* tree — you can clone, run,
hack, and open PRs against it — but a few files are generated upstream and are
mirrored here as output.

### `# managed` / `// managed` files are generated

Files whose first line is `# managed` (Python, SQL, configs) or `// managed`
(TypeScript) are produced by an upstream code generator from model
specifications. They include, for example:

- `apps/robotlab_x/src/robotlab_x/models/*.py` and `.../api/*_api.py`
- `apps/robotlab_x/sql/*.sql`
- `apps/robotlab_x_ui/src/models/*.ts`
- bootstrap files like `main.py`, `server.py`

You **can't regenerate these from this repo** (the generator isn't published).
That's fine — the generated output is committed here so the project builds and
runs standalone. If your change requires editing a `# managed` file (e.g.
adding a field to a model), open an issue or a PR describing the intent; a
maintainer applies it upstream and the regenerated output flows back here.
Please don't hand-edit `# managed` files in a PR expecting them to stick — they
get overwritten on the next publish.

### Directly editable (hand-authored) areas

These are authored by hand and are the best place to contribute directly:

- **Service business logic** — `apps/robotlab_x/src/robotlab_x/services/*_service.py`,
  `event_handlers.py`, `paths.py`
- **Service types** — anything under `apps/robotlab_x/repo/<name>/<version>/`
  (a new service, or fixes to an existing one), including its modular `ui/`
- **Shared libraries** — `packages/<name>/` (these are vendored copies; the
  maintainers keep them in sync upstream)
- **Frontend** — `apps/robotlab_x_ui/src/` components, hooks, service views
- **Docs** — `apps/robotlab_x/docs/`, this README, examples

## Development setup

See the [README quick start](./README.md#quick-start-run-from-source). In
short: `cd apps/robotlab_x && uv sync && uv run python -m robotlab_x.main`, and
`cd apps/robotlab_x_ui && npm install && npm run dev` for the UI.

Run the backend tests before opening a PR:

```bash
cd apps/robotlab_x
uv sync --all-extras            # adds pytest + friends
uv run pytest tests/ -q
```

For the frontend / modular service UIs:

```bash
cd apps/robotlab_x_ui
npm run build                   # typecheck + build the host UI
npm run build:service-ui        # build every service's ui/ bundle
npm run check:service-ui        # typecheck service UIs against the @rlx/ui SDK
```

## Adding a service

Copy `apps/robotlab_x/repo/master_template/1.0.0/` (it documents every
`package.yml` field) to `repo/<your-name>/1.0.0/`, implement your `Service`
subclass (in-process) or a pip-installed subprocess, add an `icon.svg`, and —
optionally — a modular `ui/View.tsx`. Restart the backend; the runtime
discovers it automatically. Existing services (e.g. `clock`, `echo`,
`speaker_local`, `stt_local`) are good references.

## Pull requests

- Keep changes focused; one logical change per PR.
- Match the style of the surrounding code (naming, comments, structure).
- Add or update tests for behavior changes; make sure the suites above pass.
- Note in the PR if your change touches a `# managed` file so a maintainer can
  route it through the upstream generator.
- Be kind and constructive. By contributing you agree your work is licensed
  under the repo's [MIT License](./LICENSE).

## Reporting issues

Open a GitHub issue with: what you ran, what you expected, what happened
(include the platform, Python/Node versions, and relevant logs). For security
concerns, please report privately rather than opening a public issue.
