import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import crypto from 'node:crypto';
import ts from 'typescript';
const exports={};vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/lib/square-webhook.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,esModuleInterop:true}}).outputText,{exports,require:n=>{assert.equal(n,'node:crypto');return crypto},Buffer});
test('Square accepts URL-plus-body signatures and rejects changed URLs, bodies and unsigned requests',()=>{
 const url='https://www.thelittlewanderers.com/api/webhooks/square',body='{"type":"subscription.updated"}',key='test-only-signature-key';
 const signature=crypto.createHmac('sha256',key).update(url+body).digest('base64');
 const verify=(b=body,s=signature,k=key,u=url)=>exports.verifySquareWebhook(b,s,k,u);
 assert.equal(verify(),true);assert.equal(verify(body+' '),false);assert.equal(verify(body,signature,key,url+'/'),false);
 assert.equal(verify(body,null),false);assert.equal(verify(body,signature,''),false);assert.equal(verify(body,'x'),false);
 assert.equal(verify(body,crypto.createHmac('sha256',key).update(body).digest('base64')),false);
});
