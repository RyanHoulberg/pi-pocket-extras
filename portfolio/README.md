# Portfolio

One page with every project's status, next action, and last activity. Each project can open its Pi session.

## What it does

- **Status** — active, blocked, paused, or done, with a colored dot.
- **Next action** — one line, shown under the project name.
- **Last activity** — from the project's own edits and its latest session; an active project untouched for 7 days says **stale**.
- **Suggestions** — recent chats whose folder is not a project yet can be added in one tap.
- **Open** — jumps to the project's latest session.

Pi keeps it current with the `portfolio_update` tool:

```
portfolio_update project="Pi Pocket" status="active" next="Write the README"
```

`portfolio_list` returns the whole portfolio as text, for "what's on my plate?".

## Install

Copy `portfolio.ts` and `portfolio/` into `~/.pi-pocket/extensions/`, then turn Portfolio on in **Menu → Extensions**. Or install it from the gallery once its entry is merged.

Requires **Pi Pocket 0.28.0** or newer: it reads the session list that a route gets from the app (`sessions()`). It does not read Pi Pocket's database.

## State

`~/.pi-pocket/portfolio-state.json`, mode 600. It holds the projects, their status, next action, and note. It is not part of this repository and nothing is sent anywhere.

## Rules

- The page and routes are for the owner only.
- The extension reads no secrets and makes no network calls.
- Tool names: `portfolio_update`, `portfolio_list`. Prompt section: `portfolio_status`.
- Routes: `GET state`, `POST project`, `POST delete`.
