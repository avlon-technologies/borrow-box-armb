// The deterministic FAKE MODEL PROVIDER a Continuum development package
// ships for fake-provider-first acceptance testing.
//
// Self-contained on purpose: this file is copied verbatim into every
// generated package (acceptance/fake-model-provider.mjs) so an
// implementation agent working from a blank repository has it without
// installing anything. It imports nothing but Node built-ins.
//
// What it is: a scripted stand-in for a metered model provider. A
// scenario scripts, per agent name, what the "model" answers and in which
// order the answers arrive — so orchestration and semantic behaviour can
// be exercised with zero token spend and no API key. It is NOT a model,
// NOT a runtime, and carries no Continuum semantics: the meaning of an
// agent's output is the implementation's business, exactly as with a real
// provider.
//
// The script, per agent:
//   { "latency": 0,                    virtual milliseconds; orders completion — never a real timer
//     "output": { … },                 the structured output the model "returns"
//     "silence": true,                 the agent yields: the call completes with output null
//     "fail": "timeout" | "rate-limit" | "server-error" | <any token>,   the call fails with ProviderError(kind)
//     "failuresBeforeSuccess": 1,      fail that many times, then succeed with `output` (retry scenarios)
//     "malformed": "not json at all" } the call "succeeds" with unparseable text instead of structured output
//
// Ordering is a VIRTUAL CLOCK: queued calls complete in ascending
// `latency`, ties broken by agent name, then by call sequence. Completion
// happens on microtasks after the calls were queued in the same tick —
// so `Promise.all(agents.map(complete))` observes a deterministic order
// and nothing here ever waits on wall-clock time.
//
// Budget: `maxCalls` (session ceiling) and `maxConcurrent` are enforced;
// exceeding either throws BudgetExceeded — the same shape an
// implementation's real-provider guard should raise.

export class ProviderError extends Error {
  constructor(kind, agent) {
    super(`fake provider: ${kind} (${agent})`);
    this.name = 'ProviderError';
    this.kind = kind;
    this.agent = agent;
    this.retryable = kind !== 'invalid-request';
  }
}

export class BudgetExceeded extends Error {
  constructor(limit, value, name) {
    super(`fake provider: budget exceeded — ${name} ${value} > ${limit}`);
    this.name = 'BudgetExceeded';
    this.limit = limit;
    this.value = value;
    this.budget = name;
  }
}

export class MalformedOutput extends Error {
  constructor(agent, text) {
    super(`fake provider: malformed output from ${agent}`);
    this.name = 'MalformedOutput';
    this.agent = agent;
    this.text = text;
  }
}

const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * @param {object} options
 *   script:        { [agentName]: agentScript }  — see the header
 *   budget:        { maxCalls?, maxConcurrent? } — ceilings; absent = unlimited
 *   defaultOutput: what an unscripted agent returns (default: null = silence)
 * @returns {object} provider
 *   complete({ agent, input }) → Promise<{ agent, output, text?, latency, sequence }>
 *   calls                       every call made, in call order (agent, input, sequence, outcome)
 *   completions                 every completion, in COMPLETION order
 *   kind                        'fake'
 *   requiresApiKey              false
 */
export function createFakeProvider({ script = {}, budget = {}, defaultOutput = null } = {}) {
  const calls = [];
  const completions = [];
  const failuresSoFar = new Map();
  let sequence = 0;
  let inFlight = 0;
  let queue = [];
  let flushScheduled = false;

  const settleOne = (entry) => {
    const { agent, resolve, reject, latency, seq } = entry;
    const s = script[agent] ?? {};
    inFlight -= 1;
    const done = (outcome, value) => {
      const c = calls.find((x) => x.sequence === seq);
      if (c) c.outcome = outcome;
      completions.push({ agent, sequence: seq, latency, outcome });
      if (outcome === 'ok') resolve(value); else reject(value);
    };
    const failures = failuresSoFar.get(agent) ?? 0;
    if (typeof s.failuresBeforeSuccess === 'number' && failures < s.failuresBeforeSuccess) {
      failuresSoFar.set(agent, failures + 1);
      return done('failed', new ProviderError(s.fail ?? 'server-error', agent));
    }
    if (s.fail !== undefined && s.failuresBeforeSuccess === undefined) {
      return done('failed', new ProviderError(s.fail, agent));
    }
    if (s.malformed !== undefined) {
      return done('malformed', new MalformedOutput(agent, String(s.malformed)));
    }
    if (s.silence === true) return done('ok', { agent, output: null, silent: true, latency, sequence: seq });
    const output = s.output !== undefined ? s.output : defaultOutput;
    return done('ok', { agent, output, silent: output === null, latency, sequence: seq });
  };

  const flush = async () => {
    flushScheduled = false;
    const batch = queue.slice().sort((a, b) => cmp(a.latency, b.latency) || cmp(a.agent, b.agent) || cmp(a.seq, b.seq));
    queue = [];
    for (const entry of batch) {
      await null; // one microtask per completion: an observable, deterministic order
      settleOne(entry);
    }
  };

  const provider = {
    kind: 'fake',
    requiresApiKey: false,
    calls,
    completions,
    budget: { maxCalls: budget.maxCalls ?? null, maxConcurrent: budget.maxConcurrent ?? null },
    complete({ agent, input }) {
      if (typeof agent !== 'string' || !agent) throw new TypeError('complete: agent name required');
      const seq = ++sequence;
      if (provider.budget.maxCalls !== null && seq > provider.budget.maxCalls) {
        throw new BudgetExceeded(provider.budget.maxCalls, seq, 'maxCalls');
      }
      inFlight += 1;
      if (provider.budget.maxConcurrent !== null && inFlight > provider.budget.maxConcurrent) {
        inFlight -= 1;
        throw new BudgetExceeded(provider.budget.maxConcurrent, inFlight + 1, 'maxConcurrent');
      }
      const latency = Number((script[agent] ?? {}).latency ?? 0);
      calls.push({ agent, input, sequence: seq, latency, outcome: 'pending' });
      return new Promise((resolve, reject) => {
        queue.push({ agent, resolve, reject, latency, seq });
        if (!flushScheduled) { flushScheduled = true; queueMicrotask(() => { flush(); }); }
      });
    },
  };
  return provider;
}

/** The provider an adapter should construct for `MODEL_PROVIDER`: fake by default, never a real one here. */
export function providerModeFromEnv(env = process.env) {
  const mode = (env.MODEL_PROVIDER ?? 'fake').toLowerCase();
  return { mode, isFake: mode === 'fake' };
}
