import { dirname } from "node:path";
import { mkdir, readFile, writeFile } from "node:fs/promises";

export class HealthMonitor {
  constructor({ path, unhealthyAfterMs, now = () => new Date() }) {
    this.path = path;
    this.unhealthyAfterMs = unhealthyAfterMs;
    this.now = now;
    this.state = {
      streamConnected: false,
      lastEventAt: null,
      lastSlackDeliveryAt: null,
      retryCounts: { stream: 0, slack: 0 },
      deliveryFailures: 0,
      filteredMentions: 0,
      usageWarnings: [],
      deadLetters: 0,
    };
  }

  async load() {
    try {
      this.state = { ...this.state, ...JSON.parse(await readFile(this.path, "utf8")) };
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }

  snapshot() {
    const nowMs = this.now().getTime();
    const lastEventMs = this.state.lastEventAt ? Date.parse(this.state.lastEventAt) : 0;
    const stale =
      !this.state.streamConnected && lastEventMs > 0 && nowMs - lastEventMs > this.unhealthyAfterMs;
    return {
      ...this.state,
      healthy: this.state.streamConnected && !stale && this.state.usageWarnings.length === 0,
      staleStream: stale,
      checkedAt: this.now().toISOString(),
    };
  }

  async save() {
    await mkdir(dirname(this.path), { recursive: true });
    await writeFile(this.path, `${JSON.stringify(this.snapshot(), null, 2)}\n`);
  }

  async markStreamConnected() {
    this.state.streamConnected = true;
    await this.save();
  }

  async markStreamDisconnected() {
    this.state.streamConnected = false;
    await this.save();
  }

  async markEvent(when = this.now()) {
    this.state.lastEventAt = when.toISOString();
    await this.save();
  }

  async markSlackDelivery(when = this.now()) {
    this.state.lastSlackDeliveryAt = when.toISOString();
    await this.save();
  }

  async markRetry(kind) {
    this.state.retryCounts[kind] = (this.state.retryCounts[kind] ?? 0) + 1;
    await this.save();
  }

  async markDeliveryFailure() {
    this.state.deliveryFailures += 1;
    await this.save();
  }

  async markFiltered() {
    this.state.filteredMentions += 1;
    await this.save();
  }

  async markDeadLetter() {
    this.state.deadLetters += 1;
    await this.save();
  }

  async recordUsageWarning(warning) {
    this.state.usageWarnings.push({
      at: this.now().toISOString(),
      warning: String(warning),
    });
    await this.save();
  }
}
