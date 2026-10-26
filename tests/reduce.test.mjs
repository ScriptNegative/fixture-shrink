import test from 'node:test';
import assert from 'node:assert/strict';
import {validateJSON, validatePreserve, minimize} from '../skills/fixture-shrink/scripts/reduce.mjs';

const retain = condition => async candidate => condition(candidate) ? 'interesting' : 'uninteresting';
const size = value => Buffer.byteLength(JSON.stringify(value), 'utf8');

test('valid JSON primitives, nested structures, safe numbers and special object keys validate', () => {
  for (const value of [null, true, false, '', '😀', 0, -0, 1.5, Number.MAX_SAFE_INTEGER, [], {}, {a:[null,{b:'value'}]}]) {
    assert.equal(validateJSON(value),value);
  }
  const special = JSON.parse('{"__proto__":{"flag":true},"constructor":"text","":"empty key"}');
  assert.equal(validateJSON(special),special);
  const emptyPrototype = Object.create(null);
  emptyPrototype.a = 1;
  assert.equal(validateJSON(emptyPrototype),emptyPrototype);
});

test('validation rejects non-JSON values, non-finite and unsafe numbers, cycles, getters and sparse arrays', () => {
  const cycle = {}; cycle.self = cycle;
  const getter = {}; Object.defineProperty(getter,'x',{enumerable:true,get(){throw new Error('getter ran');}});
  const hidden = {}; Object.defineProperty(hidden,'x',{value:1});
  const symbol = {[Symbol('key')]:1};
  const extra = [1]; extra.other = 2;
  for (const value of [undefined, ()=>{}, 1n, Symbol('x'), NaN, Infinity, -Infinity, Number.MAX_SAFE_INTEGER+1, new Date(), new Map(), cycle, getter, hidden, symbol, [,1],extra]) {
    assert.throws(()=>validateJSON(value));
  }
  assert.throws(()=>validateJSON(getter),/ordinary enumerable/);
});

test('validation bounds depth and expanded node count', () => {
  let atLimit = null;
  for (let index=0; index<64; index++) atLimit=[atLimit];
  assert.doesNotThrow(()=>validateJSON(atLimit));
  assert.throws(()=>validateJSON([atLimit]),/depth/);
  assert.doesNotThrow(()=>validateJSON(Array(99999).fill(null)));
  assert.throws(()=>validateJSON(Array(100000).fill(null)),/node/);
});

test('object member reduction retains only fields needed by the oracle', async () => {
  const input={noise:1,trigger:{left:'needle',right:'other',noise:[1,2,3]},unused:true};
  const result=await minimize(input,{test:retain(candidate=>candidate.trigger?.left==='needle'&&candidate.trigger?.right==='other')});
  assert.deepEqual(result.value,{trigger:{left:'needle',right:'other'}});
  assert.equal(result.reason,'fixed_point');
  assert.ok(result.accepted_reductions>0);
  assert.equal(result.candidates_tested,result.trace.length);
  assert.equal(result.accepted_reductions,result.trace.filter(item=>item.accepted).length);
  assert.ok(size(result.value)<size(input));
});

test('array chunks preserve order and retain a needed pair even when unrelated errors occur', async () => {
  const input={items:[{id:'noise-1'},{id:'a'},{id:'noise-2'},{id:'b'},{id:'noise-3'}],other:'remove'};
  const result=await minimize(input,{test:async candidate=>{
    if(!Array.isArray(candidate.items)) return 'uninteresting';
    return candidate.items.some(item=>item?.id==='a')&&candidate.items.some(item=>item?.id==='b')?'interesting':'uninteresting';
  }});
  assert.deepEqual(result.value,{items:[{id:'a'},{id:'b'}]});
  assert.equal(result.reason,'fixed_point');
});

test('traversal restarts at the root after acceptance and produces deterministic traces', async () => {
  const input={a:[0,1,2,3],b:{left:true,right:false},noise:100};
  const options={test:retain(candidate=>candidate.a?.includes(2)&&candidate.b?.left===true)};
  const first=await minimize(input,options);
  const second=await minimize(input,options);
  assert.deepEqual(first,second);
  assert.deepEqual(first.value,{a:[2],b:{left:true}});
});

test('accepted candidates are strictly smaller in UTF-8 and string contents stay unchanged', async () => {
  const input={keep:'😀e\u0301漢字',drop:'x'.repeat(20),nested:[null,'😀']};
  let previous=size(input);
  const result=await minimize(input,{test:async candidate=>{
    if(candidate.keep!==input.keep)return 'uninteresting';
    assert.ok(size(candidate)<previous);
    previous=size(candidate);
    return 'interesting';
  }});
  assert.deepEqual(result.value,{keep:'😀e\u0301漢字'});
});

