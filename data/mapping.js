/* ============================================================================
   Mapping scope model — shared by the Global Mapping and Wave Mapping modules.
   ----------------------------------------------------------------------------
   This file exists in data/ rather than inside either mapping module because
   BOTH modules need the cascade resolver, and the isolation rule forbids one
   module importing another. Shared logic goes here; never module-to-module.

   Governing principle:
     Ingest and identity are GLOBAL. Presentation and delivery are PER-WAVE.

   Rationale: ingest happens once and is shared across waves. If Wave 1 maps
   index=payments to bucket A and Wave 4 maps it to bucket B, the data is split
   and the DQL in both waves is wrong. Presentation is per-asset and cheap to
   change, so it can safely vary by wave.
   ========================================================================== */

window.DMA = window.DMA || {};
DMA.data = DMA.data || {};

DMA.data.mapping = {
  principle: "Ingest and identity are global. Presentation and delivery are per-wave.",

  /* --- Cascade: most specific wins ------------------------------------- */
  /* Layer zero is the SPL translator itself. It already rewrites a set of
     Splunk fields on every query it touches, and today that happens with no
     surface anywhere in the product — which is why the live Field Mappings
     tab reads 0 while thirteen field decisions are in fact being made. */
  scopes: [
    { id: "translator", label: "Translator built-ins", setAt: null, readOnly: true, note: "Applied by the SPL translator before any rule runs. Visible and overridable, never silent." },
    { id: "project", label: "Project", setAt: "global-mapping", note: "Set before Prioritize & Plan — it is an input to wave sizing." },
    { id: "application", label: "Application", setAt: "wave-mapping", note: "Bound to application, not wave, so re-grouping waves never orphans a mapping decision." },
    { id: "asset", label: "Asset", setAt: "wave-mapping", note: "Individual exceptions." },
  ],

  /* --- Layer zero: what the translator does before any rule applies ------ */
  translator: {
    summary:
      "Seven Splunk fields are rewritten on every translated query and six more are discarded. None of it is configuration today — it is behaviour, and it is invisible.",
    builtIns: [
      { from: "_time",       to: "timestamp",  why: "Event time becomes the Grail timestamp — the anchor every translated timeframe resolves against." },
      { from: "_raw",        to: "content",    why: "The unparsed event body becomes the log record content." },
      { from: "_indextime",  to: "timestamp",  why: "Index time collapses onto the same target as _time.", collision: "timestamp" },
      { from: "host",        to: "host.name",  why: "Splunk host becomes the semantic host attribute." },
      { from: "source",      to: "log.source", why: "File path or input name becomes the log source." },
      { from: "sourcetype",  to: "log.source", why: "Sourcetype collapses onto the same target as source.", collision: "log.source" },
      { from: "msg",         to: "content",    why: "A conventional message field, folded into content.", collision: "content" },
    ],
    /* Dropped is not the same as unmapped. These have no meaning on the
       target side at all — but a query that filters on one of them silently
       returns nothing, so they belong on screen rather than in a release note. */
    dropped: [
      { field: "_bkt",    why: "Identifies the physical Splunk bucket holding the event. Grail has no equivalent storage address." },
      { field: "_cd",     why: "Address of the event inside that bucket. Internal to Splunk's storage layer." },
      { field: "_kv",     why: "Marks whether key/value extraction already ran. A parsing artefact, not data." },
      { field: "_serial", why: "Row number within a result set, assigned at search time. Reproduced by DQL ordering instead." },
      { field: "_si",     why: "The Splunk instance and index that served the result. Replaced by bucket provenance." },
      { field: "_span",   why: "Bucket width of a timechart result. Re-derived from the DQL interval." },
    ],
  },

  /* --- Global rules (Global Mapping Configurations) --------------------- */
  globalRules: [
    {
      id: "index-bucket",
      name: "Index → Bucket",
      detail: "Which Grail bucket each Splunk index lands in. Bucket-per-index by default.",
      why: "An index is a shared source-side resource. Two waves cannot disagree about where it lands without splitting the data.",
    },
    {
      id: "retention",
      name: "Retention / bucket policy",
      detail: "Retention period and policy per bucket.",
      why: "A property of the bucket, which is itself global.",
    },
    {
      id: "pipeline-fields",
      name: "Pipeline field mapping",
      detail: "props.conf / transforms.conf → OpenPipeline processors and semantic field names.",
      why: "Parsing happens once at ingest. Two waves querying the same sourcetype need identical field names or their DQL diverges.",
    },
    {
      id: "lookup-tables",
      name: "Lookup → Grail table",
      detail: "Which Grail table each Splunk lookup file becomes.",
      why: "Several applications reference the same lookup. Scoping the definition per-wave creates duplicates or a dangling dependency when the second wave ships. Only the delivery timing is wave-level.",
    },
    {
      id: "identity",
      name: "RBAC / identity / ownership",
      detail: "Splunk users and roles → Dynatrace IAM groups and asset ownership.",
      why: "Identity is org-wide. Per-wave identity mapping would produce inconsistent ownership across the same team's assets.",
    },
    {
      id: "naming-template",
      name: "Naming convention template",
      detail: "The pattern itself, e.g. [{prefix}] {source_name}. Token values are set per-wave.",
      why: "Consistency across the estate; only the variable parts need to differ.",
    },
    {
      id: "query-guardrails",
      name: "Query guardrails",
      detail: "Maximum default timeframe and a requirement that bucket selection is scoped.",
      why: "Encodes the Globex post-mortem as a rule set up front, rather than relying on the Pre-Deploy Health Check to catch it late.",
    },
  ],

  /* --- Wave rules (Wave Map Configurations) ----------------------------- */
  waveRules: [
    { id: "naming-tokens",     name: "Naming token values",        detail: "Application prefix, team label, and other variable parts of the global template." },
    { id: "timeframe",         name: "Timeframe override",         detail: "A longer default window for this application — bounded by the global ceiling." },
    { id: "placement",         name: "Target app / segment",       detail: "Where converted assets live in the Dynatrace tenant." },
    { id: "tags",              name: "Tags & groups",              detail: "Tagging applied to published assets. Feeds Optimization-Opportunity Flagging at closeout." },
    { id: "lookup-delivery",   name: "Lookup delivery scheduling", detail: "Which wave publishes a lookup. It must ship with or before the first wave that references it." },
    { id: "asset-overrides",   name: "Per-asset overrides",        detail: "Individual exceptions to any inherited rule." },
  ],

  /* --- Lock semantics ---------------------------------------------------- */
  lock: {
    rule: "Global rules are editable until the first translation runs against them, then lock — scoped per wave.",
    waveScoped: "Wave 5's configuration stays open while Wave 1 is frozen.",
    unlockPath: "The only door back is a manual-review action that explicitly returns affected assets to translation (P1 — Add Manual Translation Review and Validation).",
    contrast:
      "The translation profile produced by Calibrate is the opposite: it stays living. These look contradictory but are not — a mapping change silently invalidates assets already translated, while a profile change only affects future translations.",
  },

  /* --- Cascade resolver -------------------------------------------------- */
  /* Returns the effective value for a field plus where it came from, so the UI
     can always show provenance ("inherited from project" / "set on this app"). */
  resolve(fieldId, layers) {
    const order = ["asset", "application", "project", "translator"];
    for (const scope of order) {
      const layer = layers[scope];
      if (layer && Object.prototype.hasOwnProperty.call(layer, fieldId)) {
        return { value: layer[fieldId], source: scope, inherited: scope !== "asset" };
      }
    }
    return { value: null, source: null, inherited: false };
  },
};
