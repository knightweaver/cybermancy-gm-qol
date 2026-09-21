/* -------------------------------------------- */
/*  Daggerheart Fear — Native                  */
/* -------------------------------------------- */

function getFearDescriptor() {
  try {
    const namespace = CONFIG?.DH?.id;
    const fearKey = CONFIG?.DH?.SETTINGS?.gameSettings?.Resources?.Fear;
    const homebrewKey = CONFIG?.DH?.SETTINGS?.gameSettings?.Homebrew;

    if (!namespace || !fearKey || !homebrewKey) {
      return {
        available: false,
        reason: "Daggerheart Fear configuration keys are unavailable.",
        namespace: namespace ?? null,
        fearKey: fearKey ?? null,
        homebrewKey: homebrewKey ?? null
      };
    }

    return {
      available: true,
      namespace,
      fearKey,
      homebrewKey,
      fearCompositeKey: `${namespace}.${fearKey}`,
      homebrewCompositeKey: `${namespace}.${homebrewKey}`
    };
  } catch (error) {
    return {
      available: false,
      reason: `Could not resolve Daggerheart Fear configuration: ${error.message}`
    };
  }
}

function getFearState() {
  const descriptor = getFearDescriptor();

  if (!descriptor.available) {
    return { ...descriptor, current: null, max: null };
  }

  try {
    const currentRaw = game.settings.get(
      descriptor.namespace,
      descriptor.fearKey
    );

    const homebrew = game.settings.get(
      descriptor.namespace,
      descriptor.homebrewKey
    );

    const maxRaw = homebrew?.maxFear;
    const current = Number(currentRaw);
    const max = Number(maxRaw);

    if (!Number.isFinite(current) || !Number.isFinite(max)) {
      return {
        ...descriptor,
        available: false,
        current: null,
        max: null,
        reason: `Daggerheart returned non-numeric Fear data (current=${String(currentRaw)}, max=${String(maxRaw)}).`
      };
    }

    return {
      ...descriptor,
      available: true,
      current,
      max,
      reason: null
    };
  } catch (error) {
    return {
      ...descriptor,
      available: false,
      current: null,
      max: null,
      reason: `Could not read Daggerheart Fear settings: ${error.message}`
    };
  }
}

function isFearRelatedSetting(setting) {
  const descriptor = getFearDescriptor();
  if (!descriptor.available) return false;

  const key = setting?.key;
  return key === descriptor.fearCompositeKey
    || key === descriptor.homebrewCompositeKey;
}

async function changeNativeFear(delta, reason = "GM Move") {
  if (!game.user?.isGM) {
    ui.notifications.warn("Only the GM can change Daggerheart Fear.");
    return false;
  }

  if (fearTransactionPending) return false;

  const fear = getFearState();
  if (!fear.available) {
    ui.notifications.warn("Native Daggerheart Fear is unavailable; no transaction was made.");
    return false;
  }

  const amount = Number(delta);
  if (!Number.isFinite(amount) || amount === 0) return true;

  const next = fear.current + amount;
  if (next < 0) {
    ui.notifications.warn(`Not enough Fear for ${reason}.`);
    return false;
  }

  // Refunds are clamped to Daggerheart's configured maximum.
  const bounded = Math.min(fear.max, next);

  try {
    fearTransactionPending = true;
    await game.settings.set(fear.namespace, fear.fearKey, bounded);

    if (amount > 0 && bounded < next) {
      ui.notifications.warn("Fear refund was capped at the configured maximum.");
    }

    return true;
  } catch (error) {
    console.error("Cybermancy GM QOL | Native Fear transaction failed", error);
    ui.notifications.error("Daggerheart Fear could not be updated. Combat state was not advanced.");
    return false;
  } finally {
    fearTransactionPending = false;
  }
}

async function gainQolFear() {
  if (
    nativeQolWritePending
    || actionTransactionPending
    || reactionTransactionPending
    || conditionTransactionPending
    || fearTransactionPending
  ) return false;

  const fear = getFearState();
  if (!fear.available) {
    ui.notifications.warn(
      "Native Daggerheart Fear is unavailable; no Fear was added."
    );
    return false;
  }

  if (fear.current >= fear.max) {
    return false;
  }

  try {
    nativeQolWritePending = true;
    return await changeNativeFear(1, "QOL Fear control");
  } finally {
    nativeQolWritePending = false;
    refreshInspector();
  }
}

async function spendQolFear() {
  if (
    nativeQolWritePending
    || actionTransactionPending
    || reactionTransactionPending
    || conditionTransactionPending
    || fearTransactionPending
  ) return false;

  const fear = getFearState();
  if (!fear.available) {
    ui.notifications.warn(
      "Native Daggerheart Fear is unavailable; no Fear was spent."
    );
    return false;
  }

  if (fear.current <= 0) {
    return false;
  }

  try {
    nativeQolWritePending = true;
    return await changeNativeFear(-1, "QOL manual Fear control");
  } finally {
    nativeQolWritePending = false;
    refreshInspector();
  }
}

async function spendNativeFear(amount, reason) {
  const value = Math.max(0, Number(amount) || 0);
  if (value === 0) return true;
  return changeNativeFear(-value, reason);
}

async function refundNativeFear(amount, reason) {
  const value = Math.max(0, Number(amount) || 0);
  if (value === 0) return true;
  return changeNativeFear(value, reason);
}