test('preserved pointers protect a subtree and reject deletions of ancestors', async () => {
  const input={payload:{required:{value:42,extra:'keep'},noise:1},unused:[1,2]};
  const result=await minimize(input,{test:retain(()=>true),preserve:['/payload/required']});
  assert.deepEqual(result.value,{payload:{required:{value:42,extra:'keep'}}});
  assert.equal(result.reason,'fixed_point');
});

test('array preservation means the same value remains at the same canonical index', async () => {
  const input={items:['first','protected','third','fourth'],drop:true};
  const result=await minimize(input,{test:retain(()=>true),preserve:['/items/1']});
  assert.deepEqual(result.value,{items:['first','protected']});
});

test('RFC 6901 escapes, empty keys and root preservation work', async () => {
  const input={'a/b':{'~key':{value:'keep'},noise:true},'':{x:1},drop:true};
  const escaped=await minimize(input,{test:retain(()=>true),preserve:['/a~1b/~0key/value','//x']});
  assert.deepEqual(escaped.value,{'a/b':{'~key':{value:'keep'}},'':{x:1}});
  const root=await minimize(input,{test:()=>{throw new Error('should not run');},preserve:['']});
  assert.deepEqual(root.value,input);
  assert.equal(root.candidates_tested,0);
  assert.equal(root.reason,'fixed_point');
});

test('invalid and unresolved preservation pointers fail before invoking the oracle', async () => {
  const input={items:[1,2],object:{'01':'valid object key'}};
  for(const preserve of [['items'],['/~2'],['/~'],['/missing'],['/items/01'],['/items/-'],['/items/2'],['/items/0/x'],[null],Array(1)]) {
    await assert.rejects(()=>minimize(input,{test:()=>{throw new Error('should not run');},preserve}));
  }
  assert.doesNotThrow(()=>validateJSON(input));
  const valid=await minimize(input,{test:retain(()=>true),preserve:['/object/01']});
  assert.deepEqual(valid.value,{object:{'01':'valid object key'}});
});

test('preservation validation has no transformation side effects and a zero budget still validates pointers', async () => {
  const input={items:[{name:'first'}, {name:'kept'}],other:'unchanged'};
  const before=structuredClone(input);
  assert.deepEqual(validatePreserve(input,['/items/1/name']),[{tokens:['items','1','name'],json:'"kept"'}]);
  assert.deepEqual(validatePreserve(input),[]);
  assert.throws(()=>validatePreserve(input,['/items/01']),/Noncanonical/);
  assert.throws(()=>validatePreserve(input,['/absent']),/does not resolve/);
  assert.deepEqual(input,before);
  await assert.rejects(()=>minimize(input,{maxCandidates:0,preserve:['/absent'],test:()=>{throw new Error('should not run');}}),/does not resolve/);
});

test('a large root-preserved fixture short-circuits without candidate enumeration or oracle calls', async () => {
  const input=Array.from({length:2000},(_,index)=>({id:index,label:`record-${index}`,nested:[index,true]}));
  const result=await minimize(input,{maxCandidates:0,preserve:[''],test:()=>{throw new Error('should not run');}});
  assert.deepEqual(result.value,input);
  assert.notEqual(result.value,input);
  assert.equal(result.reason,'fixed_point');
  assert.equal(result.candidates_tested,0);
  assert.deepEqual(result.trace,[]);
});

test('prototype-like keys remain ordinary own data while removing unrelated properties', async () => {
  const input=JSON.parse('{"__proto__":{"required":true,"noise":1},"constructor":{"keep":"yes","drop":false},"noise":"gone"}');
  const before=JSON.stringify(input);
  const result=await minimize(input,{test:retain(candidate=>Object.hasOwn(candidate,'__proto__')&&candidate.__proto__.required===true&&Object.hasOwn(candidate,'constructor')&&candidate.constructor.keep==='yes')});
  assert.equal(JSON.stringify(input),before);
  assert.deepEqual(result.value,JSON.parse('{"__proto__":{"required":true},"constructor":{"keep":"yes"}}'));
  assert.equal(Object.getPrototypeOf(result.value),Object.prototype);
  assert.equal(Object.prototype.required,undefined);
});

