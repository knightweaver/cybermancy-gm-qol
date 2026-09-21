function isEnvironmentActor(actor) {
  return actor?.type === "environment";
}

function normalizeEnvironmentLinks(value) {
  if (!Array.isArray(value)) return [];

  const seen = new Set();
  const result = [];

  for (const raw of value) {
    if (!raw) continue;
    const uuid = String(raw).trim();
    if (!uuid || seen.has(uuid)) continue;
    seen.add(uuid);
    result.push(uuid);
  }

  return result;
}

function getEnvironmentLinks(scene = canvas?.scene) {
  if (!scene) return [];

  return normalizeEnvironmentLinks(
    scene.getFlag?.(ENVIRONMENT_FLAG_NAMESPACE, ENVIRONMENT_FLAG_KEY)
      ?? scene.flags?.[ENVIRONMENT_FLAG_NAMESPACE]?.[ENVIRONMENT_FLAG_KEY]
      ?? []
  );
}

function resolveEnvironmentActorUuid(uuid) {
  if (!uuid || typeof fromUuidSync !== "function") return null;

  try {
    const document = fromUuidSync(String(uuid));
    return isEnvironmentActor(document) ? document : null;
  } catch (error) {
    console.warn(
      "Cybermancy GM QOL | Could not resolve linked Environment Actor",
      uuid,
      error
    );
    return null;
  }
}

function getEnvironmentActorUuidForToken(token) {
  if (!token) return null;

  const worldActor = token.document?.actorId
    ? game.actors?.get?.(token.document.actorId)
    : null;

  const actor = worldActor ?? token.actor ?? null;
  return isEnvironmentActor(actor) ? actor.uuid ?? null : null;
}

function getSceneEnvironments(scene = canvas?.scene) {
  const sceneId = scene?.id ?? null;
  const linkedUuids = getEnvironmentLinks(scene);
  const linkedSet = new Set(linkedUuids);
  const effective = [];
  const byUuid = new Map();

  // Explicit links are authoritative and retain their stored order, including
  // unresolved/broken UUIDs. Nothing is silently repaired or removed.
  for (const uuid of linkedUuids) {
    const actor = resolveEnvironmentActorUuid(uuid);
    const record = {
      uuid,
      actor,
      actorId: actor?.id ?? null,
      name: actor?.name ?? null,
      source: "linked",
      linked: true,
      tokenDetected: false,
      tokenIds: [],
      resolved: Boolean(actor),
      issue: actor ? null : "The linked Actor could not be resolved as an Environment."
    };

    effective.push(record);
    byUuid.set(uuid, record);
  }

  const tokenDetected = [];
  const seenTokenUuids = new Set();

  for (const token of canvas?.tokens?.placeables ?? []) {
    if (!isEnvironmentActor(token?.actor)) continue;

    const uuid = getEnvironmentActorUuidForToken(token);
    if (!uuid) continue;

    let tokenRecord = tokenDetected.find(record => record.uuid === uuid);

    if (!tokenRecord) {
      const actor = resolveEnvironmentActorUuid(uuid)
        ?? game.actors?.get?.(token.document?.actorId)
        ?? token.actor;

      tokenRecord = {
        uuid,
        actor,
        actorId: actor?.id ?? null,
        name: actor?.name ?? token.name ?? "Environment",
        source: linkedSet.has(uuid) ? "linked" : "token",
        linked: linkedSet.has(uuid),
        tokenDetected: true,
        tokenIds: [],
        resolved: Boolean(actor),
        issue: null
      };

      tokenDetected.push(tokenRecord);
    }

    if (!tokenRecord.tokenIds.includes(token.id)) {
      tokenRecord.tokenIds.push(token.id);
    }

    seenTokenUuids.add(uuid);

    const existing = byUuid.get(uuid);
    if (existing) {
      existing.tokenDetected = true;
      existing.tokenIds = [...tokenRecord.tokenIds];
      existing.actor ??= tokenRecord.actor;
      existing.actorId ??= tokenRecord.actorId;
      existing.name ??= tokenRecord.name;
      existing.resolved = Boolean(existing.actor);
      existing.issue = existing.actor ? null : existing.issue;
      continue;
    }

    effective.push(tokenRecord);
    byUuid.set(uuid, tokenRecord);
  }

  return {
    sceneId,
    links: [...linkedUuids],
    linked: effective.filter(record => record.linked),
    tokenDetected,
    effective
  };
}

