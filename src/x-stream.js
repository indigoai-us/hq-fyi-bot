import { createInterface } from "node:readline";
import { Readable } from "node:stream";
import { backoffMs, delay } from "./backoff.js";

export function normalizeXStreamEvent(payload) {
  const tweet = payload?.data;
  if (!tweet?.id) return null;

  const users = new Map(
    (payload.includes?.users ?? []).map((user) => [String(user.id), user]),
  );
  const tweets = new Map(
    (payload.includes?.tweets ?? []).map((includedTweet) => [String(includedTweet.id), includedTweet]),
  );
  const author = users.get(String(tweet.author_id)) ?? {};
  const authorHandle = String(author.username ?? tweet.author_username ?? "").replace(/^@/, "");
  const repliedTo = (tweet.referenced_tweets ?? []).find((reference) => reference.type === "replied_to");
  const originalTweet = repliedTo ? tweets.get(String(repliedTo.id)) : null;
  const originalAuthor = users.get(String(originalTweet?.author_id ?? tweet.in_reply_to_user_id ?? ""));
  const originalAuthorHandle = String(originalAuthor?.username ?? "").replace(/^@/, "");
  const originalPostId = String(repliedTo?.id ?? (tweet.conversation_id !== tweet.id ? tweet.conversation_id : "") ?? "");

  return {
    id: String(tweet.id),
    authorId: String(tweet.author_id ?? author.id ?? ""),
    authorHandle,
    text: String(tweet.text ?? ""),
    createdAt: tweet.created_at ?? new Date().toISOString(),
    url: authorHandle ? `https://x.com/${authorHandle}/status/${tweet.id}` : `https://x.com/i/web/status/${tweet.id}`,
    originalPost: originalPostId
      ? {
          id: originalPostId,
          authorId: String(originalTweet?.author_id ?? tweet.in_reply_to_user_id ?? ""),
          authorHandle: originalAuthorHandle,
          text: originalTweet?.text ? String(originalTweet.text) : "",
          createdAt: originalTweet?.created_at ?? "",
          url: originalAuthorHandle
            ? `https://x.com/${originalAuthorHandle}/status/${originalPostId}`
            : `https://x.com/i/web/status/${originalPostId}`,
        }
      : null,
    raw: payload,
  };
}

export function normalizeRecentSearchResponse(payload) {
  const users = new Map(
    (payload.includes?.users ?? []).map((user) => [String(user.id), user]),
  );

  return (payload.data ?? [])
    .map((tweet) =>
      normalizeXStreamEvent({
        data: tweet,
        includes: payload.includes ?? {
          users: users.has(String(tweet.author_id)) ? [users.get(String(tweet.author_id))] : [],
        },
      }),
    )
    .filter(Boolean);
}

export class XRecentSearchClient {
  constructor({ bearerToken, recentSearchUrl, query, fetchImpl = globalThis.fetch }) {
    this.bearerToken = bearerToken;
    this.recentSearchUrl = recentSearchUrl;
    this.query = query;
    this.fetchImpl = fetchImpl;
  }

  async search({ maxResults = 10, signal } = {}) {
    if (!this.bearerToken) throw new Error("X bearer token is not configured");
    const url = new URL(this.recentSearchUrl);
    url.searchParams.set("query", this.query);
    url.searchParams.set("max_results", String(maxResults));
    const response = await this.fetchImpl(url, {
      headers: { Authorization: `Bearer ${this.bearerToken}` },
      signal,
    });
    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new Error(`X recent search failed with status ${response.status}: ${body.slice(0, 240)}`);
    }
    return normalizeRecentSearchResponse(await response.json());
  }
}

export async function* parseXStream(stream) {
  const input = stream instanceof Readable ? stream : Readable.from(stream);
  const lines = createInterface({ input, crlfDelay: Infinity });
  for await (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const parsed = JSON.parse(trimmed);
    const mention = normalizeXStreamEvent(parsed);
    if (mention) yield mention;
  }
}

export class XFilteredStreamClient {
  constructor({ bearerToken, streamUrl, fetchImpl = globalThis.fetch, retry = {}, health }) {
    this.bearerToken = bearerToken;
    this.streamUrl = streamUrl;
    this.fetchImpl = fetchImpl;
    this.retry = retry;
    this.health = health;
  }

  async open({ signal } = {}) {
    if (!this.bearerToken) throw new Error("X bearer token is not configured");
    const response = await this.fetchImpl(this.streamUrl, {
      headers: { Authorization: `Bearer ${this.bearerToken}` },
      signal,
    });
    if (!response.ok || !response.body) {
      throw new Error(`X filtered stream failed with status ${response.status}`);
    }
    await this.health?.markStreamConnected();
    return response.body;
  }

  async run(handler, { signal } = {}) {
    let attempt = 1;
    while (!signal?.aborted) {
      try {
        const stream = await this.open({ signal });
        for await (const mention of parseXStream(stream)) {
          await this.health?.markEvent(new Date(mention.createdAt));
          await handler(mention);
        }
        attempt = 1;
      } catch (error) {
        await this.health?.markStreamDisconnected();
        if (signal?.aborted) throw error;
        await this.health?.markRetry("stream");
        await delay(backoffMs(attempt, this.retry), { signal });
        attempt += 1;
      }
    }
  }
}
