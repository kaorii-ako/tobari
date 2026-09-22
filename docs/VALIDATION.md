# VALIDATION.md — Stage 0

**Status: GATE WAIVED FOR PHASE 1 by the developer on 2026-09-22. The research
below is still unfilled and no go/pivot/stop decision has been made. The waiver
covers Phase 1 only — it does not carry into Phase 2.**

This file is filled in by the developer, not by an agent. Spec §1 is explicit
that Stage 0 is human work, and the two required sources (Product Hunt comment
threads, Perplexity with citations) are not reachable from the build agent. An
agent filling in the evidence tables below would be inventing demand, which is
the one failure mode this document exists to prevent.

When this file records a **go**, delete this status block.

---

## Gate waiver (recorded honestly)

On 2026-09-22 the developer waived this gate for Phase 1 and directed that the
build continue. That is their call to make, and it is recorded here rather than
in a commit message so the next reader sees it next to the empty tables.

What the waiver does **not** do: it does not make the thesis true, and it does
not extend to Phase 2. Phase 1 is an extension over a sidecar — reversible, and
reusable under most pivots. Phase 2 (a CEF shell, Flathub listing, a browser
people must switch to) and Phase 3 (an indefinite 4-week Chromium rebase
cadence for one developer) are not reversible in the same way. The §5 arguments
below are unanswered, and they should be answered before that commitment, not
after.

Spec §15 requires this document before Phase 1 code. Phase 1 was built first:
the `tobari-core` sidecar, the MV3 extension, AppImage packaging and CI all
landed across commits `7010a5c`, `7fc1749`, `8678ad8` with no VALIDATION.md in
the tree.

What that costs: spec §0 says this file **outranks** the spec's own assumptions
about users and market. If the research below produces a **pivot** or **stop**,
the Phase 1 work is sunk, not validated. The work is not wasted as *engineering*
— the sidecar, the hardening in §5b and the extractor/actor split in §5d are
reusable under most pivots — but the *product thesis* is still untested.

Do not treat the existence of working code as evidence the thesis holds.

---

## 1. The hypothesis under test

Tobari's wedge is **local-only AI + Linux-first + honest security docs**.

Validation **succeeds** if both hold:

- [ ] No shipping browser is local-only *and* supports Linux properly.
- [ ] Visible, recurring demand exists from a reachable community.

Validation **fails or forces a pivot** if either holds:

- [ ] A funded browser already ships a credible local-only mode on Linux.
- [ ] Demand exists only as "nice to have", with nobody willing to switch browsers.

---

## 2. Competitor table

Fill every cell. "Unknown" is an acceptable entry; a blank is not. Every row
needs a primary source — release notes, official docs, the product's own
download page — not a secondary summary.

| Product | Platforms | Linux? | AI local or cloud? | Cloud fallback? | Pricing | Account required? | Source |
|---|---|---|---|---|---|---|---|
| Perplexity Comet | | | | | | | |
| ChatGPT Atlas | | | | | | | |
| Dia (Browser Company) | | | | | | | |
| Opera Neon | | | | | | | |
| Brave Leo | | | | | | | |
| Edge Copilot | | | | | | | |
| Chrome Gemini | | | | | | | |
| Sigma | | | | | | | |
| *(add any found)* | | | | | | | |

**Fully local, no cloud fallback, Linux supported — which rows qualify?**

