# DMA — Target-State Interactive Prototype

End-to-end interactive prototype of the Dynatrace Migration Automation (DMA)
target-state workflow, built for two audiences:

1. **Internal leadership** — a visual representation of what we want to build.
2. **Internal dev team** — a visual representation of what they're building.

Source material: `PRODUCT-16422 (DMA)` Value Pack, the DMA Flow Diagram, and the
per-feature PRDs in `Feature Sets/P0–P3`.

---

## Running it

No build step, no dependencies, no Node required.

```bash
cd ~/dma-prototype
python3 -m http.server 4178
# open http://localhost:4178
```

Opening `index.html` directly from the filesystem also works — the prototype
uses classic scripts rather than ES modules specifically so it can be zipped
and shared without a server.

---

## Design system compliance

Governed by the frontend standards in the `product-architecture` repo:

| Standard | Requirement | How this prototype complies |
|---|---|---|
| STD-FE-001 | Strato Design System mandatory; tokens are the only source of truth | All colour, spacing, and type values live in `design-system/tokens.css` using Strato's `--dt-*` naming convention. No hard-coded values anywhere else. |
| STD-FE-002 | React 18 + TypeScript strict | **Not met by design** — see below. |
| STD-FE-003 | WCAG 2.1 AA | Semantic landmarks, `aria-current` / `aria-selected` / `role` attributes, visible focus rings, `prefers-reduced-motion` support, skip link. |
| STD-FE-004 | Figma handoff | Existing Figma file: *Migration Assistant* (linked in the Value Pack appendix). |

### Why not React + Strato directly

`@dynatrace/strato-components` resolves through internal Artifactory and is not
publicly installable. This prototype therefore **mirrors** Strato rather than
consuming it:

- Every token name in `design-system/tokens.css` matches Strato's naming, so
  swapping in the real `ThemeProvider` is a substitution, not a rewrite.
- Every class in `design-system/components.css` is annotated with the Strato
  component it stands in for (`/* --- <Button> (Strato: Button) --- */`).

**The token values are approximations.** Replace them with the real Strato
export before any production work begins. The names are the contract; the hex
values are not.

---

## Structure

```
dma-prototype/
├── index.html                 # script manifest — the only shared wiring
├── design-system/
│   ├── tokens.css             # Strato token mirror ← the integration contract
│   ├── base.css               # reset + layout/text utilities
│   └── components.css         # Strato component stand-ins
├── core/
│   ├── ui.js                  # el(), icon(), button(), card(), table(), modal()…
│   ├── store.js               # prefs, session state, module registry
│   ├── shell.js               # top bar, sidebar, phase pipeline, hash router
│   └── shell.css              # app chrome
├── data/
│   ├── features.js            # roadmap features + tier mapping
│   ├── project.js             # Acme Corp golden-path fixture
│   ├── mapping.js             # mapping scopes, rule sets, cascade resolver
│   ├── qualify.js             # Qualify & Scope fixtures (owned by that module)
│   ├── environment.js         # Prepare Environment fixtures (owned by that module)
│   ├── inventory.js           # Import fixtures (owned by that module)
│   ├── ruleset.js             # Global Mapping fixtures (owned by that module)
│   ├── planning.js            # applications, dependency graph, wave resolver
│   ├── calibration.js         # Calibrate fixtures (owned by that module)
│   ├── wavemapping.js         # Wave Mapping fixtures (owned by that module)
│   ├── translation.js         # Translate fixtures (owned by that module)
│   ├── validation.js          # Validate fixtures (owned by that module)
│   ├── exceptions.js          # Exceptions fixtures (owned by that module)
│   ├── deploy.js              # Deploy fixtures (owned by that module)
│   └── govern-close.js        # Govern & Close fixtures (owned by that module)
└── modules/                   # one folder per flow-diagram stage
    ├── overview/              # ✅ built
    ├── qualify-scope/         # ✅ built ┐ Setup Project
    ├── prepare-environment/   # ✅ built ┘
    ├── import/                # ✅ built ┐
    ├── global-mapping/        # ✅ built │ Extract
    ├── prioritize-plan/       # ✅ built │
    ├── wave-mapping/          # ✅ built ┘
    ├── calibrate/             # ✅ built ┐
    ├── translate/             # ✅ built │ Transform
    ├── validate/              # ✅ built │
    ├── exceptions/            # ✅ built ┘
    ├── deploy/                # ✅ built — Load
    └── govern-close/          # ✅ built — Govern & Close
```

All thirteen stages are built. No module is a stub.

### Mapping runs twice, on purpose

**Global Mapping Configurations** sits *before* Prioritize & Plan because bucket
strategy determines ingest footprint, which is what wave sizing depends on.
**Wave Map Configurations** sits *after*, once waves exist as delivery units.

Rules bind to **application**, not wave. A wave is a mutable delivery container
the EPM can re-group; an application is a stable semantic grouping. Binding to
the wave would orphan mapping decisions on every re-plan, so "wave mapping" is a
roll-up view of the applications inside that wave. The scope split and the
most-specific-wins cascade live in `data/mapping.js`, shared by both modules —
the isolation rule forbids importing one module from the other.

Global rules **lock** once the first translation runs against them, scoped per
wave: Wave 5 stays editable while Wave 1 is frozen. The only way to change a
locked rule is a manual-review action that explicitly returns the affected
assets to translation.

### Qualify & Scope is a pre-sales stage

An SSD opens a project to size an opportunity, connects the customer's Splunk,
and leaves with an LOE report to take into a client conversation. No asset is
migrated here — the deliverable is an agreed scope and a number.

Two decisions shape the screen:

**The credential fork is shown at the point of choice.** The Universal Source
Connector needs Splunk credentials. Declining routes the SSD to the CLI pathway
— the customer runs the existing bash script and sends a `.tar.gz`. That still
produces an estimate, at ±35% instead of ±20%, but it permanently forfeits
Asset-to-Asset Validation, because no customer data ever flows through DMA. The
cost lands at Validate; the decision is made here, so both pathways are laid out
side by side with their gains and costs spelled out.

**Blocked and rework are kept apart.** No-equivalent findings split two ways:
`blocked` leaves the migration scope entirely, `rework` stays in scope but buys
manual hours. They have opposite cost shapes, and collapsing them into a single
"unsupported" count is what makes an estimate wrong. The same detection engine
is surfaced a second time at Import (*No-Equivalent Command Pre-Flag*, P2), once
the real inventory lands.

The stage declares its five sub-steps on the registration (`steps`), which is
the list a stage-level drill-down would render if the deferred rewrite lands.

### Prepare Environment is a maturity assessment, not a form

Different stage, different person. Qualify & Scope is run by an **SSD** and asks
what we are migrating. Prepare Environment is run by the **Architect** and asks
whether the tenant can receive it. It runs **in parallel** with Import &
Qualify — the PRD guardrail is ~0 added sequential days — so the screen states
what it runs alongside rather than implying a queue.

