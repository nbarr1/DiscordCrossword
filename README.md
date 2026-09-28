# Discord daily crossword activity

A Discord Activity where server members solve a daily crossword (12x12, set by `GAME_CONFIG` in `packages/shared/src/config.ts`) on their own schedule. Server rankings track each solver's time, incorrect answers add time penalties, and a companion bot posts daily leaderboards to a configured channel.

---

## Features

- **Daily 12x12 crossword**: Follows professional crossword specifications (180-degree rotational symmetry, fully connected white squares, no two-letter words).
- **Discord Embedded App SDK**: Runs inside the Discord client with OAuth identity and server membership verification.
- **Server-authoritative wall-clock timer**: The clock starts when the player opens the puzzle and runs continuously on wall-clock time.
- **Competitive game rules** (penalties are set in `GAME_CONFIG`):
  - **Check Word**: Available when the active entry is full. If correct, its cells lock. If incorrect, adds a 30-second penalty (each distinct wrong guess is penalized once).
  - **Reveal Letter**: Fills the selected square with the correct letter for a 60-second penalty.
  - **Submitting**: When the last empty square is filled, the grid is checked automatically. If it's wrong, 30 seconds are added; the player fixes the errors and presses **Submit** to check again.
- **Companion bot and slash commands**:
  - `/crossword-setup channel:<channel> [announcements:<bool>]`: Sets the leaderboard channel (requires the *Manage Server* permission).
  - `/crossword-leaderboard`: Spoiler-free server standings, visible only to the person who asked.
  - `/crossword`: The app's Entry Point command (App Launcher). It replaces Discord's default "Launch" command, and Discord launches the Activity directly.
- **Scheduled releases**: A new puzzle goes live every day at `RELEASE_HOUR_UTC:RELEASE_MINUTE_UTC` (00:00 UTC by default). The server posts the closing leaderboards and keeps puzzles generated four days ahead with an LLM-assisted constructor.
- **Fallback puzzles**: Without a Gemini API key, or when generation fails, the server publishes one of seven hand-clued puzzles, choosing a different one each day.
- **CLI**: Generate, preview, approve, and reject puzzles.

---

## Word list license and source

The generator's dictionary is `packages/server/data/xwordlist.txt`, derived from the [Collaborative Word List](https://github.com/Crossword-Nexus/collaborative-word-list) by Crossword Nexus (MIT License). It keeps A-Z entries of 3-15 letters that score 50 or more (about 230,000 words, with offensive entries removed). Attribution, the license text, and refresh instructions are in `packages/server/data/WORDLIST_LICENSE.md`. The loader also rejects offensive words, including profanity inside multi-word phrases.

---

## Requirements

Node.js 22.13 or later. The server stores data with Node's built-in `node:sqlite` module, which needs no flag from 22.13 on. Node marks that module as experimental and prints an `ExperimentalWarning` once at startup; the warning is expected.

---

## Environment variables

To configure the server, create a `.env` file based on `.env.example`. The following variables are supported:

| Variable | Description | Required |
| :--- | :--- | :--- |
| `VITE_DISCORD_CLIENT_ID` | Application ID (General Information page) | Yes, for Discord sign-in |
| `DISCORD_CLIENT_SECRET` | OAuth2 client secret | Yes, for Discord sign-in |
| `DISCORD_BOT_TOKEN` | Bot token, for channel posts and command registration | Yes, for bot features |
| `DISCORD_PUBLIC_KEY` | Public key, for verifying HTTP interactions | Yes, for slash commands |
| `GEMINI_API_KEY` | Google Gemini API key, for generated puzzles | Optional; fallback puzzles are used without it |
| `GEMINI_MODEL` | Gemini model (defaults to `gemini-3.8-flash`) | Optional |
| `REQUIRE_PUZZLE_APPROVAL` | `true` to publish only puzzles approved with the CLI | Optional (defaults to `false`) |
| `PORT` | Web server port (defaults to 3000) | Optional |
| `DATABASE_PATH` | Path to the SQLite database file (defaults to `crossword.db`) | Optional |
| `DEV_ALLOWED_HOSTS` | Extra hostnames the development server accepts, comma-separated | Optional |

> Without Discord credentials, and outside production, the app runs in a development mode with a mock sign-in, so you can play in a normal browser at `http://localhost:3000`.

---

## Discord Developer Portal setup

