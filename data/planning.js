/* ============================================================================
   Prioritize & Plan — the application model, the seeded proposal, and the
   committed plan a human edited it into.
   ----------------------------------------------------------------------------
   Governing principle (revised Oct 21 2026):
     Priority seeds a proposal. Wave membership is STORED on the application
     and inherited by every asset inside it. The human owns the waves.

   This reverses the previous model, which resolved wave membership from a
   capacity ceiling and never stored it. That version implemented half of the
   approved Priority-Driven Wave Generator PRD — "proposes wave grouping and
   order from app priority, respecting dependency checks" — and dropped the
   other half: "still EPM-adjustable". A consultant learns things from the
   client that the generator cannot see: a change-freeze window, a regulatory
   filing date, an acquisition that makes two applications move together. A
   plan that cannot absorb those is a plan that gets kept in a spreadsheet
   instead.

   What we are still NOT doing is the live product's model, which stores a
   wave on every individual asset — 13,946 hand assignments reconciled against
   a manifest holding 13,937, and a UI that warns "4,108 unassigned assets".
   Here a human makes 19 placement decisions plus a small orphan queue, and
   2,908 assets inherit. Decide at the application layer, inherit at the asset
   layer — the same argument Wave Mapping makes one stage later.

   Three separable things, unchanged from the Oct 19 2026 design review:
     waves       — the partition. Every in-scope asset has exactly one.
     calibration — a sample overlay. Drawn across waves for pattern coverage,
                   deploys to non-prod only, never removes an asset from its
                   home wave.
     ownership   — an assignment overlay. Independent of both, informed by
                   both, and now one-to-many.

   Capacity modelling has been removed from this stage. Translation throughput
   is a rate, not a wave-size cap — a larger wave takes longer, it does not
   fail — and review bandwidth is a scoping and progress-monitoring question,
   not a planning constraint. See data/features.js: `capacity-planner` is
   parked rather than re-homed.
   ========================================================================== */

window.DMA = window.DMA || {};
DMA.data = DMA.data || {};