> _(answer here; if any row qualifies, §1's pivot condition may be triggered)_

---

## 3. Product Hunt evidence

Spec §1a: launch-day upvotes measure a maker's network. **Comments measure
unmet demand.** Record comments, not scores.

| Launch | Date | Upvotes | Comments | What commenters complained about or asked for |
|---|---|---|---|---|
| | | | | |

Specifically hunt for and record:

- [ ] Complaints about cloud dependence, data collection, or forced accounts in AI browsers.
- [ ] "When Linux?" asks in threads for Mac/Windows-only launches.
- [ ] Local-model products and how they were actually received.

---

## 4. Perplexity research

Run the §1b prompt verbatim. Treat anything Perplexity says about Comet — its
own product — or about category winners as a **claim to verify against primary
sources**, not a conclusion.

<details>
<summary>The prompt (spec §1b, verbatim)</summary>

```
I'm evaluating a desktop browser idea: Chromium-based, Linux-first (macOS
second, no Windows), with a built-in AI assistant that runs 100% locally via
llama.cpp — no cloud inference, no accounts, no telemetry. Differentiators:
local-only AI, published threat model, honest RAM/security tradeoff docs.

1. List AI-native browsers and browser AI features shipping as of now
   (e.g. Comet, ChatGPT Atlas, Dia, Opera Neon, Brave Leo, Edge Copilot,
   Chrome Gemini, Sigma). For each: platforms, whether AI runs locally or in
   the cloud, pricing, and Linux support.
2. Which of them offer fully local inference with no cloud fallback?
3. What do Linux desktop users say they want from a browser that current
   options don't give them? Cite forum/Reddit/HN threads.
4. What evidence exists of demand for local-only AI in browsers specifically,
   versus local LLM tools in general (Ollama, LM Studio, Jan)?
5. What are the strongest arguments that this idea is NOT worth building?
6. What's the realistic audience size: Linux desktop share, and the overlap
   with people running local models?

Cite sources for every claim. Flag anything you're uncertain about.
```

</details>

### 4.1 Findings, with primary-source verification

| Claim from Perplexity | Primary source checked | Holds? |
|---|---|---|
| | | |

### 4.2 Demand evidence (question 3 and 4)

Link the actual threads. A summary without a link is not evidence.

| Thread / post | Community | Date | What it asks for | Switching intent? |
|---|---|---|---|---|
| | | | | |

Distinguish carefully, because §1c turns on it:

- Demand for **local LLM tools** (Ollama, LM Studio, Jan) — already proven, large.
- Demand for **local AI inside a browser** — the actual thesis, unproven.

### 4.3 Audience sizing (question 6)

| Quantity | Figure | Source |
|---|---|---|
| Linux desktop share | | |
| Est. local-model users | | |
| Plausible overlap | | |

---

## 5. The strongest case against

Spec §1b: **question 5 is the most important one. Ask it again in a fresh
thread if the first answer is soft.** Write the best version of the argument
here, in full, without softening it.

> _(the strongest case that this is not worth building)_

Known candidates to address explicitly, each of which is a real risk:

1. **A 4B model is not good enough** to make page chat feel worth switching
   browsers for, and the people who would notice are the ones running 30B+
   locally already — who would rather point their browser at their own
   endpoint than use a bundled model. (Note this cuts against §3.1's
   no-external-endpoint rule.)
2. **Browser switching is the hardest ask in consumer software.** Extension
   ecosystems, profiles, password managers and muscle memory all anchor people.
   Phase 1 shipping *as an extension* partly sidesteps this — which raises the
   question of whether the browser in Phases 2–3 is needed at all.
3. **The audience may be satisfied by an extension** over Ollama, which several
   projects already ship, at a fraction of the maintenance cost of a Chromium
   patch set.
4. **Phase 3 is an open-ended maintenance commitment** — a 4-week Chromium
   rebase cadence, indefinitely, for one developer.
5. **VRAM assumptions do not generalize.** The 16 GB dev card is far above the
   Linux median; on a typical laptop the default model displaces exactly the
   memory the product promises to save.

Rebuttals, where there are honest ones:

> _(rebuttals, or an admission that there isn't one)_

---

## 6. Decision

**Decision: _(go / pivot / stop — not yet made)_**

**Phase 1 gate: waived by the developer, 2026-09-22.** Not a go decision — an
explicit choice to build Phase 1 without the evidence. Phase 2 remains gated on
a real decision recorded here.

One paragraph of reasoning, referencing the evidence above by section:

> _(reasoning)_

If **pivot**, list the spec sections it invalidates:

| Section | Still valid? | Why |
|---|---|---|
| | | |
