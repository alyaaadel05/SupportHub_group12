const test=require("node:test");
const assert=require("node:assert/strict");
const {jaccard,scoreArticle,tokens}=require("../services/duplicateService");
test("identical titles score 100 percent",()=>{
 assert.equal(scoreArticle({title:"Reset WiFi Router",content:"Press and hold reset button for 10 seconds"},
 {title:"Reset WiFi Router",content:"Press and hold reset button for 10 seconds"}),100);
});
test("unrelated titles and bodies score zero",()=>{
 assert.equal(scoreArticle({title:"Router settings",content:"Configure wireless security"},
 {title:"Printer cartridge",content:"Replace toner tray"}),0);
});
test("case and punctuation do not change tokens",()=>{
 assert.deepEqual(tokens("Wi-Fi, ROUTER!"),tokens("wifi router"));
});
test("empty strings do not divide by zero",()=>assert.equal(jaccard("", ""),0));
