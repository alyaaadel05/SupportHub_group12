const test = require("node:test");
const assert = require("node:assert/strict");
const { words, scoreArticle } = require("../services/ranking");

test("keywords are lowercased", () => {
  assert.deepEqual(words("PASSWORD Reset"), ["password", "reset"]);
});

test("punctuation is removed from keywords", () => {
  assert.deepEqual(words("wifi, router!?"), ["wifi", "router"]);
});

test("empty search gives no keywords", () => {
  assert.deepEqual(words(""), []);
  assert.deepEqual(words("   "), []);
});

test("at most 12 keywords are used", () => {
  const many = Array.from({ length: 20 }, (_, i) => "word" + i).join(" ");
  assert.equal(words(many).length, 12);
});

test("title match scores higher than category match, which scores higher than content match", () => {
  const terms = ["billing"];
  const inTitle = scoreArticle({ title: "Billing help", content: "", category_name: "" }, terms);
  const inCategory = scoreArticle({ title: "Help", content: "", category_name: "Billing" }, terms);
  const inContent = scoreArticle({ title: "Help", content: "about billing", category_name: "" }, terms);
  assert.ok(inTitle > inCategory);
  assert.ok(inCategory > inContent);
  assert.ok(inContent > 0);
});

test("article without the keyword scores zero", () => {
  assert.equal(scoreArticle({ title: "Login", content: "Reset your password" }, ["router"]), 0);
});

test("more matching keywords give a higher score", () => {
  const article = { title: "Reset router password", content: "" };
  assert.ok(scoreArticle(article, ["router", "password"]) > scoreArticle(article, ["router"]));
});

test("category name match adds to the score", () => {
  const withCategory = scoreArticle({ title: "Help", content: "", category_name: "Billing Support" }, ["billing"]);
  const without = scoreArticle({ title: "Help", content: "" }, ["billing"]);
  assert.equal(withCategory, 3);
  assert.equal(without, 0);
});