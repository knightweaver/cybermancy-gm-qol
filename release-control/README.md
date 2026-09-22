# Cybermancy GM QOL release control

A release-control JSON file is added only **after** the exact runtime candidate
has been manually qualified in clean Foundry installations.

For the v1.0.1 pre-migration baseline:

1. Let **Build Cybermancy GM QOL Release Candidate** build the exact runtime ZIP.
2. Download that exact workflow artifact.
3. Install the ZIP into a clean Foundry 13 instance running Daggerheart 1.2.x.
4. Confirm the module installs, activates, opens from Scene Controls, and exercises
   its core GM QOL functions without runtime errors.
5. Repeat the clean-install qualification with Daggerheart 1.9.x.
6. Record the workflow run ID, artifact name, ZIP SHA-256, exact Daggerheart
   versions tested, and qualification result in `release-control/v1.0.1.json`.
7. Committing that control file to `main` triggers
   **Publish Cybermancy GM QOL Release**.
8. The publish workflow rebuilds the package and requires it to be byte-identical
   to the manually qualified candidate, then publishes the exact qualified ZIP.

Manifest compatibility is intentionally:

- Foundry VTT: minimum 13, verified 13, maximum 13.
- Daggerheart: minimum 1.2, verified 1.9, maximum 1.9.

Foundry compatibility uses only the major release number. Daggerheart uses the
requested supported minor-version range because the compatibility boundary is
1.2 through 1.9.
