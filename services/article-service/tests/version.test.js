const test=require("node:test");
const assert=require("node:assert/strict");
const {compareVersions}=require("../services/versionCompare");
test("version comparison reports content changes",()=>{
 const first={title:"Reset Router",content:"Old instructions",category_id:1};
 const second={title:"Reset Router",content:"New instructions",category_id:1};
 const result=compareVersions(first,second);
 assert.equal(result.titleChanged,false);
 assert.equal(result.contentChanged,true);
 assert.equal(result.categoryChanged,false);
});
