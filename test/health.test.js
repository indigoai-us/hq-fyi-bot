import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HealthMonitor } from "../src/health.js";

test("reports healthy when a connected stream is idle", async () => {
  const dir = await mkdtemp(join(tmpdir(), "hq-x-health-"));
  try {
    const monitor = new HealthMonitor({
      path: join(dir, "health.json"),
      unhealthyAfterMs: 10,
      now: () => new Date("2026-05-31T00:00:00.000Z"),
    });
    await monitor.markStreamConnected();
    await monitor.markEvent(new Date("2026-05-30T23:59:00.000Z"));
    const snapshot = monitor.snapshot();
    assert.equal(snapshot.healthy, true);
    assert.equal(snapshot.staleStream, false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("records usage warnings without secrets", async () => {
  const dir = await mkdtemp(join(tmpdir(), "hq-x-health-"));
  try {
    const monitor = new HealthMonitor({
      path: join(dir, "health.json"),
      unhealthyAfterMs: 60_000,
    });
    await monitor.recordUsageWarning("filtered stream usage limit approaching");
    const snapshot = monitor.snapshot();
    assert.equal(snapshot.usageWarnings.length, 1);
    assert.match(snapshot.usageWarnings[0].warning, /usage limit/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
