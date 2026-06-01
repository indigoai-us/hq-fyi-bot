import { writeDeadLetter } from "./store.js";

export class MentionBridge {
  constructor({ allowlist, dedupeStore, slackClient, health, deadLetterPath }) {
    this.allowlist = new Set(allowlist.map((handle) => handle.replace(/^@/, "").toLowerCase()));
    this.dedupeStore = dedupeStore;
    this.slackClient = slackClient;
    this.health = health;
    this.deadLetterPath = deadLetterPath;
  }

  isAllowed(mention) {
    return this.allowlist.has(String(mention.authorHandle ?? "").toLowerCase());
  }

  async processMention(mention, options = {}) {
    if (!this.isAllowed(mention)) {
      await this.health?.markFiltered();
      return { status: "filtered", id: mention.id };
    }

    if (await this.dedupeStore.has(mention.id)) {
      return { status: "duplicate", id: mention.id };
    }

    try {
      const delivery = await this.slackClient.deliver(mention, options);
      await this.dedupeStore.add(mention.id);
      return { status: "delivered", id: mention.id, delivery };
    } catch (error) {
      await this.health?.markDeliveryFailure();
      await this.health?.markDeadLetter();
      await writeDeadLetter(this.deadLetterPath, {
        mention: {
          id: mention.id,
          authorHandle: mention.authorHandle,
          url: mention.url,
          createdAt: mention.createdAt,
        },
        error: error.message,
      });
      throw error;
    }
  }
}
