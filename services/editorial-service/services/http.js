class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
function id(value) {
  // Accept only plain decimal digits (or an integer number). Rejects hex ("0x1"),
  // exponents ("1e3"), signs, whitespace and any other text before it reaches SQL.
  const plain =
    (typeof value === "number" && Number.isInteger(value)) ||
    (typeof value === "string" && /^[1-9][0-9]{0,15}$/.test(value));
  const n = plain ? Number(value) : NaN;
  if (!Number.isSafeInteger(n) || n <= 0) throw new HttpError(400, "Invalid positive integer ID");
  return n;
}
function text(value, max, label, required = true) {
  if (typeof value !== "string") throw new HttpError(400, `${label} must be a string`);
  const s = value.trim();
  if ((required && !s) || s.length > max) throw new HttpError(400, `${label} must be 1-${max} characters`);
  return s;
}
function reviewComments(decision, value) {
  if (!["approved", "rejected"].includes(decision)) {
    throw new HttpError(400, "Invalid review decision");
  }

  return text(
    value ?? "",
    2000,
    decision === "rejected" ? "Rejection explanation" : "Comments",
    decision === "rejected"
  );
}

module.exports = { HttpError, id, text, reviewComments };
