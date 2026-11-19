import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';

// Exercise the actual hosted workflow script, with the HTTP boundary replaced.
const workflow = fs.readFileSync('.github/workflows/membership-billing-notices.yml', 'utf8');
const match = workflow.match(/python3 - <<'PY'\n([\s\S]*?)\n          PY/);
assert.ok(match, 'Scheduled trigger script missing');
const source = match[1].split('\n').map(line => line.slice(10)).join('\n');
const successful = {ok:true,dry_run:false,checked_at:'2026-11-19T08:27:48Z',eligible:12,sent:0,already_sent:12,in_progress:0,review:0,failures:0,pending:0,charges_executed:false};
function run({result = successful, http = 200, token = 'scoped-test-trigger', dryRun = false} = {}) {
  const wrapper = `import io, json, os, urllib.request, urllib.error
fixture = json.loads(os.environ['WORKFLOW_FIXTURE'])
def response(request, timeout):
    assert request.full_url == 'https://www.thelittlewanderers.com/api/membership-billing-notices'
    assert request.method == 'POST'
    assert json.loads(request.data) == {'dry_run': os.environ['DRY_RUN'] == 'true'}
    assert request.get_header('Authorization') == 'Bearer scoped-test-trigger'
    assert timeout == 90
    if fixture['http'] != 200:
        raise urllib.error.HTTPError(request.full_url, fixture['http'], 'error', {}, None)
    return io.StringIO(json.dumps(fixture['result']))
urllib.request.urlopen = response
exec(compile(${JSON.stringify(source)}, 'membership-workflow', 'exec'))
`;
  return spawnSync('python3', ['-c', wrapper], {encoding:'utf8',env:{...process.env,WORKFLOW_FIXTURE:JSON.stringify({result,http}),TRIGGER_TOKEN:token,DRY_RUN:String(dryRun)}});
}

test('the observed already-sent batch with one owner-review record succeeds and keeps the review warning', () => {
  const result = run({result:{...successful,review:1}});
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /"already_sent": 12/);
  assert.match(result.stdout, /"review": 1/);
  assert.match(result.stdout, /::warning title=Membership review needed::/);
  assert.match(result.stdout, /skipped/);
  assert.doesNotMatch(result.stdout + result.stderr, /scoped-test-trigger/);
});

test('successful empty and fully delivered batches remain successful without review warnings', () => {
  for(const result of [successful,{...successful,eligible:0,already_sent:0},{...successful,sent:12,already_sent:0}]) {
    const runResult=run({result});assert.equal(runResult.status,0,runResult.stderr);
    assert.doesNotMatch(runResult.stdout,/::warning/);
  }
});

test('real delivery errors, unfinished work and HTTP/auth failures still fail even with review records', () => {
  for(const result of [{...successful,review:1,failures:1},{...successful,ok:false},{...successful,pending:1}]) assert.equal(run({result}).status,2);
  for(const http of [401,503]) {const result=run({http});assert.notEqual(result.status,0);assert.match(result.stderr,new RegExp('HTTP '+http));}
  const missing=run({token:''});assert.notEqual(missing.status,0);assert.match(missing.stderr,/credential is not configured/);
});

test('manual preview sends the dry-run flag and workflow logs contain aggregate counts only', () => {
  const result=run({dryRun:true,result:{...successful,dry_run:true,review:1,results:[{recipient:'private@example.test',family:'Private Family'}]}});
  assert.equal(result.status,0,result.stderr);assert.match(result.stdout,/"dry_run": true/);
  assert.doesNotMatch(result.stdout+result.stderr,/private@example.test|Private Family|scoped-test-trigger/);
  assert.match(workflow,/default: true/);
});
