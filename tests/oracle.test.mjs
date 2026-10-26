import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, writeFile, rm} from 'node:fs/promises';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {validateOracle, runOracle} from '../skills/fixture-shrink/scripts/oracle.mjs';

const config = (command, extra = {}) => ({command, expect: {exit_code: 7, stream: 'stderr', includes: 'chosen failure'}, ...extra});

async function fixture(run) {
  const base = path.resolve(tmpdir());
  const directory = await mkdtemp(path.join(base, 'fixture-shrink-oracle-'));
  const input = path.join(directory, 'input with spaces.json');
  await writeFile(input, '{"sample":true}');
  const script = async source => {
    const file = path.join(directory, 'oracle with spaces.mjs');
    await writeFile(file, source);
    return [process.execPath, file, '{input}'];
  };
  try { await run({directory, input, script}); }
  finally {
    const resolved = path.resolve(directory);
    assert.ok(resolved.startsWith(`${base}${path.sep}`) && path.basename(resolved).startsWith('fixture-shrink-oracle-'));
    await rm(resolved, {recursive: true, force: true});
  }
}

test('normalization preserves literal argv and signatures, supplies bounded defaults, and validates JSON pointers', () => {
  const original = config([process.execPath, 'script with spaces.mjs', ' literal argument ', '{input}'], {preserve: ['', '/a~1b/~0', '/array/0', '/array/0']});
  const before = structuredClone(original);
  const result = validateOracle(original);
  assert.deepEqual(original, before);
  assert.deepEqual(result.command, original.command);
  assert.equal(result.timeout_ms, 3000);
  assert.equal(result.max_output_bytes, 65536);
  assert.deepEqual(result.preserve, ['', '/a~1b/~0', '/array/0']);
});

test('invalid schemas, missing or embedded placeholders, ambiguous expectations, and unbounded limits are rejected', () => {
  const good = config([process.execPath, 'oracle.mjs', '{input}']);
  for (const value of [null, [], {}, {...good, unknown: true}, {...good, command: []}, {...good, command: [' ']}, {...good, command: ['{input}', 'other']}, {...good, command: [process.execPath, 'oracle.mjs']}, {...good, command: [process.execPath, '{input}', '{input}']}, {...good, command: [process.execPath, '--file={input}']}, {...good, command: [process.execPath, '{input}', 'prefix{input}']}, {...good, command: [process.execPath, 5, '{input}']}]) assert.throws(() => validateOracle(value));
  for (const exit_code of [0, -1, 256, 1.5, '7', null]) assert.throws(() => validateOracle({...good, expect: {...good.expect, exit_code}}));
  for (const stream of ['both', '', null]) assert.throws(() => validateOracle({...good, expect: {...good.expect, stream}}));
  for (const includes of ['', ' ', null, 5]) assert.throws(() => validateOracle({...good, expect: {...good.expect, includes}}));
  for (const expect of [{exit_code: 7, stream: 'stderr'}, {...good.expect, extra: true}]) assert.throws(() => validateOracle({...good, expect}));
  for (const timeout_ms of [0, 49, 60001, Infinity, '3000']) assert.throws(() => validateOracle({...good, timeout_ms}));
  for (const max_output_bytes of [0, 1023, 1048577, 1024.5]) assert.throws(() => validateOracle({...good, max_output_bytes}));
  for (const preserve of [null, ['/invalid~2'], ['no-leading-slash'], [7]]) assert.throws(() => validateOracle({...good, preserve}));
});

test('only an exact failure exit code and literal signature in the chosen stream are interesting', async () => {
  await fixture(async ({input, script}) => {
    const command = await script("process.stderr.write('chosen failure'); process.exitCode=7;");
    assert.equal((await runOracle(config(command), input)).verdict, 'interesting');
    assert.equal((await runOracle(config(command, {expect:{exit_code:8,stream:'stderr',includes:'chosen failure'}}),input)).verdict,'uninteresting');
    assert.equal((await runOracle(config(command, {expect:{exit_code:7,stream:'stdout',includes:'chosen failure'}}),input)).verdict,'uninteresting');
    assert.equal((await runOracle(config(command, {expect:{exit_code:7,stream:'stderr',includes:'chosen.*failure'}}),input)).verdict,'uninteresting');
    const missing = await script("process.stderr.write('different problem'); process.exitCode=7;");
    assert.equal((await runOracle(config(missing),input)).verdict,'uninteresting');
    const passed = await script("process.stderr.write('chosen failure');");
    assert.equal((await runOracle(config(passed),input)).verdict,'uninteresting');
  });
});

