/* -------------------------------------------- */
/*  Compatibility / Metadata Coverage           */
/* -------------------------------------------- */

// Formal sidecar layer. Spotlight limits reuse the existing verified UUID
// registry; feature overrides intentionally ship empty in v0.23 rather than
// inventing metadata for content we have not validated.
const COMPATIBILITY_SIDECAR = Object.freeze({
  spotlightLimits: SPOTLIGHT_LIMIT_COMPATIBILITY.actorSpotlightLimits,
  features: Object.freeze({})
});

const COMPATIBILITY_BUCKETS = Object.freeze([
  "explicit", "native", "sidecar", "ambiguous", "unknown"
]);

function getStableActorCompatibilityKey(actor) {
  if (!actor) return null;

  const sourceKeys = getActorSpotlightLimitSourceKeys(actor);
  if (sourceKeys.length) return sourceKeys[0];

  return String(actor.uuid ?? actor.id ?? "").trim() || null;
}

function getStableFeatureCompatibilityKey(actor, entry) {
  if (!entry) return null;

  const actorKey = getStableActorCompatibilityKey(actor);
  if (actorKey && entry.id) return `${actorKey}.Item.${String(entry.id)}`;
  return null;
}

function getCompatibilityNativeActionTypes(entry) {
  return [...new Set(
    (entry?.nativeActions ?? [])
      .map(action => String(
        action?.type === "attack" ? "attack" : action?.actionType ?? ""
      ).trim().toLowerCase())
      .filter(Boolean)
  )];
}

function getExplicitFeatureCompatibility(entry) {
  if (!entry?.explicit || !entry?.metadata) return null;

  const hasFear = Object.prototype.hasOwnProperty.call(
    entry.metadata, "fearCost"
  );
  const rawFear = hasFear ? Number(entry.metadata.fearCost) : null;

  return {
    actionType: entry.metadata.actionType
      ? String(entry.metadata.actionType).trim().toLowerCase()
      : null,
    usesSpotlight:
      typeof entry.metadata.usesSpotlight === "boolean"
        ? entry.metadata.usesSpotlight
        : null,
    fearCost: hasFear && Number.isFinite(rawFear)
      ? Math.max(0, rawFear)
      : null
  };
}

function getNativeFeatureCompatibility(entry) {
  const nativeActions = entry?.nativeActions ?? [];
  const actionTypes = getCompatibilityNativeActionTypes(entry);

  if (!nativeActions.length) {
    return {
      actionTypes: [],
      actionType: null,
      actionTypeAmbiguous: false,
      fearCost: null,
      fearAmbiguous: false,
      fearReason: null
    };
  }

  const nativeCosts = collectNativeCosts(nativeActions);
  const fear = resolveSingleStructuredCost({ costs: nativeCosts }, "fear");

  return {
    actionTypes,
    actionType: actionTypes.length === 1 ? actionTypes[0] : null,
    actionTypeAmbiguous: actionTypes.length > 1,
    fearCost: fear.ambiguous ? null : Math.max(0, Number(fear.value) || 0),
    fearAmbiguous: Boolean(fear.ambiguous),
    fearReason: fear.reason ?? null
  };
}

function getSidecarFeatureCompatibility(actor, entry) {
  const key = getStableFeatureCompatibilityKey(actor, entry);
  if (!key) return null;
  const value = COMPATIBILITY_SIDECAR.features[key];
  return value && typeof value === "object"
    ? foundry.utils.deepClone(value)
    : null;
}

function applyFeatureSidecarCompatibility(actor, entry) {
  if (!entry || entry.standardAttack || entry.explicit) return entry;

  const native = getNativeFeatureCompatibility(entry);
  if (
    native.actionType
    || native.actionTypeAmbiguous
    || native.fearAmbiguous
  ) {
    return entry;
  }

  const sidecar = getSidecarFeatureCompatibility(actor, entry);
  if (!sidecar) return entry;

  const clone = {
    ...entry,
    compatibilitySource: "sidecar",
    metadata: foundry.utils.deepClone(sidecar)
  };

  if (sidecar.actionType) {
    clone.kind = {
      label: capitalize(String(sidecar.actionType)),
      source: "sidecar"
    };
  }

  clone.costs = applyExplicitMetadataToCosts(
    entry.costs ?? [],
    sidecar
  );

  return clone;
}