test('oracle mutation cannot affect the input, accepted internal candidate, or trace metadata', async () => {
  const input={keep:{value:'same'},noise:[1,2]};
  const before=structuredClone(input);
  const result=await minimize(input,{test:async(candidate,metadata)=>{
    const interesting=candidate.keep?.value==='same';
    if(candidate.keep)candidate.keep.value='changed by oracle';
    metadata.operation='changed';
    return interesting?'interesting':'uninteresting';
  }});
  assert.deepEqual(input,before);
  assert.deepEqual(result.value,{keep:{value:'same'}});
  assert.ok(result.trace.every(item=>item.operation!=='changed'));
  result.value.keep.value='changed after result';
  assert.deepEqual(input,before);
});

test('candidate budget bounds actual calls and preserves the last accepted result', async () => {
  const input={first:1,second:2,third:3};
  let calls=0;
  const result=await minimize(input,{maxCandidates:1,test:async candidate=>{calls++;return Object.hasOwn(candidate,'second')?'interesting':'uninteresting';}});
  assert.equal(calls,1);
  assert.equal(result.candidates_tested,1);
  assert.equal(result.reason,'budget_exhausted');
  assert.deepEqual(result.value,input);
  const zero=await minimize(input,{maxCandidates:0,test:()=>{throw new Error('should not run');}});
  assert.equal(zero.candidates_tested,0);
  assert.equal(zero.reason,'budget_exhausted');
});

test('stop verdict is recorded and stops immediately without accepting its candidate', async () => {
  const input=[1,2,3];
  const result=await minimize(input,{test:async()=> 'stop'});
  assert.equal(result.reason,'budget_exhausted');
  assert.deepEqual(result.value,input);
  assert.equal(result.candidates_tested,1);
  assert.deepEqual(result.trace,[{operation:'remove_array_items[0:3]',path:'',verdict:'stop',accepted:false}]);
});

test('unresolved verdicts never accept a candidate or masquerade as interesting', async () => {
  const input={a:1,b:2};
  const result=await minimize(input,{test:async()=> 'unresolved'});
  assert.deepEqual(result.value,input);
  assert.equal(result.accepted_reductions,0);
  assert.ok(result.trace.length>0);
  assert.ok(result.trace.every(item=>item.verdict==='unresolved'&&!item.accepted));
});

test('exact JSON caching avoids repeatedly testing a stable rejected candidate', async () => {
  const observed=[];
  const input={a:1,b:2,c:3};
  const result=await minimize(input,{test:async candidate=>{
    const json=JSON.stringify(candidate);
    observed.push(json);
    return Object.hasOwn(candidate,'c')?'interesting':'uninteresting';
  }});
  assert.deepEqual(result.value,{c:3});
  assert.equal(new Set(observed).size,observed.length);
  assert.equal(result.candidates_tested,observed.length);
});

test('scalar values, empty objects and arrays reach a fixed point without oracle calls', async () => {
  for(const input of [null,true,12,1.25,-0,'😀',{},[]]) {
    const result=await minimize(input,{maxCandidates:0,test:()=>{throw new Error('should not run');}});
    assert.deepEqual(result.value,input);
    assert.equal(result.reason,'fixed_point');
    assert.equal(result.candidates_tested,0);
  }
});

test('invalid options and callback outcomes are rejected rather than guessed', async () => {
  const okay=async()=> 'uninteresting';
  for(const options of [null,[],{test:okay,extra:true},{test:42},{test:okay,maxCandidates:-1},{test:okay,maxCandidates:1.5},{test:okay,maxCandidates:Infinity},{test:okay,preserve:'/'},{maxCandidates:1}]) {
    await assert.rejects(()=>minimize({a:1},options));
  }
  for(const verdict of [true,false,null,undefined,'passed']) await assert.rejects(()=>minimize({a:1},{test:async()=>verdict}),/verdict/);
  await assert.rejects(()=>minimize({a:1},{test:async()=>{throw new Error('oracle failed');}}),/oracle failed/);
});

test('string reduction is opt-in and explicit false preserves the structural strategy exactly', async () => {
  const input={keep:'before:needle:after',noise:[1,2,3]};
  const test=retain(candidate=>typeof candidate.keep==='string'&&candidate.keep.includes('needle'));
  const legacy=await minimize(input,{test});
  const explicit=await minimize(input,{test,shrinkStrings:false});
  assert.deepEqual(explicit,legacy);
  assert.deepEqual(legacy.value,{keep:input.keep});
  const strings=await minimize(input,{test,shrinkStrings:true,maxCandidates:200});
  assert.deepEqual(strings.value,{keep:'needle'});
  assert.ok(strings.trace.some(item=>item.operation.startsWith('remove_string_chunks[')&&item.path==='/keep'&&item.accepted));
  assert.deepEqual(input,{keep:'before:needle:after',noise:[1,2,3]});
});