The maturity model borrows its shape from the Dynatrace **Transformation
Journey**: six domains, 1–5 scoring, current against a required level, gaps
becoming owned actions. The content is technical rather than business — a TJ
asks whether an organisation is ready to adopt observability, this asks whether
a tenant is ready to receive a migration. Domains: Agent & Data Ingest, Storage
& Buckets, Pipeline Processing, Access & Permissions, Capacity & Limits,
Environment Topology.

**The bar is level 4 — Migration-ready, not level 5 — Optimised.** A migration
needs a sufficient environment, not a perfect one; setting the bar at 5 turns a
gate into an improvement programme nobody asked for.

**Scoring is not the deliverable.** Every domain below the bar emits a specific
owned action naming the object at fault — *which* index lacks a bucket, *which*
forwarder went silent. "Environment not ready" is not something an Architect can
act on. The checklist is the first iteration; the assessment and generated
actions are the target state and carry `proposed: true`.

**IAM, SSO, and RBAC stay outside DMA.** The platform-IAM team owns them. They
appear as manual sign-off lines so the boundary is visible rather than quietly
absorbed — and so they cannot be forgotten.

The gate re-opens. Sign-off covers a *scope*, not a project: the Wave 4–6
re-plan introduced three new indexes, which re-opened a gate signed off on
Oct 3 for Waves 1–3.

### Import is the first stage with real evidence

Qualify & Scope sized the estate from discovery metadata. Import reads the
assets themselves — definitions, query text, scheduling, ownership — so every
count here *supersedes* an estimate rather than confirming one. Four features,
one sub-step each.

**A partial run is not a failed run.** Run 3 lost 14 of 245 lookup files to a
non-UTF8 encoding; the other four asset types completed, the failure was
reported against the specific objects and the reason they were rejected, and
run 4 re-pulled only what was missed. All-or-nothing on a 3,000-asset estate
means one malformed CSV costs an afternoon. The `<15 min` target is **per run**,
which is why the cold pull (run 1, 12.6 min) is the run it exists for.

**The delta is what makes a re-import cheap.** 49 of 3,088 assets moved; the
other 3,039 keep their translation, validation result and wave assignment
untouched. Without the flag every run looks like a first run. The stacked bar
breaks down the 49 rather than the estate — at 1.6% an estate-proportional bar
is a solid block that says nothing.

**Removal is flagged, never auto-dropped.** An asset deleted in Splunk *after*
it was translated is still queued to publish, and publishing it recreates
something the customer deliberately retired. The inverse mistake — silently
discarding work someone deleted by accident — is just as expensive, so a human
decides.

**The command catalog is the same list Qualify & Scope used**; only the evidence
underneath it changed. Running it against real query text moves the **rework**
number and holds the **blocked** number, because blocked is a property of the
command and rework is a property of how the command was used. 46 blocked, 210
needing rework.

**The dead-asset gate is enforcement, not detection.** Detection already existed
and was informational, which meant dead dashboards were translated, validated
and published anyway. Now: excluded by default, visible rather than deleted,
overridable per asset — a yearly fiscal-close dashboard looks identical to a
dead one for 364 days.

**Two diffs exist in DMA and they answer different questions.** Version history
compares an asset against its own previous import. The validation diff compares
a Splunk asset against its translated Dynatrace output. Conflating them is the
most common misreading of this stage, so the Import screen says so out loud.
Any two versions can be compared, not just consecutive ones — an asset that
drifted over four runs is the case worth seeing whole.

### Global Mapping is organised by decision, not by object type

The live product splits this stage into five lists — Indexes & buckets (1,236),
Pipelines (221), Lookups (174), Inputs (66), Field mappings (0). Nothing sits
above the lists, so the same bucket decision is taken 1,236 times. The target
state is **seven rules, each decided once**, with triage pointing at the few
objects that genuinely differ. Two of today's tabs disappear entirely as
navigation: an input routes to an index, so the bucket rule already settles all
66 of them.

**Nothing starts blank.** Every rule opens with a value DMA derived from the
imported configuration *plus the evidence behind it*, so the work is reviewing a
proposal rather than deriving one. Two of the seven were edited here — the
retention cap (395 → 730 days, because Compliance holds settlement records for
two years) and the naming template (a `{team}` token added, because four teams
own dashboards with identical names). Both edits are recorded against a reason.

**The decision surface is deliberately uneven, and that is the argument.** One
naming template reaches 2,955 assets. One bucket rule has to be right 1,236
times. Two query guardrails are two sentences. Object-type navigation flattens
all of that into lists of equal-looking rows, which is why a consultant spends
the same attention on a guardrail as on the index carrying 840 GB a day.

**A rule is one stored value, and the objects resolve from it on read.** This is
the question the Index → Bucket drill-down exists to answer: nothing writes to
1,236 indexes. One pattern is stored at project scope, and every index row is
*computed* from it whenever it is read — `resolveBucket()` in `data/ruleset.js`
is literally that function, and the editor's resolution table recomputes live as
you switch between the four strategies. The only per-object storage in the whole
rule is an **override**, and there are 14 of those out of 1,236; `wu_teller_au`
keeps `logs:wu_retail_apac` no matter which strategy is selected, which is the
cascade visible in a single row. Picking the worst case on purpose: Index →
Bucket has the largest object count, the biggest downstream consequence, and is
the one rule that genuinely cannot differ between two waves. So the impact panel
tells the truth that follows from that — a change cannot be applied to the open
waves alone without writing the same index to two buckets and splitting the data,
which is why the button reads *"Apply — returns 1,615 assets to translation"*
rather than *Save*.

**The translator is cascade layer zero.** It already rewrites seven Splunk
fields and discards six more on every query it touches — and none of it is
configuration today, which is exactly why the Field mappings tab reads 0 while
thirteen decisions are being made. Surfacing it as a visible, overridable layer
exposes three target collisions (`_indextime`→`timestamp`, `sourcetype`→
`log.source`, `msg`→`content`) that currently only show up as a published
dashboard filtering on both halves and returning nothing. The cascade is now
`translator → project → application → asset`, most specific wins.

**Needs Configuration is a third bucket, not a softer Uncertain.** One is
waiting on a named input (a bucket that does not exist, a lookup with no key
column); the other is waiting on judgement. A single "needs review" queue of 205
gives the 42 that need judgement the same two minutes as the 163 that need a
name typed in. Every queue row names the specific input required.

**This stage confirms the rule set — one decision, seven rules.** Per-asset
confirmation belongs to Wave Mapping, where the asset, its application override
and its wave are all on screen together. That split is what stops the
project-level sign-off from degenerating into a 2,955-row checklist nobody
reads. The guardrail is on Uncertain only: 42 outstanding blocks rule set v4,
while 163 Needs Configuration carry forward because their inputs are known.