DMA.data.planning = {
  principle: "Priority seeds the proposal. Wave membership is stored on the application and inherited by its assets.",

  /* --- The seed input ----------------------------------------------------- */
  /* Four tiers, not a forced 1–19 rank. A rank asks for nineteen judgements
     where four will do. The tier no longer decides the plan — it decides the
     starting proposal, which the EPM then reorganises. */
  tiers: [
    { id: "critical", label: "Critical", rank: 0, tone: "critical", definition: "Revenue or regulatory stop. The business notices within minutes." },
    { id: "high",     label: "High",     rank: 1, tone: "warning",  definition: "Operational impact within a working day." },
    { id: "medium",   label: "Medium",   rank: 2, tone: "info",     definition: "Degraded insight. Tolerable for a week." },
    { id: "low",      label: "Low",      rank: 3, tone: "neutral",  definition: "Internal or historical. No external commitment." },
  ],

  /* --- The 19 applications ------------------------------------------------
     `tier` is the declared input. `dependsOn` is discovered at Import from
     shared indexes, lookup references and drilldown targets — it is evidence,
     not a judgement, which is why the consultant cannot edit it here.

     Asset counts total 2,908, not the full 2,955 estate. The remaining 47 are
     orphans that carry no application attribution at all; they live in
     `unmapped` below and are the reason this stage needs a queue rather than
     a guarantee that every asset is already accounted for. */
  applications: [
    { id: "platform-shared",   name: "Platform Shared Services",  short: "Platform",     slug: "platform_shared",   assets: 108, tier: "low",      dependsOn: [],                                     basis: "The shared `main` index plus the identity and routing lookups every other application reads." },
    { id: "payments-core",     name: "Payments Core",             short: "Payments",     slug: "payments_core",     assets: 412, tier: "critical", dependsOn: ["platform-shared"],                    basis: "Settlement and authorisation. A gap here is revenue, measured in minutes." },
    { id: "fraud-risk",        name: "Fraud & Risk",              short: "Risk",         slug: "fraud_risk",        assets: 288, tier: "critical", dependsOn: ["payments-core", "platform-shared"],   basis: "Scores every transaction Payments Core emits. Blind means unscored." },
    { id: "sanctions",         name: "Sanctions Screening",       short: "Screening",    slug: "sanctions",         assets: 134, tier: "critical", dependsOn: ["platform-shared"],                    basis: "OFAC screening. A reporting gap is a regulatory finding, not a degraded dashboard." },
    { id: "treasury-ops",      name: "Treasury Ops",              short: "Treasury",     slug: "treasury_ops",      assets: 238, tier: "high",     dependsOn: ["payments-core"],                      basis: "Liquidity and nostro positions. Impact lands at end of day, not instantly." },
    { id: "settlement",        name: "Settlement & Reconciliation", short: "Settlement", slug: "settlement",        assets: 201, tier: "high",     dependsOn: ["payments-core"],                      basis: "Daily recon against correspondent banks." },
    { id: "compliance-rpt",    name: "Compliance Reporting",      short: "Compliance",   slug: "compliance_rpt",    assets: 186, tier: "high",     dependsOn: ["sanctions", "settlement"],            basis: "Builds regulatory filings from screening and recon output." },
    { id: "retail-channels",   name: "Retail Channels",           short: "Channels",     slug: "retail_channels",   assets: 168, tier: "high",     dependsOn: ["payments-core"],                      basis: "Branch and teller estate across four regions." },
    { id: "agent-network",     name: "Agent Network",             short: "Agents",       slug: "agent_network",     assets: 158, tier: "high",     dependsOn: ["retail-channels"],                    basis: "Third-party payout agents. Contractual SLAs attached." },
    { id: "digital-wallet",    name: "Digital Wallet",            short: "Wallet",       slug: "digital_wallet",    assets: 149, tier: "medium",   dependsOn: ["payments-core", "retail-channels"],   basis: "Mobile app sessions. Growing, but not yet a primary channel." },
    { id: "fx-pricing",        name: "FX Pricing",                short: "FX",           slug: "fx_pricing",        assets: 131, tier: "medium",   dependsOn: ["treasury-ops"],                       basis: "Rate feeds and spread monitoring." },
    { id: "card-services",     name: "Card Services",             short: "Cards",        slug: "card_services",     assets: 118, tier: "medium",   dependsOn: ["payments-core"],                      basis: "Prepaid card issuance and balance enquiry." },
    { id: "customer-identity", name: "Customer Identity",         short: "Identity",     slug: "customer_identity", assets: 112, tier: "medium",   dependsOn: ["platform-shared"],                    basis: "KYC records and onboarding funnels." },
    { id: "partner-api",       name: "Partner API",               short: "Partner API",  slug: "partner_api",       assets: 97,  tier: "medium",   dependsOn: ["payments-core"],                      basis: "Outbound API for banking partners." },
    { id: "remittance",        name: "Remittance Tracking",       short: "Remittance",   slug: "remittance",        assets: 89,  tier: "medium",   dependsOn: ["payments-core", "agent-network"],     basis: "Customer-facing transfer status." },
    { id: "corporate-it",      name: "Corporate IT",              short: "Corporate IT", slug: "corporate_it",      assets: 131, tier: "low",      dependsOn: [],                                     basis: "Endpoint, VPN and helpdesk telemetry. No customer exposure." },
    { id: "hr-payroll",        name: "HR & Payroll",              short: "HR",           slug: "hr_payroll",        assets: 71,  tier: "low",      dependsOn: [],                                     basis: "Internal only, monthly cadence." },
    { id: "facilities-iot",    name: "Facilities & IoT",          short: "Facilities",   slug: "facilities_iot",    assets: 64,  tier: "low",      dependsOn: [],                                     basis: "Building sensors across 11 sites." },
    { id: "marketing",         name: "Marketing Analytics",       short: "Marketing",    slug: "marketing",         assets: 53,  tier: "low",      dependsOn: ["digital-wallet"],                     basis: "Campaign attribution. Reads wallet session data." },
  ],

  /* --- The committed waves -------------------------------------------------
     First-class objects now, not artifacts of a generator. The EPM creates,
     renames, reorders and deletes them. Six is what this project chose; it is
     not a property of the model. One wave per application is as valid as one
     wave for the whole estate — the tool must not have an opinion.

     `order` is what "tackle them one at a time" reads from. Ids are stable so
     that a reorder never rewrites wave membership. */
  waves: [
    { id: 1, order: 1, name: "Foundation",                   note: "Everything downstream waits on the shared platform, so it ships alone with Payments Core." },
    { id: 2, order: 2, name: "Core — Risk & Screening",      note: "Risk and screening together — they read the same transaction stream." },
    { id: 3, order: 3, name: "Core — Treasury & Settlement", note: "Split out of the original Core proposal so settlement recon lands before the month-end close." },
    { id: 4, order: 4, name: "Core — Compliance & Channels", note: "Pulled ahead of the Q4 regulatory filing cycle. The reason the seed's single Core wave became three." },
    { id: 5, order: 5, name: "Secondary",                    note: "Real impact, tolerable lag. Nothing downstream is waiting." },
    { id: 6, order: 6, name: "Cleanup",                      note: "Internal and historical. Deliberately last." },
  ],

  /* --- Stored placement ----------------------------------------------------
     Nineteen decisions. Every asset inside an application inherits its wave,
     which is why this object is nineteen rows long and not 2,908.

     Several of these deliberately disagree with the seed — that disagreement
     is the point of the stage, and `departures()` below computes it rather
     than storing it, so it can never go stale. */
  placement: {
    "platform-shared": 1,
    "payments-core": 1,
    "fraud-risk": 2,
    "sanctions": 2,
    "card-services": 2,
    "treasury-ops": 3,
    "settlement": 3,
    "partner-api": 3,
    "compliance-rpt": 4,
    "retail-channels": 4,
    "agent-network": 4,
    "digital-wallet": 5,
    "fx-pricing": 5,
    "customer-identity": 5,
    "remittance": 5,
    "facilities-iot": 5,
    "corporate-it": 6,
    "hr-payroll": 6,
    "marketing": 6,
  },

  /* --- Why a placement left the seed ---------------------------------------
     Recorded only where a human had a reason the system could not infer. Keyed
     by application; `departures()` surfaces these next to the computed move. */
  placementBasis: {
    "card-services": { by: "Martin Hale", at: "2026-09-18T14:20:00Z", why: "Declared Medium, but it shares an on-call rota and a release train with Fraud & Risk. Shipping them apart would split one team across two waves." },
    "partner-api": { by: "Rosa Delgado", at: "2026-09-18T14:22:00Z", why: "Declared Medium, but two banking partners are contractually entitled to 30 days' notice before their reporting surface changes. Shipping it with Treasury starts that clock early enough." },
    "compliance-rpt": { by: "Martin Hale", at: "2026-09-18T14:26:00Z", why: "The Q4 regulatory filing cycle opens Nov 3. Compliance has to be live and validated before it, which the seed's single Core wave could not guarantee." },
    "retail-channels": { by: "Martin Hale", at: "2026-09-18T14:28:00Z", why: "Moved with Compliance Reporting — branch volumes are an input to the filing." },
    "agent-network": { by: "Martin Hale", at: "2026-09-18T14:29:00Z", why: "Depends on Retail Channels and the client asked for the agent SLAs to land in the same window." },
    "facilities-iot": { by: "Martin Hale", at: "2026-10-14T09:22:00Z", why: "The site team is mid-rollout across 11 buildings and asked not to be last. Pulled from Cleanup into Secondary." },
    "customer-identity": { by: "Martin Hale", at: "2026-10-14T09:15:00Z", why: "The KYC onboarding funnel is referenced by a Wave 1 executive dashboard. Kept in Secondary, but the twelve referenced assets are pulled forward at Wave Mapping rather than moving the whole application." },
  },

  /* --- Orphans: assets with no application --------------------------------
     47 of 2,955. These carry no app attribution at all — written against the
     shared index, authored in a personal namespace, or pointed at a source
     that no longer exists. The live product has no home for them, which is how
     an estate ends up with thousands of assets nobody placed.

     Grouped by why they are orphaned, because that is the unit a human can
     actually decide on. Bulk-assigning "scratch dashboards by departed
     authors" is one judgement; doing it six times is data entry.

        assigned      32  — placed into a wave by hand
        pending        9  — still need a decision; they block nothing yet
        out-of-scope   6  — will not be migrated

     The 32 assigned are counted in their wave's totals. The 15 that are not
     assigned are counted in neither, which is exactly the honest state the
     current product hides behind a silent reconciliation gap. */
  unmapped: [
    {
      id: "ORP-01", label: "Shared `main` index saved searches", count: 14, type: "Saved search",
      reason: "Written against the shared index with no app or owner tag.",
      evidence: "Matched to Platform Shared Services by index and schedule overlap, but no attribution exists in the source.",
      state: "assigned", wave: 1, by: "Rosa Delgado", at: "2026-09-19T10:05:00Z",
    },
    {
      id: "ORP-02", label: "Treasury ad-hoc exports", count: 5, type: "Saved search",
      reason: "Scheduled exports created outside the app namespace during the 2024 nostro migration.",
      evidence: "Three still feed a finance mailbox daily, so they are live despite the lack of an owner.",
      state: "assigned", wave: 3, by: "Claire Dubois", at: "2026-09-19T10:11:00Z",
    },
    {
      id: "ORP-03", label: "Branch rollup dashboards", count: 6, type: "Dashboard",
      reason: "Built in regional personal namespaces, later shared without being re-homed.",
      evidence: "Named in the filing pack, so they cannot be dropped.",
      state: "assigned", wave: 4, by: "Claire Dubois", at: "2026-09-19T10:14:00Z",
    },
    {
      id: "ORP-04", label: "Wallet beta panels", count: 4, type: "Dashboard",
      reason: "Created during the wallet beta under a feature-flag namespace that was never cleaned up.",
      evidence: "Still viewed weekly by the product team.",
      state: "assigned", wave: 5, by: "Arjun Mehta", at: "2026-09-19T10:20:00Z",
    },
    {
      id: "ORP-05", label: "Facilities sensor alerts", count: 3, type: "Alert",
      reason: "Authored by the building-management vendor directly in the shared namespace.",
      evidence: "Vendor contract ends in March; the client wants them carried over regardless.",
      state: "assigned", wave: 6, by: "Arjun Mehta", at: "2026-09-19T10:24:00Z",
    },
    {
      id: "ORP-06", label: "Unattributed alert rules", count: 5, type: "Alert",
      reason: "Fire into a distribution list that no longer resolves. No index or owner match.",
      evidence: "Fired 0 times in 90 days. Nobody has claimed them — the question is whether they are dormant or dead.",
      state: "pending",
    },
    {
      id: "ORP-07", label: "Legacy `rex` extractions", count: 4, type: "Saved search",
      reason: "Reference three indexes decommissioned before the migration started.",
      evidence: "Cannot be translated as written. If they are kept, they are a rebuild, not a migration.",
      state: "pending",
    },
    {
      id: "ORP-08", label: "Scratch dashboards by departed authors", count: 6, type: "Dashboard",
      reason: "Authored by three leavers in personal namespaces.",
      evidence: "Zero views in 180 days and no downstream reference.",
      state: "out-of-scope", by: "Martin Hale", at: "2026-09-20T16:40:00Z", why: "No views, no owner, no reference. Confirmed droppable with the client's platform lead.",
    },
  ],

  /* --- Phase vocabulary ----------------------------------------------------
     Used to describe the seed proposal, which is organised by priority tier.
     The committed waves carry their own human-written names instead. */
  phases: {
    foundation: { label: "Foundation", tone: "primary",  why: "Carries the application everything else depends on. Nothing can ship before it." },
    core:       { label: "Core",       tone: "critical", why: "The applications the business would notice first." },
    secondary:  { label: "Secondary",  tone: "info",     why: "Real impact, tolerable lag." },
    cleanup:    { label: "Cleanup",    tone: "neutral",  why: "Internal and historical. Nothing downstream is waiting." },
  },

  /* --- The calibration set ------------------------------------------------
     Unchanged by the re-design: a sample overlay, not a wave. Selected on a
     criterion no wave uses — maximum translation-pattern coverage rather than
     business priority — because a profile tuned on the highest-priority assets
     generalises to the rest only by luck. Every row keeps its home wave. */
  calibration: {
    target: 214,
    patternsCovered: 89,
    environment: "Non-prod only",
    rule: "A calibration asset never leaves its home wave. It is translated early to tune the profile, and deploys to production on its home wave's schedule.",
    uncovered: "Three SPL patterns appear in exactly one asset each. Calibrating on a single instance teaches the profile nothing generalisable, so they are routed to Exceptions instead.",
    sample: [
      { app: "payments-core",   assets: 32, pattern: "transaction / stats / eval chains — the highest-frequency shape in the estate" },
      { app: "fraud-risk",      assets: 26, pattern: "streamstats and eventstats windowing" },
      { app: "platform-shared", assets: 21, pattern: "the shared `main` index — the only source with four unrelated writers" },
      { app: "treasury-ops",    assets: 21, pattern: "map and subsearch nesting" },
      { app: "compliance-rpt",  assets: 20, pattern: "tstats summary acceleration over a 7-year window" },
      { app: "retail-channels", assets: 19, pattern: "geostats and regional rollups" },
      { app: "digital-wallet",  assets: 18, pattern: "mobile session transaction chains" },
      { app: "sanctions",       assets: 16, pattern: "lookup-heavy correlation against screening tables" },
      { app: "fx-pricing",      assets: 15, pattern: "time-series interpolation and timewrap" },
      { app: "agent-network",   assets: 14, pattern: "the estate's only append and join pattern" },
      { app: "corporate-it",    assets: 12, pattern: "legacy rex extractions — a Cleanup-wave app, in the sample because 131 assets share the pattern" },
    ],
  },

  /* --- Ownership -----------------------------------------------------------
     A separate entity from the wave, and now one-to-many: a wave can carry
     several people, because a 540-asset wave spanning three applications is
     rarely one person's job. One of them is accountable; the rest are
     contributing. The current product's per-person "groups" nested inside
     waves are still not reproduced — that conflation is what strands assets. */
  owners: [
    { id: "rosa",  name: "Rosa Delgado", role: "Lead consultant",   capacity: 1.0 },
    { id: "claire",  name: "Claire Dubois",    role: "Consultant",        capacity: 1.0 },
    { id: "arjun", name: "Arjun Mehta",   role: "Consultant",        capacity: 1.0 },
    { id: "viktor",  name: "Viktor Sorensen",   role: "Platform engineer", capacity: 0.5 },
    { id: "martin",  name: "Martin Hale",   role: "EPM",               capacity: 0.0, note: "Accountable, not allocated. Owns sign-off, not review hours." },
  ],

  /* `accountable` is one person; `contributors` is any number. Both are per
     wave, and neither defines wave membership. */
  assignment: [
    { wave: 1, accountable: "rosa",  contributors: ["viktor"],            note: "Foundation plus Payments Core. Viktor carries the shared-index work nobody else can." },
    { wave: 2, accountable: "rosa",  contributors: ["claire"],            note: "Kept with Wave 1's accountable owner: Fraud & Risk reads Payments Core's output." },
    { wave: 3, accountable: "claire",  contributors: ["arjun"],           note: "Treasury and settlement recon." },
    { wave: 4, accountable: "claire",  contributors: ["rosa", "arjun"], note: "Three applications against a filing date — the widest wave, staffed accordingly." },
    { wave: 5, accountable: "arjun", contributors: [],                    note: "Secondary applications, no downstream dependents." },
    { wave: 6, accountable: "arjun", contributors: ["viktor"],            note: "Cleanup. Viktor decommissions the legacy indexes as it lands." },
  ],
};

