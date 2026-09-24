# Technical Decisions & Discord Platform Notes

## 1. Discrepancies with Discord Documentation

- **Client ID Environment Variable Name**:
  - *Discord Tutorial Issue*: Step 2 in Discord's "Building Your First Activity" tutorial saves the client ID as `VITE_CLIENT_ID`, but every code sample throughout the guide and template reads `import.meta.env.VITE_DISCORD_CLIENT_ID`.
  - *Resolution*: We adopted `VITE_DISCORD_CLIENT_ID` consistently across client and server environments, with fallback compatibility for `DISCORD_CLIENT_ID`.

- **Client-Side Token Storage in Discord Iframes**:
  - Discord Activities run inside third-party sandboxed iframes. Modern browsers partition or restrict third-party cookie access and local storage in cross-origin frames.
  - *Resolution*: The session token issued by our server is maintained purely in-memory on the client within `currentSession`. Every API request sends `Authorization: Bearer <token>`.

- **Entry Point Command (Primary Entry Point)**:
  - As described in Discord's Activity Entry Point documentation, Activity launches can occur via the Primary Entry Point command (Type 4) with activity launch handler (Handler 2). We configure both the Primary Entry Point command and a slash command fallback (`/crossword`).

## 2. Architectural Choices

- **Monorepo Structure (`packages/client`, `packages/server`, `packages/shared`)**:
  - Pure crossword models, slot coordinate algorithms, 180-degree rotational symmetry validation, and scoring arithmetic are shared directly between frontend and backend via `@crossword/shared`. This guarantees zero drift between client calculations and server-authoritative scoring.

- **Server-Authoritative Timing & Wall Clock Model**:
  - Crosswords in Discord are competitive daily events. Any client-side timer is purely for UI display. The true timer begins on the server when `GET /api/puzzle/today` is first invoked by the user and continues on the server wall clock. Closing the browser or Discord does not stop or pause the timer.

- **Anti-Cheat Payload Sanitization**:
  - Under no circumstances are puzzle answers sent to the client during active gameplay. The `/api/puzzle/today` endpoint strips answer keys from clues and solution grids. Word checking and letter reveals are evaluated server-side. Solutions are only provided after the player completes the puzzle or the puzzle closes.

- **SQLite Database with sql.js Engine**:
  - In cloud/container environments where native C++ compilation (`node-gyp` for `better-sqlite3`) may fail due to platform toolchain differences, `sql.js` (WebAssembly SQLite) provides 100% compliant SQL with robust file persistence and zero native compile dependencies.

- **Backtracking Constraint Solver with MRV & Quality Scoring**:
  - The puzzle filler uses Minimum Remaining Values (MRV) heuristic: at each step, it chooses the slot with the fewest remaining valid candidates in the dictionary.
  - Forward checking inspects crossing slots to prune branches that would leave an intersecting word without any possible completions.
  - A configurable time budget prevents server timeouts.

- **Offensive Blocklist & Word Filtering**:
  - All word candidate matches are verified against an offensive word blocklist to ensure content is suitable for all Discord server audiences.

- **Daily Release Boundary**:
  - Puzzles release at 00:00 UTC and run for 24 hours. The server runs an internal cron timer to advance the daily puzzle, close the previous day's rankings, post final leaderboards to configured channels, and maintain the 3–7 puzzle buffer ahead of time.