**Wave 4 is the lock model made concrete.** It translated, locked, and then came
back through the only door there is — a manual review that explicitly returned
its 518 assets to translation after the Wave 4–6 re-plan introduced three
indexes rule set v3 had never classified. Waves 1–3 stay frozen; Waves 5–6 never
locked because nothing has consumed the rules yet.

**No LOE or complexity score anywhere on this stage.** Every table in the live
product carries them and neither changes a decision taken here. The Transparent
LOE Estimator (P3) owns that question, at Qualify & Scope.

### Prioritize & Plan proposes, the EPM disposes

Today the EPM creates waves, then opens the explorer and assigns assets into
them one at a time. The plan is hand-built at the asset layer, which means the
dependency graph is carried in someone's head and re-planning is re-doing.

The target state keeps the human in the decision and moves the decision up a
layer. **Priority seeds a proposal; the EPM organises the waves; placement is
stored on the application and every asset inside it inherits.** Nineteen
placements reach 2,908 assets. This is the same *decide at the application
layer, inherit at the asset layer* argument Wave Mapping makes, and it is what
the approved roadmap already asked for — Priority-Driven Wave Generator (P3)
reads *"proposes wave grouping and order from app priority, respecting
dependency checks; still EPM-adjustable."* An earlier build of this screen
implemented the proposing half and dropped the adjustable half.

**The seed is four waves; this project committed six.** Priority is the only
business input the system has, so it proposes one wave per tier. It does not
know about the Nov 3 filing cycle, the partner notice period, or the site
rollout. All four seeded tiers now span more than one committed wave. That
delta is the argument for the stage: it is computed on every render, never
stored, so the proposal and the commitment can always be compared.

**Wave count is not a property of the model.** Six is what this project chose.
One wave per application is equally valid, and so is one for the whole estate.
Waves are first-class objects with `id` and `order` as *separate* fields, which
is what makes reorder cheap: moving a wave rewrites display order only and
cannot touch a single placement, because membership is keyed on the id.

**Four tiers, not a 1–19 rank.** Forcing a total order asks the EPM to decide
whether Wallet outranks FX, which nobody can answer and nobody needs to. Four
buckets is the smallest surface that still says what the business meant — and
since the tiers only seed a proposal the human then edits, precision there
would be false precision anyway.

**Declared priority is an input, not the answer.** An application inherits the
highest priority of anything that transitively depends on it. Platform Shared
Services is declared **Low** and ships in **Wave 1**, because Payments Core,
Fraud & Risk and Sanctions Screening cannot ship without it. It is the only
application promoted this way, and the screen shows the declared tier and the
effective one side by side — hiding the promotion would make the plan look
wrong to the person who declared it.

**Dependency checking moved from "unreachable by construction" to "checked live
on every move."** When the plan was generated, a dependency violation could not
be expressed. Now that a human places applications by hand, it can — so it is
re-run on every edit and the offending wave is marked in place. A human is
allowed to make the mistake; they are not allowed to miss it. The committed
plan has zero violations; drag Foundation out of first position and five appear
immediately.