test('root strings shrink by Unicode code points without splitting surrogate pairs or normalizing text', async () => {
  const input='xx😀zz e\u0301yy漢字';
  const observed=[];
  const result=await minimize(input,{shrinkStrings:true,maxCandidates:300,test:retain(candidate=>{
    assert.equal(typeof candidate,'string');
    for(let index=0;index<candidate.length;index++) {
      const unit=candidate.charCodeAt(index);
      if(unit>=0xd800&&unit<=0xdbff) {
        assert.ok(index+1<candidate.length);
        const next=candidate.charCodeAt(++index);
        assert.ok(next>=0xdc00&&next<=0xdfff);
      } else assert.ok(unit<0xdc00||unit>0xdfff);
    }
    observed.push(candidate);
    return candidate.includes('😀')&&candidate.includes('e\u0301');
  })});
  assert.equal(result.value,'😀e\u0301');
  assert.ok(observed.length>0);
  assert.ok(result.trace.every(item=>item.path===''));
  const empty=await minimize('',{shrinkStrings:true,test:()=>{throw new Error('no characters to remove');}});
  assert.equal(empty.reason,'fixed_point');
  assert.equal(empty.candidates_tested,0);
});

test('protected strings and subtrees retain exact values while unrelated string values shrink', async () => {
  const input={locked:{message:'😀'.repeat(3000)},payload:{'a/b':'prefix:needle:suffix'},count:42,enabled:false,empty:null};
  const result=await minimize(input,{shrinkStrings:true,maxCandidates:200,preserve:['/locked'],test:retain(candidate=>
    typeof candidate.payload?.['a/b']==='string'&&candidate.payload['a/b'].includes('needle')&&candidate.count===42&&candidate.enabled===false&&Object.hasOwn(candidate,'empty')&&candidate.empty===null
  )});
  assert.equal(result.value.locked.message,input.locked.message);
  assert.equal(result.value.payload['a/b'],'needle');
  assert.ok(result.trace.some(item=>item.operation.startsWith('remove_string_chunks[')&&item.path==='/payload/a~1b'));
  assert.ok(result.trace.every(item=>!item.path.startsWith('/locked')));
  assert.equal(result.value.count,42);
  assert.equal(result.value.enabled,false);
  assert.equal(result.value.empty,null);
  const protectedRoot=await minimize('a😀b',{shrinkStrings:true,preserve:[''],test:()=>{throw new Error('protected root');}});
  assert.equal(protectedRoot.value,'a😀b');
  assert.equal(protectedRoot.candidates_tested,0);
});

test('string values under prototype-like keys shrink without modifying keys or input objects', async () => {
  const input=JSON.parse('{"__proto__":"noise needle noise","constructor":"retain"}');
  const before=JSON.stringify(input);
  const result=await minimize(input,{shrinkStrings:true,preserve:['/constructor'],test:retain(candidate=>Object.hasOwn(candidate,'__proto__')&&candidate.__proto__.includes('needle'))});
  assert.deepEqual(Object.keys(result.value),['__proto__','constructor']);
  assert.equal(result.value.__proto__,'needle');
  assert.equal(result.value.constructor,'retain');
  assert.equal(Object.getPrototypeOf(result.value),Object.prototype);
  assert.equal(JSON.stringify(input),before);
});

test('string mode respects candidate budgets, stop verdicts, and exact candidate caching', async () => {
  let calls=0;
  const input='aaa needle aaa';
  const limited=await minimize(input,{shrinkStrings:true,maxCandidates:1,test:async()=>{calls++;return 'uninteresting';}});
  assert.equal(calls,1);
  assert.equal(limited.reason,'budget_exhausted');
  assert.equal(limited.value,input);
  const zero=await minimize(input,{shrinkStrings:true,maxCandidates:0,test:()=>{throw new Error('no budget');}});
  assert.equal(zero.reason,'budget_exhausted');
  const stopped=await minimize(input,{shrinkStrings:true,test:async()=> 'stop'});
  assert.equal(stopped.reason,'budget_exhausted');
  assert.equal(stopped.candidates_tested,1);
  assert.equal(stopped.trace[0].accepted,false);
  const seen=[];
  const cached=await minimize(input,{shrinkStrings:true,maxCandidates:200,test:retain(candidate=>{seen.push(candidate);return candidate.includes('needle');})});
  assert.equal(cached.value,'needle');
  assert.equal(new Set(seen).size,seen.length);
});

test('string mode rejects ambiguous option values before any callback', async () => {
  for(const shrinkStrings of [null,0,1,'true',[],{}]) {
    await assert.rejects(()=>minimize('needle',{shrinkStrings,test:()=>{throw new Error('should not run');}}),/boolean/);
  }
});
