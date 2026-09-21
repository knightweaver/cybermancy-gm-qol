/* -------------------------------------------- */
/*  GM Action Palette — READ ONLY               */
/* -------------------------------------------- */

function getNativeActions(item) {
  const actions = item?.system?.actions;
  if (!actions || typeof actions !== "object") return [];

  if (Array.isArray(actions)) {
    return actions.filter(Boolean);
  }

  if (typeof actions.values === "function") {
    try {
      return [...actions.values()].filter(Boolean);
    } catch (error) {
      console.warn(
        "Cybermancy GM QOL | Could not iterate structured Action collection",
        error
      );
    }
  }

  if (Symbol.iterator in Object(actions)) {
    try {
      return [...actions].map(entry => Array.isArray(entry) ? entry[1] : entry).filter(Boolean);
    } catch (_) {
      // Fall through to plain-object support.
    }
  }

  return Object.values(actions).filter(Boolean);
}

function getFastPlayFeatureRefs(actor) {
  const fastPlay = getFastPlay(actor);
  const refs = new Set();

  for (const prompt of fastPlay?.prompts ?? []) {
    for (const ref of prompt?.featureRefs ?? []) {
      if (ref) refs.add(String(ref));
    }
  }

  return refs;
}

function normalizeCost(cost) {
  if (!cost || !cost.key) return null;

  const value = Number(cost.value);
  return {
    key: String(cost.key),
    value: Number.isFinite(value) ? value : cost.value,
    scalable: Boolean(cost.scalable)
  };
}

function collectNativeCosts(actions) {
  const result = [];

  for (const action of actions) {
    for (const rawCost of action?.cost ?? []) {
      const cost = normalizeCost(rawCost);
      if (!cost) continue;

      const signature = `${cost.key}:${String(cost.value)}:${cost.scalable}`;
      if (!result.some(existing => existing.signature === signature)) {
        result.push({ ...cost, signature });
      }
    }
  }

  return result;
}

function applyExplicitMetadataToCosts(nativeCosts, meta) {
  if (!meta) return nativeCosts;

  let costs = nativeCosts.map(cost => ({ ...cost }));

  for (const [metaKey, costKey] of [
    ["fearCost", "fear"],
    ["stressCost", "stress"]
  ]) {
    if (!Object.prototype.hasOwnProperty.call(meta, metaKey)) continue;

    costs = costs.filter(cost => cost.key !== costKey);

    const value = Number(meta[metaKey]);
    if (Number.isFinite(value) && value > 0) {
      costs.push({
        key: costKey,
        value,
        scalable: false,
        signature: `${costKey}:${value}:false`,
        explicit: true
      });
    }
  }

  return costs;
}

function deriveFeatureKind(item, actions, meta) {
  if (meta?.actionType) {
    return {
      label: capitalize(meta.actionType),
      source: "explicit"
    };
  }

  if (actions.some(action => String(action?.type).toLowerCase() === "attack")) {
    return { label: "Attack", source: "native" };
  }

  const actionTypes = [
    ...new Set(
      actions
        .map(action => String(action?.actionType ?? "").toLowerCase())
        .filter(Boolean)
    )
  ];

  if (actionTypes.length === 1) {
    return {
      label: capitalize(actionTypes[0]),
      source: "native"
    };
  }

  if (actionTypes.length > 1) {
    return {
      label: actionTypes.map(capitalize).join(" / "),
      source: "native"
    };
  }

  return {
    label: "Feature",
    source: "unclassified"
  };
}

function getActionRanges(actions) {
  return [
    ...new Set(
      actions
        .map(action => String(action?.range ?? "").trim())
        .filter(Boolean)
    )
  ];
}

function formatCost(cost, fear) {
  const key = String(cost.key ?? "").toLowerCase();
  const value = cost.value;

  if (key === "fear") {
    const availability = fear.available && Number.isFinite(Number(value))
      ? (fear.current >= Number(value) ? "available" : "insufficient")
      : "unknown";

    return {
      text: `Fear ${value}`,
      className: `cmgi-cost-fear cmgi-fear-${availability}`,
      title: fear.available
        ? `Native Fear pool is ${fear.current}/${fear.max}. This indicates resource availability only; it does not determine whether the feature is legally usable.`
        : "Fear availability is unknown. This does not determine whether the feature is legally usable."
    };
  }

  if (key === "stress") {
    return {
      text: `Stress ${value}`,
      className: "cmgi-cost-stress",
      title: "Structured feature cost from the Actor/Item. Read only."
    };
  }

  return {
    text: `${capitalize(key)} ${value}`,
    className: "cmgi-cost-other",
    title: "Structured feature cost from the Actor/Item. Read only."
  };
}

function getDamageFormula(damage) {
  const parts = damage?.parts ?? [];
  const formulas = [];

  for (const part of parts) {
    const value = part?.value ?? {};
    let formula = "";

    if (value?.custom?.enabled && value?.custom?.formula) {
      formula = String(value.custom.formula);
    } else {
      const dice = value?.dice ? String(value.dice) : "";
      const bonus = Number(value?.bonus ?? 0);

      if (dice) {
        formula = dice;
        if (bonus > 0) formula += `+${bonus}`;
        else if (bonus < 0) formula += String(bonus);
      } else if (Number.isFinite(bonus) && bonus !== 0) {
        formula = String(bonus);
      }
    }

    const types = Array.isArray(part?.type) ? part.type.filter(Boolean) : [];
    if (formula) {
      formulas.push(
        types.length ? `${formula} ${types.join("/")}` : formula
      );
    }
  }

  return formulas.join(", ");
}

function buildStandardAttack(actor) {
  const attack = actor?.system?.attack;
  if (!attack || !attack.name) return null;

  const bonus = attack?.roll?.bonus;
  const range = String(attack?.range ?? "").trim();
  const damage = getDamageFormula(attack?.damage);

  const detailBits = [];
  if (Number.isFinite(Number(bonus))) {
    const numericBonus = Number(bonus);
    detailBits.push(`Attack ${numericBonus >= 0 ? "+" : ""}${numericBonus}`);
  }
  if (range) detailBits.push(capitalize(range));
  if (damage) detailBits.push(damage);

  const description = String(attack?.description ?? "").trim();

  return {
    id: "standard-attack",
    name: attack.name,
    kind: { label: "Attack", source: "native" },
    ranges: range ? [range] : [],
    costs: collectNativeCosts([attack]),
    description,
    detailsHtml: detailBits.length
      ? `<p><strong>Standard attack:</strong> ${escapeHtml(detailBits.join(" · "))}</p>`
      : `<p>Standard adversary attack.</p>`,
    explicit: false,
    fastPlayReferenced: false,
    standardAttack: true,
    nativeActions: [attack]
  };
}

function buildFeatureEntry(item, fastPlayRefs) {
  const actions = getNativeActions(item);
  const meta = getGmActionMetadata(item);
  const nativeCosts = collectNativeCosts(actions);
  const costs = applyExplicitMetadataToCosts(nativeCosts, meta);
  const kind = deriveFeatureKind(item, actions, meta);
  const ranges = getActionRanges(actions);

  return {
    id: item.id,
    name: item.name,
    kind,
    ranges,
    costs,
    description: String(item?.system?.description ?? ""),
    detailsHtml: "",
    explicit: Boolean(meta),
    metadata: meta,
    fastPlayReferenced: fastPlayRefs.has(String(item.name)),
    standardAttack: false,
    nativeActions: actions
  };
}

function buildGmActionEntries(actor) {
  const fastPlayRefs = getFastPlayFeatureRefs(actor);
  const entries = [];

  const standard = buildStandardAttack(actor);
  if (standard) entries.push(standard);

  const features = [...(actor?.items ?? [])]
    .filter(item => item?.type === "feature")
    .map(item => buildFeatureEntry(item, fastPlayRefs));

  // Keep Item order, but put Fast Play-referenced features before other
  // embedded features. Standard attack remains first.
  const referenced = features.filter(entry => entry.fastPlayReferenced);
  const other = features.filter(entry => !entry.fastPlayReferenced);

  return [...entries, ...referenced, ...other]
    .map(entry => applyFeatureSidecarCompatibility(actor, entry));
}


function normalizedActionCostSignature(action) {
  const actionType = String(action?.actionType ?? action?.type ?? "").toLowerCase();
  const costs = (action?.cost ?? [])
    .map(normalizeCost)
    .filter(Boolean)
    .map(cost => ({
      key: String(cost.key).toLowerCase(),
      value: Number.isFinite(Number(cost.value)) ? Number(cost.value) : String(cost.value),
      scalable: Boolean(cost.scalable)
    }))
    .sort((a, b) =>
      `${a.key}:${String(a.value)}:${a.scalable}`.localeCompare(
        `${b.key}:${String(b.value)}:${b.scalable}`
      )
    );

  return JSON.stringify({ actionType, costs });
}

function hasAmbiguousNativeActions(entry) {
  const actions = Array.isArray(entry?.nativeActions) ? entry.nativeActions : [];
  if (actions.length <= 1) return false;

  const signatures = new Set(actions.map(normalizedActionCostSignature));
  return signatures.size > 1;
}

