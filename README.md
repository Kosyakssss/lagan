# Lagan

A personal feed reader: the newest hundred posts from the feeds you follow,
as plain pages, and what you keep. One Bun process, one SQLite file.

## Setting it up on a Mac

```sh
git clone <this repo> lagan && cd lagan
bun install
bun link        # puts the lagan command on your PATH, run from this copy
lagan install   # runs the app at login and starts it now
```

`lagan install` writes a launch agent, `~/Library/LaunchAgents/org.sk.lagan.plist`,
pointing at this copy of the repo. It starts the app, waits until it answers and
prints its address. From then on it starts at login, and again if it stops.

| Command           | What it does                                     |
| ----------------- | ------------------------------------------------ |
| `lagan install`   | Run at login, from this copy, and start now      |
| `lagan restart`   | Restart, after pulling or changing the code      |
| `lagan uninstall` | Stop, and no longer run at login; the data stays |

`lagan` alone lists the rest: following, keeping, muting, OPML.

## Where things live

Everything is in this copy of the repo, and none of it is in git:

- `data/lagan.sqlite`: every feed, post and setting, made on the first start.
- `data/server.log`: what the running app prints.
- `.env` (optional): where it listens. Without one, at `http://127.0.0.1:8789/`.

```sh
LAGAN_HOST=127.0.0.1
LAGAN_PORT=8789
SITE_PATH=/lagan   # when a proxy serves it under a path
```

Removing it all: `lagan uninstall`, `bun unlink`, then delete the folder.

## On other devices, with Tailscale

Once, so the tailnet reaches it at `/lagan` (with `SITE_PATH=/lagan` in `.env`).
Tailscale remembers it across restarts:

```sh
tailscale serve --bg --set-path /lagan http://127.0.0.1:8789/lagan
```

## Working on it

```sh
bun run dev     # reloads on change
bun test
bun run check && bun run lint && bun run format
```