**Three applications ship out of tier order, and all three carry a recorded
reason** — Card Services (shares an on-call rota and release train with Fraud &
Risk), Partner API (two partners are contractually entitled to 30 days' notice),
Facilities & IoT (the site team is mid-rollout across 11 buildings and asked not
to be last). A move nobody can explain is a move that gets re-litigated at the
next re-plan, so `placementBasis` records who, when, and why.

**Forty-seven assets have no application, so no tier reaches them.** They were
written against the shared index, authored in a personal namespace, or point at
a source that no longer exists — nothing owns them and nothing inherits a wave
on their behalf. They get their own queue in *Set priority*, grouped into 8
clusters by *why* they are orphaned, because that is the unit a human can rule
on: deciding "scratch dashboards by departed authors" once beats deciding six
dashboards separately. Two actions per group — assign to a wave, or mark out of
scope. Currently 32 assigned, 9 still pending, 6 out of scope.

**The reconciliation gap is shown, not hidden.** 2,940 in waves + 9 pending + 6
out of scope = 2,955. Pending assets are counted in neither a wave nor the
excluded total, deliberately: an asset nobody has ruled on should look like an
open decision, not like a silent exclusion. Note that those 6 are *not* in
`project.assets.excluded` — that bucket is the import-time dead/no-equivalent
gate (133 assets, which is what takes 3,088 discovered down to 2,955 in scope).
Excluding at import and excluding at planning are different decisions by
different people at different times, and collapsing them would hide the second.

**Waves are named, not numbered-and-named.** A phase label only identifies a
wave when that phase landed once; "Core" three times over names nothing. A
repeated phase is suffixed with its two largest applications — *Core — Risk &
Screening*, *Core — Treasury & Settlement*, *Core — Compliance & Channels*.
`data/project.js` and `data/ruleset.js` carry the same names and counts, because
the committed plan has to agree with itself across screens.

**The calibration set is an overlay, not a partition.** This was the one open
question in the design. If the calibration wave were a seventh wave, its assets
would have no production home and would need re-homing before Deploy — a second
plan to maintain. Instead every asset keeps exactly one home wave, and 214 of
them are *additionally* drawn into a non-prod calibration set covering 89% of
observed SPL patterns. A calibration asset is translated early to tune the
profile and deploys on its home wave's schedule. Three patterns appear in
exactly one asset each and are routed to Exceptions rather than sampled —
calibrating on a single instance teaches the profile nothing generalisable.

**Ownership is a second overlay, and it is one-to-many.** A wave carries one
*accountable* owner for sign-off and any number of *contributors*. Waves and
assignees stay separate entities, so a wave can change hands without touching a
single asset. The live product nests per-person groups inside waves, which makes
every hand-off a bulk re-assignment — and a re-assignment that misses rows is
how an estate ends up reporting 4,108 assets with no wave at all. So the stage
is one partition (waves) plus two overlays (calibration, ownership).

Four sub-steps: *Set priority → Organize waves → Calibration set → Owners &
commit*.

**What was removed, and why.** An earlier build modelled a hard translation-
throughput ceiling and a soft review-bandwidth ceiling, and sized waves against
them. That was wrong in kind: **throughput is a rate, not a capacity.** A larger
wave takes longer; it does not fail. The ceiling only looked real because wave
duration had been frozen at five days — unfreeze it and the constraint
evaporates. Target team bandwidth is a *scoping* question (Qualify & Scope) and
actual throughput is a *progress-monitoring* question (Overview); neither
belongs between an EPM and their grouping decision. `capacity-planner` (P3) is
therefore marked `parked: true` in `data/features.js` rather than re-homed — it
stays visible as a roadmap commitment, with the reason attached, and is worth
revisiting once two or three projects have produced real per-wave throughput
data to calibrate against. Two P3 features remain live on this stage:
Priority-Driven Wave Generator and Support Wave Assignment for Non-Dashboard
Asset Types.

### Wave Mapping is named for waves, and nothing binds to one

The stage is called Wave Map Configurations, which sets the wrong expectation:
that a wave is where mapping decisions live. It is not. **A wave is a mutable
delivery container the EPM re-groups whenever priorities move; an application
is the unit of decision; an asset is the exception.** The wave is the lens you
read the configuration through, not the thing it attaches to.

**The re-plan is the proof, recorded rather than argued.** On Oct 13 the Wave
4–6 re-plan moved six applications between waves — Compliance Reporting, Retail
Channels and Agent Network pulled forward, Digital Wallet, Corporate IT and HR
Payroll pushed back. Because every value is stored against the application,
**16 mapping entries changed wave and none of them noticed**. Had the same
values been stored against the wave, those 16 rows would have been orphaned
that morning. `rePlanCost()` computes the number from the live layers, so it
cannot drift away from the configuration it describes.

**Token values and overrides are different things, and pooling them is the
counting error.** A *token* is an input the confirmed rule set demands and has
no default for — `app_prefix`, `team`. Its absence is work outstanding. An
*override* is a deliberate deviation from a project default — `timeframe`,
`placement`, `tags`. Its absence is agreement. So the screen counts two
populations rather than one: **32 of 38 token values supplied**, and **34 of 57
optional fields inherited (60%)** against 23 deliberate deviations. A single
"needs review" queue would give a missing prefix the same weight as a
considered decision, and the resulting 95-field number reads as configuration
sprawl when it is mostly inheritance working.

**The six outstanding tokens are the only blocking state**, and they are in
Waves 5 and 6 — HR Payroll and Marketing have supplied nothing, Remittance and
Facilities IoT are missing a team.

**Every field shows provenance.** Translator built-in, project, application or
asset, resolved most-specific-wins by the shared cascade in `data/mapping.js` —
the same resolver Global Mapping uses, at two more layers. Overrides are
bounded by the global rule rather than free: an application may move its
timeframe inside the **7-day guardrail ceiling** and cannot move through it,
because the ceiling is a project decision.

**Per-asset overrides come back, counted.** The live product's uncapped
per-asset editing is what makes a 2,955-asset estate unreviewable, but removing
the escape hatch entirely is worse — a regulated artefact really does need its
own name. So: **9 exceptions across 2,955 assets**, each with an author and a
reason. The cap is the visibility, not a limit. And repetition is read as
signal: **three exceptions setting Retail Channels' timeframe to 72 hours are
one missing application rule, not three decisions**, and the screen says so.

**Lookup delivery is the one rule whose answer genuinely is a wave number.** A
lookup must publish with or before the first wave that reads it, or that wave
ships a dangling reference that looks like an empty dashboard. 9 of 241 lookups
are cross-wave; the other 232 are single-wave and need no ordering decision.
Two are late — `kyc_doc_type` delivers in Wave 6 and is read in Wave 5, and
`product_catalogue` the same — and the lateness is computed from the current
plan rather than stored, so a re-plan re-derives it.

**The readiness gate is computed, not signed.** It asks one question: have this
wave's applications supplied every input the confirmed rules demand? Waves 1–4
are clear and confirmed; Wave 5 is blocked on 2 tokens and 2 late lookups; Wave
6 on 4 tokens. Because the gate is derived, a green gate and an outstanding
token cannot coexist — which is the difference between this and Global
Mapping's rule-set confirmation, a decision someone takes and records.

Five sub-steps: *Inheritance → Application overrides → Asset exceptions →
Lookup delivery → Readiness gate*. The roadmap feature is
**Application-Scoped Overrides** (P1, proposed) — it supersedes the dropped
global-overrides item, which asked for the same capability at the wrong layer.

### Calibrate predicts, and shows its working

Calibrate builds a customer translation profile — macro dictionary, naming
conventions, recurring SPL idioms, field vocabulary — from a stratified sample
of 214 dependency-free assets, then scores itself by running that sample through
Asset-to-Asset Validation. It is the only stage that is allowed to say something
about the 2,955 assets it has not touched yet, and the honesty of that claim is
the whole design problem.

**Three measures, composed, because they answer three different questions.**
The strip above the steps carries all of them at once: *run progress* (how far —
214 assets, four phases, a live estimate), *pattern coverage* (how good — 89% of
the 46 observed SPL patterns), *exit gate* (can I leave — five conditions and a
recorded decision). Shipping only the first would be a loading bar. Shipping only
the third would hide that the number moved. Each is useless alone.

**The prediction converges on screen.** Eleven batches, one per sampled
application, each recording the estimate *after* it landed: 71.0% ±14.2 after
Payments Core alone, dipping to 70.2% when the shared `main` index arrives with
four unrelated writers, settling at 78.0% ±2.4. The margin is not decoration —
an early point estimate without its interval invites someone to act on 71%. The
demo lands on the finished state, because that is what the fixture says happened;
*Replay calibration* re-runs the animation on demand. Playback time is
deliberately **not** proportional to the bar: translation gets two thirds of it,
because it is the only phase where anything changes.

**Scored twice on identical inputs.** 167 of 214 auto-approve with the profile
(78.0%); 118 auto-approve with it withheld (55.1%). The 23-point lift is measured,
not asserted. Without the control run, 78% is unfalsifiable — it could be the
profile working, or it could be an estate that was always going to translate
cleanly. This is also the only guardrail that can tell you to delete the stage.

**Not fine-tuning, and the corrections are the proof.** No weights change; the
profile is injected context. Sixteen conventions in the profile — ten undisputed,
four corrected by a consultant, two rejected outright, each correction carrying a
name, a date and a reason.
Two of those six would otherwise have shipped queries that run cleanly and return
wrong answers — a macro argument read as hours instead of minutes, widening every
fraud window sixtyfold across 41 assets; a `svc` field mapped to its Kubernetes
form when two thirds of its users predate the migration. Asset-to-Asset Validation
cannot catch either, because both translations are structurally faithful. A person
reading a dictionary can. That is the argument for human-legible context, and it
is why the stage cannot be collapsed into the translator.

**The sample is stratified, and the counterexample is on screen.** Proportional
to the estate across sourcetype, complexity and application. The first 214
dependency-free assets *in scan order* would be 85% simple access-log searches —
it predicts 91% and delivers 62%. A naive sample does not fail loudly; it runs
fine, scores high, and is wrong in the direction that costs most to discover late.

**Three patterns appear in exactly one asset each** and are routed to Exceptions
rather than sampled — calibrating on a single instance memorises an asset instead
of learning a convention. Two more are *thin* (present, but below the four-instance
bar) and are excluded from the prediction so the headline is not propped up by
shapes the profile has barely seen.

**Blocking before the first wave translates, advisory thereafter.** The exit
condition is a recorded decision, not a score: a run that scored 94% and was never
read by a consultant has not passed. In the advisory phase the profile keeps
learning — 76.4% in Wave 1 climbing to 83.3% in Wave 4 across 100 absorbed
corrections. Wave 1 coming in *below* the 78% prediction is expected; it is where
the profile meets the assets the sample could only approximate. A flat or falling
trend is the signal to re-run.

Four sub-steps: *Draw the sample → Build the profile → Score & coverage →
Release decision*. The roadmap feature is **Customer Calibration Profile**
(P1, proposed). Guardrail metric: *calibration lift*. Near zero means the stage
is ceremony and should be cut.

### Translate runs a wave, and the run is the event

Nothing in the product does this today. Translation is currently a side effect
of publishing — one dashboard at a time, *"I can publish this one, or I can
publish 15 of them"* — so a wave's translation has never been observable as a
single thing. The first decision this screen makes is to **be** that event: pick
a wave, see what will run, run it, read what came back. The wave picker in the
page header is that selector; adding a second one inside the screen would give
one decision two homes.

**2,955 assets is not 2,955 translations.** Dashboards (412), alerts (1,204) and
saved searches (968) translate — **2,584**. Lookups (241) and macros (130) are
**prerequisites**: lookups are uploaded as data and macros are expanded from the
dictionary Calibrate froze, so neither is ever translated. Counting the 371 as
translations inflates every rate on this stage by 12.6%. This is also, without
having been designed that way, why the reference screen has exactly three tabs.

**Runnable is not correct, and the two numbers are kept apart.** Translate asks
*did we produce DQL that executes?* — **93.9%** across Waves 1–4. Validate asks
*does it return the same answer?* — **81.2%**. The easier bar is always the
higher number, so a stage reporting 93.9% as its headline next to a confidence
score would be claiming the second while measuring the first. There is
deliberately **no confidence column and no diff anywhere on this screen**,
despite both appearing on the live product's Assets table.

**Best-fit model per asset is half a cost decision.** Rule-based deterministic
conversion handles ~43% of a wave with no model call at all; extended context is
reserved for the ~7% of searches that will not fit a standard window. One fixed
path either overpays on the first group or underserves the second.

**Exactly one retry, and the evidence for stopping there is on the page.**
Retries fell 19 → 17 → 14 → 11 across Waves 1–4 while blocked held roughly flat
at 30 → 29 → 29 → 25. They move differently because a retry fixes a *context*
problem — a field Global Mapping already resolved, a macro definition from the
Calibrate profile, a bucket and timeframe from Wave Mapping — and the profile
keeps absorbing those. None of the six block reasons is a context problem, so a
second retry would not move a single row. Measured, not asserted: 61 of 174
first-pass failures recovered, **35%**. The number is not flattering on purpose.

**Held is a third state, and it is neither success nor failure.** 134 of Wave
5's 488 assets never start, because Remittance Tracking and Facilities & IoT
have never supplied a `team` value. Counting them as failures slanders the
translator; counting them as successes is how a wave reports 100% on 73% of its
work. They re-enter the queue the moment the value lands.

**One pre-flight gate is clearable here, one is a handoff.** Lookup delivery
*order* is genuinely a translate-time decision — `kyc_doc_type` and
`product_catalogue` deliver in Wave 6 but are read in Wave 5, derived live from
Wave Mapping's own data — so the consultant can pull them forward and the
trigger unlocks. A missing mapping token belongs to the application, so that
check only offers a navigate-out. A gate that sends you elsewhere should look
like one.

**A dashboard is not the unit of work.** Consultants count tiles — *"25 tiles
out of 50"* — and reassign individual panels to senior reviewers. So an asset
carries its tile count and its flagged count, and opening it names every panel
and the reason each one failed. *FX Rate Drift — Intraday* is blocked on 3 of
14; routing the whole dashboard to Exceptions sends eleven working panels with
it. The live product's **"partially supported"** is deliberately not used:
consultants said plainly it tells them nothing — *"I don't really know what this
yellow stuff means"* — because it never says *which* part is partial.

**Three modes, derived not flagged.** `DMA.data.waveStageStatus(wave,
"translate")` decides: Waves 1–4 `complete` (replayable), Wave 5 `in-progress`
(pre-flight plus a live trigger), Wave 6 `not-started`. The pipeline and the
screen therefore cannot disagree about what is reachable. Outcomes and Routing are
gated behind the run on an armed wave — the summary *is* the output of the run,
and showing it beforehand would be a forecast dressed as a result.

Four sub-steps: *Pre-flight → Run translation → Outcomes → Routing*.

### Validate takes one machine verdict and two human disagreements

The comparison produces exactly one of three classifications per asset — Match,
Meaningful Difference, Uncertain — and every asset resolves to one. There is no
fourth state and no partial credit. What the screen adds is that a human can
disagree with that verdict in **both directions**, at two different points in a
wave's life, and those are not the same event:

| | Machine said | Asset is | Human can |
|---|---|---|---|
| **Triage** (pre-deploy) | FAIL | not live | override and publish, or send to Exceptions |
| **Live review** (post-deploy) | PASS | in the tenant | confirm it, or fail it with a comment |

These are deliberately two surfaces, not one filtered queue. The P1 PRD says the
two entry points *"may need different UI flows and different redeploy mechanics,
not a single shared screen"*, and the reason shows up the moment you merge them:
one list flattens the difference between *not shipped yet* and *shipped and
wrong*. A row in Triage costs a reviewer ten minutes. A row in Live Review has
been paging someone's on-call since Oct 18.

**1,751 compared, not 2,955 — and fixing this corrected the Overview.** Validate's
input is whatever Translate produced runnable DQL for: 1,864 ran, 1,751 came back
runnable, 113 were blocked and went straight to Exceptions without ever reaching a
comparator. The estate rollup previously read 2,400 + 412 + 143 = 2,955, which
would have meant validating 371 lookups and macros that never translate plus two
waves that have not run. The 81.2% rate was locked (Translate cites it by name),
so the counts were re-derived under it rather than the other way round:
**1,422 / 243 / 86**. `data/validation.js` re-derives those three literals from
the per-wave rows on load and warns on drift, because `project.js` loads first and
cannot read them.

**An override is counted in its own bucket, with a named owner and a written
reason.** Folding 38 overrides into 1,422 auto-approvals would let the system take
credit for a human's judgement — and then take the blame when that judgement is
wrong. Which happens. The machine's false-positive rate here is **0.44%** (3 of
687 live auto-approvals); the reversal rate on human overrides is **2.6%** (1 of
38). Six times higher on a much smaller base. Both are worth having; averaging
them hides the interesting one. *Payment Queue Depth Sustained* is the whole
argument in one row — Ravi Anand overrode it on Oct 8 and failed it himself on
Oct 18, after it had been paging on-call for ten days.

