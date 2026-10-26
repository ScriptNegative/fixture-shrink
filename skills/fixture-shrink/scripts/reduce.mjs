const fail = message => { throw new Error(message); };
const own = (value, key) => Object.hasOwn(value, key);
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value)
  && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const escaped = value => value.replaceAll('~', '~0').replaceAll('/', '~1');
const pointer = tokens => tokens.length ? `/${tokens.map(escaped).join('/')}` : '';
const bytes = value => Buffer.byteLength(JSON.stringify(value), 'utf8');

export function validateJSON(value) {
  const ancestors = new Set();
  let nodes = 0;
  function inspect(node, depth, tokens) {
    if (++nodes > 100000) fail('JSON exceeds the 100000-node limit');
    if (depth > 64) fail('JSON exceeds the depth limit of 64');
    const location = pointer(tokens) || '<root>';
    if (node === null || typeof node === 'string' || typeof node === 'boolean') return;
    if (typeof node === 'number') {
      if (!Number.isFinite(node)) fail(`${location}: JSON numbers must be finite`);
      if (Number.isInteger(node) && !Number.isSafeInteger(node)) fail(`${location}: unsafe integer; encode large identifiers as strings`);
      return;
    }
    if (!Array.isArray(node) && !plain(node)) fail(`${location}: expected only JSON values and plain objects`);
    if (ancestors.has(node)) fail(`${location}: JSON cannot contain a cycle`);
    ancestors.add(node);
    const keys = Reflect.ownKeys(node);
    if (keys.some(key => typeof key !== 'string')) fail(`${location}: symbol properties are not JSON`);
    if (Array.isArray(node)) {
      if (keys.length !== node.length + 1) fail(`${location}: arrays must be dense and have no extra properties`);
      for (let index = 0; index < node.length; index++) {
        const descriptor = Object.getOwnPropertyDescriptor(node, String(index));
        if (!descriptor || !descriptor.enumerable || !own(descriptor, 'value')) fail(`${location}: arrays must contain ordinary enumerable values`);
        inspect(descriptor.value, depth + 1, [...tokens, String(index)]);
      }
    } else {
      for (const key of keys) {
        const descriptor = Object.getOwnPropertyDescriptor(node, key);
        if (!descriptor.enumerable || !own(descriptor, 'value')) fail(`${location}: object properties must be ordinary enumerable values`);
        inspect(descriptor.value, depth + 1, [...tokens, key]);
      }
    }
    ancestors.delete(node);
  }
  inspect(value, 0, []);
  return value;
}

function member(object, key, value) {
  Object.defineProperty(object, key, {value, enumerable: true, writable: true, configurable: true});
}

function clone(value) {
  if (Array.isArray(value)) return value.map(clone);
  if (value !== null && typeof value === 'object') {
    const result = {};
    for (const key of Object.keys(value)) member(result, key, clone(value[key]));
    return result;
  }
  return value;
}

function parsePointer(value) {
  if (typeof value !== 'string' || (value !== '' && !value.startsWith('/'))) fail('preserve entries must be RFC 6901 JSON pointers');
  if (/~(?:[^01]|$)/.test(value)) fail(`Invalid JSON pointer escape: ${value}`);
  return value === '' ? [] : value.slice(1).split('/').map(token => token.replaceAll('~1', '/').replaceAll('~0', '~'));
}

function resolve(value, tokens, strict = false) {
  let current = value;
  for (const token of tokens) {
    if (current === null || typeof current !== 'object') return {found: false};
    if (Array.isArray(current) && !/^(0|[1-9][0-9]*)$/.test(token)) {
      if (strict) fail(`Noncanonical array index in preserve pointer: ${token}`);
      return {found: false};
    }
    if (!own(current, token)) return {found: false};
    current = current[token];
  }
  return {found: true, value: current};
}

export function validatePreserve(input, preserve = []) {
  validateJSON(input);
  if (!Array.isArray(preserve)) fail('preserve must be an array of JSON pointers');
  return Array.from(preserve, item => {
    const tokens = parsePointer(item);
    const original = resolve(input, tokens, true);
    if (!original.found) fail(`Preserve pointer does not resolve: ${item}`);
    return {tokens, json: JSON.stringify(original.value)};
  });
}

