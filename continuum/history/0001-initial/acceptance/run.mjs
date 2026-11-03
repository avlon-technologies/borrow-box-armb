// The executable ACCEPTANCE SCENARIO runner a Continuum development
// package ships (acceptance/run.mjs in every generated package).
//
// Self-contained on purpose — Node built-ins only — so an implementation
// agent can run it from a blank repository:
//
//   node acceptance/run.mjs                         run every scenario with acceptance/adapter.mjs
//   node acceptance/run.mjs --adapter ./my.mjs      a different adapter
//   node acceptance/run.mjs --only <name>           one scenario
//   node acceptance/run.mjs --check                 structure only: parse, no adapter, nothing executed
//   node acceptance/run.mjs --json                  machine summary
//
// A scenario is data (acceptance/scenarios/<name>.scenario.json):
//
//   { "acceptance-scenario": "1",
//     "name": "…", "purpose": "…",
//     "verifies": ["::System.Domain.Capability.Requirement", …],   root-anchored qualified names or #ids
//     "test": "::System.SomeTest",                                 optional: the semantic Test element it realizes
//     "environment": "LocalDevelopment",                          optional
//     "provider": { "<AgentName>": { … fake-model-provider script … } },
//     "budget": { "maxCalls": 40, "maxConcurrent": 4 },
//     "given": [ { "step": "<key>", "args": { … }, "text": "…" } ],
//     "when":  [ … ], "then": [ … ],
//     "trace": { "from": "::System….SomeMessage" } }               optional: the package tool derives a process-graph trace
//
// Steps are KEYS, not prose: the adapter binds each key to a function.
// `text` is for the human reader; `args` is data for the function. The
// same scenario runs unchanged against any implementation that provides
// an adapter — that is what makes it an executable contract rather than
// a requirements document.
//
// The ADAPTER contract (acceptance/adapter.mjs, written by the
// implementation):
//
//   export function createAdapter({ createFakeProvider, env }) {
//     return {
//       steps: { '<key>': async (ctx, args, step) => { … throw to fail … }, … },
//       beforeScenario?: async (ctx) => {},   // optional set-up
//       afterScenario?:  async (ctx) => {},   // optional tear-down
//     };
//   }
//
// Per scenario the runner builds `ctx = { scenario, provider, state, assert, log }`:
// `provider` is a fresh fake provider from the scenario's `provider`
// script and `budget`; `state` is an empty object the steps share.
//
// Traceability is validated by the package tool against the compiled
// model (every `verifies` target must resolve); this runner only checks
// the scenario's shape and executes it. Nothing here is Continuum
// authority.

