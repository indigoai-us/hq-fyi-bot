import test from "node:test";
import assert from "node:assert/strict";
import { XRecentSearchClient } from "../src/x-stream.js";

test("recent search builds query URL and normalizes results", async () => {
  const seen = [];
  const client = new XRecentSearchClient({
    bearerToken: "redacted",
    recentSearchUrl: "https://api.x.test/2/tweets/search/recent?tweet.fields=created_at",
    query: "@hq_fyi from:example_author -is:retweet",
    fetchImpl: async (url, options) => {
      seen.push({ url: String(url), authorization: options.headers.Authorization });
      return {
        ok: true,
        json: async () => ({
          data: [
            {
              id: "123",
              author_id: "u1",
              text: "@hq_fyi",
              created_at: "2026-05-31T01:40:00Z",
              referenced_tweets: [{ type: "replied_to", id: "456" }],
            },
          ],
          includes: {
            tweets: [{ id: "456", author_id: "u2", text: "Original", created_at: "2026-05-31T01:35:00Z" }],
            users: [
              { id: "u1", username: "example_author" },
              { id: "u2", username: "original_author" },
            ],
          },
        }),
      };
    },
  });

  const mentions = await client.search();
  assert.equal(seen[0].authorization, "Bearer redacted");
  assert.match(seen[0].url, /query=%40hq_fyi\+from%3Aexample_author\+-is%3Aretweet/);
  assert.equal(mentions[0].id, "123");
  assert.equal(mentions[0].authorHandle, "example_author");
  assert.equal(mentions[0].originalPost.url, "https://x.com/original_author/status/456");
});
