# Autopick Mechanism - Implementation Tasks

Phased so each phase is independently testable. Phase 1 ships the affinity resolver (rules +
mustPick) and dry-run logging only — zero ordering, zero external API. The LLM fallback (Phase
2) and live ordering (Phase 3) are added behind their own toggles, both default-off.

## Phase 0: Investigation (de-risk before coding)

### Task 0.1: Confirm socket price field
- [ ] Log a raw v-helper `newItem` socket payload and find the value/ETV key (`etv`/`value`/`price`...). Record in design §MonitoringManager.

### Task 0.2: Confirm item-detail ETV path
- [ ] Locate ETV in `/vine/api/recommendations/{recId}/item/{asin}` (`receiptData.taxValue`...); record JSON path + currency→number rule.

### Task 0.3: Confirm polling tile recommendation attrs
- [ ] Verify `input[data-asin]` in queue HTML carries `data-recommendation-id` / `data-recommendation-type`.

**Acceptance:** value source + ordering identifiers for both pipelines documented and reproducible.

---

## Phase 1: Affinity resolver (rules + mustPick) + dry-run, no ordering, no LLM

### Task 1.1: rules.json + manifest wiring
- [ ] Create `rules.json` (version + seed rules incl. a `mustPick` keyword like "filament" and brands incl. Cressi/Razer).
- [ ] Add `rules.json` to `web_accessible_resources`; add `managers/autopick-manager.js` to `content_scripts.js` after `monitoring-manager.js`.

### Task 1.2: AutopickManager — rule engine
- [ ] Create `managers/autopick-manager.js` extending `BaseManager`.
- [ ] `loadRules()` via `fetch(chrome.runtime.getURL('rules.json'))`; compile brand/keyword/phrase → `\b…\b` (i), regex → as-is; precompute aliases; sort mustPick-first then score desc.
- [ ] `matchBestRule(title)` (highest score; mustPick precedence).
- [ ] `loadConfig()` with design defaults (incl. `mustPick*`, `globalValueCeiling`, queue/value tiers).
- [ ] `scoreValueTier(value)`, queue map lookup.
- [ ] `scoreItem(item)` → `{affinityScore, affinitySource:'rule'|'unknown', override, valueScore, queueScore, raw, confidence, rule}` (no LLM yet).
- [ ] `window.vineAutopickManager` + `debugScore(title, queue, value)`.

### Task 1.3: mustPick override + value ceiling
- [ ] On mustPick match → confidence floor; cancel override if `value > mustPickValueCeiling`.
- [ ] When ceiling set but value unknown → trigger the cost-aware detail-fetch before honoring override.

### Task 1.4: Cost-aware value resolution
- [ ] `resolveValue(item, isRuleMatched)`: socket price → rule-matched detail-fetch → unknown; normalize ETV to number; failure → unknown.

### Task 1.5: Wire discovery → evaluate (dry-run)
- [ ] `processDetectedItems`: add `price/recommendationId/recommendationType/isParent` to `allNewItems`; emit `autopick:candidates`.
- [ ] `normalizeSocketItem`: capture confirmed `price`.
- [ ] `parseItemsFromHtml`: parse `data-recommendation-id`/`-type` (+ visible ETV).
- [ ] `AutopickManager.evaluate(items)`: score + record `simulated`/`skipped`; **never order**.
- [ ] `content.js`: construct after `rocket`/`monitoring`.

### Task 1.6: Audit surface
- [ ] `repository.setAutopick(asin, data)` + non-breaking `autopick` field.
- [ ] Recent-decisions ring buffer (last 50) on the manager.

**Acceptance:** armed + dry-run logs full breakdowns; `mustPick` items show override/confidence-100; value-ceiling cancels override; rule-matched priced items make 0 extra fetches; **no order ever placed; no external API called.**

---

## Phase 2: LLM fallback layer (background bridge), still dry-run-safe