**The customer is a value in a field, not a second view.** The consultant and the
customer both review these assets, and this prototype has no persona switcher.
Reviewer identity and role sit on the validation record — which the PRD's
immutable audit log (F-7) requires us to persist anyway — so attribution is not a
concession to the one-screen decision, it is something we owed regardless.

**Quiet by default is a demanding goal.** 1,422 assets were approved with no human
looking at them, so the stage's credibility rests entirely on what sits behind each
one: comparison date, signals used, confidence score, classification, threshold in
effect. An auto-approval nobody can look up is indistinguishable from one that
never happened — so every row on every table opens its audit trail, including the
ones nobody has ever opened.

**Scored only on the signals that apply.** A dashboard is compared on four signals,
an alert on four, a saved search on three. Visual layout match does not apply to an
alert; firing behaviour does not apply to a dashboard. Scoring everything on five
and silently passing the inapplicable ones is the cheapest way to inflate every
confidence number on the page.

**Uncertain is an admission, not a weaker difference.** *Treasury Daily Pack* has
six of nineteen panels returning no rows on either side. An empty result matching
an empty result is not evidence of equivalence, and the comparison says so rather
than banking it as a match.

**No DQL editor, no context box, no re-translate button.** Validate owns the
verdict and the routing decision; Exceptions owns the rework — the same boundary
Translate drew between *runnable* and *correct*, one stage later. No side-by-side
diff either: that is P2. What P0 asks for is a confidence score and a *specific*
written finding — *"returns 12,400 rows in Splunk and 9,810 in Dynatrace for the
same 24-hour window"*, never a bare "different".