function resolveSingleStructuredCost(entry, key) {
  const matching = (entry?.costs ?? []).filter(
    cost => String(cost?.key ?? "").toLowerCase() === key
  );

  if (!matching.length) {
    return { value: 0, ambiguous: false, reason: null };
  }

  if (matching.length !== 1) {
    return {
      value: null,
      ambiguous: true,
      reason: `Multiple structured ${capitalize(key)} costs are present.`
    };
  }

  const cost = matching[0];
  const numeric = Number(cost.value);

  if (!Number.isFinite(numeric) || numeric < 0 || cost.scalable) {
    return {
      value: null,
      ambiguous: true,
      reason: `The structured ${capitalize(key)} cost is scalable or non-numeric.`
    };
  }

  return {
    value: numeric,
    ambiguous: false,
    reason: null
  };
}

function getManualStructuredCosts(entry) {
  const manual = [];

  const stress = resolveSingleStructuredCost(entry, "stress");
  if (stress.ambiguous) {
    manual.push("Structured Stress cost — MANUAL");
  } else if (stress.value > 0) {
    manual.push(`Mark ${stress.value} Stress — MANUAL`);
  }

  for (const cost of entry?.costs ?? []) {
    const key = String(cost?.key ?? "").toLowerCase();
    if (key === "fear" || key === "stress") continue;

    if (cost.scalable || !Number.isFinite(Number(cost.value))) {
      manual.push(`${capitalize(key)} cost — MANUAL`);
    } else if (Number(cost.value) > 0) {
      manual.push(`${capitalize(key)} ${Number(cost.value)} — MANUAL`);
    }
  }

  return [...new Set(manual)];
}

function resolveActionTransactionCapability(entry) {
  if (!entry) {
    return { eligible: false, reason: "Action data unavailable." };
  }

  const kind = String(entry.kind?.label ?? "").toLowerCase();

  if (!["attack", "action"].includes(kind)) {
    return {
      eligible: false,
      reason: "Only confidently classified Attacks and Actions are transaction-capable in v0.11."
    };
  }

  if (
    (entry.explicit || entry.compatibilitySource === "sidecar")
    && entry.metadata?.usesSpotlight === false
  ) {
    return {
      eligible: false,
      reason: "Explicit gmAction metadata says this feature does not use an adversary Spotlight."
    };
  }

  if (hasAmbiguousNativeActions(entry)) {
    return {
      eligible: false,
      reason: "This feature contains multiple structured actions with different types or costs."
    };
  }

  const fear = resolveSingleStructuredCost(entry, "fear");
  if (fear.ambiguous) {
    return {
      eligible: false,
      reason: fear.reason
    };
  }

  return {
    eligible: true,
    reason: null,
    featureFearCost: fear.value,
    spotlightDelta: 1,
    manualCosts: getManualStructuredCosts(entry)
  };
}

function getSelectedTokenForGroup(group) {
  const selected = getSelectedToken();
  if (!selected) return null;

  return (group?.tokens ?? []).some(token => token.id === selected.id)
    ? selected
    : null;
}

function findLiveActionEntry(actor, entryId) {
  return buildGmActionEntries(actor).find(entry => String(entry.id) === String(entryId)) ?? null;
}

function buildActionTransactionPlan(tokenId, entryId) {
  if (!canvas?.ready || !canvas.scene) {
    return { valid: false, reason: "No ready Canvas Scene." };
  }

  if (spotlightOwner !== "GM") {
    return { valid: false, reason: "Take GM Spotlight before using a GM Action transaction." };
  }

  const token = canvas.tokens?.get(tokenId)
    ?? (canvas.tokens?.placeables ?? []).find(candidate => candidate.id === tokenId)
    ?? null;

  if (!token?.actor || !isAdversaryActor(token.actor)) {
    return { valid: false, reason: "The intended adversary token is no longer available." };
  }

  if (isAdversaryDefeated(token)) {
    return {
      valid: false,
      reason: `${token.name ?? token.actor.name ?? "This adversary"} is defeated and cannot take a normal Action.`
    };
  }

  const entry = findLiveActionEntry(token.actor, entryId);
  if (!entry) {
    return { valid: false, reason: "The intended action is no longer available on that Actor." };
  }

  const capability = resolveActionTransactionCapability(entry);
  if (!capability.eligible) {
    return { valid: false, reason: capability.reason };
  }

  // Token-specific granted Spotlight permission has priority over a generic
  // prepared GM Move. A grant was already recorded into TURN/TOTAL and does
  // not purchase or consume another GM Move.
  const granted = findAvailableGrantedSpotlight(token.id);
  const prepared = granted ? null : getPreparedGmMove();

  const moveFearCost = granted
    ? 0
    : prepared
      ? 0
      : getNewGmMoveCost();

  if (moveFearCost === null) {
    return { valid: false, reason: "GM Move cost could not be resolved." };
  }

  const preparedMoveFearCost = prepared
    ? Math.max(0, Number(prepared.entry.moveFearCost) || 0)
    : 0;

  const featureFearCost = Math.max(0, Number(capability.featureFearCost) || 0);
  const totalFearCost = moveFearCost + featureFearCost;

  return {
    valid: true,
    sceneId: canvas.scene.id,
    tokenId: token.id,
    tokenName: token.name ?? token.actor.name ?? "Adversary",
    actorId: token.actor.id,
    actorName: token.actor.name ?? "Adversary",
    entryId: entry.id,
    itemId: entry.standardAttack ? null : entry.id,
    actionName: entry.name,
    standardAttack: Boolean(entry.standardAttack),

    grantedSpotlight: Boolean(granted),
    grantLedgerIndex: granted?.ledgerIndex ?? null,
    grantIndex: granted?.grantIndex ?? null,
    grantOwnerActionName: granted?.ownerEntry?.actionName ?? null,
    grantRecordedDelta: granted?.grant?.delta ?? 0,

    preparedMove: Boolean(prepared),
    preparedMoveIndex: prepared?.index ?? null,
    preparedMoveFearCost,
    preparedMoveKind: prepared?.entry?.kind ?? null,

    moveKind: granted
      ? "granted"
      : prepared
        ? prepared.entry.kind
        : moveFearCost === 0
          ? "base"
          : "additional",

    moveFearCost,
    featureFearCost,
    totalFearCost,

    // A grant already placed its Spotlight mark when it was granted.
    // Consuming the grant must not double-increment TURN/TOTAL.
    spotlightDelta: granted ? 0 : capability.spotlightDelta,
    manualCosts: capability.manualCosts ?? []
  };
}

function getFeatureItemForEntry(actor, entryId) {
  if (!actor || !entryId || entryId === "standard-attack") return null;

  if (typeof actor.items?.get === "function") {
    const direct = actor.items.get(entryId);
    if (direct) return direct;
  }

  return [...(actor.items ?? [])].find(
    item => String(item?.id) === String(entryId)
  ) ?? null;
}

function getNativeActionFearCost(action) {
  const nativeCosts = collectNativeCosts([action]);
  const fear = resolveSingleStructuredCost({ costs: nativeCosts }, "fear");

  if (fear.ambiguous) {
    return {
      value: null,
      ambiguous: true,
      reason: "The native Daggerheart Fear cost is scalable, non-numeric, or otherwise ambiguous."
    };
  }

  return {
    value: Math.max(0, Number(fear.value) || 0),
    ambiguous: false,
    reason: null
  };
}

function getNativeActionCostLabels(action) {
  const costs = collectNativeCosts([action]);

  return costs.map(cost => {
    const key = String(cost?.key ?? "").toLowerCase();
    const numeric = Number(cost?.value);
    const value = Number.isFinite(numeric) ? numeric : cost?.value;

    return {
      key,
      value,
      scalable: Boolean(cost?.scalable),
      label: `${capitalize(key)} ${value}${cost?.scalable ? " (scalable)" : ""}`
    };
  });
}

function explicitMetadataMatchesNativeCosts(entry, action) {
  if (!entry?.metadata) return { matches: true, reason: null };

  const nativeCosts = collectNativeCosts([action]);

  for (const [metaKey, costKey] of [
    ["fearCost", "fear"],
    ["stressCost", "stress"]
  ]) {
    if (!Object.prototype.hasOwnProperty.call(entry.metadata, metaKey)) continue;

    const metadataValue = Math.max(0, Number(entry.metadata[metaKey]) || 0);
    const native = resolveSingleStructuredCost({ costs: nativeCosts }, costKey);

    if (native.ambiguous) {
      return {
        matches: false,
        reason: `Explicit ${costKey} metadata cannot be reconciled with the native Daggerheart Action cost.`
      };
    }

    const nativeValue = Math.max(0, Number(native.value) || 0);
    if (metadataValue !== nativeValue) {
      return {
        matches: false,
        reason:
          `Explicit ${costKey} metadata (${metadataValue}) differs from the native Daggerheart Action cost (${nativeValue}). ` +
          "Use bookkeeping-only until the content metadata and native Action agree."
      };
    }
  }

  return { matches: true, reason: null };
}