### Task 2.1: Background LLM bridge
- [ ] Add `host_permissions` for the provider API domain(s); store API key in `chrome.storage`.
- [ ] `background.js`: handle `autopickScoreAffinity` → `LlmProvider` (anthropic | gemini), system = hardened scorer prompt + user preferences, user = title/context, request strict JSON `{score:0-10,reason}`; parse+clamp; failure → `{ok:false}`.

### Task 2.2: Resolver integration + cost gate + cache
- [ ] `resolveAffinity`: rules → (if no rule) LLM → unknown; runs on polling **and** socket.
- [ ] `canBeDecisive(ctx)` gate (skip LLM when even max affinity can't cross threshold, or mustPick already decided).
- [ ] `scoreAffinity(item)` content-side: per-call timeout → fallback unknown; LRU title cache + per-ASIN persistence; optional `llmDailyCallCap` (day-rollover reset).
- [ ] Record `affinitySource:'llm'` + `llmReason` in the audit field.

### Task 2.3: Prompt hardening + validation
- [ ] Title treated as untrusted data; system prompt forbids following in-title instructions; reject non-JSON/out-of-range; unit test an injection title.

**Acceptance:** unmatched decisive items (e.g. Razer/last_chance) get an LLM affinity on both pipelines; hopeless items make 0 calls; cache prevents re-query; timeout falls back cleanly; injection titles can’t change behavior. Still dry-run → no orders.

---

## Phase 3: Ordering + guardrails (live)

### Task 3.1: RocketManager programmatic entry
- [ ] Extract `placeOrder(itemData, ctx)`; keep click handler as wrapper; emit `rocketOrderSuccess`/`rocketOrderError` with `source`; manual-path parity test.

### Task 3.2: Arming + session state
- [ ] `arm()/disarm()/isArmed()` via `sessionStorage`; master `enabled` gate required first.

### Task 3.3: Guardrails + serial queue
- [ ] Persisted day-scoped runtime (`ordersToday/lastOrderTs/attemptedAsins/day` + rollover reset).
- [ ] `decide()` (threshold/override/dedupe/parent/value-ceiling/dry-run) + `drainQueue()` (serial, confidence-first, honoring isOrdering/cooldown/cap).
- [ ] Await `rocketOrderSuccess/Error` (timeout) before crediting cooldown/cap.
- [ ] `kill()` flushes queue + disarms.

### Task 3.4: Flip ordering on
- [ ] Dry-run off → passing candidates call `placeOrder`; record `ordered`/`failed`.

**Acceptance:** live + armed + dry-run off orders only items ≥ threshold (or mustPick); never overlapping orders; cooldown/cap/dedupe/value-ceiling enforced; kill halts immediately.

---

## Phase 4: Popup UI

### Task 4.1: Autopick settings panel
- [ ] Master enable, Arm-this-session, Kill-switch, dry-run, threshold slider, cooldown, daily cap, value ceiling.
- [ ] Advanced (collapsible): per-queue scores, value tiers, mustPick floor/ceiling.
- [ ] Rules: count, import/replace/export `rules.json`.

### Task 4.2: LLM settings panel
- [ ] Enable, provider, model, API key (masked), preferences-prompt textarea, timeout, daily call cap; live apply.

### Task 4.3: Recent decisions log
- [ ] Render ring buffer `asin · title · confidence% · affinitySource · decision · reason`; auto-update while open.

**Acceptance:** all config editable + live-applied; LLM key never leaves background context except for API calls; decisions visible; arm/kill reflect live state.

---

## Phase 5: Tests & docs

### Task 5.1: Tests
- [ ] Resolver (rule traps, mustPick precedence/ceiling, decisive-only LLM, cache, timeout).
- [ ] LLM bridge (provider switch, strict-JSON, injection).
- [ ] Decisions/guardrails (threshold, override, dedupe, cooldown, cap, value-ceiling, kill).
- [ ] Fetch/LLM-count assertions per AC6/AC7; RocketManager parity + lifecycle.

### Task 5.2: Docs
- [ ] Update `CLAUDE.md` (manager list + init order). Usage note: enable → arm → dry-run first → tune rules → optionally enable LLM.
