
const pool = require("../db/pool");

// ==========================================
// 1. HELPER FUNCTIONS
// ==========================================

function httpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function validId(value) {
  const id = Number(value);

  if (!Number.isSafeInteger(id) || id <= 0) {
    throw httpError(400, "Invalid category ID");
  }

  return id;
}

function validateCategory(data) {
  const name =
    typeof data?.name === "string"
      ? data.name.trim()
      : "";

  if (name.length < 2 || name.length > 80) {
    throw httpError(
      400,
      "Category name must contain 2 to 80 characters"
    );
  }

  return { name };
}

// ==========================================
// 2. LIST ALL CATEGORIES
// ==========================================

exports.list = async (req, res, next) => {
  try {
    const result = await pool.query(
      `SELECT id, name
       FROM categories
       ORDER BY name ASC`
    );

    res.json({
      categories: result.rows
    });

  } catch (error) {
    next(error);
  }
};

// ==========================================
// 3. CREATE CATEGORY
// ==========================================

exports.create = async (req, res, next) => {
  try {
    const { name } = validateCategory(req.body);

    const result = await pool.query(
      `INSERT INTO categories (name)
       VALUES ($1)
       RETURNING id, name`,
      [name]
    );

    res.status(201).json({
      category: result.rows[0]
    });

  } catch (error) {
    if (error.code === "23505") {
      return next(
        httpError(409, "Category already exists")
      );
    }

    next(error);
  }
};

// ==========================================
// 4. UPDATE CATEGORY
// ==========================================

exports.update = async (req, res, next) => {
  try {
    const id = validId(req.params.id);
    const { name } = validateCategory(req.body);

    const result = await pool.query(
      `UPDATE categories
       SET name = $1
       WHERE id = $2
       RETURNING id, name`,
      [name, id]
    );

    if (!result.rows.length) {
      throw httpError(404, "Category not found");
    }

    res.json({
      category: result.rows[0]
    });

  } catch (error) {
    if (error.code === "23505") {
      return next(
        httpError(409, "Category already exists")
      );
    }

    next(error);
  }
};

// ==========================================
// 5. DELETE CATEGORY
// ==========================================

exports.remove = async (req, res, next) => {
  try {
    const id = validId(req.params.id);

    const result = await pool.query(
      `DELETE FROM categories
       WHERE id = $1
       AND NOT EXISTS (
         SELECT 1
         FROM articles
         WHERE articles.category_id = categories.id
       )
       RETURNING id`,
      [id]
    );

    if (!result.rows.length) {
      throw httpError(
        409,
        "Category not found or currently in use"
      );
    }

    res.status(204).end();

  } catch (error) {
    if (error.code === "23503") {
      return next(
        httpError(
          409,
          "Cannot delete a category that is in use"
        )
      );
    }

    next(error);
  }
};
