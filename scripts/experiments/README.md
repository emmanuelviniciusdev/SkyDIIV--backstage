# Experiments — Scripts

Proof-of-concept and isolated experiments under `scripts/experiments/`.

Each subfolder is a standalone Python project with its own `pyproject.toml`,
README, and [uv](https://docs.astral.sh/uv/) run instructions.

## Projects

| Folder | Description |
|--------|-------------|
| [`poc--web-scraper-shopping-suggestions/`](poc--web-scraper-shopping-suggestions/) | Playwright web scraper for shopping suggestions in online marketplaces |

## Conventions

- PoCs do **not** require automated tests.
- Runtime outputs (`output.json`, `output.txt`, `.venv`) are listed in
  `scripts/.gitignore`.
- Production scripts live under `scripts/<script-name>/`; experiments are
  grouped here.