/* ---------------------------------------------------------------------------
   The seed.

   Proposes one wave per priority tier, in rank order, after promoting any
   application that something higher-priority depends on. It is deliberately
   the simplest honest proposal: priority is the only business input it has, so
   priority is the only thing it groups by. It does not pretend to know about
   filing dates, change-freeze windows or release trains — a human supplies
   those by editing the result.

   One rule before grouping: EFFECTIVE TIER. An application inherits the
   highest priority of anything that transitively depends on it. Platform
   Shared Services is declared Low, but Payments Core cannot ship without it,
   so it inherits Critical and lands in the first wave. Grouping on the
   declared tier alone would bury it last and make every wave above it
   unshippable.
   --------------------------------------------------------------------------- */
DMA.data.planning.effectiveTiers = function (tierOverrides) {
  const P = DMA.data.planning;
  const tiers = tierOverrides || {};
  const apps = P.applications.map((a) => ({ ...a, tier: tiers[a.id] || a.tier }));
  const byId = Object.fromEntries(apps.map((a) => [a.id, a]));
  const rankOf = (tierId) => (P.tiers.find((t) => t.id === tierId) || { rank: 3 }).rank;

  const dependents = Object.fromEntries(apps.map((a) => [a.id, new Set()]));
  apps.forEach((a) => a.dependsOn.forEach((d) => dependents[d] && dependents[d].add(a.id)));
  const transitive = (id, seen = new Set()) => {
    dependents[id].forEach((d) => {
      if (!seen.has(d)) { seen.add(d); transitive(d, seen); }
    });
    return seen;
  };

  apps.forEach((a) => {
    const down = [...transitive(a.id)];
    const inherited = down.reduce((best, id) => Math.min(best, rankOf(byId[id].tier)), 3);
    a.declaredRank = rankOf(a.tier);
    a.effectiveRank = Math.min(a.declaredRank, inherited);
    a.effectiveTier = (P.tiers.find((t) => t.rank === a.effectiveRank) || P.tiers[3]).id;
    a.pulledForwardBy = a.effectiveRank < a.declaredRank
      ? down.filter((id) => rankOf(byId[id].tier) === a.effectiveRank).map((id) => byId[id].name)
      : [];
    a.dependentCount = down.length;
  });

  return apps;
};

