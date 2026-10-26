import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,readdir,rm,access} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {shrinkFile} from '../skills/fixture-shrink/scripts/shrink.mjs';

const cli=fileURLToPath(new URL('../skills/fixture-shrink/scripts/shrink.mjs',import.meta.url));
const checker=`import{readFileSync}from'node:fs';
try{
 const d=JSON.parse(readFileSync(process.argv[2],'utf8'));
 if(d.schemaVersion!==1||!Array.isArray(d.items)||d.items.some(x=>!x||typeof x.key!=='string'||!x.key)){console.error('VALIDATION: missing fields');process.exit(1)}
 if(new Set(d.items.map(x=>x.key)).size>new Set(d.items.map(x=>x.key.trim().toLowerCase())).size){console.error('REPRO: collision');process.exit(1)}
}catch(e){console.error('VALIDATION: '+e.message);process.exit(1)}`;

async function fixture(run) {
  const parent=path.resolve(tmpdir());
  const directory=await mkdtemp(path.join(parent,'fixture-shrink-cli-'));
  const input=path.join(directory,'input with spaces.json');
  const oraclePath=path.join(directory,'oracle.json');
  const program=path.join(directory,'check with spaces.mjs');
  const out=path.join(directory,'result');
  const value={schemaVersion:1,metadata:{extra:'irrelevant'},items:[...Array.from({length:8},(_,i)=>({key:`sku-${i}`,notes:'not part of the failure'})),{key:'needle',notes:'noise'},{key:' NEEDLE ',notes:'noise'}]};
  const config={command:[process.execPath,program,'{input}'],expect:{exit_code:1,stream:'stderr',includes:'REPRO: collision'},preserve:['/schemaVersion']};
  await writeFile(input,JSON.stringify(value));
  await writeFile(program,checker);
  await writeFile(oraclePath,JSON.stringify(config));
  try {await run({directory,input,oraclePath,program,out,value,config});}
  finally {
    const resolved=path.resolve(directory);
    assert.ok(resolved.startsWith(`${parent}${path.sep}`)&&path.basename(resolved).startsWith('fixture-shrink-cli-'));
    await rm(resolved,{recursive:true,force:true});
  }
}

test('real process reduction keeps the observed business failure and rejects unrelated validation errors',async()=>{
  await fixture(async({input,oraclePath,program,out})=>{
    const original=await readFile(input);
    const report=await shrinkFile(input,oraclePath,out,{maxRuns:80});
    assert.equal(report.verified,true);
    assert.equal(report.status,'reduced');
    assert.ok(report.runs.length<=80);
    assert.equal(report.final_confirmations,2);
    const reduced=JSON.parse(await readFile(path.join(out,'reduced.json'),'utf8'));
    assert.equal(reduced.schemaVersion,1);
    assert.equal(reduced.items.length,2);
    assert.deepEqual(reduced.items.map(item=>Object.keys(item)),[['key'],['key']]);
    const replay=spawnSync(process.execPath,[program,path.join(out,'reduced.json')],{encoding:'utf8'});
    assert.equal(replay.status,1);
    assert.match(replay.stderr,/REPRO: collision/);
    assert.ok(report.runs.some(run=>run.verdict==='uninteresting'&&run.stderr.preview.includes('VALIDATION:')));
    assert.ok(report.reduction.accepted_reductions>0);
    assert.deepEqual(await readFile(input),original);
    assert.deepEqual((await readdir(out)).sort(),['reduced.json','report.json','report.md']);
    const disk=JSON.parse(await readFile(path.join(out,'report.json'),'utf8'));
    assert.equal(disk.result.sha256,report.result.sha256);
  });
});

test('six-run budget preserves final replays and returns an explicitly partial verified result',async()=>{
  await fixture(async({input,oraclePath,out})=>{
    const report=await shrinkFile(input,oraclePath,out,{maxRuns:6});
    assert.equal(report.status,'budget_exhausted');
    assert.equal(report.verified,true);
    assert.equal(report.runs.length,6);
    assert.deepEqual(report.runs.map(run=>run.phase),['baseline-original','baseline-original','baseline-normalized','baseline-normalized','final','final']);
    assert.equal(report.final_confirmations,2);
  });
});

test('the original must reproduce twice and normalized JSON must reproduce independently',async()=>{
  await fixture(async({directory,input,oraclePath,program,out,config})=>{
    await writeFile(program,`import{readFileSync}from'node:fs';const s=readFileSync(process.argv[2],'utf8');if(s.includes('"style":"compact"')){console.error('REPRO: collision');process.exit(1)}`);
    await writeFile(input,'{"style":"compact","schemaVersion":1}');
    const report=await shrinkFile(input,oraclePath,out);
    assert.equal(report.status,'normalization_rejected');
    assert.equal(report.verified,false);
    assert.equal(report.runs.length,3);
    await assert.rejects(access(path.join(out,'reduced.json')));
    const out2=path.join(directory,'wrong-matcher');
    await writeFile(oraclePath,JSON.stringify({...config,expect:{...config.expect,includes:'unrelated symptom'}}));
    const mismatch=await shrinkFile(input,oraclePath,out2);
    assert.equal(mismatch.status,'baseline_rejected');
    assert.equal(mismatch.runs.length,1);
    assert.equal(mismatch.result,null);
  });
});