function resolveNativeEmbeddedActionCapability(tokenId, entryId) {
  if (!canvas?.ready || !canvas.scene) {
    return { available: false, reason: "No ready Canvas Scene." };
  }

  const token = canvas.tokens?.get(tokenId)
    ?? (canvas.tokens?.placeables ?? []).find(candidate => candidate.id === tokenId)
    ?? null;

  if (!token?.actor || !isAdversaryActor(token.actor)) {
    return { available: false, reason: "The intended adversary token is no longer available." };
  }

  const entry = findLiveActionEntry(token.actor, entryId);
  if (!entry || entry.standardAttack) {
    return {
      available: false,
      reason: "Native embedded execution requires an embedded feature Action."
    };
  }

  const capability = resolveActionTransactionCapability(entry);
  if (!capability.eligible) {
    return { available: false, reason: capability.reason };
  }

  const item = getFeatureItemForEntry(token.actor, entryId);
  if (!item) {
    return { available: false, reason: "The embedded feature Item is no longer available." };
  }

  const actions = getNativeActions(item);
  if (actions.length !== 1) {
    return {
      available: false,
      reason:
        actions.length === 0
          ? "This feature has no executable native Daggerheart Action."
          : "v0.13 native execution requires exactly one native Daggerheart Action in the feature."
    };
  }

  const action = actions[0];
  if (!action || typeof action.use !== "function") {
    return {
      available: false,
      reason: "The feature's native Action does not expose Daggerheart Action.use()."
    };
  }

  const nativeKind = String(
    action?.type === "attack" ? "attack" : action?.actionType ?? ""
  ).toLowerCase();

  if (!["attack", "action"].includes(nativeKind)) {
    return {
      available: false,
      reason: "Only native Attack/Action feature workflows are executable in v0.13."
    };
  }

  if (entry.explicit && entry.metadata?.usesSpotlight === false) {
    return {
      available: false,
      reason: "Explicit gmAction metadata says this feature does not use an adversary Spotlight."
    };
  }

  const metadataMatch = explicitMetadataMatchesNativeCosts(entry, action);
  if (!metadataMatch.matches) {
    return { available: false, reason: metadataMatch.reason };
  }

  const nativeFear = getNativeActionFearCost(action);
  if (nativeFear.ambiguous) {
    return { available: false, reason: nativeFear.reason };
  }

  return {
    available: true,
    reason: null,
    token,
    item,
    action,
    entry,
    nativeActionId: action.id ?? action._id ?? null,
    expectedNativeFearCost: nativeFear.value,
    nativeCosts: getNativeActionCostLabels(action),
    systemVersion: game.system?.version ?? null,
    validatedVersion: NATIVE_ATTACK_VALIDATED_DH_VERSION,
    versionMatches: game.system?.version === NATIVE_ATTACK_VALIDATED_DH_VERSION
  };
}

async function invokeNativeEmbeddedAction(plan) {
  const capability = resolveNativeEmbeddedActionCapability(
    plan?.tokenId,
    plan?.entryId
  );

  if (!capability.available) {
    throw new Error(capability.reason);
  }

  const { token, action, item } = capability;

  if (!token.controlled) {
    token.control({ releaseOthers: true });
  }

  const nativeEvent = createNativeAttackEvent();

  console.log(
    "Cybermancy GM QOL | invoking native Daggerheart embedded Action",
    {
      token: token.name,
      tokenId: token.id,
      actorUuid: token.actor?.uuid,
      item: item.name,
      itemId: item.id,
      action: action.name,
      actionId: action.id ?? action._id,
      daggerheartVersion: game.system?.version
    }
  );

  return action.use(nativeEvent);
}

function resolveNativeStandardAttackCapability(tokenId, entryId = "standard-attack") {
  if (!canvas?.ready || !canvas.scene) {
    return { available: false, reason: "No ready Canvas Scene." };
  }

  const token = canvas.tokens?.get(tokenId)
    ?? (canvas.tokens?.placeables ?? []).find(candidate => candidate.id === tokenId)
    ?? null;

  if (!token?.actor || !isAdversaryActor(token.actor)) {
    return { available: false, reason: "The intended adversary token is no longer available." };
  }

  const entry = findLiveActionEntry(token.actor, entryId);
  if (!entry?.standardAttack) {
    return {
      available: false,
      reason: "Native execution is limited to the adversary's built-in standard attack in v0.12."
    };
  }

  const attack = token.actor?.system?.attack;
  if (!attack || typeof attack.use !== "function") {
    return {
      available: false,
      reason: "This Actor does not expose the validated Daggerheart standard-attack Action.use() interface."
    };
  }

  return {
    available: true,
    reason: null,
    token,
    attack,
    systemVersion: game.system?.version ?? null,
    validatedVersion: NATIVE_ATTACK_VALIDATED_DH_VERSION,
    versionMatches: game.system?.version === NATIVE_ATTACK_VALIDATED_DH_VERSION
  };
}

function createNativeAttackEvent() {
  // Daggerheart 1.2.7 Action.use(event) reads the ordinary keyboard-modifier
  // properties from its triggering event. A synthetic MouseEvent provides the
  // same native event shape while intentionally applying no modifier shortcuts.
  return new MouseEvent("click", {
    bubbles: false,
    cancelable: true,
    view: window,
    shiftKey: false,
    altKey: false,
    ctrlKey: false,
    metaKey: false
  });
}

async function invokeNativeStandardAttack(plan) {
  const capability = resolveNativeStandardAttackCapability(
    plan?.tokenId,
    plan?.entryId ?? "standard-attack"
  );

  if (!capability.available) {
    throw new Error(capability.reason);
  }

  const { token, attack } = capability;

  // The transaction is tied to one exact Token. Re-control that Token before
  // invoking Daggerheart so the native workflow/speaker context comes from the
  // intended synthetic Actor even if canvas selection changed while the preview
  // dialog was open.
  if (!token.controlled) {
    token.control({ releaseOthers: true });
  }

  const nativeEvent = createNativeAttackEvent();

  console.log(
    "Cybermancy GM QOL | invoking native Daggerheart standard attack",
    {
      token: token.name,
      tokenId: token.id,
      actorUuid: token.actor?.uuid,
      action: attack.name,
      daggerheartVersion: game.system?.version
    }
  );

  // Daggerheart 1.2.7 native integration point:
  // token.actor.system.attack is an ActionField-backed DHAttackAction whose
  // .use(event) method executes Daggerheart's own configuration + workflow.
  return attack.use(nativeEvent);
}

function getLastActionLedgerEntryWithIndex() {
  for (let index = gmMoveLedger.length - 1; index >= 0; index -= 1) {
    const entry = gmMoveLedger[index];

    // Never reach backward through a later Environment Action to attach a
    // new grant to an older adversary Action transaction.
    if (entry?.transactionType === "environment-action") return null;

    if (entry?.transactionType === "action" && entry.actionName) {
      return { entry, index };
    }
  }
  return null;
}

function getLastActionLedgerEntry() {
  return getLastActionLedgerEntryWithIndex()?.entry ?? null;
}

function findAvailableGrantedSpotlight(tokenId) {
  if (!tokenId) return null;

  for (let ledgerIndex = gmMoveLedger.length - 1; ledgerIndex >= 0; ledgerIndex -= 1) {
    const entry = gmMoveLedger[ledgerIndex];
    if (entry?.transactionType !== "action") continue;

    const grants = sanitizeGrantedSpotlights(entry.grantedSpotlights);

    for (let grantIndex = 0; grantIndex < grants.length; grantIndex += 1) {
      const grant = grants[grantIndex];

      if (
        String(grant.tokenId) === String(tokenId)
        && grant.status === "available"
      ) {
        return {
          ledgerIndex,
          grantIndex,
          ownerEntry: entry,
          grant
        };
      }
    }
  }

  return null;
}

function getActionExecutionRecord(plan) {
  if (plan?.grantedSpotlight) {
    const ownerEntry = gmMoveLedger[plan.grantLedgerIndex];
    if (ownerEntry?.transactionType !== "action") return null;

    const grants = Array.isArray(ownerEntry.grantedSpotlights)
      ? ownerEntry.grantedSpotlights
      : [];

    return grants[plan.grantIndex] ?? null;
  }

  for (let index = gmMoveLedger.length - 1; index >= 0; index -= 1) {
    const entry = gmMoveLedger[index];
    if (
      entry?.transactionType === "action"
      && String(entry?.tokenId ?? "") === String(plan?.tokenId ?? "")
      && String(entry?.actionName ?? "") === String(plan?.actionName ?? "")
    ) {
      return entry;
    }
  }

  return null;
}

function getGrantModeTransaction() {
  if (spotlightOwner !== "GM" || grantModeLedgerIndex === null) return null;

  const entry = gmMoveLedger[grantModeLedgerIndex];
  if (entry?.transactionType !== "action") {
    grantModeLedgerIndex = null;
    return null;
  }

  return { entry, index: grantModeLedgerIndex };
}

