import {spawn} from 'node:child_process';
import path from 'node:path';
import {performance} from 'node:perf_hooks';

const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const fail = message => { throw new Error(message); };
const nonblank = value => typeof value === 'string' && value.trim().length > 0;

function fields(value, allowed, required, label) {
  if (!object(value)) fail(`${label} must be an object`);
  for (const key of Object.keys(value)) if (!allowed.includes(key)) fail(`Unknown ${label} field: ${key}`);
  for (const key of required) if (!Object.hasOwn(value, key)) fail(`Missing ${label} field: ${key}`);
}

function integer(value, minimum, maximum, label) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) fail(`${label} must be an integer from ${minimum} to ${maximum}`);
  return value;
}

export function validateOracle(config) {
  fields(config, ['command', 'expect', 'timeout_ms', 'max_output_bytes', 'preserve'], ['command', 'expect'], 'oracle');
  if (!Array.isArray(config.command) || !config.command.length || config.command.some(argument => !nonblank(argument))) {
    fail('command must be a non-empty array of non-blank strings');
  }
  if (config.command[0] === '{input}' || config.command.filter(argument => argument === '{input}').length !== 1 || config.command.some(argument => argument.includes('{input}') && argument !== '{input}')) {
    fail('command requires exactly one standalone {input} argument, after the executable');
  }
  fields(config.expect, ['exit_code', 'stream', 'includes'], ['exit_code', 'stream', 'includes'], 'expect');
  const exit_code = integer(config.expect.exit_code, 1, 255, 'expect.exit_code');
  if (!['stdout', 'stderr'].includes(config.expect.stream)) fail('expect.stream must be stdout or stderr');
  if (!nonblank(config.expect.includes)) fail('expect.includes must be a non-blank literal string');
  const timeout_ms = integer(config.timeout_ms === undefined ? 3000 : config.timeout_ms, 50, 60000, 'timeout_ms');
  const max_output_bytes = integer(config.max_output_bytes === undefined ? 65536 : config.max_output_bytes, 1024, 1048576, 'max_output_bytes');
  const preserve = config.preserve === undefined ? [] : config.preserve;
  if (!Array.isArray(preserve) || preserve.some(pointer => typeof pointer !== 'string' || !/^(?:\/(?:[^~]|~[01])*)*$/.test(pointer))) {
    fail('preserve must be an array of RFC 6901 JSON Pointer strings');
  }
  return {command: [...config.command], expect: {exit_code, stream: config.expect.stream, includes: config.expect.includes}, timeout_ms, max_output_bytes, preserve: [...new Set(preserve)]};
}

export async function runOracle(inputConfig, inputPath, {cwd = process.cwd()} = {}) {
  const config = validateOracle(inputConfig);
  if (!nonblank(inputPath)) fail('inputPath must be a non-blank path string');
  if (!nonblank(cwd)) fail('cwd must be a non-blank path string');
  const started = performance.now();
  return new Promise(resolve => {
    const output = {stdout: [], stderr: []};
    let bytes = 0;
    let child;
    let timedOut = false;
    let outputLimited = false;
    let failure = null;
    let settled = false;
    let terminating = false;
    let exitCode = null;
    let exitSignal = null;
    let timeout;
    let forceClose;

    function finish(code = exitCode, signal = exitSignal) {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      clearTimeout(forceClose);
      let stdout = Buffer.concat(output.stdout).toString('utf8');
      let stderr = Buffer.concat(output.stderr).toString('utf8');
      if (!outputLimited) {
        try {
          const decoder = new TextDecoder('utf-8', {fatal: true});
          stdout = decoder.decode(Buffer.concat(output.stdout));
          stderr = decoder.decode(Buffer.concat(output.stderr));
        } catch {
          failure ??= 'Oracle output is not valid UTF-8';
        }
      }
      const exit_code = Number.isInteger(code) ? code : null;
      const actualSignal = typeof signal === 'string' ? signal : null;
      if (actualSignal) failure ??= `Oracle terminated by signal ${actualSignal}`;
      if (exit_code === null && !failure) failure = 'Oracle did not complete with an exit code';
      const unresolved = timedOut || outputLimited || failure !== null || actualSignal !== null || exit_code === null;
      const selectedOutput = config.expect.stream === 'stdout' ? stdout : stderr;
      resolve({
        verdict: unresolved ? 'unresolved' : exit_code === config.expect.exit_code && selectedOutput.includes(config.expect.includes) ? 'interesting' : 'uninteresting',
        exit_code,
        signal: actualSignal,
        timed_out: timedOut,
        output_limited: outputLimited,
        stdout,
        stderr,
        duration_ms: Math.max(0, Math.round(performance.now() - started)),
        error: failure
      });
    }

    function directKill() {
      if (child && child.exitCode === null && child.signalCode === null) {
        try { child.kill('SIGKILL'); } catch (error) { failure ??= `Could not stop oracle: ${error.message}`; }
      }
    }

    function terminate() {
      if (terminating || settled) return;
      terminating = true;
      // Closing inherited pipes is bounded even if a detached descendant escapes
      // the process group or its parent exits before Windows can inspect the tree.
      forceClose = setTimeout(() => {
        failure ??= 'Oracle streams remained open after termination; detached descendants may still be running';
        child?.stdout?.destroy();
        child?.stderr?.destroy();
        directKill();
        finish();
      }, 1500);
      if (!child?.pid) { finish(); return; }
      if (process.platform === 'win32') {
        if (child.exitCode !== null || child.signalCode !== null) return;
        const executable = path.join(process.env.SystemRoot || process.env.WINDIR || 'C:\\Windows', 'System32', 'taskkill.exe');
        try {
          const killer = spawn(executable, ['/PID', String(child.pid), '/T', '/F'], {shell: false, windowsHide: true, stdio: 'ignore', timeout: 1000});
          killer.once('error', directKill);
          killer.once('close', directKill);
          killer.unref();
        } catch { directKill(); }
      } else {
        try { process.kill(-child.pid, 'SIGKILL'); }
        catch (error) { if (error.code !== 'ESRCH') failure ??= `Could not stop oracle process group: ${error.message}`; directKill(); }
      }
    }

    function collect(stream, chunk) {
      if (settled || terminating) return;
      const remaining = Math.max(0, config.max_output_bytes - bytes);
      if (remaining) output[stream].push(Buffer.from(chunk.subarray(0, remaining)));
      bytes += chunk.length;
      if (bytes > config.max_output_bytes) {
        outputLimited = true;
        terminate();
      }
    }

    const args = config.command.slice(1).map(argument => argument === '{input}' ? inputPath : argument);
    try {
      child = spawn(config.command[0], args, {cwd, shell: false, windowsHide: true, detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe']});
      timeout = setTimeout(() => { timedOut = true; terminate(); }, config.timeout_ms);
      child.stdout.on('data', chunk => collect('stdout', chunk));
      child.stderr.on('data', chunk => collect('stderr', chunk));
      child.once('error', error => {
        failure ??= `Could not run oracle: ${error.message}`;
        if (child.pid) terminate(); else finish();
      });
      child.once('exit', (code, signal) => { exitCode = code; exitSignal = signal; });
      child.once('close', (code, signal) => finish(code, signal));
    } catch (error) {
      failure = `Could not run oracle: ${error.message}`;
      finish();
    }
  });
}