test('final instability keeps an unverified candidate and never publishes reduced.json',async()=>{
  await fixture(async({directory,input,oraclePath,program,out,config})=>{
    const counter=path.join(directory,'counter.txt');
    await writeFile(program,`import{readFileSync,writeFileSync,existsSync}from'node:fs';const f=process.argv[3];const n=existsSync(f)?Number(readFileSync(f,'utf8'))+1:1;writeFileSync(f,String(n));if(n<=5){console.error('REPRO: collision');process.exit(1)}`);
    await writeFile(oraclePath,JSON.stringify({...config,command:[process.execPath,program,'{input}',counter]}));
    const report=await shrinkFile(input,oraclePath,out,{maxRuns:6});
    assert.equal(report.status,'unstable_result');
    assert.equal(report.verified,false);
    assert.equal(report.final_confirmations,1);
    assert.equal(report.result.path,'candidate.json');
    await assert.rejects(access(path.join(out,'reduced.json')));
  });
});

test('an oracle cannot change a candidate silently',async()=>{
  await fixture(async({input,oraclePath,program,out})=>{
    await writeFile(program,`import{writeFileSync}from'node:fs';writeFileSync(process.argv[2],'{}');console.error('REPRO: collision');process.exit(1)`);
    await assert.rejects(shrinkFile(input,oraclePath,out),/modified or replaced its candidate/);
    const report=JSON.parse(await readFile(path.join(out,'report.json'),'utf8'));
    assert.equal(report.status,'error');
    assert.equal(report.verified,false);
    assert.equal(report.runs[0].input_unchanged,false);
    await assert.rejects(access(path.join(out,'reduced.json')));
  });
});

test('candidate replacement with an identical hardlink cannot make the helper overwrite the original',async()=>{
  await fixture(async({input,oraclePath,program,out,config})=>{
    const original=await readFile(input);
    await writeFile(program,`import{unlinkSync,linkSync}from'node:fs';unlinkSync(process.argv[2]);linkSync(process.argv[3],process.argv[2]);console.error('REPRO: collision');process.exit(1)`);
    await writeFile(oraclePath,JSON.stringify({...config,command:[process.execPath,program,'{input}',input]}));
    await assert.rejects(shrinkFile(input,oraclePath,out),/modified or replaced/);
    assert.deepEqual(await readFile(input),original);
    const report=JSON.parse(await readFile(path.join(out,'report.json'),'utf8'));
    assert.equal(report.status,'error');
    assert.equal(report.runs.length,1);
    assert.equal(report.runs[0].input_unchanged,false);
    assert.ok((await readdir(out)).every(name=>!name.startsWith('.fixture-shrink-')));
  });
});

test('preflight validation and exclusive output prevent accidental overwrites or lossy input handling',async()=>{
  await fixture(async({directory,input,oraclePath,out})=>{
    await writeFile(input,'{"unsafe":9007199254740993}');
    await assert.rejects(shrinkFile(input,oraclePath,out),/safe|integer/i);
    await assert.rejects(access(out));
    await writeFile(input,Buffer.from([0x7b,0x22,0xff,0x22,0x3a,0x31,0x7d]));
    await assert.rejects(shrinkFile(input,oraclePath,out),/encoded data|encoding|UTF/i);
    await writeFile(input,'{"schemaVersion":1,"items":[]}');
    await assert.rejects(shrinkFile(input,oraclePath,directory),/EEXIST/);
    await assert.rejects(shrinkFile(input,oraclePath,out,{maxRuns:5}),/6 to 10000/);
    assert.ok((await readdir(directory)).includes('oracle.json'));
  });
});

test('CLI validates flags, exits distinctly for baseline rejection, and keeps stdout machine-readable',async()=>{
  await fixture(async({directory,input,oraclePath,out})=>{
    const command=(args)=>spawnSync(process.execPath,[cli,...args],{cwd:directory,encoding:'utf8'});
    for(const args of [[],[input,'--oracle',oraclePath],[input,'--oracle',oraclePath,'--out',out,'--max-runs','6.5'],[input,'--oracle',oraclePath,'--oracle',oraclePath,'--out',out]]) {
      const result=command(args);
      assert.equal(result.status,1,result.stderr);
      assert.equal(result.stdout,'');
    }
    const valid=command([input,'--oracle',oraclePath,'--out',out,'--max-runs','6']);
    assert.equal(valid.status,0,valid.stderr);
    assert.equal(JSON.parse(valid.stdout).status,'budget_exhausted');
    const wrong=path.join(directory,'missing-failure');
    await writeFile(input,'{"schemaVersion":1,"items":[]}');
    const rejected=command([input,'--oracle',oraclePath,'--out',wrong]);
    assert.equal(rejected.status,2,rejected.stderr);
    assert.equal(JSON.parse(rejected.stdout).verified,false);
  });
});
