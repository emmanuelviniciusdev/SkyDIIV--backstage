---
name: conventional-commit
description: Suggest a conventional commit message from git status, diff, and recent history. Use when the user asks for a commit message, wants help committing, or wants a message for recent or staged changes.
---

# Conventional Commit

Suggest a commit message in this repo's style. Do **not** create the commit unless the user explicitly asked to commit.

## Inspect changes

Run these in parallel:

```bash
git status
git diff
git diff --staged
git log -15 --format='%s'
```

If there are no staged or unstaged changes, say so and stop.

Do not commit `.env`, `.dev.vars`, credentials, or files that look like secrets. Warn if they are in the diff.

## Message format

```
type(scope): subject
```

Omit `(scope)` only for repo-wide work (root README, OpenSpec config, shared `.cursor/` files that are not app-specific).

Subject: imperative, lowercase after the colon, no trailing period, focus on **why** not a file list.

Optional body: 1–2 sentences on why. Most commits in this repo are subject-only; add a body only when the why is not obvious from the subject.

### Types

| Type | When |
|------|------|
| `feat` | New behavior or capability |
| `fix` | Bug fix |
| `chore` | Tooling, config, deps, refactors with no user-facing behavior, docs-only chores |

Use `docs` or `ci` only when the change is purely that and a matching type already appears in recent `git log`. Prefer `chore` / `fix` / `feat` to match history.

### Scope

Derive from the top-level path of the change:

| Path | Scope |
|------|--------|
| `apps/worker-ai-workflows/` | `worker-ai-workflows` |
| `apps/worker-scheduler/` | `worker-scheduler` |
| `apps/worker-outbox-events/` | `worker-outbox-events` |
| `apps/worker-notification/` | `worker-notification` |
| `apps/worker-sync/` | `worker-sync` |
| `apps/robot-scrape-products/` | `robot-scrape-products` |
| `scripts/` | `scripts` |
| `.github/workflows/` | `ci` |
| deploy/Terraform under an app | that app's name, or `deploy` if the change is deploy-only across apps |

If several apps changed, prefer **one commit per app**. If the user wants a single commit, drop the scope or use the dominant app.

## Output

Show the suggested message in a fenced block, then one line on type/scope rationale.

If the user asked to **commit**, follow the repo git safety rules: stage the relevant files, commit with a HEREDOC, then `git status`. Never `--no-verify`, never force-push, never amend unless the user asked and the amend rules are met.

### Examples from this repo

```
feat(worker-ai-workflows): use preferred_name in wardrobe panorama prompts
fix(robot-scrape-products): make hard destroy reliable with OCI state
chore(worker-scheduler): move neon-database-snapshot to every wednesday schedule
chore: OpenSpec init
```
