# Autopick Mechanism - Requirements

## Overview
Add an **autopick** capability that automatically places Vine orders for newly-discovered
items whose computed desirability score crosses a configurable threshold. Autopick reuses the
existing discovery pipeline (`MonitoringManager.processDetectedItems`) and ordering pipeline
(`RocketManager.performOrder`). The decision layer in between scores each item on three pillars
— **affinity + value + queue** — and, when the item is good enough and all safety guardrails
pass, triggers a Rocket order programmatically.

The **affinity** pillar (formerly "brand") is computed by a layered resolver: deterministic
**rules** first (brands, keywords, phrases, regex — any of which may carry a `mustPick`
override), and a **light LLM as a backup** that scores items no rule matched (e.g. "Razer
headphones" appearing in last_chance when no rule covers it).

## Goals
- Score every newly-discovered item on a 0–30 raw scale (affinity + value + queue), surfaced as 0–100% confidence.
- Make affinity generic: brands are just one rule type alongside keywords/phrases/regex.
- Support **`mustPick` overrides** so a matched interest (e.g. "filament") is picked regardless of value/queue, within safety limits.
- Use a **light LLM as a fallback** to score items that no rule matched, on both polling and socket pipelines.
- Auto-order at/above threshold by reusing `RocketManager` (no new checkout logic).
- Be safe by default: master toggle, per-session arming, dry-run default, dedupe, cooldown, daily cap, value ceiling, kill-switch.
- Keep rules + LLM preferences external and editable.

## Non-Goals (v1)
- A full rules-management UI with autocomplete (v1 ships a bundled `rules.json` with import/export + a free-text LLM preferences prompt).
- Multi-quantity orders or variation selection beyond what `RocketManager` already resolves for parent ASINs.
- Fine-tuning or local models. The LLM is a hosted, swappable provider.

## Definitions
- **Raw score**: `affinityScore + valueScore + queueScore`, each in `[0, 10]`, total `[0, 30]`.
- **Confidence**: `round(rawScore / 30 * 100)` percent.
- **Rule match**: a `rules.json` entry whose pattern matches the title (case-insensitive whole-word for brand/keyword/phrase; raw regex for regex rules).
- **mustPick**: a rule flag that forces a pick on match (confidence → 100 / floor), bypassing the value+queue math but **not** the safety guardrails.
- **LLM fallback**: when no rule matches, a hosted light model returns an affinity score (0–10) + reason, from a user-written preferences prompt.
- **Armed / Dry-run / Known**: as before — armed = master-enabled and session-armed; dry-run = score+log but never order.

## Acceptance Criteria

### AC1: Three-pillar scoring
**Given** a newly-discovered item with title, queue, and (optionally) price
**When** autopick scores it
**Then** it computes `queueScore` from the queue map, `valueScore` from the value tiers, and `affinityScore` from the affinity resolver (rules → LLM → unknown)
**And** exposes raw total (0–30), confidence (0–100%), the per-pillar breakdown, and the affinity source (`rule` | `llm` | `unknown`).

### AC2: Generic affinity rules
**Given** `rules.json` contains brand, keyword, phrase, and regex rules each with a `score`
**When** an item title is scored
**Then** the highest-scoring **matching** rule sets `affinityScore`
**And** brand/keyword/phrase rules match case-insensitively on whole words (so "cressi"/"filament" do not match inside an unrelated word)
**And** an item matching no rule yields no rule-based affinity (proceeds to the LLM fallback).

### AC3: mustPick override
**Given** a rule with `mustPick: true` (e.g. `{ "type": "keyword", "pattern": "filament", "mustPick": true }`)
**When** an item title matches it
**Then** the item is treated as a forced pick (confidence → 100 / configured floor), bypassing the value+queue contribution to the threshold
**And** it still must pass every safety guardrail, including a configurable **mustPick value ceiling** (a price above the ceiling cancels the override and falls back to normal scoring).

### AC4: LLM fallback resolver
**Given** an item that matched no rule and the LLM layer is enabled
**When** affinity is resolved
**Then** autopick queries the configured light model with the user's preferences prompt and the item's title (and value/queue context as available)
**And** uses the returned score (0–10, clamped) as `affinityScore` with source `llm`, recording the model's short reason
**And** if the LLM is disabled, errors, or times out, affinity falls back to `unknownAffinityScore`.

### AC5: LLM on both pipelines (incl. socket), with a latency safety net
**Given** the LLM layer is enabled
**When** an unmatched item is discovered via **either** polling **or** socket
**Then** the LLM is consulted for both (socket included)
**And** a per-call hard timeout bounds the wait; on timeout the item falls back to `unknownAffinityScore` rather than blocking the pipeline
**And** the user accepts that a slow LLM response may forfeit a fast-moving socket item.

### AC6: Cost-aware LLM invocation (decisive-only)
**Given** an unmatched item
**When** deciding whether to call the LLM
**Then** the call is skipped when it cannot change the outcome — i.e. when even a maximal affinity (10) added to `valueScore + queueScore` would stay below `thresholdPercent`, or when a `mustPick` rule already decided the item
**And** identical/near-identical titles reuse a cached verdict instead of re-querying.

### AC7: Value sourcing (cost-aware) — unchanged
**Given** a discovered item
**Then** value uses the socket price if present; else, for a rule-matched item it may fetch the item-detail ETV; else value is unknown (`unknownValueScore`). (LLM fallback does not require a value fetch.)

### AC8: Threshold decision
**Given** a scored item with confidence `C` and threshold `T`
**When** `C >= T` (or a `mustPick` override fired) → it becomes a candidate and proceeds to the safety gates;
**When** `C < T` → autopick records a `skipped` decision with the full breakdown.

### AC9: Arming (manual, per session)
Autopick never auto-orders unless the master toggle is enabled **and** the user armed it this session; arming is session-scoped (does not survive a browser restart) and applies to both pipelines.

### AC10: Dry-run default
Armed + dry-run (default) → candidates are logged as `simulated`, no order placed. Dry-run off → a passing candidate triggers a real `RocketManager` order.

### AC11: Safety guardrails
A live candidate is suppressed if any gate fails: **dedupe** (ASIN already attempted), **single-flight** (`RocketManager.isOrdering`), **cooldown** (`cooldownSeconds`), **daily cap** (`dailyCap`), **value ceiling** (incl. mustPick ceiling), **kill-switch** (one action disarms and flushes pending candidates).

### AC12: Reuse of RocketManager
A cleared candidate is ordered via a programmatic `RocketManager` entry point with `{ asin, recommendationId, recommendationType, isParent }`; the existing overlay/iframe/toast and window-message success/error handling are reused unchanged.

### AC13: Auditability
Every decision (`ordered` | `simulated` | `skipped` | `failed`) records the pillar breakdown, affinity source (`rule`/`llm`/`unknown`), the matched rule or LLM reason, value source, and timestamp — on the item (`autopick` field) and in the popup's recent-decisions log.

### AC14: Configurability
The popup lets the user set master enable, dry-run, `thresholdPercent`, `cooldownSeconds`, `dailyCap`, value ceiling, per-queue scores, value tiers, import/replace `rules.json`, and the **LLM section** (enable, provider, model, API key, preferences prompt, timeout). Changes apply without reloading.

## Non-Functional Requirements

### Performance
- Rule scoring (no fetch/LLM) < 5 ms/item.
- LLM is invoked only for decisive unmatched items and is cached by normalized title; a per-call timeout bounds latency on every pipeline.
- Candidate ordering is serialized; never two overlapping checkout submissions.

### Safety / Correctness
- Default: master **off**, dry-run **on**, LLM **off**. A fresh install never auto-orders and never calls an external API.
- Every real order passes dedupe, cooldown, daily-cap, and value-ceiling checks before submission.
- Persisted counters (orders-today, attempted ASINs) survive refresh within a day.
- The API key is stored in `chrome.storage` and used only from the background service worker.

### Compatibility
- Works with both transport modes (`polling`, `socket`) and the existing Amazon domains.

## Open Questions / Risks
- **Socket price field name** still unconfirmed (Task 0.1).
- **Polling tiles lack `recommendationId`** in the current parse (must add; Task 0.3).
- **LLM latency vs socket races** — accepted by the user; mitigated by timeout + cache + decisive-only.
- **LLM cost** — bounded by decisive-only + cache; still proportional to unmatched decisive items. A per-day LLM-call cap may be added.
- **Parent ASIN auto-order risk** — gated by `allowParentAutopick` (default off).
- **Prompt-injection via titles** — the LLM scores attacker-influenced text; constrain it to return only a clamped score and never treat title text as instructions.