function replacing(root, tokens, replacement) {
  if (!tokens.length) return replacement;
  const [key, ...rest] = tokens;
  if (Array.isArray(root)) {
    const result = root.slice();
    result[Number(key)] = replacing(root[Number(key)], rest, replacement);
    return result;
  }
  const result = {};
  for (const item of Object.keys(root)) member(result, item, item === key ? replacing(root[item], rest, replacement) : root[item]);
  return result;
}

function sizes(length) {
  const result = [];
  for (let size = length; size > 0; size = size === 1 ? 0 : Math.ceil(size / 2)) result.push(size);
  return result;
}

function* transformations(root, node = root, tokens = []) {
  if (node === null || typeof node !== 'object') return;
  const keys = Object.keys(node);
  for (const size of sizes(keys.length)) {
    for (let start = 0; start + size <= keys.length; start++) {
      const end = start + size;
      let replacement;
      if (Array.isArray(node)) replacement = [...node.slice(0, start), ...node.slice(end)];
      else {
        replacement = {};
        for (let index = 0; index < keys.length; index++) {
          if (index < start || index >= end) member(replacement, keys[index], node[keys[index]]);
        }
      }
      yield {
        value: replacing(root, tokens, replacement),
        operation: `${Array.isArray(node) ? 'remove_array_items' : 'remove_object_members'}[${start}:${end}]`,
        path: pointer(tokens)
      };
    }
  }
  for (const key of keys) yield* transformations(root, node[key], [...tokens, key]);
}

export async function minimize(input, options = {}) {
  if (!plain(options)) fail('options must be an object');
  for (const key of Object.keys(options)) if (!['test', 'maxCandidates', 'preserve'].includes(key)) fail(`Unknown reducer option: ${key}`);
  const {test, maxCandidates = 100, preserve = []} = options;
  if (typeof test !== 'function') fail('test must be a callback');
  if (!Number.isSafeInteger(maxCandidates) || maxCandidates < 0) fail('maxCandidates must be a non-negative safe integer');
  const guards = validatePreserve(input, preserve);
  let value = clone(input);
  let candidates_tested = 0;
  let accepted_reductions = 0;
  const trace = [];
  // Cache validity assumes an oracle stable for the same serialized JSON.
  const cache = new Map();
  const result = reason => ({value, candidates_tested, accepted_reductions, reason, trace});
  if (guards.some(guard => guard.tokens.length === 0)) return result('fixed_point');
  if (maxCandidates === 0) return result(value !== null && typeof value === 'object' && Object.keys(value).length ? 'budget_exhausted' : 'fixed_point');
  while (true) {
    const currentBytes = bytes(value);
    let accepted = false;
    for (const candidate of transformations(value)) {
      const json = JSON.stringify(candidate.value);
      if (Buffer.byteLength(json, 'utf8') >= currentBytes) continue;
      if (guards.some(guard => {
        const found = resolve(candidate.value, guard.tokens);
        return !found.found || JSON.stringify(found.value) !== guard.json;
      })) continue;
      if (cache.has(json)) continue;
      if (candidates_tested >= maxCandidates) return result('budget_exhausted');
      const metadata = {operation: candidate.operation, path: candidate.path};
      const verdict = await test(clone(candidate.value), {...metadata});
      candidates_tested++;
      if (!['interesting', 'uninteresting', 'unresolved', 'stop'].includes(verdict)) fail(`Unknown test verdict: ${String(verdict)}`);
      const keep = verdict === 'interesting';
      trace.push({...metadata, verdict, accepted: keep});
      if (verdict === 'stop') return result('budget_exhausted');
      if (verdict !== 'unresolved') cache.set(json, verdict);
      if (keep) {
        value = candidate.value;
        accepted_reductions++;
        accepted = true;
        break;
      }
    }
    if (!accepted) return result('fixed_point');
  }
}
