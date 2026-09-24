# Discord Daily Crossword Activity

A full-featured Discord Activity where server members solve a daily crossword (12x12, set by `GAME_CONFIG` in `packages/shared/src/config.ts`) on their own schedule. Server rankings track each solver's time, incorrect answers add time penalties, and a companion bot posts daily leaderboards to a configured channel.

---

## Features

- **Daily 12x12 Crossword**: Follows professional crossword specifications (180-degree rotational symmetry, fully connected white squares, no two-letter words).
- **Discord Embedded App SDK**: Embedded inside the Discord client with OAuth identity and guild verification.
- **Server-Authoritative Wall-Clock Timer**: The clock starts when the player opens the puzzle and runs continuously on wall clock time.
- **Competitive Game Rules**:
  - **Check Word**: Available when active entry is full. If correct, locks cells. If incorrect, adds a 30-second penalty (distinct incorrect guesses penalized once).
  - **Reveal Letter**: Fills a single cell with the correct letter for a 60-second penalty.
  - **Automatic Submission**: As soon as every square is filled, validates immediately. If incorrect, adds 30 seconds.
- **Companion Bot & Slash Commands**:
  - `/crossword-setup channel:<channel> [announcements:<bool>]`: Configures the leaderboard channel (requires *Manage Server* permission).
  - `/crossword-leaderboard`: Ephemeral spoiler-free server standings.
  - `/crossword`: The app's Entry Point command (App Launcher). It replaces Discord's default "Launch" command, and Discord launches the Activity directly.
- **Automatic Scheduled Releases**: Advances every day at 00:00 UTC, posts closing leaderboards, and buffers puzzles 2–7 days ahead using an LLM-assisted constructor.
- **CLI Suite**: Tooling to generate, preview in browser, and approve/reject puzzles.

---

## Word list license and source

The generator's dictionary is `packages/server/data/xwordlist.txt`, derived from the [Collaborative Word List](https://github.com/Crossword-Nexus/collaborative-word-list) by Crossword Nexus (MIT License). It keeps A-Z entries of 3-15 letters that score 50 or more (about 230,000 words, with offensive entries removed). Attribution, the license text, and refresh instructions are in `packages/server/data/WORDLIST_LICENSE.md`. The loader also rejects offensive words, including profanity inside multi-word phrases.

---

## Environment Variables

Create a `.env` file based on `.env.example`:

| Variable | Description | Required |
| :--- | :--- | :--- |
| `VITE_DISCORD_CLIENT_ID` | Discord Application Client ID | Yes (for Discord auth) |
| `DISCORD_CLIENT_SECRET` | Discord Application Client Secret | Yes (for OAuth token exchange) |
| `DISCORD_BOT_TOKEN` | Discord Bot Token (for channel posts & command registration) | Yes (for Bot features) |
| `DISCORD_PUBLIC_KEY` | Discord ed25519 public key (for verifying HTTP interactions) | Yes (for Slash commands) |
| `GEMINI_API_KEY` | Google Gemini API Key (for LLM clue generation & themes) | Optional (fallbacks provided) |
| `GEMINI_MODEL` | Gemini Model (defaults to `gemini-3.8-flash`) | Optional |
| `PORT` | Web server port (defaults to 3000) | Optional |
| `DATABASE_PATH` | Path to SQLite database file (defaults to `crossword.db`) | Optional |

> In browser standalone preview mode without Discord credentials, the application automatically runs in an interactive development mode with mock sessions so gameplay can be previewed immediately.

---

## Discord Bot Setup & Permissions

1. Go to the [Discord Developer Portal](https://discord.com/developers/applications).
2. Create an Application, copy your **Client ID**, **Client Secret**, and **Public Key**.
3. Under **Bot**, create a bot user and copy the **Bot Token**.
   - Under **OAuth2 > Redirects**, add the placeholder `https://127.0.0.1`. Discord requires a redirect URI, and the Embedded App SDK handles the redirect inside the Activity.
4. On the **General Information** page, set **Interactions Endpoint URL** to `https://<YOUR_APP_URL>/api/interactions`. The server must be running with `DISCORD_PUBLIC_KEY` set, because Discord verifies the endpoint when you save it.
5. Under **Activities**:
   - Enable Activities (Settings), and select the platforms you want under **Supported Platforms**.
   - Under **URL Mappings**, map the `/` prefix to your app's host (without `https://`).
6. Bot Permissions required:
   - `Send Messages` (0x800)
   - `Embed Links` (0x4000)
   - `Use External Emojis` (optional)
7. Invite the Bot to your test server with `applications.commands` and `bot` scopes.

---

## Running Locally

### 1. Install Dependencies
```bash
npm install
```

### 2. Start Full-Stack Dev Server
```bash
npm run dev
```
Open `http://localhost:3000` to interact with the crossword.

### 3. Run Tests
```bash
npm run test
```

### 4. CLI Commands
```bash
# Generate a new puzzle
npm run cli generate --date 2026-09-25

# Generate HTML preview of latest puzzle
npm run cli preview

# View buffered puzzles
npm run cli buffer

# Approve a buffered puzzle for publication
npm run cli approve <puzzleId>
```

---

## Production Build & Deployment

```bash
npm run build
npm start
```
`npm start` sets `NODE_ENV=production` (POSIX shells; on Windows, set it yourself), so the server serves the Vite production bundle from `dist/` on port 3000 and disables the development mock login. `VITE_DISCORD_CLIENT_ID` must be set when you run `npm run build`, because Vite compiles it into the client.