DMA.data.planning.seed = function (tierOverrides) {
  const P = DMA.data.planning;
  const apps = P.effectiveTiers(tierOverrides);

  const waves = P.tiers
    .map((t) => {
      const members = apps
        .filter((a) => a.effectiveRank === t.rank)
        .sort((x, y) => y.assets - x.assets);
      return members.length
        ? { tier: t.id, name: t.label, apps: members, assets: members.reduce((n, a) => n + a.assets, 0) }
        : null;
    })
    .filter(Boolean)
    .map((w, i) => ({ ...w, id: i + 1, order: i + 1 }));

  return { waves, totalAssets: waves.reduce((n, w) => n + w.assets, 0) };
};

/* ---------------------------------------------------------------------------
   The committed plan: stored placement, read back as waves.
   --------------------------------------------------------------------------- */
DMA.data.planning.committed = function (placementOverride, waveList, orphanOverride) {
  const P = DMA.data.planning;
  const place = placementOverride || P.placement;
  const list = waveList || P.waves;
  const byWave = {};
  list.forEach((w) => (byWave[w.id] = { ...w, apps: [], appAssets: 0, orphans: [], orphanAssets: 0 }));

  P.applications.forEach((a) => {
    const id = place[a.id];
    if (byWave[id]) { byWave[id].apps.push(a); byWave[id].appAssets += a.assets; }
  });
  P.orphanStates(orphanOverride).forEach((o) => {
    if (o.state === "assigned" && byWave[o.wave]) { byWave[o.wave].orphans.push(o); byWave[o.wave].orphanAssets += o.count; }
  });

  const waves = Object.values(byWave)
    .map((w) => ({ ...w, assets: w.appAssets + w.orphanAssets }))
    .sort((x, y) => x.order - y.order);

  return {
    waves,
    totalAssets: waves.reduce((n, w) => n + w.assets, 0),
    placedApps: Object.keys(P.placement).length,
  };
};

