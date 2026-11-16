const test = require("node:test");
const assert = require("node:assert/strict");
const { words, scoreArticle, parseSearch } = require("../services/ranking");
test("tokenization removes duplicates",()=>assert.deepEqual(words("Router router WIFI"),["router","wifi"]));
test("title matches rank above content matches",()=>{
 assert.ok(scoreArticle({title:"router reset",content:""},["router"]) >
   scoreArticle({title:"help",content:"router"},["router"]));
});
test("invalid page throws 400",()=>assert.throws(()=>parseSearch({page:"-1"}),{status:400}));
