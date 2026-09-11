# Merc Protocol — server backend

A real backend for Merc Protocol: username/password accounts (bcrypt-hashed,
Postgres-backed), JWT sessions, and a live multiplayer arena where the
*server* — not each player's browser — decides who's alive, who got hit, and
who won. It replaces the earlier claude.ai-Artifact version, which could only
network through Anthropic's own sandboxed `room` capability and had to trust
every client's own account of its health.

## Why this had to become its own website

Claude Artifacts run inside a strict content-security policy that blocks
`fetch`/WebSocket/XHR to any host except a couple of platform capabilities.
There is no way to make an Artifact page talk to a custom server. So this
project is a normal two-part web app instead:

- `server/` — a Node/Express server that serves the game client, exposes
  `/api/register`, `/api/login`, `/api/me`, `/api/leaderboard`, `/api/online`,
  and runs a WebSocket endpoint at `/ws` for the live arena.
- `public/index.html` — the game client (Three.js), served as a static file
  by the same server. Practice mode (vs bots) runs entirely offline in the
  browser, exactly like before. Multiplayer Arena mode connects to `/ws`.

Because client and server are same-origin, there's no CORS/CSP fight to
manage — the whole thing is just "one website."

## What's actually authoritative, and what isn't

- **Accounts**: real. Passwords are hashed with bcrypt before they ever touch
  the database; the server never stores or logs a plaintext password.
- **HP, kills, deaths, match state**: authoritative on the server
  (`server/arena.js`). A client can only ever say "I hit player X for Y
  damage" — the server decides whether that's valid (target exists, is
  alive, is on the other team) and is the only thing that actually
  subtracts HP or declares a kill. A modified/cheating client cannot lie
  about its own health or grant itself kills.
- **Position and animation are still client-reported.** There is no
  server-side physics simulation — building one would mean re-implementing
  movement, collision, and animation blending in Node and shipping inputs
  instead of state, which is a much bigger project. Practically: a modified
  client could still report a fake position (teleport, walk through walls)
  even though it can no longer lie about combat outcomes. If you want fully
  cheat-proof movement later, that's the next major step, and would center
  on `server/arena.js`'s `state` message handler.
- **Multiplayer Arena is Team Deathmatch only, on the Rooftop map, single
  shared arena per server process.** Capture Objective's capture-point logic
  still only exists client-side (from the Practice/bots build) and has no
  server-authoritative equivalent yet — extending `server/arena.js`'s
  `applyHit`/tick loop with a capture-point check is the natural next step
  if you want Capture Objective in PvP too. "Single shared arena per
  process" also means: if you scale this service to more than one Render
  instance, players get split across separate, unsynced arenas. Fixing that
  needs a shared store (e.g. Redis pub/sub) between instances — not
  included here, since it only matters once you're running multiple
  instances.

## Local development

```bash
npm install
cp .env.example .env      # edit DATABASE_URL to point at a local Postgres
npm start                 # serves the game at http://localhost:3000
```

You need a Postgres database reachable at `DATABASE_URL`. The server creates
its own tables on startup (`server/db.js`'s `init()`) — nothing to migrate
by hand.

## Deploying to Render

The included `render.yaml` is a Render "Blueprint": it describes both the
web service and a managed Postgres database, so Render can provision both
together.

1. Push this project to a GitHub repo.
2. In the Render dashboard: **New > Blueprint**, point it at the repo. Render
   reads `render.yaml` and provisions the `merc-protocol` web service and the
   `merc-protocol-db` Postgres database, wiring `DATABASE_URL` between them
   automatically. `JWT_SECRET` is auto-generated.
3. Once deployed, Render gives you a URL like
   `https://merc-protocol.onrender.com` — that's the whole game, accounts and
   all. Share that link with friends to play together.

Render's free web service tier spins down after inactivity and takes ~30-60s
to wake back up on the next request — fine for casual play, worth knowing if
the first load ever feels slow. The free Postgres tier is time-limited by
Render's own policy (currently expires after 30-90 days depending on plan);
check Render's current pricing page before relying on it long-term, or use a
paid Postgres plan for anything you want to keep.

## Project layout

```
server/
  index.js   -- boots Express + the WebSocket server, wires everything together
  db.js      -- Postgres access (users, stats)
  auth.js    -- register/login/me/leaderboard routes, JWT sign/verify
  arena.js   -- the authoritative live-match relay (the actual "backend" part)
public/
  index.html -- the game client
render.yaml  -- Render Blueprint (web service + Postgres)
```
