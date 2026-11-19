
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const pool = require("../db/pool");
const articleService = require("../services/articleService");
const versionService = require("../services/versionService");
const categoryController = require("../controllers/categoryController");

const author = { id: 5, role: "author" };

const input = {
  title: "Reset Router",
  content: "Complete router reset instructions.",
  categoryId: 2
};

test("Creating an article also creates version 1", async (t) => {
  const queries = [];

  const client = {
    async query(sql, params) {
      queries.push(sql);

      if (sql.includes("SELECT 1 FROM categories")) {
        return { rowCount: 1, rows: [{ "?column?": 1 }] };
      }

      if (sql.includes("INSERT INTO articles")) {
        return {
          rows: [{
            id: 10,
            author_id: 5,
            status: "draft",
            title: input.title
          }]
        };
      }

      return { rows: [], rowCount: 1 };
    },
    release() {}
  };

  t.mock.method(pool, "connect", async () => client);

  const result = await articleService.create(input, author);

  assert.equal(result.id, 10);
  assert.equal(result.status, "draft");
  assert.ok(queries.some(q => q.includes("INSERT INTO article_versions")));
  assert.ok(queries.includes("COMMIT"));
});

test("Invalid category causes transaction rollback", async (t) => {
  const queries = [];

  const client = {
    async query(sql) {
      queries.push(sql);
      if (sql.includes("SELECT 1 FROM categories")) {
        return { rowCount: 0, rows: [] };
      }
      return { rows: [] };
    },
    release() {}
  };

  t.mock.method(pool, "connect", async () => client);

  await assert.rejects(
    articleService.create(input, author),
    { status: 400 }
  );

  assert.ok(queries.includes("ROLLBACK"));
});

test("Another author cannot update an article", async (t) => {
  const queries = [];

  const client = {
    async query(sql) {
      queries.push(sql);

      if (sql.includes("FROM articles") &&
          sql.includes("FOR UPDATE")) {
        return {
          rows: [{
            id: 10,
            author_id: 99,
            status: "draft"
          }]
        };
      }

      return { rows: [] };
    },
    release() {}
  };

  t.mock.method(pool, "connect", async () => client);

  await assert.rejects(
    articleService.update(10, input, author),
    { status: 403 }
  );

  assert.ok(queries.includes("ROLLBACK"));
  assert.equal(
    queries.some(q => q.includes("UPDATE articles")),
    false
  );
});

test("Another author cannot delete an article", async (t) => {
  const queries = [];

  t.mock.method(pool, "query", async (sql) => {
    queries.push(sql);
    return {
      rows: [{
        id: 10,
        author_id: 99,
        status: "draft"
      }]
    };
  });

  await assert.rejects(
    articleService.remove(10, author),
    { status: 403 }
  );

  assert.equal(
    queries.some(q => q.includes("DELETE FROM articles")),
    false
  );
});

test("Restoring a version creates new version history", async () => {
  const queries = [];

  const client = {
    async query(sql) {
      queries.push(sql);

      if (sql.includes("FROM articles") &&
          sql.includes("FOR UPDATE")) {
        return {
          rows: [{ id: 10, author_id: 5, status: "draft" }]
        };
      }

      if (sql.includes("FROM article_versions") &&
          sql.includes("version_id =")) {
        return {
          rows: [{
            title: "Previous Title",
            content: "Previous instructions.",
            category_id: 2
          }]
        };
      }

      if (sql.includes("UPDATE articles")) {
        return {
          rows: [{ id: 10, title: "Previous Title" }]
        };
      }

      if (sql.includes("MAX(version_number)")) {
        return { rows: [{ n: 3 }] };
      }

      return { rows: [] };
    },
    release() {}
  };

  const fakePool = {
    async connect() { return client; }
  };

  const result = await versionService.restore(
    fakePool, 10, 2, author
  );

  assert.equal(result.title, "Previous Title");
  assert.ok(
    queries.some(q => q.includes("INSERT INTO article_versions"))
  );
  assert.ok(queries.includes("COMMIT"));
});

test("Invalid category name is rejected", async () => {
  const req = { body: { name: "A" } };
  let error = null;

  await categoryController.create(
    req,
    {},
    (err) => { error = err; }
  );

  assert.equal(error?.status, 400);
});