/* Orphan groups with any in-session decisions applied. An override is either a
   wave id (assign) or the string "out-of-scope". */
DMA.data.planning.orphanStates = function (override) {
  const edits = override || {};
  return DMA.data.planning.unmapped.map((o) => {
    const e = edits[o.id];
    if (e === undefined) return o;
    if (e === "out-of-scope") return { ...o, state: "out-of-scope", wave: undefined, by: "You", at: null };
    if (e === "pending") return { ...o, state: "pending", wave: undefined };
    return { ...o, state: "assigned", wave: e, by: "You", at: null };
  });
};

/* How the orphan queue splits. The three states are mutually exclusive and
   sum to 47, which is the only way the estate reconciles to 2,955. */
DMA.data.planning.orphanTally = function (override) {
  const u = DMA.data.planning.orphanStates(override);
  const sum = (state) => u.filter((o) => o.state === state).reduce((n, o) => n + o.count, 0);
  const assigned = sum("assigned");
  const pending = sum("pending");
  const outOfScope = sum("out-of-scope");
  return {
    assigned, pending, outOfScope,
    total: assigned + pending + outOfScope,
    groups: u.length,
    pendingGroups: u.filter((o) => o.state === "pending").length,
  };
};

/* How the seed's shape became the committed shape.

   The seed proposes one wave per tier; the EPM split two of those tiers across
   several waves to hit a filing date. That is a structural refinement, not a
   disagreement — every application stayed in tier order. Reporting it as
   sixteen "moves" would be an artifact of comparing a four-item list to a
   six-item list by position, and would drown the three changes that are real. */