function classifyFeatureCompatibility(actor, entry) {
  if (!entry) return {
    bucket: "unknown", source: "UNKNOWN", issue: "feature-unavailable",
    reason: "Feature entry unavailable."
  };

  if (entry.standardAttack) return {
    bucket: "native", source: "NATIVE", issue: null,
    reason: "Standard adversary attack uses structured Daggerheart attack data."
  };

  const explicit = getExplicitFeatureCompatibility(entry);
  const native = getNativeFeatureCompatibility(entry);
  const sidecar = getSidecarFeatureCompatibility(actor, entry);

  // Explicit metadata is highest authority for resolution, but a contradiction
  // with structured native data is unsafe enough to surface as AMBIGUOUS.
  if (explicit) {
    if (explicit.actionType && native.actionType &&
        explicit.actionType !== native.actionType) {
      return {
        bucket: "ambiguous", source: "AMBIGUOUS",
        issue: "action-type-conflict",
        reason: `Explicit actionType '${explicit.actionType}' conflicts with native '${native.actionType}'.`,
        explicit, native, sidecar
      };
    }

    if (explicit.fearCost !== null && native.fearCost !== null &&
        explicit.fearCost !== native.fearCost) {
      return {
        bucket: "ambiguous", source: "AMBIGUOUS",
        issue: "fear-cost-conflict",
        reason: `Explicit Fear ${explicit.fearCost} conflicts with native Fear ${native.fearCost}.`,
        explicit, native, sidecar
      };
    }

    return {
      bucket: "explicit", source: "EXPLICIT", issue: null,
      reason: "Resolved from flags.cybermancy.gmAction.",
      explicit, native, sidecar
    };
  }

  if (native.actionTypeAmbiguous || native.fearAmbiguous) {
    return {
      bucket: "ambiguous", source: "AMBIGUOUS",
      issue: native.actionTypeAmbiguous
        ? "multiple-native-action-types"
        : "ambiguous-native-fear",
      reason: native.actionTypeAmbiguous
        ? "Multiple native Actions expose different action types."
        : native.fearReason ?? "Native Fear metadata is ambiguous.",
      explicit, native, sidecar
    };
  }

  if (native.actionType) {
    return {
      bucket: "native", source: "NATIVE", issue: null,
      reason: "Resolved from structured Daggerheart native Action data.",
      explicit, native, sidecar
    };
  }

  if (sidecar) {
    return {
      bucket: "sidecar", source: "SIDECAR", issue: null,
      reason: "Resolved from QOL compatibility sidecar metadata.",
      explicit, native, sidecar
    };
  }

  return {
    bucket: "unknown", source: "UNKNOWN",
    issue: "insufficient-structured-metadata",
    reason: "No explicit Cybermancy metadata, reliable native Action classification, or sidecar entry is available.",
    explicit, native, sidecar
  };
}

function getSpotlightLimitCompatibility(actor) {
  if (!actor) return {
    limit: 1, source: "DEFAULT", sourceKey: null,
    reason: "Actor unavailable; using advisory base rule."
  };

  const explicit = getExplicitActorSpotlightLimit(actor);
  if (explicit.present) {
    const limit = normalizeSpotlightLimit(explicit.raw);
    if (limit !== null) return {
      limit, source: "CYBERMANCY", sourceKey: null, reason: null
    };

    return {
      limit: 1, source: "DEFAULT", sourceKey: null,
      reason: `Invalid flags.cybermancy.spotlightLimit value: ${String(explicit.raw)}`
    };
  }

  const nativeCandidates = [
    foundry.utils.getProperty(actor, "system.spotlightLimit"),
    foundry.utils.getProperty(actor, "system.resources.spotlightLimit.value")
  ];
  for (const raw of nativeCandidates) {
    const limit = normalizeSpotlightLimit(raw);
    if (limit !== null) return {
      limit, source: "NATIVE", sourceKey: null, reason: null
    };
  }

  for (const sourceKey of getActorSpotlightLimitSourceKeys(actor)) {
    const raw = COMPATIBILITY_SIDECAR.spotlightLimits[sourceKey];
    const limit = normalizeSpotlightLimit(raw);
    if (limit !== null) return {
      limit, source: "SIDECAR", sourceKey, reason: null
    };
  }

  return {
    limit: 1, source: "DEFAULT", sourceKey: null, reason: null
  };
}

