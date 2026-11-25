"use strict";

const Sentiment = require("sentiment");
const analyzer = new Sentiment();

async function classify(text) {
  try {
    const input = String(text || "");
    const result = analyzer.analyze(input);

    const score = result.comparative;

    let label = "NEUTRAL";

    if (score > 0) label = "POSITIVE";
    if (score < 0) label = "NEGATIVE";

    // Heuristic strength estimate, not a calibrated probability.
    const confidence = Math.min(
      1,
      Math.abs(score) / (1 + Math.abs(score))
    );

    return {
      status: "completed",
      label,
      confidence: Number(confidence.toFixed(4))
    };
  } catch (error) {
    console.error(
      "[sentiment] Local analysis failed:",
      error.name || "Error"
    );

    return {
      status: "unavailable",
      label: null,
      confidence: null
    };
  }
}

module.exports = { classify };