function startGrantSpotlightMode() {
  if (
    spotlightOwner !== "GM"
    || actionTransactionPending
    || reactionTransactionPending
    || conditionTransactionPending
    || fearTransactionPending
  ) {
    return false;
  }

  const latest = getLastActionLedgerEntryWithIndex();
  if (!latest) {
    ui.notifications.warn("No current-turn GM Action transaction is available to receive granted Spotlights.");
    return false;
  }

  grantModeLedgerIndex = latest.index;
  return true;
}

function stopGrantSpotlightMode() {
  if (grantModeLedgerIndex === null) return false;
  grantModeLedgerIndex = null;
  return true;
}

async function grantSpotlightToToken(tokenId) {
  const grantTransaction = getGrantModeTransaction();
  if (!grantTransaction || !tokenId) return false;

  const token = canvas?.tokens?.get(tokenId)
    ?? (canvas?.tokens?.placeables ?? []).find(candidate => candidate.id === tokenId)
    ?? null;

  if (!token?.actor || !isAdversaryActor(token.actor)) {
    ui.notifications.warn("Granted Spotlight requires a live adversary token on the current Scene.");
    return false;
  }

  if (isAdversaryDefeated(token)) {
    ui.notifications.warn(
      `${token.name ?? token.actor.name ?? "This adversary"} is defeated and cannot receive a granted Spotlight.`
    );
    return false;
  }

  const before = snapshotCombatStateMemory();
  const limitBefore = getSpotlightLimit(token);
  const projectedTurn = getSpotlightUseCount(tokenId) + 1;
  const projectedOverBy = Math.max(0, projectedTurn - limitBefore.limit);

  grantTransaction.entry.grantedSpotlights = sanitizeGrantedSpotlights(
    grantTransaction.entry.grantedSpotlights
  );
  grantTransaction.entry.grantedSpotlights.push({
    tokenId: String(tokenId),
    delta: 1,
    status: "available",
    actionName: null,
    actionSubtype: null,
    effectId: null,
    effectName: null,
    itemId: null,
    nativeActionId: null,
    executionMode: null,
    executionStatus: null,
    expectedNativeFearCost: 0,
    featureFearCost: 0,
    inspectorFearCost: 0
  });

  adjustSpotlightCounts(tokenId, 1);

  const saved = await persistCombatState();
  if (!saved) {
    restoreCombatStateMemory(before);
    return false;
  }

  if (projectedOverBy > 0) {
    ui.notifications.warn(
      `Granted Spotlight recorded for ${token.name}. TURN ${projectedTurn} exceeds resolved LIMIT ${limitBefore.limit} by ${projectedOverBy}. Advisory only; the grant was recorded.`
    );
  }

  return true;
}

async function removeGrantedSpotlight(ledgerIndex, grantIndex) {
  const safeLedgerIndex = Math.trunc(Number(ledgerIndex));
  const safeGrantIndex = Math.trunc(Number(grantIndex));
  const entry = gmMoveLedger[safeLedgerIndex];

  if (entry?.transactionType !== "action") return false;

  const grants = sanitizeGrantedSpotlights(entry.grantedSpotlights);
  const grant = grants[safeGrantIndex];
  if (!grant) return false;

  if (grant.status !== "available") {
    ui.notifications.warn(
      "This granted Spotlight has already been consumed by an Action. It cannot be individually removed; undo the owning GM Move if the transaction must be reversed."
    );
    return false;
  }

  const turn = getSpotlightUseCount(grant.tokenId);
  const total = getSpotlightTotalCount(grant.tokenId);
  if (turn < grant.delta || total < grant.delta) {
    ui.notifications.warn(
      "This granted Spotlight cannot be removed safely because TURN/TOTAL no longer contain the linked grant. Use the Spotlight integrity diagnostic before changing it."
    );
    return false;
  }

  const before = snapshotCombatStateMemory();

  grants.splice(safeGrantIndex, 1);
  entry.grantedSpotlights = grants;
  adjustSpotlightCounts(grant.tokenId, -grant.delta);

  const saved = await persistCombatState();
  if (!saved) {
    restoreCombatStateMemory(before);
    return false;
  }

  return true;
}

function renderLastActionSummary() {
  const latestReaction = getLatestReactionWithIndex();
  const latestTransaction = getLastGmActionTransactionWithIndex();

  const reactionSequence = latestReaction?.sequence ?? 0;
  const actionSequence = Math.max(
    0,
    Number(latestTransaction?.entry?.eventSequence) || 0
  );

  if (latestReaction && reactionSequence >= actionSequence) {
    return renderLastReactionSummary(latestReaction);
  }

  if (latestTransaction?.entry?.transactionType === "environment-action") {
    return renderLastEnvironmentActionSummary(latestTransaction);
  }

  const latest = getLastActionLedgerEntryWithIndex();
  if (!latest) return "";

  const { entry, index } = latest;
  const token = entry.tokenId
    ? canvas?.tokens?.get(entry.tokenId)
      ?? (canvas?.tokens?.placeables ?? []).find(candidate => candidate.id === entry.tokenId)
    : null;

  const tokenName = token?.name ?? (entry.tokenId ? `Token ${entry.tokenId}` : "Adversary");
  const status = entry.executionStatus
    ? String(entry.executionStatus).replaceAll("-", " ").toUpperCase()
    : "";

  const grants = sanitizeGrantedSpotlights(entry.grantedSpotlights);
  const totalGranted = grants.reduce((sum, grant) => sum + grant.delta, 0);
  const availableGranted = grants
    .filter(grant => grant.status === "available")
    .reduce((sum, grant) => sum + grant.delta, 0);
  const grantModeActive = grantModeLedgerIndex === index && spotlightOwner === "GM";

  const grantRows = grants.map((grant, grantIndex) => {
    const grantToken = canvas?.tokens?.get(grant.tokenId)
      ?? (canvas?.tokens?.placeables ?? []).find(candidate => candidate.id === grant.tokenId)
      ?? null;
    const grantName = grantToken?.name ?? `Token ${grant.tokenId}`;

    const grantStatus = grant.status === "available"
      ? "AVAILABLE"
      : grant.actionName
        ? `USED — ${grant.actionName}`
        : "USED";

    const grantStatusHtml =
      grant.status === "available" && grantToken
        ? `
          <button type="button"
                  class="cmgi-grant-available"
                  data-action="focus-token"
                  data-token-id="${escapeHtml(grant.tokenId)}"
                  title="Select and focus ${escapeHtml(grantName)}. This does not consume the granted Spotlight.">
            AVAILABLE
          </button>`
        : `<strong>${escapeHtml(grantStatus)}</strong>`;

    const canRemove = grant.status === "available"
      && !actionTransactionPending
      && !fearTransactionPending;

    return `
      <span class="cmgi-grant-chip">
        ${escapeHtml(grantName)} ×${grant.delta}
        ${grantStatusHtml}
        <button type="button"
                class="cmgi-grant-remove"
                data-action="remove-granted-spotlight"
                data-ledger-index="${index}"
                data-grant-index="${grantIndex}"
                ${canRemove ? "" : "disabled"}
                title="${grant.status === "available"
                  ? "Remove this unused granted Spotlight bookkeeping from the owning GM Action transaction."
                  : "This grant has already been consumed by an Action and cannot be individually removed. Undo the owning GM Move if the transaction must be reversed."}">
          ×
        </button>
      </span>`;
  }).join("");

  return `
    <div class="cmgi-last-action" title="Most recent committed GM event in the current Inspector cycle.">
      <span class="cmgi-last-action-label">LAST GM EVENT</span>
      <strong>${escapeHtml(tokenName)} — ${escapeHtml(entry.actionName)}</strong>
      ${status ? `<span class="cmgi-last-action-status">${escapeHtml(status)}</span>` : ""}
      <span class="cmgi-grant-count">GRANTS ${totalGranted} · AVAILABLE ${availableGranted}</span>
      ${grantRows ? `<span class="cmgi-grant-list">${grantRows}</span>` : ""}

      ${spotlightOwner === "GM" ? `
        <button type="button"
                class="cmgi-grant-mode-button"
                data-action="${grantModeActive ? "stop-grant-mode" : "start-grant-mode"}"
                ${actionTransactionPending || reactionTransactionPending || conditionTransactionPending || fearTransactionPending ? "disabled" : ""}
                title="${grantModeActive
                  ? "Finish assigning granted Spotlights from this GM Action."
                  : "Assign one or more exact-token Spotlights to this GM Action without creating another GM Move or spending Fear."}">
          ${grantModeActive ? "DONE GRANTING" : "GRANT SPOTLIGHT"}
        </button>
      ` : ""}
    </div>

    ${grantModeActive ? `
      <div class="cmgi-grant-mode-banner">
        <strong>GRANTING FROM:</strong>
        ${escapeHtml(tokenName)} — ${escapeHtml(entry.actionName)}
        <span class="cmgi-muted">Choose GRANT +1 on any exact adversary token. Grants create linked Spotlight bookkeeping but no additional GM Move or Fear cost.</span>
      </div>
    ` : ""}`;
}

