import test from "node:test";
import assert from "node:assert/strict";
import { Readable } from "node:stream";
import { normalizeXStreamEvent, parseXStream, XFilteredStreamClient } from "../src/x-stream.js";

const payload = {
  data: {
    id: "1000000000000000001",
    author_id: "12345",
    text: "Testing @hq_fyi",
    created_at: "2026-05-31T00:35:57Z",
    referenced_tweets: [{ type: "replied_to", id: "1000000000000000000" }],
  },
  includes: {
    tweets: [
      {
        id: "1000000000000000000",
        author_id: "67890",
        text: "Original post",
        created_at: "2026-05-31T00:15:00Z",
      },
    ],
    users: [
      { id: "12345", username: "example_author" },
      { id: "67890", username: "original_author" },
    ],
  },
};

test("normalizes X stream payload into mention event", () => {
  const mention = normalizeXStreamEvent(payload);
  assert.equal(mention.id, "1000000000000000001");
  assert.equal(mention.authorHandle, "example_author");
  assert.equal(mention.url, "https://x.com/example_author/status/1000000000000000001");
  assert.equal(mention.originalPost.id, "1000000000000000000");
  assert.equal(mention.originalPost.authorHandle, "original_author");
  assert.equal(mention.originalPost.url, "https://x.com/original_author/status/1000000000000000000");
});

test("parses newline-delimited stream events", async () => {
  const lines = Readable.from([`${JSON.stringify(payload)}\n\n`]);
  const mentions = [];
  for await (const mention of parseXStream(lines)) mentions.push(mention);
  assert.equal(mentions.length, 1);
  assert.equal(mentions[0].authorHandle, "example_author");
});

test("reconnects after transient stream error", async () => {
  let calls = 0;
  const received = [];
  const client = new XFilteredStreamClient({
    bearerToken: "redacted",
    streamUrl: "https://x.test/stream",
    retry: { baseMs: 0, maxMs: 0, jitterRatio: 0 },
    fetchImpl: async () => {
      calls += 1;
      if (calls === 1) return { ok: false, status: 503 };
      return {
        ok: true,
        status: 200,
        body: Readable.from([`${JSON.stringify(payload)}\n`]),
      };
    },
  });

  const controller = new AbortController();
  await client.run(
    async (mention) => {
      received.push(mention);
      controller.abort(new Error("done"));
    },
    { signal: controller.signal },
  ).catch((error) => {
    if (error.message !== "done") throw error;
  });

  assert.equal(calls, 2);
  assert.equal(received.length, 1);
});
