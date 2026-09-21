/* -------------------------------------------- */
/*  Scene PC Roster                              */
/* -------------------------------------------- */

function isPcActor(actor) {
  return Boolean(actor && actor.type === "character");
}

function pcSceneEntryKey(token) {
  if (!token?.actor) return null;

  const linked = Boolean(token.document?.actorLink);
  const actorId = token.actor?.id ?? token.document?.actorId ?? null;

  if (linked && actorId) {
    return `actor:${actorId}`;
  }

  return `token:${token.id}`;
}

function getScenePcEntries() {
  if (!canvas?.ready || !canvas.scene) return [];

  const tokens = (canvas.tokens?.placeables ?? [])
    .filter(token => isPcActor(token.actor));

  const entries = new Map();

  // Prefer a controlled representation when a linked Actor appears more than
  // once. Linked tokens share Actor state, so only one row is needed.
  const ordered = [
    ...tokens.filter(token => token.controlled),
    ...tokens.filter(token => !token.controlled)
  ];

  for (const token of ordered) {
    const key = pcSceneEntryKey(token);
    if (!key || entries.has(key)) continue;

    entries.set(key, {
      key,
      actor: token.actor,
      token,
      linked: Boolean(token.document?.actorLink)
    });
  }

  return [...entries.values()].sort((a, b) =>
    String(a.actor?.name ?? "").localeCompare(
      String(b.actor?.name ?? "")
    )
  );
}

function resolvePcToken(tokenId) {
  if (!tokenId) return null;

  const token = canvas?.tokens?.get(tokenId)
    ?? (canvas?.tokens?.placeables ?? []).find(
      candidate => String(candidate?.id) === String(tokenId)
    )
    ?? null;

  return token?.actor && isPcActor(token.actor)
    ? token
    : null;
}
