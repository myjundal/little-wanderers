import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
const exports={};
vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/lib/auth-redirect.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText,{exports,URL});
test('authentication keeps valid destinations and rejects external parser tricks',()=>{
 const safe=value=>exports.safeAuthNextPath(value,'https://www.thelittlewanderers.com/auth/callback');
 for(const bad of [null,'','https://evil.example','//evil.example','/\\evil.example','/\n/evil.example','javascript:alert(1)'])assert.equal(safe(bad),'/landing');
 assert.equal(safe('/employee'),'/employee');
 assert.equal(safe('/landing/classschedule?month=10#calendar'),'/landing/classschedule?month=10#calendar');
});
