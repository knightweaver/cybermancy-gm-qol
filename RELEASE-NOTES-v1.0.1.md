# Cybermancy GM QOL v1.0.1

Pre-migration clean-install baseline release for Cybermancy GM QOL.

## Compatibility

- Foundry VTT 13
- Daggerheart 1.2 through 1.9

The Foundry manifest intentionally uses major release numbers only:
minimum 13, verified 13, maximum 13.

The Daggerheart relationship records the supported range explicitly:
minimum 1.2, verified 1.9, maximum 1.9.

## Packaging baseline

This release adds the same clean-install release discipline used by the
Cybermancy and Edgeheart modules:

- a deterministic runtime ZIP containing only the files Foundry needs;
- a release-candidate GitHub Actions workflow;
- manifest validation before packaging;
- manual clean-install qualification of the exact candidate;
- qualification at both Daggerheart 1.2.x and 1.9.x range boundaries;
- a release-control gate before publication;
- byte-for-byte rebuild equivalence checking;
- publication of the exact manually qualified candidate;
- release assets consisting of the module ZIP, module.json, and SHA256SUMS.txt.

No Foundry 14 / Daggerheart 2.x migration changes are included in this baseline.
