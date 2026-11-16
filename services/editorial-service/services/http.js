class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
function id(value) {
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n <= 0) throw new HttpError(400, "Invalid positive integer ID");
  return n;
}
function text(value, max, label, required = true) {
  if (typeof value !== "string") throw new HttpError(400, `${label} must be a string`);
  const s = value.trim();
  if ((required && !s) || s.length > max) throw new HttpError(400, `${label} must be 1-${max} characters`);
  return s;
}
module.exports = { HttpError, id, text };