**Wave 1 landed at 77.9% against Calibrate's predicted 78.0% ±2.4.** That is the
calibration stage collecting on its own claim, and it is the reason the prediction
is worth making. Rates climb 77.9 → 81.6 → 82.1 → 82.9 as the profile absorbs
each wave.

**Three of the four live failures are not translation faults at all** — a correct
alert wired to the old on-call schedule, a correct panel with the wrong default
timeframe, a correct threshold that lost a per-BIN split. The comparison could not
have caught any of them, which is precisely the argument for the post-deploy
surface existing rather than trusting the gate.

Four sub-steps: *Comparison → Triage → Live review → Record*. Record is
estate-scoped and says so on the page — the false-positive and override-reversal
rates only mean anything across all four compared waves.

### Exceptions is the one stage where a person does the translation

Every other Transform stage is a machine doing work a human supervises. This one
is the reverse, and the screen is built around a person writing a query rather
than around a queue being drained.

**Four inlets, one worklist — and the fourth is not a rounding error.**

| | | |
|---:|---|---|
| **113** | Blocked in Translate | `translation.estate().blocked` |
| **135** | Sent back by Validate | `validation.estate().toExceptions` |
| **4** | Failed after going live | `validation.estate().failed` |
| **46** | No automated path | owned here |
| **298** | in the queue | **252** of them had an automated attempt |

Three of those four numbers are **re-derived on every render** from the stage
that produced them, so Exceptions cannot drift from Translate or Validate
without someone editing those stages. The fourth — lookups and macros whose
Splunk behaviour has no Dynatrace equivalent at all — is owned here, because it
never entered a translation run: no block reason, no confidence score, nothing
to retranslate. Those rows open into a **rebuild-from-intent** variant with
*Retranslate* disabled and the context box repurposed as the spec. The screen
keeps **252 of 298** visible everywhere, because the two populations answer
different questions and averaging them answers neither.

**One queue and not four,** because the work is identical: read the asset,
understand what it was for, write DQL that does it, prove it. Only the evidence
differs — a block reason, a validation finding, a reviewer's comment, or in 46
cases nothing at all.

**Two layouts, not one.** A dashboard is worked panel by panel against a rail and
publishes whole or not at all; an alert or a saved search is a single query, and
a one-item sidebar is a frame around nothing. *Fraud Model Drift* is 12 panels
with 4 blocked — routing all twelve through a single-query workspace would make
eight working panels unreachable.

**The context box is the stage's product.** Natural language, written alongside
the original SPL, fed to the translator on regeneration. Each round is kept
verbatim with what it produced, and three rounds that all came back *still
failing* is the most useful thing the pane can tell the next person to open the
asset. Three outcomes, never two: **Resolved**, **Improved** (runs, still
wrong), **Still failing**.

**Some queries never come good, and the demo shows one.** *Champion vs.
challenger* takes two rounds of context and returns 11,204 rows against the
original's 14,880 both times. It is fixed by hand, in the editor, and the
hand-written version is **never offered as a suggestion** — no AI diagnosis and
no suggested fix is a PRD non-goal, and the capture is a record of what a person
did, not a loop that closes itself.

**Single-asset publish runs the gate rather than going around it.** Exceptions
publishes one asset; Deploy publishes waves. The single-asset path exists
because a fix sitting in a queue is worth nothing — but it runs the same
pre-deploy health check, and the check is allowed to stop it. *Branch close-of-day
variance* fails four of five, including **Wave 4 has not deployed**; the screen
then says what happens instead (return it to its wave, resolved, waiting on
Deploy) rather than greying a button and leaving you to guess. Waves 5 and 6 have
no queue at all, and the stage says why — neither has finished translating, so
neither can have produced an exception.

**States are captured; there is no second reviewer.** *Needs review* and *Sent
back* persist as statuses and **the same person who did the work can reach
both** — Send back is a real action that hands the asset to whoever owns the
answer, with a written comment, and stops the clock on it. That is the
difference between a blocker and a silence.

**The delta is reported with its denominator.** 0.21 auto → 0.96 corrected is
**+0.75**, and the page argues immediately that this is the size of the manual
bill rather than the model's mistake: **113 of the 184** corrected assets scored
zero by construction, because no runnable DQL is a score of zero and not a bad
score. The same discipline applies to the clear rate — **61.7%** of 298, or
**73.0%** against the 252 that had an attempt. Both are true; the screen prints
both and names which population each one counts.

Four sub-steps: *Queue → Workspace → Publish → Record*.

### Deploy is a monitor, not a publishing console

**There is no "publish wave" button on this screen, and that is the product.**
An asset that clears validation goes to the tenant on its own; an asset that
Exceptions fixes goes on its own too. Adding an approve-and-release step here
would invent a gate the product does not have and make the automation look like
it needs supervision it does not need. The question the stage answers is not
*shall we go* but *is it out yet, and if not, what is holding it* — so every
number is a state, and every action either routes to the stage that owns the fix
or clears the one thing this stage owns.

