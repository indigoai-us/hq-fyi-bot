import test from "node:test";
import assert from "node:assert/strict";
import { formatSlackMessage, SlackWebhookClient } from "../src/slack.js";

const mention = {
  id: "1000000000000000001",
  authorHandle: "example_author",
  text: "Testing @hq_fyi",
  createdAt: "2026-05-31T00:35:57Z",
  url: "https://x.com/example_author/status/1000000000000000001",
  originalPost: {
    id: "1000000000000000000",
    authorHandle: "original_author",
    text: "This is the original post content.",
    url: "https://x.com/original_author/status/1000000000000000000",
  },
};

test("formats Slack message with required mention fields", () => {
  const message = formatSlackMessage(mention);
  const serialized = JSON.stringify(message);
  assert.match(serialized, /example_author/);
  assert.match(serialized, /Testing @hq_fyi/);
  assert.match(serialized, /1000000000000000001/);
  assert.match(serialized, /2026-05-31T00:35:57Z/);
  assert.match(serialized, /https:\/\/x.com\/example_author\/status\/1000000000000000001/);
  assert.match(serialized, /Original post/);
  assert.match(serialized, /This is the original post content\./);
  assert.match(serialized, /https:\/\/x.com\/original_author\/status\/1000000000000000000/);
});

test("retries retryable Slack failures", async () => {
  const statuses = [500, 200];
  const calls = [];
  const client = new SlackWebhookClient({
    webhookUrl: "https://hooks.slack.test/services/redacted",
    retry: { retries: 2, baseMs: 0, maxMs: 0, jitterRatio: 0 },
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      const status = statuses.shift();
      return {
        ok: status === 200,
        status,
        text: async () => "temporary failure",
      };
    },
  });

  const result = await client.deliver(mention);
  assert.equal(result.ok, true);
  assert.equal(calls.length, 2);
});

test("dry-run delivery does not call Slack", async () => {
  const client = new SlackWebhookClient({
    dryRun: true,
    fetchImpl: async () => assert.fail("fetch should not be called"),
  });
  const result = await client.deliver(mention);
  assert.equal(result.dryRun, true);
  assert.equal(result.message.text.includes("example_author"), true);
});
