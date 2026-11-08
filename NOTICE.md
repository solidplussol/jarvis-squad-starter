# Notice and credits

This repository is a sample that demonstrates [Squad](https://github.com/github/squad) and
Jarvis working together. It is licensed under the **GNU Affero General Public License v3.0**
(AGPL-3.0). The full text is in [LICENSE](./LICENSE).

## Jarvis (vendored, modified)

`vendor\jarvis` contains a **modified copy** of
[Prompt-Surfer/obsidian-jarvis-ui](https://github.com/Prompt-Surfer/obsidian-jarvis-ui)
(upstream tag `v2.20.6`, commit `0d2eca1ff19d896e0f558184416574ffcde4389c`), licensed
`AGPL-3.0-only`.

Original author: **Prompt-Surfer** (prompt-surfer@protonmail.com), as stated in the upstream
`package.json` and README. The upstream LICENSE is the unmodified GNU AGPL-3.0 text and names no
other copyright holder. All credit for the original work belongs to Prompt-Surfer.

The modifications made in this repository are listed in
[vendor\jarvis\MODIFICATIONS](./vendor/jarvis/MODIFICATIONS). Modified files carry upstream
attribution; the original licence is preserved in `vendor\jarvis\LICENSE`.

## Squad (not bundled)

[Squad](https://github.com/github/squad) is a separate tool. It is not bundled here and is
installed separately under its own licence (GitHub's licence metadata reports MIT; see the
repository's LICENSE for the authoritative terms). Squad was created by Brady Gaster
([bradygaster](https://github.com/bradygaster)), the original author, and was earlier hosted at
[bradygaster/squad](https://github.com/bradygaster/squad). All credit for the original work belongs
to him.

## Third-party content

Third-party content inside `vendor\jarvis` belongs to its respective owners. This includes:

- Community particle formations fetched from
  [particles.casberry.in](https://particles.casberry.in), which remain the work of their individual
  publishers (see `vendor\jarvis\src\shapes\casberry.ts`). That file also contains a public browser
  API key shipped in the site's own JavaScript, which belongs to that site.
- Screenshots and other media, which belong to their respective owners.

The concept illustration `docs\images\jarvis-squad-concept.png` was supplied by the repository owner.

## AGPL section 13 (network use)

If you run a modified version of this software and let users interact with it over a network,
AGPL section 13 requires you to offer those users the corresponding source. Publishing this
repository satisfies that for an unmodified deployment; if you modify it, you must offer your
modified source.

## Disclaimer

This sample is provided as-is, without warranty. This notice is not legal advice.