**The health check holds assets, not waves.** The P1 PRD says the check "blocks
only the specific assets that fail, not the whole wave", and its metric is the
hardest on the roadmap: zero waves skip it, under any circumstance. Wave 3 is
the worked example — **14 held, 361 cleared and ready**. Reading that as "Wave 3
is blocked", which the Overview banner and a wave-level `health` field used to
say, overstates the check by about 360 assets and makes a real safety gate look
like ceremony standing in front of a finished wave. Fixing it meant deleting the
wave-level verdict and the `blockedAt` branch in `DMA.data.waveStageStatus`
rather than leaving a mechanism with nothing honest to point at. The five-segment
bar on each wave card is the whole argument in one shape: *held* is visibly a
sliver.

**Three failures, three surfaces**, because collapsing them into one "failed"
count would be the most misleading number this stage could print:

| | What happened | Where the fix lives |
|---|---|---|
| **14** Held | the check caught it before anything was written | upstream — nine of the fourteen are one mapping rule |
| **3** Refused | the write was attempted and the tenant said no | target-side RBAC, ownership, bucket — no DQL work moves it |
| **4** Live and wrong | already in the tenant, already incorrect | a write over a live object, the riskiest thing the product does |

**No rollback, deliberately.** Delta & Versioning's rollback explicitly excludes
objects already written to a live tenant, so offering one here would be a promise
the platform cannot keep. The honest answer for a live-and-wrong asset is a
redeploy over the top, and the screen says so.

Estate figures are derived, not typed: **858 live** (Wave 1 → Production 402,
Wave 2 → Non-prod 456), 361 ready, 360 awaiting the check, 156 open verdicts.

Four sub-steps: *Monitor → Held → Refused & wrong → Record*.

### Govern & Close carries two features with two different triggers

This stage looks half-empty, and the reason is the point. Its two P3 features
fire at different moments: **optimisation flagging runs per wave at publish**
and has already swept all 858 live assets, producing 16 findings nobody has
looked at; **the retention policy runs once at project close** and has not run
at all. Building it as one screen that "opens when the project closes" would
have hidden a completed pass with real findings *and* implied the cleanup was a
live capability. So the stage is half-populated on purpose and says which half.

**The close gate shows its arithmetic instead of greying itself out.** Five
derived reasons block close today — 4 of 6 waves unpublished, 4 assets live and
wrong, 156 open validation verdicts, 14 held by the health check, 1 published
wave live in staging and not promoted. Each row names the stage that owns it and
navigates there. The last one is marked `external`: promotion to production is a
customer sign-off recorded here but made outside DMA.

**There is no fix button anywhere on this screen.** All three relevant
acceptance criteria say flagged-not-fixed, so every control is a review control
— confirm, dismiss, accept into backlog, record exception — and each one names
what would fix it and who owns it.

**Query efficiency is two flag types, not one.** An explicit acceptance
criterion, and the justification is ownership: *parse-before-filter* is a query
rewrite, *repeated-parse* is an OpenPipeline change an architect owns. Both
carry the Globex post-mortem as their source. Nine flags across four types
(3 / 3 / 2 / 1), seven still open.

**Three of seven dedupe clusters are deliberately not duplicates.** Four
region-scoped fraud dashboards, a warn/page alert pair, an exec-vs-ops view —
false positives are the PRD's named complexity driver, and a queue where
everything is a duplicate trains a reviewer to confirm without reading. `kind`
(what a cluster *is*) and `state` (what a person *decided*) are separate fields,
so dismissing a cluster never rewrites the finding.

**One tag rule reports 0 of 858 rather than rounding up to 100%.**
`dt.owner`, `dma.source.index` and `dma.wave` are all derivable from the source
estate. `dt.cost_center` is not — it needs a customer finance mapping nobody has
supplied — so it is printed as a gap.

**A retention exception cannot be saved without a reason.** This is the only
modal in the prototype that refuses to save. The guardrail metric is "100%
revoked or explicitly extended with a reason", and a blank reason satisfies the
first half while defeating the second. Eight artifacts across five classes, one
pre-existing exception; the `history` class defaults to **retain**, not delete,
which is the asymmetry that makes this a policy rather than a delete button.

The Record step closes with five named exclusions, led by **User Enablement** —
both P3 PRDs put it outside DMA's system scope, which is why the old stub's
"hand off to enablement" summary was replaced.

Four sub-steps: *Organise → Optimisation flags → Close-out policy → Record*.

### The isolation rule

> **A module may depend on `DMA.ui`, `DMA.data`, and `DMA.store`.
> A module may never reference another module.**

This is what makes it safe to iterate one screen at a time. Rebuilding
`global-mapping` cannot break `validate`, because there is no path between
them. The only shared wiring is the `<script>` manifest in `index.html`.

### Module contract

```js
DMA.register({
  id:      "import",          // URL hash segment
  title:   "Import",          // sidebar label + page header heading
  phase:   "extract",         // flow-diagram phase
  icon:    "download",        // DMA.ui icon key
  status:  "ready",           // "stub" renders the placeholder screen
  scope:   "estate",          // "estate" | "wave" | "sample" — see below
  summary: "One-line description.",
  steps:   [{ id: "sources", label: "Sources" }],  // the stage's own sub-steps
  notes:   ["Design decisions, shown on the stage."],
  render(root, ctx) { /* paint into root */ },
});
```

`features` is **not** a register key — the shell derives a module's roadmap
features from `data/features.js` via `DMA.data.featuresFor(mod.id)`.

`ctx` provides `navigate(moduleId)` and `pageHeader(actions)`.

---

## Two navs, two questions

The sidebar and the top bar used to carry the same thirteen stage names in two
different shapes, which is the definition of a duplicate. They now answer
different questions:

| | Question | Carries |
|---|---|---|
| **Sidebar** | Where can I go? | Every stage, labelled, grouped by phase. No status. |
| **Phase pipeline** | How far has the work got? | Five phases, each with a completion fraction and one meter segment per stage. No stage names. |

Neither one is a subset of the other, so neither is redundant.

### The pipeline is a fraction, not a tick

The first sketch gave each phase a tick / half / empty glyph. Against the real
project that renders **five identical half-glyphs**, because every phase is
mid-flight at once — which is what a migration actually looks like. The design
only works with a denominator:

```
Whole estate   Setup 1/2 · Extract 3/4 · Transform 1/4 · Load 0/1 · Close 0/1
Wave 1         Setup 1/2 · Extract 4/4 · Transform 4/4 · Load 1/1 · Close 0/1
Wave 6         Setup 1/2 · Extract 3/4 · Transform 1/4 · Load 0/1 · Close 0/1
```

Clicking a phase opens **the first stage in it that is not complete**, not the
first stage. Going to a named stage is the sidebar's job; a chip that always
dropped you on a finished screen would make the fraction beside it useless as
a target. When every stage in the phase is done it falls back to the first.

