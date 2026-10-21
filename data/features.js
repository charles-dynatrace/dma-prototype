/* ============================================================================
   Roadmap feature map — source of truth for the P0–P3 tier overlay.
   ----------------------------------------------------------------------------
   Mirrors section 6 of PRODUCT-16422 (DMA) Value Pack, including the
   August 17 2026 reprioritisation. 22 roadmap features total.

   Entries carrying `proposed: true` came out of design review and are NOT yet
   in the approved Value Pack roadmap. They render with a "Proposed" marker so
   the dev team never mistakes them for committed scope.

   Entries carrying `parked: true` ARE in the approved roadmap but have been
   deferred out of this prototype, with `parkedWhy` recording the reason. They
   stay listed — removing them would hide a roadmap commitment — but render with
   a "Parked" marker so nobody builds against them in this phase.

   `tier` values:
     live     — already delivered in the production platform (Value Pack §5)
     p0..p3   — roadmap tier
     dropped  — removed from the roadmap; retained here only to explain absence

   NOTE: the DMA Flow Diagram PDF still shows "Global + Per-Asset Overrides" and
   "Background Job + Live ETA" in its feature map. The Value Pack states both
   were dropped entirely and both sit in Feature Sets/Archived/. The Value Pack
   is treated as authoritative here.
   ========================================================================== */

window.DMA = window.DMA || {};

DMA.data = DMA.data || {};

