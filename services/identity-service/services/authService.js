
const bcrypt = require("bcryptjs");
const pool = require("../db/pool");

// Return user information without exposing password hashes.
function publicUser(row) {
  if (!row) return null;

  return {
    id: row.id,
    user_id: row.id,
    name: row.name,
    full_name: row.name,
    email: row.email,
    role: row.role,
    created_at: row.created_at
  };
}

// Validate registration details.
function validateRegistration(fullName, email, password) {
  if (
    typeof fullName !== "string" ||
    fullName.trim().length < 2 ||
    fullName.trim().length > 100
  ) {
    const error = new Error(
      "Name must be between 2 and 100 characters"
    );
    error.status = 400;
    throw error;
  }

  if (
    typeof email !== "string" ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) ||
    email.length > 254
  ) {
    const error = new Error("Invalid email address");
    error.status = 400;
    throw error;
  }

  if (
    typeof password !== "string" ||
    password.length < 12 ||
    Buffer.byteLength(password, "utf8") > 72
  ) {
    const error = new Error(
      "Password must be at least 12 characters and at most 72 bytes"
    );
    error.status = 400;
    throw error;
  }
}

// Register a new user.
async function registerUser(fullName, email, password) {
  validateRegistration(fullName, email, password);

  const normalizedName = fullName.trim();
  const normalizedEmail = email.trim().toLowerCase();

  // Check whether the email is already registered.
  const existingUser = await pool.query(
    `SELECT id
     FROM users
     WHERE LOWER(email) = $1
     LIMIT 1`,
    [normalizedEmail]
  );

  if (existingUser.rows.length > 0) {
    const error = new Error("Email already registered");
    error.status = 409;
    throw error;
  }

  // Hash the password before storing it.
  const passwordHash = await bcrypt.hash(password, 12);

  try {
    // The database accepts author, editor and admin.
    // New users receive the author role.
    const result = await pool.query(
      `INSERT INTO users
         (name, email, password_hash, role)
       VALUES
         ($1, $2, $3, 'author')
       RETURNING id, name, email, role, created_at`,
      [
        normalizedName,
        normalizedEmail,
        passwordHash
      ]
    );

    return publicUser(result.rows[0]);
  } catch (error) {
    if (error.code === "23505") {
      const conflict = new Error(
        "Email already registered"
      );
      conflict.status = 409;
      throw conflict;
    }

    throw error;
  }
}

// Log in an existing user.
async function loginUser(email, password) {
  if (
    typeof email !== "string" ||
    typeof password !== "string"
  ) {
    const error = new Error(
      "Invalid email or password"
    );
    error.status = 401;
    throw error;
  }

  const normalizedEmail = email.trim().toLowerCase();

  const result = await pool.query(
    `SELECT
       id,
       name,
       email,
       password_hash,
       role,
       created_at
     FROM users
     WHERE LOWER(email) = $1
     LIMIT 1`,
    [normalizedEmail]
  );

  if (result.rows.length === 0) {
    const error = new Error(
      "Invalid email or password"
    );
    error.status = 401;
    throw error;
  }

  const user = result.rows[0];

  const passwordMatches = await bcrypt.compare(
    password,
    user.password_hash
  );

  if (!passwordMatches) {
    const error = new Error(
      "Invalid email or password"
    );
    error.status = 401;
    throw error;
  }

  return publicUser(user);
}

// Retrieve a user by ID.
async function findUserById(userId) {
  const result = await pool.query(
    `SELECT
       id,
       name,
       email,
       role,
       created_at
     FROM users
     WHERE id = $1
     LIMIT 1`,
    [userId]
  );

  return publicUser(result.rows[0]);
}

// Record authentication activity.
async function auditLog(userId, action, details = {}) {
  try {
    await pool.query(
      `INSERT INTO audit_logs
         (user_id, action, target_id, details)
       VALUES
         ($1, $2, $3, $4)`,
      [
        userId || null,
        action,
        userId ? String(userId) : null,
        JSON.stringify(details)
      ]
    );
  } catch (error) {
    console.error(
      "Audit logging failed:",
      error.message
    );
  }
}

module.exports = {
  registerUser,
  loginUser,
  findUserById,
  auditLog,
  publicUser,
  validateRegistration
};
