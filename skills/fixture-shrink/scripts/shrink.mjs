import {readFile, writeFile, mkdir, unlink, stat, lstat} from 'node:fs/promises';
import path from 'node:path';
import {createHash, randomUUID} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {validateJSON, validatePreserve, minimize} from './reduce.mjs';
import {validateOracle, runOracle} from './oracle.mjs';

const fail = message => { throw new Error(message); };
const hash = value => createHash('sha256').update(value).digest('hex');
const serialize = value => `${JSON.stringify(value, null, 2)}\n`;

async function readBounded(file, maximum) {
  const info = await stat(file);
  if (!info.isFile() || info.size > maximum) fail(`Expected a regular file no larger than ${maximum} bytes: ${file}`);
  const buffer = await readFile(file);
  if (buffer.length > maximum) fail(`File exceeds ${maximum} bytes: ${file}`);
  // Invalid UTF-8 must not silently become replacement characters.
  new TextDecoder('utf-8', {fatal:true}).decode(buffer);
  return buffer;
}

function markdown(report) {
  const lines = ['# FixtureShrink result', '', `Status: **${report.status}**. Final replay verified: **${report.verified}**.`, '',
    `Oracle runs: ${report.runs.length}/${report.limits.max_runs}.`,
    `Original: ${report.source.bytes} bytes. Normalized: ${report.normalization.bytes} bytes.`,
    `Result: ${report.result ? `${report.result.bytes} bytes in ${report.result.path}` : 'no accepted result'}.`, '',
    'The matcher identifies an observed failure signature; it does not establish the same root cause or a global minimum.', '',
    '## Replay command', '', 'Arguments (no shell):', '', '```json', JSON.stringify(report.oracle.command), '```', '',
    'Replace the standalone {input} argument with the result file. Run from the recorded working directory, using the same program and environment.', '',
    '## Evidence', '', `Required exit code: ${report.oracle.expect.exit_code}. Required stream: ${report.oracle.expect.stream}.`, '',
    'Literal signature:', '', '```text', report.oracle.expect.includes, '```', '',
    'See report.json for the exact matcher, protected pointers, hashes, ordered run observations, and reduction trace. Output previews are bounded; classification uses the complete captured output within the configured byte limit.', '',
    'Review the fixture and report before sharing. No secret removal, process isolation, environment snapshot, or application source-drift verification is performed.'];
  if (report.note) lines.splice(4,0,report.note,'');
  return `${lines.join('\n')}\n`;
}

