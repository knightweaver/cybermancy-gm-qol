# Cybermancy GM QOL source modules

These files are maintenance/source modules. They intentionally share one
top-level lexical scope when compiled.

`tools/build-bundle.mjs` concatenates them in numeric order into
`scripts/bundle.js`.

Foundry loads only `scripts/main.js`, which imports the generated bundle.
This preserves the working single-ES-module runtime semantics while separating
the source by responsibility.

Do not add `import` or `export` statements to source fragments without changing
the build architecture.

`65-environment-actions.js` contains Environment GM Move transactions and never mutates adversary Spotlight counters.

`67-reactions.js` contains Reaction/non-Spotlight feature transactions. These use an independent reaction ledger and never consume GM Moves or adversary Spotlight.

`68-combat-state.js` reads native adversary HP/Stress/Armor/threshold/effect state and owns condition-clear orchestration. HP/Stress/Armor remain display-only.

`69-compatibility.js` formalizes explicit/native/sidecar/ambiguous/unknown metadata resolution, Spotlight-limit provenance, Scene compatibility reporting, and session-local diagnostics.

`68-writeback.js` owns v0.25 administrative native write-back. Fear gain, HP/Stress editing, and the three core Daggerheart condition toggles do not create GM Moves or consume Spotlight.

`52-pcs.js` owns current-Scene PC discovery for v0.26. PC write-back remains native and ledger-free.

v0.26.1 corrects the PC armor readout to native Armor Slots and adds session-local collapse state for the entire PCS section.

v0.26.2 adds PC-owned embedded Item refresh hooks because native character Armor Slot state may be changed through the equipped Armor Item without an updateActor hook firing.

v0.26.3 makes PC names use the existing `focus-token` exact-token selection/pan path already used by adversary token controls.

v1.0.0 canonical identity: module/package `cybermancy-gm-qol`, global API `game.cybermancyGMQOL`. The v0.x/RC module namespace and `game.cybermancyGMInspector` remain compatibility/migration aliases only.