function getFeatureCompatibilityDisplay(actor, entry) {
  const result = classifyFeatureCompatibility(actor, entry);
  const details = [];

  if (result.explicit?.actionType)
    details.push(`explicit actionType=${result.explicit.actionType}`);
  if (result.native?.actionType)
    details.push(`native actionType=${result.native.actionType}`);
  if (result.explicit?.fearCost !== null && result.explicit?.fearCost !== undefined)
    details.push(`explicit Fear=${result.explicit.fearCost}`);
  if (result.native?.fearCost !== null && result.native?.fearCost !== undefined)
    details.push(`native Fear=${result.native.fearCost}`);

  return { ...result, detailText: details.join(" · ") };
}

function getCompatibilityReport(scene = canvas?.scene) {
  const empty = {
    sceneId: scene?.id ?? null,
    sceneName: scene?.name ?? null,
    adversaries: 0,
    adversaryGroups: 0,
    environments: 0,
    features: { explicit: 0, native: 0, sidecar: 0, ambiguous: 0, unknown: 0 },
    spotlightLimits: { explicit: 0, native: 0, sidecar: 0, default: 0 },
    issues: []
  };
  if (!scene) return empty;

  const report = foundry.utils.deepClone(empty);
  const groups = getSceneGroups();
  report.adversaryGroups = groups.length;
  report.adversaries = groups.reduce(
    (sum, group) => sum + (group?.tokens?.length ?? 0), 0
  );

  for (const group of groups) {
    const actor = group.actor ?? group?.tokens?.[0]?.actor ?? null;
    if (!actor) continue;

    for (const entry of buildGmActionEntries(actor)) {
      const result = classifyFeatureCompatibility(actor, entry);
      const bucket = COMPATIBILITY_BUCKETS.includes(result.bucket)
        ? result.bucket : "unknown";
      report.features[bucket] += 1;
      if (["ambiguous", "unknown"].includes(bucket)) {
        report.issues.push({
          actor: actor.name ?? "Adversary",
          actorUuid: actor.uuid ?? null,
          feature: entry.name ?? "Feature",
          featureId: entry.id ?? null,
          bucket, issue: result.issue, reason: result.reason
        });
      }
    }

    const limit = getSpotlightLimitCompatibility(actor);
    const key = limit.source === "CYBERMANCY" ? "explicit"
      : limit.source === "NATIVE" ? "native"
        : limit.source === "SIDECAR" ? "sidecar" : "default";
    report.spotlightLimits[key] += 1;
  }

  const discovery = getSceneEnvironments(scene);
  const environments = (discovery.effective ?? [])
    .filter(record => record?.resolved && record?.actor);
  report.environments = environments.length;

  for (const record of environments) {
    const actor = record.actor;
    for (const entry of buildGmActionEntries(actor).filter(e => !e.standardAttack)) {
      const result = classifyFeatureCompatibility(actor, entry);
      const bucket = COMPATIBILITY_BUCKETS.includes(result.bucket)
        ? result.bucket : "unknown";
      report.features[bucket] += 1;
      if (["ambiguous", "unknown"].includes(bucket)) {
        report.issues.push({
          actor: actor.name ?? "Environment",
          actorUuid: actor.uuid ?? null,
          feature: entry.name ?? "Feature",
          featureId: entry.id ?? null,
          bucket, issue: result.issue, reason: result.reason
        });
      }
    }
  }

  return foundry.utils.deepClone(report);
}

// v1.0 compatibility alias for RC-era macros/API consumers.
function getReleaseCandidateDiagnostic(scene = canvas?.scene) {
  return getRuntimeDiagnostic(scene);
}

function toggleInspectorDiagnostics() {
  inspectorDiagnosticsVisible = !inspectorDiagnosticsVisible;
  refreshInspector();
  return inspectorDiagnosticsVisible;
}

