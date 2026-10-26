import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {decodeMessage} from '../examples/message/service.mjs';

const root = fileURLToPath(new URL('../',import.meta.url));
const cases = [
  ['ordinary content', 'note:hello world', 'hello world'],
  ['internal delimiters', 'note:part one:part two:part three', 'part one:part two:part three'],
  ['only a delimiter as content', 'note::', ':'],
  ['content starts with a delimiter', 'note::tail', ':tail'],
  ['content ends with a delimiter', 'note:tail:', 'tail:'],
  ['consecutive delimiters', 'note::::', ':::'],
  ['Unicode and combining marks around delimiters', 'note:😀 é 漢字:🚀:fin', '😀 é 漢字:🚀:fin'],
  ['newlines and whitespace around delimiters', 'note: first\n: second \n', ' first\n: second \n'],
];
for (const [name,input,expected] of cases) {
  test(name,()=>assert.equal(decodeMessage(input),expected));
}

for (const fixture of ['examples/message/input.json','results/default/reduced.json','results/strings-final/reduced.json']) {
  test('unchanged checker accepts '+fixture,()=>{
    const result=spawnSync(process.execPath,['examples/message/check.mjs',fixture],{cwd:root,encoding:'utf8'});
    assert.equal(result.error,undefined);
    assert.equal(result.status,0,result.stderr);
    assert.equal(result.stdout,'PASS: all content after the first delimiter is preserved\n');
    assert.equal(result.stderr,'');
    assert.equal(JSON.parse(readFileSync(new URL('../'+fixture,import.meta.url),'utf8')).schemaVersion,1);
  });
}

test('input, checker and supplied oracle retain their initial bytes',()=>{
  const hashes=JSON.parse(readFileSync(new URL('../initial-hashes.json',import.meta.url),'utf8'));
  for (const name of ['input.json','check.mjs','oracle.json']) {
    const actual=createHash('sha256').update(readFileSync(new URL('../examples/message/'+name,import.meta.url))).digest('hex');
    assert.equal(actual,hashes[name],name+' changed');
  }
});
