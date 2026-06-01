const DEFAULT_TARGET_HANDLE = "hq_fyi";
const DEFAULT_TWEET_FIELDS = "created_at,author_id,conversation_id,referenced_tweets,in_reply_to_user_id";
const DEFAULT_EXPANSIONS = "author_id,referenced_tweets.id,referenced_tweets.id.author_id";
const DEFAULT_USER_FIELDS = "username,name";

function csv(value) {
  return String(value ?? "")
    .split(",")
    .map((item) => item.trim().replace(/^@/, "").toLowerCase())
    .filter(Boolean);
}

function bool(value, fallback = false) {
  if (value == null || value === "") return fallback;
  return ["1", "true", "yes", "on"].includes(String(value).toLowerCase());
}

function defaultRuleValue(targetHandle) {
  return `@${targetHandle} -is:retweet`;
}

export function loadConfig(env = process.env) {
  const allowlist = csv(env.HQ_X_ALLOWED_AUTHORS || env.ALLOWED_AUTHORS || "");
  const targetHandle = String(env.HQ_X_TARGET_HANDLE || env.TARGET_HANDLE || DEFAULT_TARGET_HANDLE)
    .replace(/^@/, "")
    .toLowerCase();
  const ruleValue = env.HQ_X_RULE_VALUE || env.X_RULE_VALUE || defaultRuleValue(targetHandle);

  return {
    mode: env.NODE_ENV || "production",
    x: {
      bearerToken:
        env.X_BEARER_TOKEN ||
        env.HQ_FYI_BEARER_TOKEN ||
        "",
      targetHandle,
      targetUserId: env.HQ_X_TARGET_USER_ID || env.X_TARGET_USER_ID || "",
      ruleValue,
      ruleId: env.HQ_X_RULE_ID || env.X_RULE_ID || "",
      streamUrl:
        env.HQ_X_STREAM_URL ||
        `https://api.x.com/2/tweets/search/stream?tweet.fields=${DEFAULT_TWEET_FIELDS}&expansions=${DEFAULT_EXPANSIONS}&user.fields=${DEFAULT_USER_FIELDS}`,
      recentSearchUrl:
        env.HQ_X_RECENT_SEARCH_URL ||
        `https://api.x.com/2/tweets/search/recent?tweet.fields=${DEFAULT_TWEET_FIELDS}&expansions=${DEFAULT_EXPANSIONS}&user.fields=${DEFAULT_USER_FIELDS}`,
    },
    slack: {
      webhookUrl:
        env.SLACK_WEBHOOK_URL ||
        env.HQ_FYI_WEBHOOK_URL ||
        "",
      channelId: env.SLACK_CHANNEL_ID || "",
      channelName: env.SLACK_CHANNEL_NAME || "hq-fyi",
      dryRun: bool(env.SLACK_DRY_RUN, false),
    },
    allowlist,
    dedupe: {
      path: env.DEDUPE_STORE_PATH || ".data/processed-mentions.json",
    },
    deadLetter: {
      path: env.DEAD_LETTER_PATH || ".data/dead-letter.jsonl",
    },
    health: {
      path: env.HEALTH_STATE_PATH || ".data/health.json",
      unhealthyAfterMs: Number(env.UNHEALTHY_AFTER_MS || 120_000),
    },
    retry: {
      retries: Number(env.RETRY_ATTEMPTS || 3),
      baseMs: Number(env.RETRY_BASE_MS || 1_000),
      maxMs: Number(env.RETRY_MAX_MS || 30_000),
    },
  };
}

export function assertRuntimeConfig(config) {
  const missing = [];
  if (!config.x.bearerToken) missing.push("X_BEARER_TOKEN or HQ_FYI_BEARER_TOKEN");
  if (!config.slack.webhookUrl && !config.slack.dryRun) {
    missing.push("SLACK_WEBHOOK_URL or HQ_FYI_WEBHOOK_URL");
  }
  if (config.allowlist.length === 0) missing.push("HQ_X_ALLOWED_AUTHORS or ALLOWED_AUTHORS");
  if (missing.length > 0) {
    throw new Error(`Missing required runtime configuration: ${missing.join(", ")}`);
  }
}
