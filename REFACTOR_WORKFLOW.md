# Zorka Refactor Workflow

This workflow governs refactor audits and implementation cycles. It supplements
the ownership and gameplay rules in `AGENTS.md`; it does not replace them.

## Current Contract (2026-08-21 audit)

- **Supported runtime modes:** Solo Arena, Local PvP Arena, Arcade Mode, and
  Experimental Mode are exposed by the UI and composed by `Game`. Experimental
  now includes persistent profiles, shortcuts, and New Game Plus behavior.
- **World rules:** `game.js` is authoritative for the 1920 x 1080 design size
  and the 17280 x 9720 standard world. Standard modes wrap. Experimental uses
  `getWorldRules()` to select bounded, area-aware movement over immutable
  topology from `world/experimental_rooms.js`.
- **Gameplay ownership:** `Game` owns canonical match collections and
  cross-entity outcomes; entities own persistent entity state; `physics.js`
  remains stateless; Experimental area indexes are derived; UI, camera, audio,
  and rendering consume state without owning gameplay truth.
- **Intentional behavior:** Arcade is one-life and forces Hardcore behavior.
  Transformations are unavailable in Arcade and Experimental. Experimental
  retains profile progression while rebuilding run-scoped world state after a
  human death, and its shortcuts add doorway geometry beyond the original
  linear route.
- **Legacy/dormant behavior:** online multiplayer is not active,
  `Game.network` is intentionally `null`, and `network_manager.js` is retained
  legacy code. Network-facing methods in `game.js` are dormant unless a future
  product decision restores that subsystem.
- **Material unresolved questions:** the existing suite has 13 failures that
  disagree with current implementation in Experimental copy, population, and
  lifecycle behavior, shortcut-aware wall/render expectations, and missile
  speed. These disagreements must be reconciled as implementation bugs, stale
  tests, or product decisions before refactoring those seams. Vite is now
  explicitly declared as a development dependency in both package manifests,
  resolving the previously ambiguous build-tool ownership; installing it still
  requires registry access or a populated npm cache.

### Baseline evidence

- `node --test` discovers 257 tests: 244 pass and 13 fail.
- The remaining failure groups are three Experimental UI/adventure assertions,
  one Sector 9 population assertion, one profile-menu assertion, seven
  Experimental lifecycle/wall/render assertions, and one missile-speed
  assertion. These are **unresolved contract drift**, not an invitation to
  change gameplay merely to make tests green.
- The two former leveling/speed failures were stale tests. Repository history
  shows deliberate changes that doubled base thrust and capped NPC Projectile
  upgrades at five; the focused leveling suite now represents both current
  contracts and passes all 20 tests.
- The build configuration now declares Vite 8.1.5 in `package.json` and locks
  it in `package-lock.json`. In the current audit environment, `npm ci
  --offline` cannot install it because the package tarball is not cached, so a
  clean build remains an environment-limited verification item rather than a
  manifest disagreement.
- No performance optimization is approved from this audit. Performance work
  remains blocked on a reproducible browser baseline after correctness and
  build configuration are trustworthy.

## 1. Reconcile the contract

Before planning a refactor, compare implementation, architecture/agent
documentation, tests, exposed UI/modes, and build/runtime configuration.
Classify every disagreement as an implementation bug, stale test, stale
documentation, dormant/legacy behavior, or unresolved product decision. Only a
decision that materially changes architecture should block unrelated work.

Update the Current Contract above when evidence changes. Do not start structural
or performance work while the affected behavior is ambiguous.

## 2. Establish correctness

Run the existing suite and, for each failure:

1. identify the asserted behavior;
2. compare it with implementation and documented intent;
3. decide whether the test or implementation is stale or incorrect;
4. make the smallest justified correction;
5. rerun the focused test; and
6. rerun the broader suite affected by the seam.

Proceed only when relevant tests represent intended behavior, remaining failures
are documented and unrelated, and the project builds and launches.

## 3. Establish performance evidence

Do not choose an optimization from static inspection alone. Use reproducible
browser scenarios for ordinary Solo play (the control), projectile-heavy and
missile-heavy combat, dense hazards, Experimental doorway and populated-room
combat, and Local PvP split-screen rendering.

For each relevant scenario, record approximate entity counts, average and worst
frame time, visible hitching, allocation/GC behavior where practical, and the
hottest profiled functions. Reuse the same scenario for every before/after
comparison; do not build a benchmark framework unless existing browser tools
are insufficient.

## 4. Maintain and re-rank a candidate backlog

Each candidate records:

- **Problem** and concrete **Evidence**
- **Category:** correctness, architecture, performance, readability, or
  maintainability
- **Benefit:** separate 0-5 Performance, Readability, and Modularity values
- **Risk:** 0-5
- **Effort:** XS, S, M, L, or XL
- **Confidence:** measured, strongly evidenced, plausible, or speculative
- **Dependencies**
- **Stop condition:** evidence that makes the change unnecessary

At the beginning of each cycle, re-rank using correctness risk, measured
performance impact, benefit-to-risk ratio, coupling reduction, cognitive-load
reduction, and effort—in that order. Prefer work that unlocks later evidence.
Never treat a previous ranking as permanent or the backlog as an approved
roadmap.

## 5. Plan only the next one to three slices

For the next small group of related changes, define:

- **Goal** — the specific problem being addressed
- **Ownership seam** — the authoritative owner or boundary changing
- **Invariants** — behavior and ordering that cannot change
- **Success criteria** — the observable improvement
- **Verification** — focused/broad tests, browser checks, scenarios, and
  profiler measurements
- **Rollback/stop condition** — evidence requiring abandonment or reversion

For lifecycle changes, explicitly preserve single destruction, same-frame
removal, missile detonation ordering, aim-lock clearing, derived-index cleanup,
and canonical collection authority.

## 6. Implement and verify one slice

Make the smallest complete edit and avoid unrelated cleanup. `Game` remains the
match coordinator unless a responsibility is deliberately extracted; entities
retain entity state; physics remains stateless; indexes remain derived; and
presentation never gains gameplay truth.

Before evaluating improvement, run syntax/import checks, the build, focused
tests, broader tests affected by the seam, and the smallest in-game scenario
that exposes both expected behavior and likely regressions. Stop if correctness
is uncertain.

## 7. Evaluate performance changes

When performance is a goal, rerun the exact baseline scenario and compare frame
time, allocation/GC behavior, hot-function time, and relevant throughput:

- **Clear improvement:** keep it if complexity is acceptable.
- **Neutral:** keep it only for an independently sufficient readability or
  modularity benefit.
- **Regression:** revert or revise it.
- **Inconclusive:** gather better evidence; do not stack more optimization on
  top.

## 8. Reassess and document

After every accepted slice, re-rank the backlog. Check whether the next suspected
hotspot remains hot, whether the slice removed another problem, whether a larger
bottleneck appeared, and whether added complexity invalidates a planned
abstraction.

Update only the smallest relevant architecture documentation. Describe current
ownership, dependency direction, behavioral contracts, derived structures,
removed legacy behavior, and real module boundaries—never speculative future
architecture.

The process is complete when contracts are trustworthy, measured performance is
acceptable, ownership and dependency direction are clear, and modules are
cohesive without unnecessary abstraction. It is valid to leave candidates
unimplemented.