To set up the app, enter these values in the [Discord Developer Portal](https://discord.com/developers/applications). Replace `<host>` with your public hostname: a tunnel hostname while testing, or your own domain in production.

| Page | Setting | Value |
| :--- | :--- | :--- |
| General Information | Application ID, Public Key | Copy into `VITE_DISCORD_CLIENT_ID` and `DISCORD_PUBLIC_KEY` |
| General Information | Interactions Endpoint URL | `https://<host>/api/interactions` (save it while the server is running with `DISCORD_PUBLIC_KEY` set; Discord tests the URL when you save it) |
| OAuth2 | Client Secret | Copy into `DISCORD_CLIENT_SECRET` |
| OAuth2 | Redirects | `https://127.0.0.1` (a required placeholder; the Embedded App SDK handles the redirect) |
| Bot | Token | Copy into `DISCORD_BOT_TOKEN` |
| Bot | Privileged Gateway Intents | Leave off; the app uses HTTP interactions only |
| Installation | Installation Contexts | User Install and Guild Install |
| Installation | Guild Install scopes and permissions | `applications.commands` and `bot`; Send Messages, Embed Links, and View Channels |
| Installation | User Install scopes | `applications.commands` |
| Activities → Settings | Enable Activities | On, with the platforms you want under Supported Platforms |
| Activities → URL Mappings | Prefix `/` | Target `<host>`, without `https://`. No other mappings are needed. |

The Activity requests the `identify` and `guilds.members.read` scopes when it starts. The server uses `guilds.members.read` to confirm that the player belongs to the server the Activity was opened in; neither scope needs Discord's approval.

To test inside Discord, follow these steps:

1. In Discord, turn on Developer Mode (User Settings → Advanced).
2. Start the server with `npm run dev`. The game and its API both run on port 3000.
3. Start a tunnel with `cloudflared tunnel --url http://localhost:3000`. The development server accepts `*.trycloudflare.com` hostnames; for other tunnels, add the hostname to `DEV_ALLOWED_HOSTS`.
4. Put the tunnel hostname in the URL mapping and the Interactions Endpoint URL. Quick tunnel hostnames change each time the tunnel starts, so update both each time.
5. Install the app in your test server with the install link from the Installation page.
6. Restart the server if you added the bot token after it started; commands register at startup, and the log shows `[DiscordBot] Registered slash commands successfully.`
7. Open the Activity from the App Launcher, then run `/crossword-setup channel:#your-channel` to choose where leaderboards are posted.

Only you and members of your developer team can open the Activity until it's distributed, so add other testers to a team in the Developer Portal.

---

## Running locally

To run the app on your computer, follow these steps:

1. Install dependencies:
   ```bash
   npm install
   ```
2. Start the development server:
   ```bash
   npm run dev
   ```
   Open `http://localhost:3000` to play.
3. Run the type check and tests:
   ```bash
   npm run lint
   npm test
   ```

### CLI commands

The CLI works on the same database as the server, including while the server is running. Arguments go after `--`, so that npm passes them to the CLI.

```bash
# Generate a puzzle for a date (defaults to today) and add it to the buffer
npm run cli -- generate --date 2026-09-25 --theme "space travel"

# Write an HTML preview, with answers, of the newest puzzle or a given one
npm run cli -- preview [puzzleId] --out preview.html

# List buffered puzzles and their approval status
npm run cli -- buffer

# Approve a buffered puzzle (needed only when REQUIRE_PUZZLE_APPROVAL=true)
npm run cli -- approve <puzzleId>

# Reject a buffered puzzle; the server generates a replacement for its date
npm run cli -- reject <puzzleId>
```

Buffered puzzles publish on their date automatically. With `REQUIRE_PUZZLE_APPROVAL=true`, a puzzle that wasn't approved by its release time is replaced with a fallback puzzle. Published puzzles can't be rejected or replaced, because players may already have attempts on them.

---

## Production build and deployment

```bash
npm run build
npm start
```

`npm start` sets `NODE_ENV=production` (on POSIX shells; on Windows, set it yourself), so the server serves the production bundle from `dist/` on port 3000 and turns off the development mock sign-in. Set `VITE_DISCORD_CLIENT_ID` before `npm run build`, because the build compiles it into the client. Serve the app over HTTPS on a domain you own, and point the `/` URL mapping and the Interactions Endpoint URL at that domain.