export async function shrinkFile(inputPath, oraclePath, outputPath, {maxRuns=80, cwd=process.cwd()}={}) {
  if (!Number.isSafeInteger(maxRuns) || maxRuns < 6 || maxRuns > 10000) fail('max-runs must be an integer from 6 to 10000');
  const sourcePath = path.resolve(inputPath);
  const output = path.resolve(outputPath);
  const workingDirectory = path.resolve(cwd);
  const source = await readBounded(sourcePath, 1048576);
  const originalHash = hash(source);
  const value = JSON.parse(source.toString('utf8').replace(/^\uFEFF/, ''));
  validateJSON(value);
  const configBytes = await readBounded(path.resolve(oraclePath),65536);
  const oracle = validateOracle(JSON.parse(configBytes.toString('utf8').replace(/^\uFEFF/, '')));
  // Validate protected paths before executing the user's command or creating output.
  validatePreserve(value,oracle.preserve);
  const normalized = serialize(value);
  await mkdir(output,{mode:0o700}); // Intentionally refuses to reuse an existing directory.
  const report = {
    format:1,tool:'FixtureShrink',version:'0.1.0',created_at:new Date().toISOString(),
    status:'in_progress',verified:false,
    source:{path:sourcePath,sha256:originalHash,bytes:source.length},
    oracle:{...oracle,cwd:workingDirectory},limits:{max_runs:maxRuns},
    normalization:{json_parse_stringify:true,bytes:Buffer.byteLength(normalized),sha256:hash(normalized),note:'Whitespace, number spelling, object-key ordering, and duplicate-key representation are normalized by JavaScript JSON parsing/serialization.'},
    runs:[],reduction:null,result:null,final_confirmations:0
  };

  const observe = async (bytes, phase, metadata={}) => {
    if (report.runs.length >= maxRuns) fail('Internal run budget exhausted');
    const candidatePath = path.join(output,`.fixture-shrink-${randomUUID()}.json`);
    await writeFile(candidatePath,bytes,{flag:'wx',mode:0o600});
    try {
      const identity=await lstat(candidatePath);
      const observed = await runOracle(oracle,candidatePath,{cwd:workingDirectory});
      let intact=false;
      try {
        const after=await lstat(candidatePath);
        intact=after.isFile()&&!after.isSymbolicLink()&&after.nlink===1&&after.dev===identity.dev&&after.ino===identity.ino&&after.size===Buffer.byteLength(bytes)
          &&hash(await readBounded(candidatePath,Math.max(1048576,Buffer.byteLength(bytes))))===hash(bytes);
      } catch { /* Missing or replaced candidate is a failed integrity check. */ }
      const preview = text => ({preview:text.slice(0,2048),preview_truncated:text.length>2048,sha256:hash(text)});
      report.runs.push({index:report.runs.length+1,phase,...metadata,input_sha256:hash(bytes),input_bytes:Buffer.byteLength(bytes),
        verdict:observed.verdict,exit_code:observed.exit_code,signal:observed.signal,timed_out:observed.timed_out,output_limited:observed.output_limited,
        stdout:preview(observed.stdout),stderr:preview(observed.stderr),duration_ms:observed.duration_ms,error:observed.error,input_unchanged:intact});
      if (!intact) fail('Oracle modified or replaced its candidate input; use a read-only oracle');
      return observed.verdict;
    } finally {
      await unlink(candidatePath).catch(error=>{if(error.code!=='ENOENT')throw error;});
    }
  };

  const finish = async (status, best, verified, note) => {
    report.status=status;
    report.verified=verified;
    if (note) report.note=note;
    if (best!==undefined) {
      const bytes=serialize(best);
      const filename=verified?'reduced.json':'candidate.json';
      await writeFile(path.join(output,filename),bytes,{flag:'wx',mode:0o600});
      report.result={path:filename,sha256:hash(bytes),bytes:Buffer.byteLength(bytes)};
    }
    await writeFile(path.join(output,'report.json'),serialize(report),{flag:'wx',mode:0o600});
    await writeFile(path.join(output,'report.md'),markdown(report),{flag:'wx',mode:0o600});
    return report;
  };

  try {
    for (let repeat=0;repeat<2;repeat++) {
      if (await observe(source,'baseline-original',{repeat:repeat+1})!=='interesting') {
        return await finish('baseline_rejected',undefined,false,'The original input did not match on both baseline runs. Check the command and use a specific, repeatable failure signature.');
      }
    }
    for (let repeat=0;repeat<2;repeat++) {
      if (await observe(normalized,'baseline-normalized',{repeat:repeat+1})!=='interesting') {
        return await finish('normalization_rejected',undefined,false,'The normalized JSON did not preserve the required signature. This reducer works on JSON structure, not byte-sensitive inputs.');
      }
    }
    const reduction=await minimize(value,{
      maxCandidates:maxRuns,preserve:oracle.preserve,
      test:async (candidate, metadata) => {
        // Keep two final replays available, and allow two confirmations for an accepted candidate.
        if (report.runs.length+4>maxRuns) return 'stop';
        const bytes=serialize(candidate);
        const first=await observe(bytes,'candidate',{...metadata,repeat:1});
        if (first!=='interesting') return first;
        const second=await observe(bytes,'candidate',{...metadata,repeat:2});
        return second==='interesting'?'interesting':'unresolved';
      }
    });
    report.reduction={candidates_tested:reduction.candidates_tested,accepted_reductions:reduction.accepted_reductions,reason:reduction.reason,trace:reduction.trace};
    const best=serialize(reduction.value);
    for (let repeat=0;repeat<2;repeat++) {
      if (await observe(best,'final',{repeat:repeat+1})!=='interesting') {
        return await finish('unstable_result',reduction.value,false,'Final replay did not preserve the matcher twice. The candidate is unverified; investigate flakiness or stateful side effects.');
      }
      report.final_confirmations++;
    }
    if (hash(await readBounded(sourcePath,1048576))!==originalHash) {
      return await finish('source_changed',reduction.value,false,'The original input changed during this run. The tool does not edit it; inspect oracle side effects or concurrent writers.');
    }
    const status=reduction.reason==='budget_exhausted'?'budget_exhausted':reduction.accepted_reductions?'reduced':'unchanged';
    return await finish(status,reduction.value,true);
  } catch (error) {
    // Preserve observed evidence on an operational failure without labeling a fixture verified.
    if (report.status==='in_progress') {
      await finish('error',undefined,false,error.message).catch(()=>{});
    }
    throw error;
  }
}

if (process.argv[1] && import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href) {
  const usage='Usage: node shrink.mjs <input.json> --oracle <oracle.json> --out <new-directory> [--max-runs N]';
  try {
    const args=process.argv.slice(2);
    if (args.length===1 && args[0]==='--help') process.stdout.write(`${usage}\n`);
    else {
      if (!args[0] || args[0].startsWith('--')) fail(usage);
      const options={};
      for (let index=1;index<args.length;index+=2) {
        const flag=args[index],value=args[index+1];
        if (!['--oracle','--out','--max-runs'].includes(flag)||!value||value.startsWith('--')||Object.hasOwn(options,flag)) fail(usage);
        options[flag]=value;
      }
      if (!options['--oracle']||!options['--out']) fail(usage);
      const count=options['--max-runs'];
      if (count!==undefined && !/^[1-9]\d*$/.test(count)) fail('max-runs must be an integer from 6 to 10000');
      const report=await shrinkFile(args[0],options['--oracle'],options['--out'],{maxRuns:count===undefined?80:Number(count)});
      process.stdout.write(`${JSON.stringify({status:report.status,verified:report.verified,original_bytes:report.source.bytes,normalized_bytes:report.normalization.bytes,result_bytes:report.result?.bytes??null,oracle_runs:report.runs.length,max_runs:report.limits.max_runs,output:path.resolve(options['--out'])},null,2)}\n`);
      process.exitCode=report.verified?0:report.status==='unstable_result'?3:2;
    }
  } catch(error) {
    console.error(`FixtureShrink: ${error.message}`);
    process.exitCode=1;
  }
}
