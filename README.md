# hq-fyi-bot

Dependency-free Node 20 bot that watches an X filtered stream for mentions of a
target handle and relays allowlisted posts to a Slack incoming webhook.

The bot is built for small trusted workflows: it keeps a local dedupe store,
writes dead-letter records when Slack delivery fails, exposes a JSON health
snapshot, and suppresses posts from authors outside your configured allowlist.

## Prerequisites

- Node.js 20 or newer.
- An X API bearer token with access to filtered stream and recent search.
- A Slack incoming webhook URL for the destination channel.
- A persistent directory for `.data/` when running outside local development.

No token or webhook value belongs in git, logs, issues, PRs, or chat. Use your
secret manager in production.

## Getting Started

### 1. Clone and verify the project

```bash
git clone https://github.com/indigoai-us/hq-fyi-bot.git
cd hq-fyi-bot
npm test
```

The project has no runtime npm dependencies. The test command uses Node's
built-in test runner and should pass before you add real credentials.

### 2. Create provider credentials

Create these outside the repo:

- X API bearer token with access to filtered stream and recent search.
- Slack incoming webhook URL for the channel that should receive mentions.

Keep both values in a password manager, deployment secret store, or your shell
environment. Do not paste real credentials into `.env.example`, issues, PRs, or
logs.

### 3. Configure local environment

Copy the example file and edit the copy:

```bash
cp .env.example .env
```

Set at least these values:

```bash
X_BEARER_TOKEN=...
SLACK_WEBHOOK_URL=...
HQ_X_TARGET_HANDLE=hq_fyi
HQ_X_ALLOWED_AUTHORS=example_author,another_author
HQ_X_RULE_VALUE='@hq_fyi -is:retweet'
SLACK_DRY_RUN=1
```

The app intentionally does not load `.env` files by itself. Export the file into
your shell before running commands:

```bash
set -a
source .env
set +a
```

### 4. Run a dry-run smoke test

The fixture smoke test formats a Slack message and exercises the dedupe path
without posting to Slack:

```bash
npm run smoke:fixture
```

You should see a JSON result with `"status": "delivered"` and `"dryRun": true`.

### 5. Create the X stream rule

Create or update your X filtered stream rule so the API sends matching posts to
the stream. If you already manage rules elsewhere, keep `HQ_X_RULE_VALUE`
aligned with that rule.

```bash
curl -X POST "https://api.x.com/2/tweets/search/stream/rules" \
  -H "Authorization: Bearer $X_BEARER_TOKEN" \
  -H "Content-Type: application/json" \
  --data "$(node -e 'console.log(JSON.stringify({ add: [{ value: process.env.HQ_X_RULE_VALUE, tag: "hq-fyi-bot" }] }))')"
```

To inspect existing rules:

```bash
curl "https://api.x.com/2/tweets/search/stream/rules" \
  -H "Authorization: Bearer $X_BEARER_TOKEN"
```

### 6. Start the bot

Keep `SLACK_DRY_RUN=1` for the first live stream test if you only want logs and
local state writes. Set it to `0` when you are ready to post to Slack:

```bash
SLACK_DRY_RUN=0 npm start
```

The bot now waits for future matching X events. It does not backfill posts that
already existed before startup.

### 7. Check health and backfill one mention

Read the local health snapshot:

```bash
npm run health
```

If a valid mention was posted before the stream consumer was running, process
one recent-search result with the same rule:

```bash
npm run backfill
```

## Configuration

| Environment variable | Required | Description |
| --- | --- | --- |
| `X_BEARER_TOKEN` | yes | X API bearer token. |
| `SLACK_WEBHOOK_URL` | yes unless dry-run | Slack incoming webhook URL. |
| `HQ_X_ALLOWED_AUTHORS` | yes | Comma-separated X handles allowed to trigger Slack delivery. `@` prefixes are optional. |
| `HQ_X_TARGET_HANDLE` | no | Mentioned handle to watch. Defaults to `hq_fyi`. |
| `HQ_X_RULE_VALUE` | no | X filtered stream/recent search query. Defaults to `@<target> -is:retweet`. |
| `SLACK_CHANNEL_NAME` | no | Channel name used in startup logs. Defaults to `hq-fyi`. |
| `SLACK_DRY_RUN` | no | Set to `1` to format messages without posting to Slack. |
| `DEDUPE_STORE_PATH` | no | Processed mention id store. Defaults to `.data/processed-mentions.json`. |
| `DEAD_LETTER_PATH` | no | JSONL delivery failure log. Defaults to `.data/dead-letter.jsonl`. |
| `HEALTH_STATE_PATH` | no | Health snapshot path. Defaults to `.data/health.json`. |

The X stream rule can be broad, but the application allowlist is mandatory
defense in depth. For low-volume bots, `@hq_fyi -is:retweet` is usually enough.
For stricter upstream filtering, use a custom `HQ_X_RULE_VALUE`, such as a rule
that also includes `from:` terms for known authors.

## Commands

```bash
npm test
npm run smoke:fixture
npm start
npm run backfill
npm run health
```

`npm start` listens for future matching X events. It does not backfill existing
posts. `npm run backfill` runs one recent-search pass with the same query and
delivers the newest undelivered allowlisted mention.

## Production Notes

- Run under a process manager such as systemd, launchd, Docker, Fly.io, or a
  supervised VM service.
- Mount `.data/` on persistent storage so restarts do not resend old mentions.
- Set `SLACK_DRY_RUN=0` only after `npm run smoke:fixture` passes.
- Rotate X and Slack credentials through your secret manager, then restart the
  process.
- Keep the X filtered stream rule and `HQ_X_ALLOWED_AUTHORS` reviewed together.

## Runtime Internals

- `src/x-stream.js` opens and parses the X filtered stream and recent search.
- `src/bridge.js` enforces the allowlist and dedupe before Slack delivery.
- `src/slack.js` formats and sends Slack webhook messages with retry/backoff.
- `src/store.js` persists processed mention ids and dead-letter failures.
- `src/health.js` records stream state, deliveries, retries, and failures
  without secret values.
- `src/cli.js` exposes `run`, `process-fixture`, `backfill-once`, and `health`.

## License

MIT
