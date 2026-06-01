#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig, assertRuntimeConfig } from "./config.js";
import { HealthMonitor } from "./health.js";
import { JsonDedupeStore } from "./store.js";
import { SlackWebhookClient } from "./slack.js";
import { MentionBridge } from "./bridge.js";
import { normalizeXStreamEvent, XFilteredStreamClient, XRecentSearchClient } from "./x-stream.js";

function buildRuntime({ env = process.env, fetchImpl = globalThis.fetch } = {}) {
  const config = loadConfig(env);
  const health = new HealthMonitor(config.health);
  const dedupeStore = new JsonDedupeStore(config.dedupe.path);
  const slackClient = new SlackWebhookClient({
    webhookUrl: config.slack.webhookUrl,
    dryRun: config.slack.dryRun,
    fetchImpl,
    retry: config.retry,
    health,
  });
  const bridge = new MentionBridge({
    allowlist: config.allowlist,
    dedupeStore,
    slackClient,
    health,
    deadLetterPath: config.deadLetter.path,
  });
  return { config, health, bridge };
}

async function run() {
  const { config, health, bridge } = buildRuntime();
  assertRuntimeConfig(config);
  await health.load();
  console.error(
    `[bridge] starting X filtered stream for @${config.x.targetHandle}; rule="${config.x.ruleValue}"; Slack #${config.slack.channelName}; dryRun=${config.slack.dryRun}`,
  );
  console.error("[bridge] waiting for future matching X posts; existing posts are not backfilled");
  const client = new XFilteredStreamClient({
    bearerToken: config.x.bearerToken,
    streamUrl: config.x.streamUrl,
    retry: config.retry,
    health,
  });

  const controller = new AbortController();
  process.on("SIGINT", () => controller.abort(new Error("SIGINT")));
  process.on("SIGTERM", () => controller.abort(new Error("SIGTERM")));
  try {
    await client.run(
      async (mention) => {
        const result = await bridge.processMention(mention);
        console.error(`[bridge] ${result.status}: ${result.id}`);
      },
      {
        signal: controller.signal,
      },
    );
  } finally {
    await health.markStreamDisconnected();
  }
}

async function processFixture(path) {
  const stateDir = await mkdtemp(join(tmpdir(), "hq-fyi-bot-fixture-"));
  const { health, bridge } = buildRuntime({
    env: {
      ...process.env,
      SLACK_DRY_RUN: process.env.SLACK_DRY_RUN ?? "1",
      HQ_X_ALLOWED_AUTHORS: process.env.HQ_X_ALLOWED_AUTHORS ?? "example_author",
      DEDUPE_STORE_PATH: process.env.DEDUPE_STORE_PATH ?? join(stateDir, "dedupe.json"),
      DEAD_LETTER_PATH: process.env.DEAD_LETTER_PATH ?? join(stateDir, "dead-letter.jsonl"),
      HEALTH_STATE_PATH: process.env.HEALTH_STATE_PATH ?? join(stateDir, "health.json"),
    },
  });
  try {
    await health.load();
    const payload = JSON.parse(await readFile(path, "utf8"));
    const mention = normalizeXStreamEvent(payload);
    if (!mention) throw new Error("Fixture did not contain a valid X stream event");
    const result = await bridge.processMention(mention);
    console.log(JSON.stringify(result, null, 2));
  } finally {
    await rm(stateDir, { recursive: true, force: true });
  }
}

async function backfillOnce() {
  const { config, health, bridge } = buildRuntime();
  assertRuntimeConfig(config);
  await health.load();
  const client = new XRecentSearchClient({
    bearerToken: config.x.bearerToken,
    recentSearchUrl: config.x.recentSearchUrl,
    query: config.x.ruleValue,
  });
  const mentions = await client.search({ maxResults: 10 });
  console.error(`[bridge] recent search returned ${mentions.length} matching mention(s)`);
  if (mentions.length === 0) {
    console.log(JSON.stringify({ status: "none" }, null, 2));
    return;
  }

  mentions.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
  for (const mention of mentions) {
    const result = await bridge.processMention(mention);
    console.error(`[bridge] ${result.status}: ${result.id}`);
    if (result.status === "delivered") {
      console.log(JSON.stringify(result, null, 2));
      return;
    }
  }
  console.log(JSON.stringify({ status: "no-new-mentions", checked: mentions.length }, null, 2));
}

async function health() {
  const config = loadConfig();
  const monitor = new HealthMonitor(config.health);
  await monitor.load();
  console.log(JSON.stringify(monitor.snapshot(), null, 2));
}

const command = process.argv[2];
try {
  if (command === "run") await run();
  else if (command === "backfill-once") await backfillOnce();
  else if (command === "process-fixture") await processFixture(process.argv[3]);
  else if (command === "health") await health();
  else {
    console.error("Usage: node src/cli.js <run|backfill-once|process-fixture|health>");
    process.exitCode = 2;
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
