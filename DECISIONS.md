# Technical Decisions & Discord Platform Notes

## 1. Discrepancies with Discord Documentation

- **Client ID Environment Variable Name**:
  - *Discord Tutorial Issue*: Step 2 in Discord's "Building Your First Activity" tutorial saves the client ID as `VITE_CLIENT_ID`, but every code sample throughout the guide and template reads `import.meta.env.VITE_DISCORD_CLIENT_ID`.
  - *Resolution*: We adopted `VITE_DISCORD_CLIENT_ID` consistently across client and server environments, with fallback compatibility for `DISCORD_CLIENT_ID`.

- **Development Server Behind a Tunnel**:
  - The tutorial runs Vite on port 5173 and a separate API server; this app serves both from one Express server on port 3000, so the tunnel points at port 3000. Vite rejects requests whose Host header it doesn't know, so `vite.config.ts` allows `*.trycloudflare.com` and any hosts listed in `DEV_ALLOWED_HOSTS`.

- **Client-Side Token Storage in Discord Iframes**:
  - Discord Activities run inside third-party sandboxed iframes. Modern browsers partition or restrict third-party cookie access and local storage in cross-origin frames.
  - *Resolution*: The session token issued by our server is maintained purely in-memory on the client within `currentSession`. Every API request sends `Authorization: Bearer <token>`.

- **Entry Point Command (Primary Entry Point)**:
  - As described in Discord's Activity Entry Point documentation, Activity launches can occur via the Primary Entry Point command (Type 4) with activity launch handler (Handler 2). `/crossword` is registered as that Entry Point command (it replaces the default "Launch" command created when Activities are enabled). With handler 2, Discord launches the Activity itself and the app never receives the interaction; if the handler is switched to `APP_HANDLER` (1), the server answers with `LAUNCH_ACTIVITY` (type 12).

## 2. Architectural Choices

- **Monorepo Structure (`packages/client`, `packages/server`, `packages/shared`)**:
  - Pure crossword models, slot coordinate algorithms, 180-degree rotational symmetry validation, and scoring arithmetic are shared directly between frontend and backend via `@crossword/shared`. This guarantees zero drift between client calculations and server-authoritative scoring.

- **Server-Authoritative Timing & Wall Clock Model**:
  - Crosswords in Discord are competitive daily events. Any client-side timer is purely for UI display. The true timer begins on the server when `GET /api/puzzle/today` is first invoked by the user and continues on the server wall clock. Closing the browser or Discord does not stop or pause the timer.
  - Every attempt request (save, check word, reveal letter, submit) carries the ID of the puzzle the client loaded. When that puzzle is no longer live, the server answers `409` with `code: 'PUZZLE_CLOSED'`, and the client stops accepting input and offers to load the new puzzle. Without the ID, a request sent just after the daily release would have been applied to the new day's attempt.

- **Anti-Cheat Payload Sanitization**:
  - Under no circumstances are puzzle answers sent to the client during active gameplay. The `/api/puzzle/today` endpoint strips answer keys from clues and solution grids. Word checking and letter reveals are evaluated server-side. Solutions are only provided after the player completes the puzzle or the puzzle closes.

- **SQLite Database with Node's Built-in `node:sqlite`**:
  - Native modules such as `better-sqlite3` need `node-gyp` and a C++ toolchain, which some cloud and container environments lack. `node:sqlite` ships with Node.js (no flag needed from 22.13), so there's nothing to compile.
  - It opens the database file itself, in WAL mode with a busy timeout. The server and the CLI can use the same file at once, each write is committed through SQLite's journal, and a crash can't leave a half-written file. (The earlier `sql.js` engine kept the database in memory and rewrote the whole file on every write, so CLI changes made while the server ran were overwritten.)
  - Node marks the module as experimental and prints an `ExperimentalWarning` once at startup; that warning is expected.

- **Backtracking Constraint Solver with MRV & Quality Scoring**:
  - The puzzle filler uses Minimum Remaining Values (MRV) heuristic: at each step, it chooses the slot with the fewest remaining valid candidates in the dictionary.
  - Forward checking inspects crossing slots to prune branches that would leave an intersecting word without any possible completions.
  - A configurable time budget prevents server timeouts.

- **Offensive Blocklist & Word Filtering**:
  - All word candidate matches are verified against an offensive word blocklist to ensure content is suitable for all Discord server audiences.

- **Clues Are Never Placeholders**:
  - A generated puzzle is published only when the LLM supplied a usable clue for every entry. Failed or timed-out requests reject; entries whose clue is missing or gives the answer away (checked by whole word, so "Someone special" is fine for ONE) are requested once more, and a fill that still lacks any clue is discarded. When no generated puzzle is ready, a hand-clued fallback puzzle is published instead, chosen by date so consecutive days differ.

- **Themes Shape the Fill**:
  - The LLM is asked for theme entries whose lengths match the chosen template's long across slots. At least two must fit, or the puzzle is themeless; placed entries are fixed before the filler runs, so the title never promises a theme the grid doesn't have.

- **Generation Shares the Web Server's Thread**:
  - The backtracking filler yields to the event loop every 15 ms, and LLM requests time out, so puzzle generation can't stall API requests or the daily release.

- **Server Membership Verification**:
  - The Activity requests the `guilds.members.read` scope, and the server calls `GET /users/@me/guilds/{guild.id}/member` for the server the Activity was opened in. `GET /users/@me/guilds` returns at most 200 servers, so members of many servers could fail that check.

- **Daily Release Boundary**:
  - Puzzles release at `RELEASE_HOUR_UTC:RELEASE_MINUTE_UTC` (00:00 UTC by default) and run until the next release. The server checks every minute to publish the day's puzzle, close earlier puzzles, and post final leaderboards to configured channels. Buffer maintenance runs separately and keeps puzzles ready from tomorrow through `BUFFER_DAYS_AHEAD + BUFFER_TARGET_MIN - 1` days out (four dates by default), so slow generation never delays the release.

- **Optional Editorial Approval**:
  - Buffered puzzles publish on their date automatically. With `REQUIRE_PUZZLE_APPROVAL=true`, only puzzles approved with `cli approve` are published; an unapproved one is replaced by a fallback puzzle. A puzzle that players have attempts on is never replaced.