function buildStandardAttackImplementationDetails(plan) {
  const fear = getFearState();
  const spotlightLimit = getSpotlightLimit(plan.tokenId);
  const currentTurn = getSpotlightUseCount(plan.tokenId);
  const projectedTurn =
    currentTurn + Math.max(0, Number(plan.spotlightDelta) || 0);
  const nativeAttack = resolveNativeStandardAttackCapability(
    plan.tokenId,
    plan.entryId
  );

  const moveLabel = plan.grantedSpotlight
    ? "GRANTED — no new GM Move"
    : plan.preparedMove
      ? "READY — prepared GM Move"
      : plan.moveFearCost === 0
        ? "BASE — 0 Fear"
        : `ADDITIONAL — ${plan.moveFearCost} Fear`;

  const spotlightLabel = plan.grantedSpotlight
    ? `${currentTurn}/${spotlightLimit.limit} — already counted by grant`
    : `${currentTurn}/${spotlightLimit.limit} → ${projectedTurn}/${spotlightLimit.limit}`;

  const nativeLabel = nativeAttack?.available
    ? `Available — Daggerheart ${nativeAttack.systemVersion ?? "version unknown"}`
    : `Unavailable — ${nativeAttack?.reason ?? "native interface not found"}`;

  return {
    rows: [
      ["GM Move", moveLabel],
      ["Spotlight", spotlightLabel],
      ["Spotlight Limit", `${spotlightLimit.limit} · ${spotlightLimit.sourceLabel}`],
      ["Native Attack", nativeLabel],
      ["Native Fear", fear.available ? `${fear.current}/${fear.max}` : "Unavailable"]
    ],
    notes: [
      "COMMIT & ROLL commits QOL bookkeeping, then invokes Daggerheart's native standard attack.",
      "BOOKKEEPING ONLY commits GM Move/Fear/Spotlight bookkeeping without invoking the native attack.",
      "Undo GM Move reverses QOL bookkeeping only; it does not reverse native rolls, damage, chat, or effects."
    ]
  };
}

function renderStandardAttackCompactPreviewContent(plan) {
  const details = buildStandardAttackImplementationDetails(plan);

  return `
    <style>
      .cmgi-transaction-preview-compact {
        position: relative;
        overflow: visible;
        font-size: 14px;
        padding: .1rem .05rem;
      }
      .cmgi-transaction-compact-heading {
        display: flex;
        align-items: center;
        gap: .4rem;
        margin-bottom: .75rem;
      }
      .cmgi-transaction-compact-heading h3 {
        flex: 1 1 auto;
        margin: 0;
      }
      .cmgi-transaction-info-wrap {
        position: relative;
        display: inline-flex;
        flex: 0 0 auto;
      }
      .cmgi-transaction-info {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 1.15rem;
        height: 1.15rem;
        border: 1px solid currentColor;
        border-radius: 999px;
        font-size: .72rem;
        cursor: help;
        opacity: .7;
      }
      .cmgi-transaction-info:hover,
      .cmgi-transaction-info:focus {
        opacity: 1;
      }
      .cmgi-transaction-info-popover {
        display: none;
        position: absolute;
        z-index: 1000;
        top: calc(100% + .35rem);
        right: 0;
        width: min(470px, calc(100vw - 4rem));
        padding: .65rem .75rem;
        border: 1px solid rgba(0,0,0,.38);
        border-radius: 6px;
        background: rgba(246,243,231,.985);
        color: #1b1b1b;
        box-shadow: 0 .35rem 1rem rgba(0,0,0,.3);
        font-size: .82rem;
        line-height: 1.3;
      }
      .cmgi-transaction-info-wrap:hover .cmgi-transaction-info-popover,
      .cmgi-transaction-info-wrap:focus-within .cmgi-transaction-info-popover {
        display: block;
      }
      .cmgi-transaction-info-grid {
        display: grid;
        grid-template-columns: minmax(95px, auto) minmax(0, 1fr);
        gap: .28rem .65rem;
        align-items: baseline;
      }
      .cmgi-transaction-info-label {
        font-weight: 800;
        text-align: right;
      }
      .cmgi-transaction-info-notes {
        display: block;
        margin-top: .55rem;
        padding-top: .5rem;
        border-top: 1px solid rgba(0,0,0,.2);
      }
      .cmgi-transaction-info-notes div + div {
        margin-top: .3rem;
      }
      .cmgi-transaction-fear {
        padding-top: .6rem;
        border-top: 1px solid rgba(0,0,0,.22);
        font-size: 1.05rem;
        font-weight: 850;
      }
    </style>
    <div class="cmgi-transaction-preview-compact">
      <div class="cmgi-transaction-compact-heading">
        <h3>${escapeHtml(plan.tokenName)} — ${escapeHtml(plan.actionName)}</h3>
        <span class="cmgi-transaction-info-wrap">
          <span class="cmgi-transaction-info"
                tabindex="0"
                role="img"
                aria-label="Transaction implementation details">ⓘ</span>
          <span class="cmgi-transaction-info-popover" role="tooltip">
            <span class="cmgi-transaction-info-grid">
              ${details.rows.map(([label, value]) => `
                <span class="cmgi-transaction-info-label">${escapeHtml(label)}</span>
                <span>${escapeHtml(value)}</span>
              `).join("")}
            </span>
            <span class="cmgi-transaction-info-notes">
              ${details.notes.map(note => `<div>${escapeHtml(note)}</div>`).join("")}
            </span>
          </span>
        </span>
      </div>
      <div class="cmgi-transaction-fear">
        TOTAL FEAR: ${escapeHtml(plan.totalFearCost)}
      </div>
    </div>`;
}

function configureStandardAttackDialogButtons(html, {
  nativeAvailable,
  nativeReason = null
} = {}) {
  const root = html?.[0] ?? html;
  if (!root?.querySelector) return;

  const buttonBar =
    root.querySelector(".dialog-buttons")
    ?? root.querySelector("footer")
    ?? null;

  if (buttonBar?.style) {
    buttonBar.style.display = "flex";
    buttonBar.style.gap = ".4rem";
  }

  const commit = root.querySelector('[data-button="commitAndRoll"]');
  const bookkeep = root.querySelector('[data-button="bookkeepOnly"]');
  const cancel = root.querySelector('[data-button="cancel"]');

  const commitTitle = nativeAvailable
    ? "Commit the GM Move/Fear/Spotlight bookkeeping, then invoke Daggerheart's native standard attack roll. Native roll, damage, chat, and effects remain Daggerheart-owned."
    : `Native roll unavailable: ${nativeReason ?? "native standard attack interface not found"}.`;

  const bookkeepTitle =
    "Commit only the GM Move/Fear/Spotlight bookkeeping. Do not invoke the native attack roll; resolve the attack manually.";

  const cancelTitle =
    "Close this transaction without spending Fear, recording a GM Move or Spotlight, or rolling the attack.";

  if (commit) {
    commit.title = commitTitle;
    if (!nativeAvailable) commit.disabled = true;
  }

  if (bookkeep) {
    bookkeep.title = bookkeepTitle;
  }

  if (cancel) {
    cancel.title = cancelTitle;
  }

  for (const button of [commit, bookkeep, cancel].filter(Boolean)) {
    button.style.flex = "1 1 0";
    button.style.width = "auto";
    button.style.minWidth = "0";
    button.style.height = "2rem";
    button.style.minHeight = "2rem";
    button.style.padding = ".12rem .4rem";
    button.style.fontSize = ".78rem";
    button.style.lineHeight = "1";
    button.style.whiteSpace = "nowrap";
  }
}

