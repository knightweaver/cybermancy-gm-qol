function isAdversaryActor(actor) {
  if (!actor) return false;
  if (actor.type === "adversary") return true;

  const role = String(actor.system?.type ?? "").toLowerCase();
  return [
    "minion", "standard", "bruiser", "horde", "leader",
    "skulk", "social", "solo", "support"
  ].includes(role);
}

function normalizeSpotlightLimit(raw) {
  const numeric = Number(raw);
  if (!Number.isFinite(numeric)) return null;

  const integer = Math.trunc(numeric);
  if (integer < 1 || integer !== numeric) return null;

  return integer;
}

function getActorSpotlightLimitSourceKeys(actor) {
  if (!actor) return [];

  const keys = [
    actor?._stats?.compendiumSource,
    foundry.utils.getProperty(actor, "flags.core.sourceId"),
    foundry.utils.getProperty(actor, "_source.flags.core.sourceId"),
    actor?.uuid?.startsWith?.("Compendium.") ? actor.uuid : null
  ];

  return [...new Set(
    keys
      .map(value => value ? String(value) : null)
      .filter(Boolean)
  )];
}

function getExplicitActorSpotlightLimit(actor) {
  if (!actor) return { present: false, raw: undefined };

  const direct = foundry.utils.getProperty(
    actor,
    "flags.cybermancy.spotlightLimit"
  );

  if (direct !== undefined && direct !== null) {
    return { present: true, raw: direct };
  }

  const source = foundry.utils.getProperty(
    actor,
    "_source.flags.cybermancy.spotlightLimit"
  );

  if (source !== undefined && source !== null) {
    return { present: true, raw: source };
  }

  return { present: false, raw: undefined };
}

function resolveActorSpotlightLimit(actor) {
  const resolved = getSpotlightLimitCompatibility(actor);

  return {
    limit: resolved.limit,
    source:
      resolved.source === "CYBERMANCY"
        ? "cybermancy"
        : resolved.source === "NATIVE"
          ? "native"
          : resolved.source === "SIDECAR"
            ? "srd"
            : "default",
    sourceLabel: resolved.source,
    sourceKey: resolved.sourceKey ?? null,
    reason: resolved.reason ?? null
  };
}

function resolveSpotlightLimitToken(tokenOrId) {
  if (!tokenOrId) return null;

  if (typeof tokenOrId === "object") {
    if (tokenOrId.actor) return tokenOrId;
    if (tokenOrId.document?.actor) return tokenOrId;
  }

  const tokenId = String(tokenOrId);

  return canvas?.tokens?.get(tokenId)
    ?? (canvas?.tokens?.placeables ?? []).find(
      candidate => String(candidate?.id) === tokenId
    )
    ?? null;
}

function getSpotlightLimit(tokenOrId) {
  const token = resolveSpotlightLimitToken(tokenOrId);
  const tokenId = token?.id
    ?? token?.document?.id
    ?? (typeof tokenOrId === "string" ? tokenOrId : null);

  if (!token?.actor) {
    return {
      available: false,
      tokenId,
      limit: 1,
      source: "default",
      sourceLabel: "DEFAULT",
      sourceKey: null,
      turn: tokenId ? getSpotlightUseCount(tokenId) : 0,
      remaining: null,
      reached: false,
      exceeded: false,
      overBy: 0,
      reason: "The exact Scene token could not be resolved."
    };
  }

  const resolved = resolveActorSpotlightLimit(token.actor);
  const turn = getSpotlightUseCount(tokenId);
  const remaining = Math.max(0, resolved.limit - turn);
  const overBy = Math.max(0, turn - resolved.limit);

  return {
    available: true,
    tokenId,
    actorId: token.actor?.id ?? null,
    actorName: token.actor?.name ?? null,
    ...resolved,
    turn,
    remaining,
    reached: turn === resolved.limit,
    exceeded: turn > resolved.limit,
    overBy
  };
}

function tokenGroupKey(token) {
  return token?.document?.actorId
    ?? token?.actor?.id
    ?? token?.actor?.name
    ?? token?.id;
}

function getFastPlay(actor) {
  return actor?.getFlag?.("cybermancy", "fastPlay")
    ?? actor?.flags?.cybermancy?.fastPlay
    ?? null;
}

function getGmActionMetadata(item) {
  return item?.getFlag?.("cybermancy", "gmAction")
    ?? item?.flags?.cybermancy?.gmAction
    ?? null;
}

function escapeHtml(value) {
  return foundry.utils.escapeHTML(String(value ?? ""));
}

function capitalize(value) {
  const text = String(value ?? "");
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : "";
}

function getSelectedToken() {
  return canvas?.tokens?.controlled?.[0] ?? null;
}

function resetInspectorSessionState() {
  expandedGroups.clear();
  expandedEnvironments.clear();
  collapsedFastPlay.clear();
  pcSectionCollapsed = false;
  inspectorDiagnosticsVisible = false;
  grantModeLedgerIndex = null;
  inspectorSceneId = canvas?.scene?.id ?? null;
}

function syncSceneSessionState() {
  const sceneId = canvas?.scene?.id ?? null;

  if (inspectorSceneId !== null && sceneId !== inspectorSceneId) {
    expandedGroups.clear();
    expandedEnvironments.clear();
    collapsedFastPlay.clear();
    pcSectionCollapsed = false;
    inspectorDiagnosticsVisible = false;
    grantModeLedgerIndex = null;
  }

  inspectorSceneId = sceneId;
}

function setSelectedGroupExpanded(token) {
  if (!token || !isAdversaryActor(token.actor)) return;
  expandedGroups.add(tokenGroupKey(token));
}

function isGroupExpanded(groupKey) {
  return expandedGroups.has(groupKey);
}

function getTokenInstanceLabels(group) {
  const tokens = group?.tokens ?? [];
  const baseNames = tokens.map(token =>
    String(token?.name ?? token?.actor?.name ?? "Token")
  );

  const counts = new Map();
  for (const name of baseNames) {
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }

  const ordinals = new Map();

  return tokens.map((token, index) => {
    const baseName = baseNames[index];
    let label = baseName;

    // Only append an ordinal when duplicate display names would otherwise
    // make exact-token selection ambiguous.
    if ((counts.get(baseName) ?? 0) > 1) {
      const ordinal = (ordinals.get(baseName) ?? 0) + 1;
      ordinals.set(baseName, ordinal);
      label = `${baseName} ${ordinal}`;
    }

    return {
      token,
      label
    };
  });
}

function getSceneGroups() {
  if (!canvas?.ready || !canvas.scene) return [];

  const tokens = (canvas.tokens?.placeables ?? []).filter(
    token => isAdversaryActor(token.actor)
  );

  const groups = new Map();

  for (const token of tokens) {
    const key = tokenGroupKey(token);

    if (!groups.has(key)) {
      groups.set(key, {
        key,
        actor: token.actor,
        tokens: []
      });
    }

    groups.get(key).tokens.push(token);
  }

  const selected = getSelectedToken();
  const selectedKey = selected ? tokenGroupKey(selected) : null;

  const result = [...groups.values()].map(group => ({
    ...group,
    selected: group.key === selectedKey,
    expanded: isGroupExpanded(group.key)
  }));

  result.sort((a, b) => {
    if (a.selected !== b.selected) return a.selected ? -1 : 1;
    return String(a.actor?.name ?? "").localeCompare(
      String(b.actor?.name ?? "")
    );
  });

  return result;
}