A phase's denominator is every stage in it, including the estate-scoped ones,
even when a wave is in scope. A wave does not personally pass through Import,
but Import is a prerequisite it inherits — so the fraction answers "how far
along is the work this wave depends on", and the chip's tooltip lists the
split stage by stage so the number is never the whole claim.

### `scope` — what a stage operates on

- **`estate`** — the whole inventory. One pass, no parallelism. Qualify & Scope,
  Prepare Environment, Import, Global Mapping, Prioritize & Plan, Govern & Close.
- **`sample`** — the calibration sample only. Calibrate alone.
- **`wave`** — a single delivery wave. Wave Mapping, Translate, Validate,
  Exceptions, Deploy.

The wave picker renders in the **page header**, not the chrome: which wave you
are looking at is a property of the stage in front of you. `DMA.shell.pageHeader`
emits it whenever `mod.scope === "wave"`, so it is one implementation in a
function every module already calls rather than five copies in five modules.
Estate- and sample-scoped stages get nothing — they used to show a static
"Whole estate" line, which was a control-shaped thing that could not be
operated.

The four modules that carried their own `← All waves` button lost it. The
picker's first option is All waves and it sits in the same row, so the button
was the header arguing with itself.

### The fan-out

The first `wave`-scoped module in registration order is where the estate stops
being one track and becomes one track per wave. Derived, not hard-coded — the
pipeline's subject tooltip names it, so re-ordering the stages moves it.

This is the one structural fact a flat list hides. Wave 1 can be deploying
while Wave 4 is still translating; a single project-level position cannot say
that. The pipeline recomputes every fraction against the selected wave
(`DMA.data.waveStageStatus`), which is also what gives the two navs a real
reason to coexist rather than a stated one.

### The subject label

Left of the chips, the pipeline names what it is counting — "Whole estate" or
"Wave 3 — Treasury & Settlement". It has to: `waveId` is global session state
and the picker only appears on wave-scoped stages, so without the label the
pipeline would quietly report wave 3's position on a screen with nothing on it
mentioning wave 3. When a wave is in scope the label is a button that clears
back to the estate — the only exit from a wave once you have navigated to a
stage that has no picker.

### What is still deferred

A stage-level drill-down — the pipeline showing **the sub-steps of the stage
you are in** — remains the eventual destination for the bar beneath the top
nav. It is deferred because a stage's sub-steps cannot be invented ahead of the
screen that contains them, and because all twelve stages currently render their
own `stepper()` into their own session key. **As each module is built it should
declare its own sub-steps**; that list is what a drill-down would render.

The predecessor to the pipeline listed all thirteen stages here. It overflowed
its container by 488px at 1512px wide, hiding Translate through Govern & Close
behind a scroll. Five chips fit with no scroll container down to 1180px.

---

## Prototype-only affordances

Two things in this prototype are presentation aids for *this artifact* and are
**not** part of the product UI:

- **Roadmap tier overlay** (top bar) — overlays P0/P1/P2/P3 badges on every
  feature so the dev team can see sequencing. Off by default.
- **"Proposed" markers** — features carrying `proposed: true` in
  `data/features.js` came out of design review and are **not** in the approved
  Value Pack roadmap. Currently: *Customer Calibration Profile* and
  *Application-Scoped Mapping Overrides*. Do not read them as committed scope.

---

## Demo data

The golden path models the Acme Corp reference migration cited across the
feature PRDs: 2,955 assets (3,002 dashboard panels, 1,204 alerts), 6 waves,
2,400 auto-approved vs. 555 needing attention (81.2% auto-approval against a
≥70% launch target), and a 1,675-hour manual review baseline.

The project sits mid-flight with two waves already in a customer tenant and
four still upstream — chosen so the prototype shows real held, failed and
in-review states rather than an unrealistically clean happy path.

The six waves are deliberately spread across the flow so the scope selector has
something to show: Waves 1–2 published, Wave 3 validating, Wave 4 translated,
Wave 5 mapped, Wave 6 planned only.

**The pre-deploy health check holds assets, not waves.** An earlier version of
this demo data carried a wave-level `health` verdict and marked Wave 3
*blocked at Deploy*. That was wrong on the PRD's own terms — the check holds
the assets that fail it and lets the rest of the wave through — and it was
wrong on the numbers, claiming a 497-asset problem where a 14-asset one
exists. Wave 3 today has **361 assets cleared and waiting** and **14 held**,
and the `blockedAt` branch in `DMA.data.waveStageStatus` was removed with the
verdict rather than left as a mechanism with nothing honest to point at.

Downstream of that, **858 assets are live** (Wave 1 → Production, Wave 2 →
Non-prod), **4 of them are live and wrong** and surfaced in Validate's live
review, and Govern & Close has already run its organise-and-flag pass over all
858 while its retention policy has not run at all.

**Prepare Environment is deliberately not green.** A stage that passed cleanly
hides every state the feature exists for. Rather than contradict the timeline —
the project is already at Validate, so environment prep obviously finished once
— the gate is modelled as *re-opened*: it was signed off Oct 3 for Waves 1–3,
and the Wave 4–6 re-plan introduced three unmapped indexes. That keeps the flow
coherent while still showing failed checks, blocking actions, and a pending
manual sign-off.

---

## Known discrepancy: where the Readiness Checklist Gate belongs

The *Readiness Checklist Gate* PRD describes itself as "the fourth and final
step of the target-state **Qualify & Scope** stage", gating entry into Import.
`data/features.js` assigns it to **Prepare Environment**, and the prototype
builds it there — as that stage's closing gate, run by the Architect, assessing
whether the tenant is mature enough to import into.

Both readings are defensible because there are genuinely two sign-offs: the SSD
closing out scope, and the Architect closing out environment. The PRD text
conflates them. **Prepare Environment is treated as correct here** — the gate's
own acceptance criteria are environment facts, and its owner is the Architect,
not the SSD. Worth correcting the PRD's stage reference.

---

## Known discrepancy: flow diagram vs. Value Pack

The DMA Flow Diagram PDF still shows **Global + Per-Asset Overrides** and
**Background Job + Live ETA** in its feature map. The Value Pack's August 17
2026 reprioritisation states both were dropped from the roadmap entirely, and
both sit in `Feature Sets/Archived/`. The diagram also positions LOE estimation
early, while the Value Pack moved **Transparent LOE Estimator** from P0 to P3.

**The Value Pack is treated as authoritative here.** These items are retained in
`data/features.js` with `tier: "dropped"` so the absence is documented rather
than silent. Worth reconciling the diagram before it's shared more widely.

One nuance: *Global + Per-Asset Overrides* stays dropped, but design review
reinstated the capability at a narrower scope as the proposed
*Application-Scoped Mapping Overrides*. The original was dropped for being
unbounded; the replacement is bounded by the global rule and bound to a stable
grouping. Flag this if the diagram is reconciled — it is not a straight revert.