function renderQolCompactTransactionContent({
  heading,
  totalFear,
  rows = [],
  notes = [],
  warning = null
}) {
  return `
    <style>
      .cmgi-transaction-preview-compact {
        position: relative;
        overflow: visible;
        font-size: 14px;
        padding: .1rem .05rem;
      }
      .cmgi-transaction-compact-heading {
        display: flex;
        align-items: center;
        gap: .4rem;
        margin-bottom: .75rem;
      }
      .cmgi-transaction-compact-heading h3 {
        flex: 1 1 auto;
        margin: 0;
      }
      .cmgi-transaction-info-wrap {
        position: relative;
        display: inline-flex;
        flex: 0 0 auto;
      }
      .cmgi-transaction-info {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 1.15rem;
        height: 1.15rem;
        border: 1px solid currentColor;
        border-radius: 999px;
        font-size: .72rem;
        cursor: help;
        opacity: .7;
      }
      .cmgi-transaction-info:hover,
      .cmgi-transaction-info:focus { opacity: 1; }
      .cmgi-transaction-info-popover {
        display: none;
        position: absolute;
        z-index: 1000;
        top: calc(100% + .35rem);
        right: 0;
        width: min(470px, calc(100vw - 4rem));
        padding: .65rem .75rem;
        border: 1px solid rgba(0,0,0,.38);
        border-radius: 6px;
        background: rgba(246,243,231,.985);
        color: #1b1b1b;
        box-shadow: 0 .35rem 1rem rgba(0,0,0,.3);
        font-size: .82rem;
        line-height: 1.3;
      }
      .cmgi-transaction-info-wrap:hover .cmgi-transaction-info-popover,
      .cmgi-transaction-info-wrap:focus-within .cmgi-transaction-info-popover {
        display: block;
      }
      .cmgi-transaction-info-grid {
        display: grid;
        grid-template-columns: minmax(105px, auto) minmax(0, 1fr);
        gap: .28rem .65rem;
        align-items: baseline;
      }
      .cmgi-transaction-info-label {
        font-weight: 800;
        text-align: right;
      }
      .cmgi-transaction-info-notes {
        display: block;
        margin-top: .55rem;
        padding-top: .5rem;
        border-top: 1px solid rgba(0,0,0,.2);
      }
      .cmgi-transaction-info-notes div + div { margin-top: .3rem; }
      .cmgi-transaction-warning {
        display: block;
        margin-top: .45rem;
        font-weight: 800;
      }
      .cmgi-transaction-fear {
        padding-top: .6rem;
        border-top: 1px solid rgba(0,0,0,.22);
        font-size: 1.05rem;
        font-weight: 850;
      }
    </style>
    <div class="cmgi-transaction-preview-compact">
      <div class="cmgi-transaction-compact-heading">
        <h3>${escapeHtml(heading)}</h3>
        <span class="cmgi-transaction-info-wrap">
          <span class="cmgi-transaction-info"
                tabindex="0"
                role="img"
                aria-label="Transaction implementation details">ⓘ</span>
          <span class="cmgi-transaction-info-popover" role="tooltip">
            <span class="cmgi-transaction-info-grid">
              ${rows.map(([label, value]) => `
                <span class="cmgi-transaction-info-label">${escapeHtml(label)}</span>
                <span>${escapeHtml(value)}</span>
              `).join("")}
            </span>
            ${notes.length ? `
              <span class="cmgi-transaction-info-notes">
                ${notes.map(note => `<div>${escapeHtml(note)}</div>`).join("")}
              </span>` : ""}
            ${warning
              ? `<span class="cmgi-transaction-warning">${escapeHtml(warning)}</span>`
              : ""}
          </span>
        </span>
      </div>
      <div class="cmgi-transaction-fear">
        TOTAL FEAR: ${escapeHtml(totalFear)}
      </div>
    </div>`;
}

function configureQolCompactTransactionButtons(
  html,
  { titles = {}, disabled = {} } = {}
) {
  const root = html?.[0] ?? html;
  if (!root?.querySelector) return;

  const buttonBar =
    root.querySelector(".dialog-buttons")
    ?? root.querySelector("footer")
    ?? null;

  if (buttonBar?.style) {
    buttonBar.style.display = "flex";
    buttonBar.style.gap = ".4rem";
  }

  for (const [key, title] of Object.entries(titles)) {
    const button = root.querySelector(`[data-button="${key}"]`);
    if (!button) continue;
    button.title = title;
    if (disabled[key]) button.disabled = true;
  }

  for (const button of root.querySelectorAll(".dialog-buttons button")) {
    button.style.flex = "1 1 0";
    button.style.width = "auto";
    button.style.minWidth = "0";
    button.style.height = "2rem";
    button.style.minHeight = "2rem";
    button.style.padding = ".12rem .4rem";
    button.style.fontSize = ".78rem";
    button.style.lineHeight = "1";
    button.style.whiteSpace = "nowrap";
  }
}

function getQolCompactDialogOptions() {
  return {
    width: 620,
    height: 300,
    resizable: true
  };
}

function buildEmbeddedActionCompactPreview(plan, nativeEmbedded) {
  const fear = getFearState();
  const spotlightLimit = getSpotlightLimit(plan.tokenId);
  const currentTurn = getSpotlightUseCount(plan.tokenId);
  const projectedTurn =
    currentTurn + Math.max(0, Number(plan.spotlightDelta) || 0);

  const expectedNativeFearCost = nativeEmbedded?.available
    ? Math.max(0, Number(nativeEmbedded.expectedNativeFearCost) || 0)
    : 0;

  const totalFear = nativeEmbedded?.available
    ? plan.moveFearCost + expectedNativeFearCost
    : plan.totalFearCost;

  const moveLabel = plan.grantedSpotlight
    ? "GRANTED — no new GM Move"
    : plan.preparedMove
      ? "READY — prepared GM Move"
      : plan.moveFearCost === 0
        ? "BASE — 0 Fear"
        : `ADDITIONAL — ${plan.moveFearCost} Fear`;

  const spotlightLabel = plan.grantedSpotlight
    ? `${currentTurn}/${spotlightLimit.limit} — grant already counted`
    : `${currentTurn}/${spotlightLimit.limit} → ${projectedTurn}/${spotlightLimit.limit}`;

  const featureCost = nativeEmbedded?.available
    ? `${expectedNativeFearCost} Fear — Daggerheart`
    : plan.featureFearCost > 0
      ? `${plan.featureFearCost} Fear — QOL`
      : "0 Fear";

  const affordable =
    totalFear === 0
    || (fear.available && fear.current >= totalFear);

  return {
    heading: `${plan.tokenName} — ${plan.actionName}`,
    totalFear,
    rows: [
      ["GM Move", moveLabel],
      ["Spotlight", spotlightLabel],
      ["Spotlight Limit", `${spotlightLimit.limit} · ${spotlightLimit.sourceLabel}`],
      ["Feature Cost", featureCost],
      ["Native Feature", nativeEmbedded?.available
        ? "Available — exactly one Daggerheart Action"
        : `Unavailable — ${nativeEmbedded?.reason ?? "native Action unavailable"}`],
      ["Native Fear", fear.available ? `${fear.current}/${fear.max}` : "Unavailable"]
    ],
    notes: [
      plan.grantedSpotlight
        ? "This transaction consumes an already-recorded granted Spotlight without adding another GM Move or TURN/TOTAL mark."
        : "The QOL layer owns GM Move Fear and Spotlight bookkeeping.",
      nativeEmbedded?.available
        ? "Commit & Use then hands native feature costs, dialogs, rolls, targets, damage, uses, and effects to Daggerheart."
        : "Bookkeeping Only records the supported QOL bookkeeping; resolve the feature manually.",
      "Undo GM Move reverses QOL bookkeeping only; native Daggerheart outcomes are not reversed."
    ],
    warning: affordable
      ? null
      : fear.available
        ? `INSUFFICIENT FEAR — this transaction requires ${totalFear}.`
        : "NATIVE FEAR UNAVAILABLE — commit will be rejected."
  };
}

function showActionTransactionPreview(tokenId, entryId) {
  const plan = buildActionTransactionPlan(tokenId, entryId);

  if (!plan.valid) {
    ui.notifications.warn(plan.reason);
    return;
  }

  const buttons = {};

  if (plan.standardAttack) {
    const nativeAttack = resolveNativeStandardAttackCapability(
      tokenId,
      entryId
    );

    buttons.commitAndRoll = {
      label: "Commit & Roll",
      callback: () => commitActionTransaction(
        tokenId,
        entryId,
        { executionMode: "native-standard" }
      )
    };

    buttons.bookkeepOnly = {
      label: "Bookkeeping Only",
      callback: () => commitActionTransaction(
        tokenId,
        entryId,
        { executionMode: "bookkeeping-only" }
      )
    };

    buttons.cancel = {
      label: "Cancel"
    };

    new Dialog(
      {
        title: plan.grantedSpotlight
          ? "GM Action Transaction — Granted Spotlight"
          : "GM Action Transaction",
        content: renderStandardAttackCompactPreviewContent(plan),
        buttons,
        default: "cancel",
        render: html => configureStandardAttackDialogButtons(
          html,
          {
            nativeAvailable: nativeAttack.available,
            nativeReason: nativeAttack.reason
          }
        )
      },
      {
        width: 620,
        height: 300,
        resizable: true
      }
    ).render(true);

    return;
  }

  const nativeEmbedded = resolveNativeEmbeddedActionCapability(
    tokenId,
    entryId
  );

  const preview = buildEmbeddedActionCompactPreview(plan, nativeEmbedded);

  buttons.commitAndUse = {
    label: "Commit & Use",
    callback: () => commitActionTransaction(
      tokenId,
      entryId,
      { executionMode: "native-embedded" }
    )
  };

  buttons.bookkeepOnly = {
    label: "Bookkeeping Only",
    callback: () => commitActionTransaction(
      tokenId,
      entryId,
      { executionMode: "bookkeeping-only" }
    )
  };

  buttons.cancel = { label: "Cancel" };

  new Dialog(
    {
      title: plan.grantedSpotlight
        ? "GM Action Transaction — Granted Spotlight"
        : "GM Action Transaction",
      content: renderQolCompactTransactionContent(preview),
      buttons,
      default: "cancel",
      render: html => configureQolCompactTransactionButtons(
        html,
        {
          titles: {
            commitAndUse: nativeEmbedded.available
              ? "Commit GM Move/Fear/Spotlight bookkeeping, then invoke the native Daggerheart feature Action."
              : `Native feature execution is unavailable: ${nativeEmbedded.reason ?? "native Action unavailable"}.`,
            bookkeepOnly:
              "Commit only the supported GM Move/Fear/Spotlight bookkeeping and resolve the feature manually.",
            cancel:
              "Close this transaction without spending Fear, recording a GM Move or Spotlight, or using the feature."
          },
          disabled: { commitAndUse: !nativeEmbedded.available }
        }
      )
    },
    getQolCompactDialogOptions()
  ).render(true);
}

