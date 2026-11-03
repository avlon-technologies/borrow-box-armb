# Development package — borrowbox

> A Continuum **development package**: a mechanically verifiable implementation handoff consisting of a Goal, the semantic architecture, the technology bindings for one environment, and executable acceptance scenarios. Generated and verified by `tools/development-package.mjs`; `PACKAGE.json` is its manifest and proof.

```
GOAL.md                         why — intent, in prose (never adds a semantic claim)
model/borrowbox.adl             what — the semantic architecture (authored adl-source; AUTHORITY)
model/borrowbox.adl-manifest.json
model/borrowbox.adl.txt         the dense adl-text projection (derived, for reading)
model/*.adl-binding.json        how — technology per environment (applies to this exact attestation)
model/*.vocabulary-claims.json
gaps/                           the implementation's recorded semantic gaps (yours; client workspace, never package inventory)
model/compile-proof.json        the compiler's result, relayed verbatim (derived)
acceptance/scenarios/*.scenario.json   executable Given/When/Then, each traced to the model
acceptance/run.mjs, fake-model-provider.mjs   the shipped runner and deterministic fake provider
acceptance/adapter.mjs          the step bindings (the implementation writes this; a reference one may ship)
acceptance/traces/              derived process-graph traces per scenario
IMPLEMENTATION.md               the contract for the implementation agent (derived)
BEHAVIOUR.md                    the behavioural projection: declared order, unordered (potentially concurrent) steps, underspecified causality (derived)
PACKAGE.json                    manifest + proof: identities, digests, file inventory (derived)
```

```
The Goal tells us why.
The semantic ADL tells us what the system means.
The bindings tell us how this environment realizes it.
The acceptance scenarios prove the important behaviours.
The implementation realizes all of the above — and is not in this package.
```

| | |
|---|---|
| semantic package | `avlon.borrowbox` `cycle-1` (`adl/1.7`) |
| attestation | `sha256:1631f83eecbc048520644600379ef320132af8ef0806436cb6bff032dd5eed42` |
| changeState | `sha256:8ae3819b488c8639ce39955a41a7303c6f8cd4f360c74f65849a61deb1055a5f` |
| environment | `LocalDevelopment` |
| scenarios | 6, resolved against the model; no adapter ships — the implementation writes one and runs them with `package run` |
| compiler warnings | 0 |

Start with `GOAL.md`, then `IMPLEMENTATION.md`. Verify the package before trusting it:

```
node <continuum>/tools/development-package.mjs check <this directory>
```