test('argv spaces and shell metacharacters stay literal and the supplied cwd is used', async () => {
  await fixture(async ({directory,input,script}) => {
    const command = await script("import fs from 'node:fs'; if(JSON.parse(fs.readFileSync(process.argv[2],'utf8')).sample && process.argv[3]==='a b; echo untrusted' && process.cwd()===process.argv[4]) {process.stdout.write('chosen failure'); process.exitCode=7;}");
    command.push('a b; echo untrusted',directory);
    const result = await runOracle(config(command,{expect:{exit_code:7,stream:'stdout',includes:'chosen failure'}}),input,{cwd:directory});
    assert.equal(result.verdict,'interesting',result.error);
    assert.equal(result.stdout,'chosen failure');
  });
});

test('spawn failures and invalid working directories are unresolved, never matching failures', async () => {
  await fixture(async ({directory,input,script}) => {
    const missing = await runOracle(config([path.join(directory,'missing-executable'),'{input}']),input);
    assert.equal(missing.verdict,'unresolved');
    assert.equal(missing.exit_code,null);
    assert.match(missing.error,/Could not run oracle/);
    const command = await script("process.stderr.write('chosen failure'); process.exitCode=7;");
    const cwd = await runOracle(config(command),input,{cwd:path.join(directory,'missing-directory')});
    assert.equal(cwd.verdict,'unresolved');
    assert.equal(cwd.exit_code,null);
  });
});

test('timeouts remain unresolved even after printing the expected signature', async () => {
  await fixture(async ({input,script}) => {
    const command = await script("process.stderr.write('chosen failure'); setInterval(()=>{},1000);");
    const result = await runOracle(config(command,{timeout_ms:200}),input);
    assert.equal(result.verdict,'unresolved');
    assert.equal(result.timed_out,true);
    assert.equal(result.output_limited,false);
    assert.ok(result.duration_ms < 4000);
  });
});

test('combined output byte limits bound retained memory and cannot masquerade as an interesting result', async () => {
  await fixture(async ({input,script}) => {
    const command = await script("process.stderr.write('chosen failure'); process.stdout.write('x'.repeat(200000)); process.exitCode=7;");
    const result = await runOracle(config(command,{max_output_bytes:1024}),input);
    assert.equal(result.verdict,'unresolved');
    assert.equal(result.output_limited,true);
    assert.ok(Buffer.byteLength(result.stdout)+Buffer.byteLength(result.stderr)<=1024);
  });
});

test('split multibyte UTF-8 is decoded correctly and malformed output is unresolved', async () => {
  await fixture(async ({input,script}) => {
    const valid = await script("const b=Buffer.from('é chosen failure'); process.stderr.write(b.subarray(0,1)); setTimeout(()=>{process.stderr.write(b.subarray(1)); process.exitCode=7;},20);");
    const good = await runOracle(config(valid),input);
    assert.equal(good.verdict,'interesting');
    assert.equal(good.stderr,'é chosen failure');
    const invalid = await script("process.stderr.write(Buffer.from([255])); process.stderr.write('chosen failure'); process.exitCode=7;");
    const bad = await runOracle(config(invalid),input);
    assert.equal(bad.verdict,'unresolved');
    assert.match(bad.error,/UTF-8/);
  });
});

test('signal termination is unresolved even with the expected failure text', {skip:process.platform==='win32'?'Windows signal delivery does not expose equivalent POSIX semantics':false}, async () => {
  await fixture(async ({input,script}) => {
    const command = await script("process.stderr.write('chosen failure'); process.kill(process.pid,'SIGTERM');");
    const result = await runOracle(config(command),input);
    assert.equal(result.verdict,'unresolved');
    assert.equal(result.signal,'SIGTERM');
    assert.equal(result.exit_code,null);
  });
});

test('timeout terminates a live oracle and its ordinary child tree', async () => {
  await fixture(async ({input,script}) => {
    const command = await script("import {spawn} from 'node:child_process'; const c=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:['ignore','inherit','inherit']}); process.stderr.write('chosen failure CHILD_PID='+c.pid); setInterval(()=>{},1000);");
    const result = await runOracle(config(command,{timeout_ms:500}),input);
    assert.equal(result.verdict,'unresolved');
    assert.equal(result.timed_out,true);
    assert.ok(result.duration_ms < 4000);
    const match=result.stderr.match(/CHILD_PID=(\d+)/);
    assert.ok(match,'The child started before the timeout');
    const pid=Number(match[1]);
    // A recently terminated POSIX child can remain a zombie briefly; kill(0)
    // cannot distinguish that from a running process, so pipe closure and the
    // absence of forced-close diagnostics are the portable observation here.
    assert.doesNotMatch(result.error || '',/streams remained open/);
    assert.ok(Number.isInteger(pid));
  });
});