DMA.data.planning.seedDelta = function (tierOverrides) {
  const P = DMA.data.planning;
  const seed = P.seed(tierOverrides);
  const apps = P.effectiveTiers(tierOverrides);
  const tierOf = Object.fromEntries(apps.map((a) => [a.id, a.effectiveTier]));

  const splits = seed.waves.map((sw) => {
    const landed = [];
    sw.apps.forEach((a) => {
      const w = P.waves.find((x) => x.id === P.placement[a.id]);
      if (w && !landed.some((l) => l.id === w.id)) landed.push(w);
    });
    landed.sort((x, y) => x.order - y.order);
    return { tier: sw.tier, seedName: sw.name, seedAssets: sw.assets, into: landed };
  });

  return {
    seedWaves: seed.waves.length,
    committedWaves: P.waves.length,
    splits,
    splitCount: splits.filter((s) => s.into.length > 1).length,
    tierOf,
  };
};

/* The departures that are real: an application sitting in a wave whose other
   members are a different priority tier. Every one of these is a human acting
   on something the system could not see — a shared release train, a site
   rollout — so every one of them should carry a recorded reason. */
DMA.data.planning.departures = function (tierOverrides) {
  const P = DMA.data.planning;
  const apps = P.effectiveTiers(tierOverrides);
  const byId = Object.fromEntries(apps.map((a) => [a.id, a]));
  const com = P.committed();

  const out = [];
  com.waves.forEach((w) => {
    const members = w.apps.map((a) => byId[a.id]).filter(Boolean);
    if (members.length < 2) return;
    const waveRank = Math.min(...members.map((m) => m.effectiveRank));
    const waveTier = (P.tiers.find((t) => t.rank === waveRank) || P.tiers[3]).id;
    members.forEach((m) => {
      if (m.effectiveRank === waveRank) return;
      out.push({
        app: m,
        wave: w.order,
        waveName: w.name,
        appTier: m.effectiveTier,
        waveTier,
        direction: m.effectiveRank > waveRank ? "earlier" : "later",
        basis: P.placementBasis[m.id] || null,
      });
    });
  });
  return out.sort((x, y) => x.wave - y.wave);
};

/* Dependency violations. A dependency may ship with or before its dependent,
   never after. The seed cannot produce one; a human edit can, which is exactly
   why this check moved from "unreachable by construction" to "run on every
   change and shown live". */
DMA.data.planning.violations = function (placement, waveList) {
  const P = DMA.data.planning;
  const where = placement || P.placement;
  const list = waveList || P.waves;
  const orderOf = (waveId) => (list.find((w) => w.id === waveId) || { order: 0 }).order;
  const out = [];
  P.applications.forEach((a) => {
    const appOrder = orderOf(where[a.id]);
    a.dependsOn.forEach((d) => {
      if (where[d] === undefined) return;
      const depOrder = orderOf(where[d]);
      if (depOrder > appOrder) {
        out.push({
          app: a.name, appId: a.id, dep: P.appById(d).name, depId: d,
          appWave: appOrder, depWave: depOrder,
        });
      }
    });
  });
  return out;
};

DMA.data.planning.appById = function (id) {
  return DMA.data.planning.applications.find((a) => a.id === id) || null;
};

DMA.data.planning.ownerById = function (id) {
  return DMA.data.planning.owners.find((o) => o.id === id) || null;
};