function renderCompatibilityDiagnosticForEntry(actor, entry) {
  if (!inspectorDiagnosticsVisible) return "";
  const result = getFeatureCompatibilityDisplay(actor, entry);
  const key = getStableFeatureCompatibilityKey(actor, entry);

  return `
    <div class="cmgi-compatibility-diagnostic">
      <strong>${escapeHtml(result.source)}</strong>
      ${result.reason ? `<span>${escapeHtml(result.reason)}</span>` : ""}
      ${result.detailText ? `<span>${escapeHtml(result.detailText)}</span>` : ""}
      ${key ? `<code>${escapeHtml(key)}</code>` : ""}
    </div>`;
}

function getRuntimeDiagnostic(scene = canvas?.scene) {
  const architecture = getArchitectureDiagnostic();
  const compatibility = getCompatibilityReport(scene);
  const fear = getFearState();
  const spotlight = getSpotlightState();
  const persisted = getPersistedCombatStateDiagnostic(scene);
  const pcEntries = getScenePcEntries();
  const adversaryGroups = getSceneGroups();
  const adversaryTokens = adversaryGroups.flatMap(group => group?.tokens ?? []);
  const environmentDiscovery = scene ? getSceneEnvironments(scene) : { effective: [] };
  const environments = (environmentDiscovery?.effective ?? [])
    .filter(record => record?.resolved && record?.actor);

  const safeRead = (reader, token) => {
    try { return reader(token); }
    catch (error) { return { available: false, error: error?.message ?? String(error) }; }
  };

  const pcStates = pcEntries.map(entry => safeRead(getPcCombatState, entry.token));
  const adversaryStates = adversaryTokens.map(token => safeRead(getAdversaryCombatState, token));
  const combatStates = [...pcStates, ...adversaryStates];

  const resourceStatus = key => {
    if (!combatStates.length) return "NOT EXERCISED";
    return combatStates.every(state => Boolean(state?.[key]?.available)) ? "NATIVE" : "UNKNOWN";
  };

  const configuredConditions = new Set(
    (CONFIG?.statusEffects ?? [])
      .map(effect => String(effect?.id ?? effect?._id ?? "").toLowerCase())
      .filter(Boolean)
  );

  const conditionsStatus = ["vulnerable", "restrained", "hidden"]
    .every(id => configuredConditions.has(id)) ? "NATIVE" : "UNKNOWN";

  const armorStatus = !pcStates.length
    ? "NOT EXERCISED"
    : pcStates.some(state => state?.armor?.available)
      ? "NATIVE"
      : "NATIVE / NONE PRESENT";

  const compatibilityReview = compatibility.features.ambiguous + compatibility.features.unknown;
  const integrity = spotlight.spotlightIntegrity ?? getSpotlightIntegrity();
  const issues = [];

  if (persisted?.parsed?.error) issues.push(`Scene combat-state snapshot: ${persisted.parsed.error}`);
  if (!integrity?.valid) issues.push("Spotlight bookkeeping integrity check failed.");
  for (const issue of compatibility.issues ?? []) {
    issues.push(`${issue.actor} — ${issue.feature}: ${issue.reason ?? issue.issue ?? issue.bucket}`);
  }
  for (const state of combatStates) {
    if (state?.error) issues.push(`Native combat-state read: ${state.error}`);
  }

  return {
    module: { id: MODULE_ID, title: "Cybermancy GM QOL", version: VERSION, combatStateSchema: COMBAT_STATE_SCHEMA_VERSION },
    runtime: {
      foundry: String(game?.version ?? game?.release?.version ?? "unknown"),
      daggerheart: String(game?.system?.version ?? game?.system?.data?.version ?? "unknown")
    },
    scene: {
      id: scene?.id ?? null,
      name: scene?.name ?? null,
      state: persisted?.parsed?.error ? "ERROR" : spotlight.loaded ? "LOADED" : "NOT LOADED",
      revision: spotlight.revision,
      pcs: pcEntries.length,
      adversaryTokens: adversaryTokens.length,
      adversaryGroups: adversaryGroups.length,
      environments: environments.length
    },
    nativeInterfaces: {
      fear: fear.available ? "NATIVE" : "UNKNOWN",
      hp: resourceStatus("hp"),
      stress: resourceStatus("stress"),
      armorSlots: armorStatus,
      evasion: !pcStates.length
        ? "NOT EXERCISED"
        : pcStates.every(state => state?.evasion?.available)
          ? "NATIVE"
          : "UNKNOWN",
      conditions: conditionsStatus,
      embeddedActions: compatibilityReview > 0 ? "REVIEW" : "NATIVE / SAFE",
      opportunityHook: architecture.opportunityRuntime === "daggerheart.postRollDuality" ? "NATIVE" : "UNKNOWN"
    },
    compatibility: foundry.utils.deepClone(compatibility),
    integrity: foundry.utils.deepClone(integrity),
    issues
  };
}

