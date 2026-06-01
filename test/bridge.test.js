import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MentionBridge } from "../src/bridge.js";
import { JsonDedupeStore } from "../src/store.js";
import { HealthMonitor } from "../src/health.js";

function mention(overrides = {}) {
  return {
    id: "m-1",
    authorHandle: "example_author",
    text: "hello @hq_fyi",
    url: "https://x.com/example_author/status/m-1",
    createdAt: "2026-05-31T00:35:57Z",
    ...overrides,
  };
}

async function makeBridge({ deliver, allowlist = ["example_author"] } = {}) {
  const dir = await mkdtemp(join(tmpdir(), "hq-fyi-bot-"));
  const health = new HealthMonitor({
    path: join(dir, "health.json"),
    unhealthyAfterMs: 60_000,
  });
  const bridge = new MentionBridge({
    allowlist,
    dedupeStore: new JsonDedupeStore(join(dir, "dedupe.json")),
    slackClient: { deliver: deliver ?? (async () => ({ ok: true })) },
    health,
    deadLetterPath: join(dir, "dead-letter.jsonl"),
  });
  return { dir, bridge };
}

test("delivers an allowlisted mention once", async () => {
  const calls = [];
  const { dir, bridge } = await makeBridge({ deliver: async (item) => calls.push(item) });
  try {
    assert.equal((await bridge.processMention(mention())).status, "delivered");
    assert.equal((await bridge.processMention(mention())).status, "duplicate");
    assert.equal(calls.length, 1);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("dedupe survives a store reload", async () => {
  const { dir, bridge } = await makeBridge();
  try {
    await bridge.processMention(mention());
    const secondBridge = new MentionBridge({
      allowlist: ["example_author"],
      dedupeStore: new JsonDedupeStore(join(dir, "dedupe.json")),
      slackClient: { deliver: async () => assert.fail("should not deliver duplicate") },
      health: new HealthMonitor({ path: join(dir, "health-2.json"), unhealthyAfterMs: 60_000 }),
      deadLetterPath: join(dir, "dead-letter.jsonl"),
    });
    assert.equal((await secondBridge.processMention(mention())).status, "duplicate");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("suppresses non-allowlisted authors", async () => {
  const { dir, bridge } = await makeBridge();
  try {
    const result = await bridge.processMention(mention({ authorHandle: "not_allowed" }));
    assert.equal(result.status, "filtered");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("records dead letters after delivery failure", async () => {
  const { dir, bridge } = await makeBridge({
    deliver: async () => {
      throw new Error("slack unavailable");
    },
  });
  try {
    await assert.rejects(() => bridge.processMention(mention()), /slack unavailable/);
    const deadLetter = await readFile(join(dir, "dead-letter.jsonl"), "utf8");
    assert.match(deadLetter, /m-1/);
    assert.match(deadLetter, /slack unavailable/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
