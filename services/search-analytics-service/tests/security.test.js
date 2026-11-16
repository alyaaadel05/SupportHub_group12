const test = require("node:test");
const assert = require("node:assert/strict");
const { makeSignature, requireEditorialSignature } = require("../middleware/security");
const secret = "a".repeat(64);
test("signature depends on sender, path and body",()=>{
 assert.notEqual(makeSignature(secret,"editorial-service","123","POST","/internal/publications",'{"articleId":1}'),
   makeSignature(secret,"editorial-service","123","POST","/internal/publications",'{"articleId":2}'));
});
test("valid signed editorial request",()=>{
 const old = process.env.SERVICE_SHARED_SECRET;
 process.env.SERVICE_SHARED_SECRET = secret;
 const timestamp = String(Date.now());
 const body = '{"articleId":1}';
 const headers = {
 "x-service-name":"editorial-service", "x-service-timestamp":timestamp,
 "x-service-signature":makeSignature(secret,"editorial-service",timestamp,"POST","/internal/publications",body)
 };
 const req={get(name){return headers[name];},method:"POST",originalUrl:"/internal/publications",rawBody:body};
 let passed=false;
 requireEditorialSignature(req,{status(){throw new Error("rejected");}},()=>{passed=true;});
 assert.equal(passed,true);
 if(old===undefined) delete process.env.SERVICE_SHARED_SECRET;
 else process.env.SERVICE_SHARED_SECRET=old;
});
