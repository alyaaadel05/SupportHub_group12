"use strict";

// Local sentiment verification.
// No Hugging Face token, subscription, or external API required.

const { classify } = require("../services/sentimentService");

const cases = [
  {
    name: "Positive feedback",
    text: "Excellent support! I love this helpful article.",
    expected: "POSITIVE"
  },
  {
    name: "Negative feedback",
    text: "Terrible support. This article is awful and useless.",
    expected: "NEGATIVE"
  },
  {
    name: "Neutral feedback",
    text: "The article contains information about account settings.",
    expected: "NEUTRAL"
  }
];

(async () => {
  let passed = 0;

  for (const test of cases) {
    const result = await classify(test.text);

    const ok =
      result.status === "completed" &&
      result.label === test.expected &&
      Number.isFinite(result.confidence);

    console.log(
      `${ok ? "PASS" : "FAIL"}: ${test.name} -> ${result.label}`
    );

    if (ok) passed++;
  }

  console.log(`TOTAL: ${passed}/${cases.length} passed`);

  if (passed !== cases.length) {
    process.exitCode = 1;
  }
})().catch(error => {
  console.error("FAIL:", error.name);
  process.exitCode = 1;
});