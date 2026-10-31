import assert from "node:assert/strict";
import { test } from "node:test";
import { missingGithubCredentials } from "../src/env.js";

test("missingGithubCredentials names whatever is unset or empty", () => {
  assert.deepEqual(
    missingGithubCredentials({ GITHUB_APP_ID: "1", GITHUB_APP_PRIVATE_KEY: "k" }),
    [],
  );
  assert.deepEqual(missingGithubCredentials({ GITHUB_APP_ID: "1", GITHUB_APP_PRIVATE_KEY: "" }), [
    "GITHUB_APP_PRIVATE_KEY",
  ]);
  assert.deepEqual(missingGithubCredentials({}), ["GITHUB_APP_ID", "GITHUB_APP_PRIVATE_KEY"]);
});
