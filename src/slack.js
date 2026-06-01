import { withRetry } from "./backoff.js";

const SLACK_SECTION_TEXT_LIMIT = 3000;

function truncateForSlack(text, limit = SLACK_SECTION_TEXT_LIMIT) {
  const value = String(text ?? "");
  if (value.length <= limit) return value;
  return `${value.slice(0, limit - 3)}...`;
}

export function formatSlackMessage(mention) {
  const linkElements = [
    { type: "mrkdwn", text: `<${mention.url}|Mention on X>` },
  ];
  if (mention.originalPost?.url) {
    linkElements.push({ type: "mrkdwn", text: `<${mention.originalPost.url}|Original post>` });
  }
  const blocks = [
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*X mention from @${mention.authorHandle}*\n${mention.text}`,
      },
    },
  ];
  if (mention.originalPost?.text) {
    const originalAuthor = mention.originalPost.authorHandle
      ? ` from @${mention.originalPost.authorHandle}`
      : "";
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: truncateForSlack(`*Original post${originalAuthor}*\n${mention.originalPost.text}`),
      },
    });
  }
  blocks.push({
    type: "context",
    elements: [
      { type: "mrkdwn", text: `*Mention ID:* ${mention.id}` },
      { type: "mrkdwn", text: `*Created:* ${mention.createdAt}` },
      ...linkElements,
    ],
  });

  return {
    text: `X mention from @${mention.authorHandle}: ${mention.url}`,
    blocks,
    unfurl_links: false,
    unfurl_media: false,
  };
}

function isRetryableStatus(status) {
  return status === 429 || status >= 500;
}

export class SlackWebhookClient {
  constructor({ webhookUrl, dryRun = false, fetchImpl = globalThis.fetch, retry = {}, health }) {
    this.webhookUrl = webhookUrl;
    this.dryRun = dryRun;
    this.fetchImpl = fetchImpl;
    this.retry = retry;
    this.health = health;
  }

  async deliver(mention, { signal } = {}) {
    const message = formatSlackMessage(mention);
    if (this.dryRun) {
      await this.health?.markSlackDelivery();
      return { ok: true, dryRun: true, message };
    }
    if (!this.webhookUrl) throw new Error("Slack webhook URL is not configured");

    return withRetry(
      async (attempt) => {
        if (attempt > 1) await this.health?.markRetry("slack");
        const response = await this.fetchImpl(this.webhookUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(message),
          signal,
        });
        if (!response.ok) {
          const text = await response.text().catch(() => "");
          const error = new Error(`Slack delivery failed with status ${response.status}`);
          error.status = response.status;
          error.responseText = text.slice(0, 300);
          throw error;
        }
        await this.health?.markSlackDelivery();
        return { ok: true, status: response.status };
      },
      {
        ...this.retry,
        signal,
        retryable: (error) => isRetryableStatus(error.status),
      },
    );
  }
}
