// Automatic re-review request (Search -> Editorial).
// After an UNHELPFUL vote, count the votes for that article. If it has at least 5 unhelpful
// votes AND more than 60 % of its votes are unhelpful, ask the Editorial Service (signed request)
// to open an "Automatic (reader votes)" re-review flag.
// The reader's vote must never fail because of this: every error is caught and only logged.
// Editorial returns the existing flag (200) if one is already open, so repeats are harmless and
// the next unhelpful vote simply retries if Editorial was down.
const pool = require("../db/pool");
const { requestAutoFlag } = require("./serviceClient");
const metrics = require("./metricsService");

const MIN_UNHELPFUL = 5;
const MIN_SHARE = 0.6; // strictly more than 60 %

function ruleMet(unhelpful, total) {
  return total > 0 && unhelpful >= MIN_UNHELPFUL && unhelpful / total > MIN_SHARE;
}

async function checkAfterUnhelpfulVote(articleId) {
  try {
    const { rows } = await pool.query(`SELECT COUNT(*)::int AS total,
      COUNT(*) FILTER (WHERE NOT helpful)::int AS unhelpful
      FROM helpfulness_votes WHERE article_id=$1`, [articleId]);
    const { total, unhelpful } = rows[0];
    if (!ruleMet(unhelpful, total)) return { requested: false, unhelpful, total };

    const status = await requestAutoFlag(articleId, unhelpful, total);
    if (status === 201 || status === 200) {
      console.log(`Auto-flag requested for article ${articleId} (${unhelpful}/${total} unhelpful): Editorial ${status}`);
      metrics.record("AutoFlagRequests", 1);
    } else {
      console.error(`Auto-flag not accepted for article ${articleId}: Editorial ${status}`);
      metrics.record("AutoFlagFailures", 1);
    }
    return { requested: true, status, unhelpful, total };
  } catch (error) {
    console.error(`Auto-flag request failed for article ${articleId}:`, error.message);
    metrics.record("AutoFlagFailures", 1);
    return { requested: false, error: true };
  }
}

module.exports = { ruleMet, checkAfterUnhelpfulVote, MIN_UNHELPFUL, MIN_SHARE };