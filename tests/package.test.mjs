import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,readdir,cp,mkdtemp,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';

const root=fileURLToPath(new URL('../',import.meta.url));
const skill=path.join(root,'skills','fixture-shrink');

test('the installed skill is self-contained and its references resolve inside the folder',async()=>{
  const source=await readFile(path.join(skill,'SKILL.md'),'utf8');
  assert.match(source,/^---\r?\nname: fixture-shrink\r?\n/);
  assert.ok(Buffer.byteLength(source)<8000);
  const inspect=async directory=>{
    for(const entry of await readdir(directory,{withFileTypes:true})) {
      const file=path.join(directory,entry.name);
      if(entry.isDirectory())await inspect(file);
      else if(entry.name.endsWith('.md')) {
        const text=await readFile(file,'utf8');
        for(const match of text.matchAll(/\]\(([^)]+)\)/g)) {
          const href=match[1];
          if(/^[a-z]+:|^#/i.test(href))continue;
          const target=path.resolve(directory,href.split('#')[0]);
          assert.ok(target.startsWith(`${path.resolve(skill)}${path.sep}`),`Reference escapes skill: ${href}`);
          await readFile(target);
        }
      }
    }
  };
  await inspect(skill);
  assert.match(await readFile(path.join(skill,'LICENSE'),'utf8'),/MIT License/);
});

test('copied skill executes without package installation or repository-relative imports',async()=>{
  const base=path.resolve(tmpdir());
  const scratch=await mkdtemp(path.join(base,'fixture-shrink-package-'));
  try{
    await cp(skill,path.join(scratch,'fixture-shrink'),{recursive:true});
    const oracle=path.join(scratch,'oracle.json');
    await writeFile(oracle,JSON.stringify({command:[process.execPath,path.join(root,'examples','catalog','check.mjs'),'{input}'],expect:{exit_code:1,stream:'stderr',includes:'REPRO: normalized-sku-collision'},preserve:['/schemaVersion']}));
    const output=path.join(scratch,'result');
    const result=spawnSync(process.execPath,[path.join(scratch,'fixture-shrink','scripts','shrink.mjs'),path.join(root,'examples','catalog','input.json'),'--oracle',oracle,'--out',output,'--max-runs','6'],{cwd:scratch,encoding:'utf8',timeout:15000});
    assert.equal(result.status,0,result.stderr);
    const summary=JSON.parse(result.stdout);
    assert.equal(summary.verified,true);
    assert.equal(summary.oracle_runs,6);
    const fixture=JSON.parse(await readFile(path.join(output,'reduced.json'),'utf8'));
    assert.equal(fixture.schemaVersion,1);
  }finally{
    const resolved=path.resolve(scratch);
    assert.ok(resolved.startsWith(`${base}${path.sep}`)&&path.basename(resolved).startsWith('fixture-shrink-package-'));
    await rm(resolved,{recursive:true,force:true});
  }
});