import { readdirSync, readFileSync, existsSync, realpathSync, statSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

export const SCENARIO_PROFILE = '1';
export const PHASES = Object.freeze(['given', 'when', 'then']);
const NAME_RX = /^[a-z0-9][a-z0-9-]*$/;

/** Structural validation of one scenario value. Returns a list of problems (empty = well-formed). */
export function validateScenarioShape(s, sourceId = 'scenario') {
  const problems = [];
  const p = (m) => problems.push(`${sourceId}: ${m}`);
  if (!s || typeof s !== 'object' || Array.isArray(s)) { p('not an object'); return problems; }
  if (s['acceptance-scenario'] !== SCENARIO_PROFILE) p(`"acceptance-scenario" must be "${SCENARIO_PROFILE}"`);
  if (typeof s.name !== 'string' || !NAME_RX.test(s.name)) p('"name": lowercase kebab-case required');
  if (!Array.isArray(s.verifies) || s.verifies.length === 0 || !s.verifies.every((v) => typeof v === 'string' && v.length)) {
    p('"verifies": a non-empty list of element references (root-anchored qualified names or #ids)');
  }
  if (s.test !== undefined && typeof s.test !== 'string') p('"test": a reference string');
  if (s.environment !== undefined && typeof s.environment !== 'string') p('"environment": a name');
  if (s.provider !== undefined && (typeof s.provider !== 'object' || Array.isArray(s.provider))) p('"provider": an object keyed by agent name');
  if (s.budget !== undefined && (typeof s.budget !== 'object' || Array.isArray(s.budget))) p('"budget": an object');
  if (s.trace !== undefined && (typeof s.trace !== 'object' || typeof s.trace.from !== 'string')) p('"trace": { "from": "<message reference>" }');
  for (const phase of PHASES) {
    if (!Array.isArray(s[phase])) { p(`"${phase}": a list of steps`); continue; }
    s[phase].forEach((st, i) => {
      if (!st || typeof st !== 'object' || typeof st.step !== 'string' || !st.step) p(`${phase}[${i}]: "step" key required`);
      if (st.args !== undefined && (typeof st.args !== 'object' || st.args === null)) p(`${phase}[${i}]: "args" must be an object`);
    });
  }
  if (Array.isArray(s.then) && s.then.length === 0) p('"then": at least one assertion step');
  return problems;
}

/** Read every *.scenario.json under `dir`, sorted by name. Throws on a malformed file. */
export function loadScenarios(dir) {
  if (!existsSync(dir)) return [];
  const files = readdirSync(dir).filter((f) => f.endsWith('.scenario.json')).sort();
  const out = [];
  for (const f of files) {
    const text = readFileSync(join(dir, f), 'utf8');
    let value;
    try { value = JSON.parse(text); } catch (e) { throw new Error(`${f}: not JSON — ${e.message}`); }
    const problems = validateScenarioShape(value, f);
    if (problems.length) throw new Error(problems.join('\n'));
    if (value.name !== f.replace(/\.scenario\.json$/, '')) {
      throw new Error(`${f}: file name and scenario name differ (${value.name})`);
    }
    out.push({ file: f, ...value });
  }
  return out;
}

/** The step vocabulary a set of scenarios uses: key → { texts, argKeys, scenarios, phases }. Derived, for the adapter author. */
export function stepVocabulary(scenarios) {
  const vocab = new Map();
  for (const s of scenarios) {
    for (const phase of PHASES) {
      for (const st of s[phase]) {
        const v = vocab.get(st.step) ?? { key: st.step, texts: new Set(), argKeys: new Set(), scenarios: new Set(), phases: new Set() };
        if (st.text) v.texts.add(st.text);
        for (const k of Object.keys(st.args ?? {})) v.argKeys.add(k);
        v.scenarios.add(s.name);
        v.phases.add(phase);
        vocab.set(st.step, v);
      }
    }
  }
  return [...vocab.values()].sort((a, b) => (a.key < b.key ? -1 : 1)).map((v) => ({
    key: v.key, texts: [...v.texts].sort(), argKeys: [...v.argKeys].sort(),
    scenarios: [...v.scenarios].sort(), phases: [...v.phases].sort(),
  }));
}

/**
 * Execute scenarios against an adapter.
 * @param {object} o
 *   scenarios: loaded scenarios; adapter: the object createAdapter returned;
 *   createFakeProvider: the factory (from fake-model-provider.mjs); env; only?
 * @returns {Promise<object>} { ok, executed, passed, failed, scenarios: [ … ] }
 */
export async function runScenarios({ scenarios, adapter, createFakeProvider, env = process.env, only = null }) {
  const results = [];
  const wanted = only ? scenarios.filter((s) => s.name === only) : scenarios;
  if (only && wanted.length === 0) throw new Error(`no scenario named ${only}`);
  // FAKE MODE STRIPS PROVIDER CREDENTIALS: with MODEL_PROVIDER=fake (the default) no *_API_KEY reaches a
  // scenario, so nothing under test can reach a paid provider by accident — and "needs no API key" is a
  // claim the scenario can check rather than assume.
  const scenarioEnv = scrubbedEnv(env);
  for (const scenario of wanted) {
    const provider = createFakeProvider({ script: scenario.provider ?? {}, budget: scenario.budget ?? {} });
    const log = [];
    const ctx = { scenario, provider, state: {}, assert, env: scenarioEnv, log: (m) => log.push(String(m)) };
    const r = { name: scenario.name, ok: true, steps: [], log };
    try {
      if (adapter.beforeScenario) await adapter.beforeScenario(ctx);
      outer: for (const phase of PHASES) {
        for (const st of scenario[phase]) {
          const fn = adapter.steps?.[st.step];
          const rec = { phase, step: st.step, text: st.text ?? null, ok: true };
          r.steps.push(rec);
          if (typeof fn !== 'function') {
            rec.ok = false; rec.error = `adapter binds no step "${st.step}"`;
            r.ok = false; r.failedAt = rec; break outer;
          }
          try { await fn(ctx, st.args ?? {}, st); } catch (e) {
            rec.ok = false; rec.error = e && e.message ? e.message : String(e);
            r.ok = false; r.failedAt = rec; break outer;
          }
        }
      }
    } finally {
      try { if (adapter.afterScenario) await adapter.afterScenario(ctx); } catch (e) { r.ok = false; r.teardownError = e.message; }
    }
    r.providerCalls = provider.calls.length;
    r.providerCompletionOrder = provider.completions.map((c) => c.agent);
    results.push(r);
  }
  const passed = results.filter((x) => x.ok).length;
  return { ok: results.every((x) => x.ok), executed: results.length, passed, failed: results.length - passed, scenarios: results };
}

/** The environment a scenario sees: in fake mode (the default) every *_API_KEY is removed. */
export function scrubbedEnv(env = process.env) {
  const mode = String(env.MODEL_PROVIDER ?? 'fake').toLowerCase();
  const out = { ...env, MODEL_PROVIDER: mode };
  if (mode === 'fake') for (const k of Object.keys(out)) if (/_API_KEY$/i.test(k)) delete out[k];
  return out;
}

/** Resolve the adapter module path and construct the adapter. */
export async function loadAdapter(adapterPath, { createFakeProvider, env = process.env } = {}) {
  const abs = resolve(adapterPath);
  if (!existsSync(abs)) throw new Error(`adapter not found: ${adapterPath}`);
  // the ESM module cache is keyed by URL: a long-lived process (the guard, a test runner) that loads an
  // adapter, then sees it edited, must load the NEW bytes — so the URL carries the file's identity
  const st = statSync(abs);
  const mod = await import(`${pathToFileURL(abs).href}?v=${st.size}-${Math.round(st.mtimeMs)}`);
  if (typeof mod.createAdapter !== 'function') throw new Error(`${adapterPath}: must export createAdapter({ createFakeProvider, env })`);
  const adapter = await mod.createAdapter({ createFakeProvider, env });
  if (!adapter || typeof adapter.steps !== 'object') throw new Error(`${adapterPath}: createAdapter must return { steps }`);
  return adapter;
}

export function renderReport(report) {
  const lines = [];
  for (const s of report.scenarios) {
    lines.push(`${s.ok ? 'pass' : 'FAIL'}  ${s.name}  (${s.providerCalls} model calls${s.providerCompletionOrder.length ? ': ' + s.providerCompletionOrder.join(' → ') : ''})`);
    if (!s.ok && s.failedAt) lines.push(`      at ${s.failedAt.phase} "${s.failedAt.step}"${s.failedAt.text ? ' — ' + s.failedAt.text : ''}\n      ${s.failedAt.error}`);
    if (s.teardownError) lines.push(`      teardown: ${s.teardownError}`);
  }
  lines.push(`${report.passed} passed, ${report.failed} failed, ${report.executed} executed`);
  return lines.join('\n');
}

// ---- CLI (only when executed directly) --------------------------------
async function main(argv) {
  const here = dirname(fileURLToPath(import.meta.url));
  const opts = { adapter: join(here, 'adapter.mjs'), only: null, json: false, check: false, scenarios: join(here, 'scenarios') };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--adapter') opts.adapter = argv[++i];
    else if (a === '--only') opts.only = argv[++i];
    else if (a === '--scenarios') opts.scenarios = argv[++i];
    else if (a === '--json') opts.json = true;
    else if (a === '--check') opts.check = true;
    else if (a === '--help' || a === '-h') { console.log('usage: node run.mjs [--adapter <path>] [--only <name>] [--scenarios <dir>] [--check] [--json]'); return 0; }
    else { console.error(`unknown argument: ${a}`); return 2; }
  }
  let scenarios;
  try { scenarios = loadScenarios(opts.scenarios); } catch (e) { console.error(e.message); return 1; }
  if (opts.check) {
    const vocab = stepVocabulary(scenarios);
    if (opts.json) console.log(JSON.stringify({ ok: true, scenarios: scenarios.map((s) => s.name), steps: vocab }, null, 2));
    else console.log(`${scenarios.length} scenarios well-formed; ${vocab.length} distinct steps: ${vocab.map((v) => v.key).join(', ')}`);
    return 0;
  }
  const fake = await import(pathToFileURL(join(here, 'fake-model-provider.mjs')).href);
  let adapter;
  try { adapter = await loadAdapter(opts.adapter, { createFakeProvider: fake.createFakeProvider }); } catch (e) { console.error(e.message); return 1; }
  const report = await runScenarios({ scenarios, adapter, createFakeProvider: fake.createFakeProvider, only: opts.only });
  console.log(opts.json ? JSON.stringify(report, null, 2) : renderReport(report));
  return report.ok ? 0 : 1;
}

// symlink-safe (an npx / npm-link install reaches this file through node_modules/.bin): compare real paths
const samePath = (a, b) => { try { return realpathSync(a) === realpathSync(b); } catch { return false; } };
const invokedDirectly = process.argv[1] && samePath(resolve(process.argv[1]), fileURLToPath(import.meta.url));
if (invokedDirectly) main(process.argv.slice(2)).then((code) => process.exit(code), (e) => { console.error(e); process.exit(1); });