async function commitActionTransaction(
  tokenId,
  entryId,
  { executionMode = "bookkeeping-only" } = {}
) {
  if (
    actionTransactionPending
    || reactionTransactionPending
    || conditionTransactionPending
    || fearTransactionPending
  ) return false;

  const plan = buildActionTransactionPlan(tokenId, entryId);
  if (!plan.valid) {
    ui.notifications.warn(plan.reason);
    return false;
  }

  if (plan.sceneId !== canvas?.scene?.id) {
    ui.notifications.warn("The active Scene changed before the transaction could commit.");
    return false;
  }

  const nativeStandard = executionMode === "native-standard";
  const nativeEmbedded = executionMode === "native-embedded";
  const nativeExecution = nativeStandard || nativeEmbedded;

  let nativeCapability = null;
  let expectedNativeFearCost = 0;

  if (nativeStandard) {
    if (!plan.standardAttack) {
      ui.notifications.warn("Native standard execution requires the built-in adversary attack.");
      return false;
    }

    nativeCapability = resolveNativeStandardAttackCapability(tokenId, entryId);
    if (!nativeCapability.available) {
      ui.notifications.warn(nativeCapability.reason);
      return false;
    }
  } else if (nativeEmbedded) {
    if (plan.standardAttack) {
      ui.notifications.warn("Native embedded execution requires a feature Action.");
      return false;
    }

    nativeCapability = resolveNativeEmbeddedActionCapability(tokenId, entryId);
    if (!nativeCapability.available) {
      ui.notifications.warn(nativeCapability.reason);
      return false;
    }

    expectedNativeFearCost = Math.max(
      0,
      Number(nativeCapability.expectedNativeFearCost) || 0
    );
  } else if (executionMode !== "bookkeeping-only") {
    ui.notifications.warn("Unknown GM Action transaction execution mode.");
    return false;
  }

  // Cost ownership:
  // - GM Move Fear is waived when consuming a granted Spotlight.
  // - bookkeeping-only feature Fear remains QOL-owned.
  // - native embedded feature Fear remains Daggerheart-owned.
  const inspectorFearCost = nativeEmbedded
    ? plan.moveFearCost
    : plan.totalFearCost;

  const requiredFearBeforeCommit = nativeEmbedded
    ? plan.moveFearCost + expectedNativeFearCost
    : plan.totalFearCost;

  const fear = getFearState();
  if (!fear.available || fear.current < requiredFearBeforeCommit) {
    ui.notifications.warn(
      `Not enough native Daggerheart Fear. This transaction requires ${requiredFearBeforeCommit} available before commit.`
    );
    return false;
  }

  const before = snapshotCombatStateMemory();
  const preparedBeforeCommit = plan.grantedSpotlight
    ? null
    : getPreparedGmMove();
  const grantBeforeCommit = plan.grantedSpotlight
    ? findAvailableGrantedSpotlight(plan.tokenId)
    : null;
  let fearSpent = false;

  if (plan.grantedSpotlight) {
    if (
      !grantBeforeCommit
      || grantBeforeCommit.ledgerIndex !== plan.grantLedgerIndex
      || grantBeforeCommit.grantIndex !== plan.grantIndex
    ) {
      ui.notifications.warn(
        "The granted Spotlight changed or was consumed before commit. Reopen the Action preview."
      );
      return false;
    }
  } else {
    if (Boolean(preparedBeforeCommit) !== Boolean(plan.preparedMove)) {
      ui.notifications.warn("GM Move readiness changed before commit. Reopen the Action preview.");
      return false;
    }

    if (
      preparedBeforeCommit
      && preparedBeforeCommit.index !== plan.preparedMoveIndex
    ) {
      ui.notifications.warn("The prepared GM Move changed before commit. Reopen the Action preview.");
      return false;
    }
  }

  try {
    grantModeLedgerIndex = null;
    actionTransactionPending = true;

    if (inspectorFearCost > 0) {
      fearSpent = await spendNativeFear(
        inspectorFearCost,
        plan.grantedSpotlight
          ? `Granted Spotlight feature cost: ${plan.actionName}`
          : `GM Action transaction: ${plan.actionName}`
      );
      if (!fearSpent) return false;
    }

    if (plan.grantedSpotlight) {
      const ownerEntry = gmMoveLedger[plan.grantLedgerIndex];
      if (ownerEntry?.transactionType !== "action") {
        throw new Error("The owning GM Action transaction is no longer available.");
      }

      const grants = sanitizeGrantedSpotlights(ownerEntry.grantedSpotlights);
      const grant = grants[plan.grantIndex];

      if (
        !grant
        || grant.status !== "available"
        || String(grant.tokenId) !== String(plan.tokenId)
      ) {
        throw new Error("The granted Spotlight is no longer available.");
      }

      // Consume the already-recorded Spotlight entitlement. Do NOT create a
      // GM Move and do NOT touch TURN/TOTAL; the grant did that at grant time.
      grant.status = "used";
      grant.actionName = plan.actionName;
      grant.itemId = plan.itemId;
      grant.nativeActionId = nativeEmbedded
        ? String(nativeCapability?.nativeActionId ?? "")
        : null;
      grant.executionMode = executionMode;
      grant.executionStatus = nativeExecution
        ? "pending-native"
        : "bookkeeping-only";
      grant.expectedNativeFearCost = expectedNativeFearCost;
      grant.featureFearCost = nativeEmbedded ? 0 : plan.featureFearCost;
      grant.inspectorFearCost = inspectorFearCost;
      grant.eventSequence = allocateGmEventSequence();

      // The owning transaction stays the grant owner, but its event sequence
      // advances so a granted Action after a Reaction correctly becomes the
      // latest GM event in the dialog.
      ownerEntry.eventSequence = grant.eventSequence;
      ownerEntry.grantedSpotlights = grants;

      // Keep QOL-owned bookkeeping Fear refundable with the owning GM
      // Move. Native Daggerheart feature costs are deliberately not included.
      ownerEntry.fearCost =
        Math.max(0, Number(ownerEntry.fearCost) || 0)
        + inspectorFearCost;
    } else if (preparedBeforeCommit) {
      // Prepared move was already acquired/paid. Consume that SAME entry.
      const ledgerEntry = preparedBeforeCommit.entry;

      ledgerEntry.fearCost =
        Math.max(0, Number(ledgerEntry.fearCost) || 0)
        + inspectorFearCost;
      ledgerEntry.featureFearCost = nativeEmbedded ? 0 : plan.featureFearCost;
      ledgerEntry.expectedNativeFearCost = expectedNativeFearCost;
      ledgerEntry.transactionType = "action";
      ledgerEntry.executionMode = executionMode;
      ledgerEntry.executionStatus = nativeExecution
        ? "pending-native"
        : "bookkeeping-only";
      ledgerEntry.moveStatus = "used";
      ledgerEntry.tokenId = plan.tokenId;
      ledgerEntry.itemId = plan.itemId;
      ledgerEntry.nativeActionId = nativeEmbedded
        ? String(nativeCapability?.nativeActionId ?? "")
        : null;
      ledgerEntry.actionName = plan.actionName;
      ledgerEntry.eventSequence = allocateGmEventSequence();
      ledgerEntry.spotlightDelta = plan.spotlightDelta;
      ledgerEntry.grantedSpotlights = [];
    } else {
      // Normal direct path: acquire and immediately use one new GM Move.
      gmMovesThisTurn += 1;
      gmMoveLedger.push({
        kind: plan.moveKind,
        fearCost: inspectorFearCost,
        moveFearCost: plan.moveFearCost,
        featureFearCost: nativeEmbedded ? 0 : plan.featureFearCost,
        expectedNativeFearCost,
        transactionType: "action",
        executionMode,
        executionStatus: nativeExecution ? "pending-native" : "bookkeeping-only",
        moveStatus: "used",
        tokenId: plan.tokenId,
        itemId: plan.itemId,
        nativeActionId: nativeEmbedded
          ? String(nativeCapability?.nativeActionId ?? "")
          : null,
        actionName: plan.actionName,
        eventSequence: allocateGmEventSequence(),
        spotlightDelta: plan.spotlightDelta,
        grantedSpotlights: []
      });
    }

    if (plan.spotlightDelta > 0) {
      adjustSpotlightCounts(plan.tokenId, plan.spotlightDelta);
    }

    const saved = await persistCombatState();
    if (!saved) {
      restoreCombatStateMemory(before);

      if (fearSpent && inspectorFearCost > 0) {
        const refunded = await refundNativeFear(
          inspectorFearCost,
          "failed GM Action transaction state save"
        );
        if (!refunded) {
          ui.notifications.error(
            "Action transaction save failed and the Fear refund also failed. Check native Fear manually."
          );
        }
      }

      return false;
    }

    refreshInspector();

    if (executionMode === "bookkeeping-only" && plan.manualCosts.length) {
      ui.notifications.warn(
        `GM Action bookkeeping committed. Manual cost remains: ${plan.manualCosts.join("; ")}`
      );
    }

    if (nativeExecution) {
      try {
        const nativeResult = nativeStandard
          ? await invokeNativeStandardAttack(plan)
          : await invokeNativeEmbeddedAction(plan);

        const executionRecord = getActionExecutionRecord(plan);
        if (executionRecord) {
          executionRecord.executionStatus = nativeResult === undefined
            ? "cancelled"
            : "completed";

          const statusSaved = await persistCombatState();
          if (!statusSaved) {
            ui.notifications.warn(
              "Native Action finished, but its execution status could not be persisted. Bookkeeping remains committed."
            );
          }
        }

        refreshInspector();

        if (nativeResult === undefined) {
          ui.notifications.warn(
            `Native Daggerheart Action did not complete for ${plan.tokenName} — ${plan.actionName}. ` +
            "QOL bookkeeping remains committed."
          );
        }
      } catch (error) {
        console.error(
          "Cybermancy GM QOL | Native Daggerheart Action invocation failed after bookkeeping commit",
          error
        );

        const executionRecord = getActionExecutionRecord(plan);
        if (executionRecord) {
          executionRecord.executionStatus = "failed";
          const statusSaved = await persistCombatState();
          if (!statusSaved) {
            ui.notifications.warn(
              "Native Action failure status could not be persisted. Bookkeeping remains committed."
            );
          }
        }

        refreshInspector();

        ui.notifications.error(
          `Native Action invocation failed for ${plan.tokenName} — ${plan.actionName}. ` +
          "QOL bookkeeping remains committed; native costs/effects are not automatically reversed."
        );

        return {
          committed: true,
          nativeExecutionInvoked: true,
          nativeExecutionStatus: "failed",
          grantedSpotlight: plan.grantedSpotlight,
          error
        };
      }
    }

    const executionRecord = getActionExecutionRecord(plan);

    return {
      committed: true,
      grantedSpotlight: plan.grantedSpotlight,
      nativeExecutionInvoked: nativeExecution,
      nativeExecutionStatus: nativeExecution
        ? executionRecord?.executionStatus ?? null
        : "bookkeeping-only"
    };
  } finally {
    actionTransactionPending = false;

    // Always rerender after releasing the transaction lock.
    refreshInspector();
  }
}

