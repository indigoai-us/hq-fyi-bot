import test from "node:test";
import assert from "node:assert/strict";
import { assertRuntimeConfig, loadConfig } from "../src/config.js";

test("loads public environment variable names", () => {
  const config = loadConfig({
    X_BEARER_TOKEN: "x-token",
    SLACK_WEBHOOK_URL: "https://hooks.slack.test/services/redacted",
    HQ_X_ALLOWED_AUTHORS: "Example_Author,@Second_Author",
  });

  assert.equal(config.x.bearerToken, "x-token");
  assert.equal(config.slack.webhookUrl, "https://hooks.slack.test/services/redacted");
  assert.deepEqual(config.allowlist, ["example_author", "second_author"]);
});

test("builds a generic default X rule from the target handle", () => {
  const config = loadConfig({
    HQ_X_TARGET_HANDLE: "@custom_bot",
  });

  assert.equal(config.x.ruleValue, "@custom_bot -is:retweet");
});

test("requires credentials and an explicit author allowlist at runtime", () => {
  const config = loadConfig({ SLACK_DRY_RUN: "1" });

  assert.throws(
    () => assertRuntimeConfig(config),
    /X_BEARER_TOKEN or HQ_FYI_BEARER_TOKEN.*HQ_X_ALLOWED_AUTHORS or ALLOWED_AUTHORS/,
  );
});
