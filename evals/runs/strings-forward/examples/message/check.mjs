import {readFile} from 'node:fs/promises';
import {decodeMessage} from './service.mjs';

try {
  if (process.argv.length!==3) throw new Error('expected one JSON input path');
  const envelope=JSON.parse((await readFile(process.argv[2],'utf8')).replace(/^\uFEFF/,''));
  if (envelope===null || typeof envelope!=='object' || Array.isArray(envelope)) throw new Error('expected an envelope object');
  if (envelope.schemaVersion!==1) throw new Error('schemaVersion must be 1');
  if (typeof envelope.message!=='string' || !envelope.message.startsWith('note:') || envelope.message.length<=5) throw new Error('expected note: followed by nonempty content');
  const expected=envelope.message.slice('note:'.length);
  const actual=decodeMessage(envelope.message);
  if (actual!==expected) {
    console.error('REPRO: truncated-message');
    process.exitCode=1;
  } else console.log('PASS: all content after the first delimiter is preserved');
} catch(error) {
  console.error(`VALIDATION: ${error.message}`);
  process.exitCode=1;
}