function renderActionTransactionControl(entry, group) {
  const actor = group?.actor ?? group?.tokens?.[0]?.actor ?? null;
  const compatibility = classifyFeatureCompatibility(actor, entry);

  if (["ambiguous", "unknown"].includes(compatibility.bucket)) {
    return `
      <span class="cmgi-action-manual"
            title="${escapeHtml(compatibility.reason ?? "Structured metadata is insufficient for safe execution.")}">
        ${escapeHtml(compatibility.source)}
      </span>`;
  }

  const reactionCapability = resolveReactionTransactionCapability(entry);

  if (reactionCapability.eligible) {
    return renderAdversaryReactionTransactionControl(entry, group);
  }

  const capability = resolveActionTransactionCapability(entry);

  if (!capability.eligible) {
    return `
      <span class="cmgi-action-manual"
            title="${escapeHtml(capability.reason ?? compatibility.reason ?? "Manual action bookkeeping required.")}">
        MANUAL
      </span>`;
  }

  const selectedToken = getSelectedTokenForGroup(group);

  if (!selectedToken) {
    return `
      <button type="button" class="cmgi-action-use" disabled
              title="Select an exact token from this adversary group before using the transaction.">
        SELECT TOKEN
      </button>`;
  }

  if (isAdversaryDefeated(selectedToken)) {
    return `
      <button type="button" class="cmgi-action-use" disabled
              title="This adversary is defeated and cannot take a normal Action.">
        DEFEATED
      </button>`;
  }

  if (spotlightOwner !== "GM") {
    return `
      <button type="button" class="cmgi-action-use" disabled
              title="Take GM Spotlight before using an adversary Action transaction.">
        GM SPOTLIGHT
      </button>`;
  }

  const availableGrant = findAvailableGrantedSpotlight(selectedToken.id);

  return `
    <button
      type="button"
      class="cmgi-action-use"
      data-action="preview-action-transaction"
      data-token-id="${escapeHtml(selectedToken.id)}"
      data-entry-id="${escapeHtml(entry.id)}"
      ${actionTransactionPending || reactionTransactionPending || conditionTransactionPending || fearTransactionPending ? "disabled" : ""}
      title="${availableGrant
        ? "Use one available granted Spotlight for this exact token. No GM Move Fear, no new GM Move, and no additional TURN/TOTAL mark will be added. Feature-specific costs still apply."
        : "Preview GM Move + feature costs + exact-token Spotlight bookkeeping. Eligible standard attacks and single embedded Actions can invoke Daggerheart natively."}">
      ${availableGrant ? "USE · GRANTED" : "USE"}
    </button>`;
}

function renderActionBadges(entry, fear) {
  const badges = [];

  badges.push(
    `<span class="cmgi-action-badge cmgi-kind" title="${escapeHtml(
      entry.kind.source === "explicit"
        ? "Classification supplied by flags.cybermancy.gmAction."
        : entry.kind.source === "native"
          ? "Classification supplied by structured Daggerheart action data."
          : "No structured action classification is available; no inference was made."
    )}">${escapeHtml(entry.kind.label)}</span>`
  );

  for (const range of entry.ranges) {
    badges.push(
      `<span class="cmgi-action-badge cmgi-range">${escapeHtml(capitalize(range))}</span>`
    );
  }

  for (const cost of entry.costs) {
    const formatted = formatCost(cost, fear);
    badges.push(
      `<span class="cmgi-action-badge ${escapeHtml(formatted.className)}"
             title="${escapeHtml(formatted.title)}">${escapeHtml(formatted.text)}</span>`
    );
  }

  if (entry.fastPlayReferenced) {
    badges.push(
      `<span class="cmgi-action-badge cmgi-fastplay-ref"
             title="This feature is referenced by the Actor's structured Fast Play prompts.">FAST PLAY</span>`
    );
  }

  if (entry.explicit) {
    badges.push(
      `<span class="cmgi-action-badge cmgi-explicit-badge"
             title="This feature contains explicit Cybermancy gmAction metadata.">EXPLICIT</span>`
    );
  }

  return badges.join("");
}

function renderActionDetails(entry) {
  const description = entry.description?.trim();
  const descriptionHtml = description
    ? `<div class="cmgi-feature-description">${description}</div>`
    : `<div class="cmgi-muted">No feature description is stored on this entry.</div>`;

  const metadataHtml = entry.explicit
    ? `
      <details class="cmgi-inline-meta">
        <summary>gmAction metadata</summary>
        <code>${escapeHtml(JSON.stringify(entry.metadata))}</code>
      </details>`
    : "";

  return `
    ${entry.detailsHtml}
    ${descriptionHtml}
    ${metadataHtml}`;
}

function renderGmActions(actor, group) {
  const entries = buildGmActionEntries(actor);
  const fear = getFearState();

  if (!entries.length) {
    return `
      <div class="cmgi-actions">
        <div class="cmgi-section-title">GM ACTIONS</div>
        <div class="cmgi-muted">No standard attack or embedded feature Items found.</div>
      </div>`;
  }

  const rows = entries.map(entry => `
    <div class="cmgi-action-shell">
      <details class="cmgi-action-entry">
        <summary>
          <span class="cmgi-action-name">${escapeHtml(entry.name)}</span>
          <span class="cmgi-action-badges">${renderActionBadges(entry, fear)}</span>
        </summary>
        <div class="cmgi-action-details">
          ${renderActionDetails(entry)}
          ${renderCompatibilityDiagnosticForEntry(actor, entry)}
        </div>
      </details>
      <div class="cmgi-action-control">
        ${renderActionTransactionControl(entry, group)}
      </div>
    </div>
  `).join("");

  const gmActionsInfo =
    "USE previews GM Move + structured feature Fear + the selected exact token's Spotlight. " +
    "Standard attacks can COMMIT & ROLL. A feature with exactly one safe native Daggerheart Attack/Action can COMMIT & USE. " +
    "QOL owns GM Move Fear; Daggerheart owns native feature costs. Structured Reactions and explicit non-Spotlight features use REACT and do not consume a GM Move or adversary Spotlight. " +
    "Passives, ambiguous multi-Action features, and unclassified features remain reference-only or MANUAL.";

  return `
    <div class="cmgi-actions">
      <div class="cmgi-section-title cmgi-section-title-with-info">
        <span>GM ACTIONS</span>
        <span class="cmgi-info-icon"
              tabindex="0"
              role="img"
              aria-label="GM Actions information"
              title="${escapeHtml(gmActionsInfo)}">ⓘ</span>
      </div>
      ${rows}
    </div>`;
}