function renderRuntimeDiagnostics() {
  if (!inspectorDiagnosticsVisible) return "";

  const diagnostic = getRuntimeDiagnostic();
  const compatibility = diagnostic.compatibility;
  const labels = {
    fear: "Fear", hp: "HP", stress: "Stress", armorSlots: "Armor Slots",
    evasion: "Evasion", conditions: "Conditions",
    embeddedActions: "Embedded Actions", opportunityHook: "Opportunity Hook"
  };

  const interfaces = Object.entries(diagnostic.nativeInterfaces)
    .map(([key, value]) => `
      <div class="cmgi-runtime-diagnostic-row">
        <span>${escapeHtml(labels[key] ?? key)}</span>
        <strong>${escapeHtml(value)}</strong>
      </div>`).join("");

  return `
    <section class="cmgi-runtime-diagnostics">
      <div class="cmgi-section-title">QOL DIAGNOSTICS</div>
      <div class="cmgi-runtime-diagnostic-grid">
        <span>Module</span><strong>${escapeHtml(diagnostic.module.version)}</strong>
        <span>Foundry</span><strong>${escapeHtml(diagnostic.runtime.foundry)}</strong>
        <span>Daggerheart</span><strong>${escapeHtml(diagnostic.runtime.daggerheart)}</strong>
        <span>Combat Schema</span><strong>${escapeHtml(diagnostic.module.combatStateSchema)}</strong>
        <span>Scene State</span><strong>${escapeHtml(diagnostic.scene.state)} · rev ${escapeHtml(diagnostic.scene.revision)}</strong>
        <span>Scene</span><strong>${escapeHtml(diagnostic.scene.name ?? "none")}</strong>
        <span>Actors</span><strong>${escapeHtml(`${diagnostic.scene.pcs} PCs · ${diagnostic.scene.adversaryTokens} adversaries · ${diagnostic.scene.environments} environments`)}</strong>
      </div>
      <div class="cmgi-runtime-diagnostic-subtitle">NATIVE INTERFACES</div>
      <div class="cmgi-runtime-interface-grid">${interfaces}</div>
      <div class="cmgi-runtime-diagnostic-subtitle">COMPATIBILITY REPORT</div>
      <div class="cmgi-compatibility-counts">
        <span>EXPLICIT ${compatibility.features.explicit}</span>
        <span>NATIVE ${compatibility.features.native}</span>
        <span>SIDECAR ${compatibility.features.sidecar}</span>
        <span>AMBIGUOUS ${compatibility.features.ambiguous}</span>
        <span>UNKNOWN ${compatibility.features.unknown}</span>
      </div>
      <div class="cmgi-compatibility-counts">
        <span>LIMITS: CYBERMANCY ${compatibility.spotlightLimits.explicit}</span>
        <span>NATIVE ${compatibility.spotlightLimits.native}</span>
        <span>SIDECAR ${compatibility.spotlightLimits.sidecar}</span>
        <span>DEFAULT ${compatibility.spotlightLimits.default}</span>
      </div>
      <div class="cmgi-runtime-diagnostic-subtitle">INTEGRITY</div>
      <div class="cmgi-runtime-integrity${diagnostic.integrity?.valid ? " cmgi-runtime-ok" : " cmgi-runtime-review"}">
        Spotlight bookkeeping: <strong>${diagnostic.integrity?.valid ? "PASS" : "REVIEW"}</strong>
      </div>
      ${diagnostic.issues.length
        ? `<details class="cmgi-runtime-issues"><summary>${diagnostic.issues.length} item(s) need review</summary><ul>${diagnostic.issues.map(issue => `<li>${escapeHtml(issue)}</li>`).join("")}</ul></details>`
        : `<div class="cmgi-muted">No runtime compatibility or integrity issues detected on this Scene.</div>`}
    </section>`;
}