async function linkEnvironmentUuid(uuid) {
  const scene = canvas?.scene;
  if (!game.user?.isGM || !scene || !uuid) return false;

  const actor = resolveEnvironmentActorUuid(uuid);
  if (!actor) {
    ui.notifications.warn(
      "Only a resolvable Environment Actor can be linked to the Scene."
    );
    return false;
  }

  const current = getEnvironmentLinks(scene);
  if (current.includes(String(uuid))) return false;

  const next = [...current, String(uuid)];

  try {
    await scene.setFlag(
      ENVIRONMENT_FLAG_NAMESPACE,
      ENVIRONMENT_FLAG_KEY,
      next
    );
    refreshInspector();
    return true;
  } catch (error) {
    console.error(
      "Cybermancy GM QOL | Failed to link Environment",
      uuid,
      error
    );
    ui.notifications.error("The Environment could not be linked to this Scene.");
    return false;
  }
}

async function unlinkEnvironmentUuid(uuid) {
  const scene = canvas?.scene;
  if (!game.user?.isGM || !scene || !uuid) return false;

  const current = getEnvironmentLinks(scene);
  const next = current.filter(entry => entry !== String(uuid));

  if (next.length === current.length) return false;

  try {
    if (next.length) {
      await scene.setFlag(
        ENVIRONMENT_FLAG_NAMESPACE,
        ENVIRONMENT_FLAG_KEY,
        next
      );
    } else {
      await scene.unsetFlag(
        ENVIRONMENT_FLAG_NAMESPACE,
        ENVIRONMENT_FLAG_KEY
      );
    }

    refreshInspector();
    return true;
  } catch (error) {
    console.error(
      "Cybermancy GM QOL | Failed to unlink Environment",
      uuid,
      error
    );
    ui.notifications.error("The Environment link could not be removed.");
    return false;
  }
}

function showLinkEnvironmentDialog() {
  if (!game.user?.isGM || !canvas?.scene) return;

  const linked = new Set(getEnvironmentLinks());
  const environments = [...(game.actors ?? [])]
    .filter(isEnvironmentActor)
    .sort((a, b) => String(a.name ?? "").localeCompare(String(b.name ?? "")));

  if (!environments.length) {
    ui.notifications.warn("No world Environment Actors are available to link.");
    return;
  }

  const options = environments.map(actor => `
    <option value="${escapeHtml(actor.uuid)}"
            ${linked.has(actor.uuid) ? "disabled" : ""}>
      ${escapeHtml(actor.name)}
      ${linked.has(actor.uuid) ? " — already linked" : ""}
    </option>
  `).join("");

  new Dialog({
    title: "Link Environment to Scene",
    content: `
      <form>
        <div class="form-group">
          <label>Environment</label>
          <select name="environmentUuid">
            ${options}
          </select>
        </div>
        <p class="notes">
          This writes only
          <code>flags.${ENVIRONMENT_FLAG_NAMESPACE}.${ENVIRONMENT_FLAG_KEY}</code>
          on the current Scene.
        </p>
      </form>
    `,
    buttons: {
      link: {
        icon: '<i class="fa-solid fa-link"></i>',
        label: "Link",
        callback: html => {
          const uuid =
            html?.find?.('[name="environmentUuid"]')?.val?.()
            ?? html?.[0]?.querySelector?.('[name="environmentUuid"]')?.value
            ?? html?.querySelector?.('[name="environmentUuid"]')?.value
            ?? null;

          if (uuid) linkEnvironmentUuid(uuid);
        }
      },
      cancel: {
        label: "Cancel"
      }
    },
    default: "link"
  }).render(true);
}
