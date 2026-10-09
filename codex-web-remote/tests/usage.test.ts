import { test } from "node:test";
import assert from "node:assert/strict";
import {
  contextUsage,
  quotaWindows,
  sessionModel,
  effortLabel,
} from "../src/client/usage.js";
test("context uses the latest active context, handles missing data and compaction", () => {
  const usage = {
    total: { totalTokens: 1_000_000 },
    last: { totalTokens: 25_000 },
    modelContextWindow: 100_000,
  };
  assert.equal(contextUsage(usage)?.percent, 25);
  assert.equal(
    contextUsage({ ...usage, last: { totalTokens: 10_000 } })?.percent,
    10,
  );
  assert.equal(
    contextUsage({ ...usage, last: { totalTokens: 200_000 } })?.percent,
    100,
  );
  for (const value of [
    null,
    {},
    { ...usage, modelContextWindow: null },
    { ...usage, modelContextWindow: 0 },
    { ...usage, last: { totalTokens: NaN } },
  ])
    assert.equal(contextUsage(value), null);
});
test("quota labels follow actual durations even when primary and secondary are swapped", () => {
  const windows = quotaWindows({
    rateLimits: {
      primary: { usedPercent: 10, windowDurationMins: 10080 },
      secondary: { usedPercent: 25, windowDurationMins: 300 },
    },
  });
  assert.deepEqual(
    windows.map((w) => [w.label, w.remaining]),
    [
      ["1 tuần", 90],
      ["5 giờ", 75],
    ],
  );
  assert.equal(
    quotaWindows({
      rateLimits: { primary: { usedPercent: null, windowDurationMins: 60 } },
    })[0].remaining,
    null,
  );
  assert.equal(
    quotaWindows({ rateLimits: { primary: { usedPercent: 120 } } })[0]
      .remaining,
    0,
  );
  assert.deepEqual(quotaWindows(null), []);
});
test("session metadata comes from acknowledged policy, not catalog defaults", () => {
  const catalog = [
    { model: "model-a", displayName: "Model A", defaultReasoningEffort: "low" },
  ];
  const session = sessionModel(
    { model: "old", policy: { model: "model-a", reasoningEffort: "high" } },
    catalog,
  );
  assert.equal(session.name, "Model A");
  assert.equal(effortLabel(session.effort), "Cao");
  assert.equal(sessionModel({}, catalog).name, "Chưa có dữ liệu");
});
