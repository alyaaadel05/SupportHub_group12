class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
function id(value) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number <= 0) throw new HttpError(400, "Invalid ID");
  return number;
}
function boundedString(value, max, label, optional = false) {
  if (optional && (value === undefined || value === null || value === "")) return "";
  if (typeof value !== "string") throw new HttpError(400, `${label} must be text`);
  const result = value.trim();
  if ((!optional && !result) || result.length > max) throw new HttpError(400, `Invalid ${label}`);
  return result;
}
module.exports = { HttpError, id, boundedString };