DMA.data.features = [
  /* --- Delivered (live platform) -------------------------------------- */
  { id: "curator-contract",   name: "Curator data-contract ingest",            tier: "live", module: "qualify-scope" },
  { id: "structure-convert",  name: "Structure conversion + DQL scaffolding",  tier: "live", module: "translate" },
  { id: "assignment-status",  name: "Consultant assignment + status tracking", tier: "live", module: "overview" },
  { id: "warning-taxonomy",   name: "Warning & gap taxonomy",                  tier: "live", module: "validate" },
  { id: "side-by-side",       name: "Side-by-side source↔DQL preview + edit",  tier: "live", module: "exceptions" },
  { id: "publish-tenants",    name: "Publish to non-prod / prod tenants",      tier: "live", module: "deploy" },

  /* --- P0: build first -------------------------------------------------- */
  {
    id: "asset-validation",
    name: "Asset-to-Asset Validation",
    tier: "p0",
    module: "validate",
    what: "Compares every translated asset against its Splunk original and auto-approves exact matches; only real differences reach a human.",
    metric: "Auto-approval rate ≥70% at launch, growing toward ≥90%.",
  },
  {
    id: "source-connector",
    name: "Universal Source Connector",
    tier: "p0",
    module: "qualify-scope",
    what: "Connect Splunk directly inside DMA with credentials, replacing local export scripts and manual .tar.gz upload.",
    metric: "Time to first successful connection <15 min.",
  },
  {
    id: "asset-importer",
    name: "Universal Asset Importer",
    tier: "p0",
    module: "import",
    what: "Pulls every asset and its metadata in one bulk pass and flags what is new, changed, or removed since the last import.",
    metric: "Full inventory import in <15 min, regardless of asset count.",
  },
  {
    id: "context-injection",
    name: "Context-Injection Engine",
    tier: "p0",
    module: "global-mapping",
    what: "Suggests a starting bucket, naming pattern, and field mapping for every asset entering Map Configurations.",
    metric: "100% of assets enter mapping with a suggested default pre-populated.",
  },

  /* --- P1: next --------------------------------------------------------- */
  {
    id: "env-readiness",
    name: "Environment Readiness Engine",
    tier: "p1",
    module: "prepare-environment",
    what: "Automated agent, bucket, and data-flow checks run in parallel with Import & Qualify to confirm the target is actually ready.",
    metric: "Majority of environment issues caught pre-deploy, not at stage 9.",
  },
  {
    id: "llm-bulk-translate",
    name: "Add LLM Translations to the Bulk Translation Workflow",
    tier: "p1",
    module: "translate",
    what: "System picks a best-fit model per translation and retries failures with system-generated context instead of stopping at the first miss.",
    metric: "% of bulk-translated assets passing validation without a manual retry.",
  },
  {
    id: "predeploy-health",
    name: "Pre-Deploy Health Check",
    tier: "p1",
    module: "deploy",
    what: "Blocking check covering data flow and query/throttle-limit risk; blocks only the specific failing assets, not the whole wave.",
    metric: "0 waves skip the check, under any circumstance.",
  },
  {
    id: "delta-versioning",
    name: "Delta / Versioning Engine",
    tier: "p1",
    module: "import",
    what: "Persists full version history per asset across every import, with arbitrary-version diff and rollback.",
    metric: "100% of imported assets carry full version history.",
  },
  {
    id: "manual-review",
    name: "Add Manual Translation Review and Validation to DMA Workflow",
    tier: "p1",
    module: "exceptions",
    what: "Review, edit, re-translate, and redeploy failed assets inside DMA — including natural-language context injection to regenerate DQL.",
    metric: "Delta score between auto-translated and manually-corrected result.",
  },

  {
    id: "calibration-profile",
    name: "Customer Calibration Profile",
    tier: "p1",
    module: "calibrate",
    proposed: true,
    what: "Builds a macro, naming, and idiom profile from a stratified sample of dependency-free assets, then scores itself through Asset-to-Asset Validation to predict auto-approval before the estate commits.",
    metric: "Calibration lift — auto-approval rate with the profile vs. without, on the same sample.",
  },
  {
    id: "env-maturity-assessment",
    name: "Environment Maturity Assessment",
    tier: "p1",
    module: "prepare-environment",
    proposed: true,
    what: "Scores the target tenant across the six technical domains a migration depends on — ingest, storage, pipeline, access, capacity, topology — against a defined Migration-ready bar, and turns every domain below the bar into a specific owned action for the Architect. Modelled on the Transformation Journey maturity assessment, but technical rather than business.",
    metric: "100% of blocking environment actions named by the system rather than discovered at deploy.",
  },
  {
    id: "no-equivalent-scoping",
    name: "No-Equivalent Capability Flagging",
    tier: "p1",
    module: "qualify-scope",
    proposed: true,
    what: "Names the Splunk assets and capabilities that have no Dynatrace equivalent at scoping time, split into blocked (leaves scope) and rework (stays, costs manual hours), and exports the list for the SSD to take into a client conversation.",
    metric: "100% of no-equivalent capabilities named in the LOE report before a scope is agreed.",
  },
  {
    id: "app-scoped-overrides",
    name: "Application-Scoped Mapping Overrides",
    tier: "p1",
    module: "wave-mapping",
    proposed: true,
    what: "Reinstates the dropped Global + Per-Asset Overrides at a narrower scope — overrides bind to application, not wave, so they survive EPM re-planning.",
    metric: "0 mapping decisions orphaned by a wave re-group.",
  },

  /* --- P2: later / reconsider timing ------------------------------------ */
  {
    id: "confidence-triage",
    name: "Mapping Confidence Triage",
    tier: "p2",
    module: "global-mapping",
    what: "Classifies every asset as Fits Default, Needs Configuration, or Uncertain before it can proceed.",
    metric: "0 Uncertain assets proceed to translation without explicit human resolution.",
  },
  {
    id: "readiness-checklist",
    name: "Readiness Checklist Gate",
    tier: "p2",
    module: "prepare-environment",
    what: "Required go/no-go checklist, built from signals DMA already computes, confirmed before a project enters Import & Qualify.",
    metric: "100% of projects have a recorded confirmation before progressing.",
  },
  {
    id: "no-equivalent-preflag",
    name: "No-Equivalent Command Pre-Flag",
    tier: "p2",
    module: "import",
    what: "Flags at import time any asset containing an SPL command with no DQL equivalent. Shares its detection engine with No-Equivalent Capability Flagging in Qualify & Scope — same rules, surfaced a second time once the real inventory lands.",
    metric: "100% of no-equivalent-command assets flagged at import.",
  },
  {
    id: "dead-asset-gate",
    name: "Dead-Asset Validation Gate",
    tier: "p2",
    module: "import",
    what: "Auto-excludes assets already flagged dead/no-data, with a PM override for false positives.",
    metric: "100% auto-excluded by default.",
  },
  {
    id: "env-templates",
    name: "Best Practice Environment Templates",
    tier: "p2",
    module: "prepare-environment",
    what: "Applies DMA's documented best practices — bucket-per-index, naming convention, processor ordering — automatically.",
    metric: "100% of new projects provisioned from the template.",
  },
  {
    id: "similarity-diff",
    name: "Similarity Score + Diff View",
    tier: "p2",
    module: "validate",
    what: "Attaches a computed similarity score and visual source-vs-translation diff to every routed exception.",
    metric: "100% of routed exceptions carry a score + diff.",
  },
  {
    id: "self-service",
    name: "Customer & Partner Self-Service",
    tier: "p2",
    module: "qualify-scope",
    what: "Authenticated customers or certified partners run connect/import/translate themselves, with guardrails and escalation.",
    metric: "% of pilot projects run end-to-end without a Dynatrace consultant.",
  },

  /* --- P3: backlog ------------------------------------------------------ */
  {
    id: "loe-estimator",
    name: "Transparent LOE Estimator",
    tier: "p3",
    module: "qualify-scope",
    what: "Turns the complexity assessment into an hours estimate split between automated and manual hours.",
    metric: "Estimate accuracy within ±20% at launch.",
  },
  {
    id: "capacity-planner",
    name: "Limit-Aware Capacity Planner",
    tier: "p3",
    module: "prioritize-plan",
    parked: true,
    parkedWhy:
      "Parked Oct 21 2026. The premise — that throughput imposes a wave-size ceiling — does not hold: translation throughput is a rate, not a capacity. A larger wave takes longer; it does not fail. The ceiling only looked real because wave duration was frozen at five days. Target team bandwidth belongs to Qualify & Scope (sizing the engagement) and actual throughput belongs to Overview (monitoring progress) — neither constrains how an EPM groups applications. Revisit once two or three projects have produced real per-wave throughput data to calibrate against.",
    what: "Models ingest capacity, translation throughput, and team bandwidth as a wave-size ceiling.",
    metric: "100% of proposed waves sized against a modeled ceiling.",
  },
  {
    id: "wave-generator",
    name: "Priority-Driven Wave Generator",
    tier: "p3",
    module: "prioritize-plan",
    what: "Proposes wave grouping and order from app priority, respecting dependency checks; still EPM-adjustable.",
    metric: "100% of new projects start from a system-proposed grouping.",
  },
  {
    id: "nondashboard-waves",
    name: "Support Wave Assignment for Non-Dashboard Asset Types",
    tier: "p3",
    module: "prioritize-plan",
    what: "Extends wave assignment beyond dashboards to alerts, searches, and other asset types.",
    metric: "% of non-dashboard assets entering a wave via the generator.",
  },
  {
    id: "retention-policy",
    name: "Retention / Close-Out Policy",
    tier: "p3",
    module: "govern-close",
    what: "Config-managed policy governing temp buckets, credentials, and staging data at project close.",
    metric: "100% of temporary credentials revoked or explicitly extended at closeout.",
  },
  {
    id: "optimization-flagging",
    name: "Optimization-Opportunity Flagging",
    tier: "p3",
    module: "govern-close",
    what: "Auto-tags, groups, and dedupes published assets and flags cost/usability optimisation opportunities.",
    metric: "100% of published waves auto-tagged/grouped/deduped at closeout.",
  },

  /* --- Dropped (shown only to explain absence from the flow diagram) ---- */
  { id: "global-overrides",  name: "Global + Per-Asset Overrides",      tier: "dropped", module: "wave-mapping", what: "Dropped from the roadmap in the Aug 17 2026 reprioritisation; still present in the flow diagram PDF. Superseded by Application-Scoped Mapping Overrides below, which reinstates the capability at a narrower scope." },
  { id: "background-eta",    name: "Background Job + Live ETA",         tier: "dropped", module: "translate",           what: "Dropped from the roadmap in the Aug 17 2026 reprioritisation; still present in the flow diagram PDF." },
  { id: "ai-corrections",    name: "AI-Assisted Translation Corrections", tier: "dropped", module: "exceptions",        what: "Retired as a standalone item and folded into Add Manual Translation Review and Validation." },
  { id: "pluggable-translation", name: "Pluggable Translation",         tier: "dropped", module: "translate",           what: "Archived — superseded by the LLM bulk-translation workflow." },
];

DMA.data.featuresFor = function (moduleId, includeDropped = false) {
  return DMA.data.features.filter(
    (f) => f.module === moduleId && (includeDropped || f.tier !== "dropped")
  );
};

DMA.data.TIER_LABELS = {
  live: "Live today",
  p0: "P0 — Build first",
  p1: "P1 — Next",
  p2: "P2 — Later",
  p3: "P3 — Backlog",
  dropped: "Dropped",
};
