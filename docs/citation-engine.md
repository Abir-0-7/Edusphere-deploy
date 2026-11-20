# Citation engine and attribution (8.E05)

StudyVault uses Citation.js `0.9.0` with `@citation-js/plugin-csl`, `@citation-js/plugin-bibtex`, and `@citation-js/plugin-ris`, each pinned to `0.9.0`. The pnpm lock pins citeproc `2.4.63`. Runtime parsing is synchronous and local: DOI and URL imports do not trigger network requests, so metadata is never silently fetched or invented.

The CSL styles and locale are vendored from fixed upstream commits and SHA-256 checked before use:

| Asset | Upstream revision | SHA-256 | License and attribution |
| --- | --- | --- | --- |
| APA Style 7th edition | `citation-style-language/styles@e98c3b8a5371ad571abcf2192b75dfdd392243f/apa.csl` | `3917def5fc951b104d64216c3373096042368b9704ba269ca83c14ebaba889fc` | CC BY-SA 3.0; Brenton M. Wiernik, Andrew Dunning; contributor Jay Pfaffman |
| MLA Handbook 9th edition (in-text) | `citation-style-language/styles@e98c3b8a5371ad571abcf2192b75dfdd392243f/modern-language-association.csl` | `e1432698ef28938d044b06bd45ddcc57d6b974cec25f71007075646a11f99484` | CC BY-SA 3.0; Sebastian Karcher, Andrew Dunning; contributor Patrick O'Brien |
| IEEE Reference Guide (2023) | `citation-style-language/styles@e98c3b8a5371ad571abcf2192b75dfdd392243f/ieee.csl` | `b4c7619fc16c45a31e4cc3271eab94ffe83192d3b4c7fc729470a3b459448de3` | CC BY-SA 3.0; Michael Berkowitz and listed contributors |
| CSL English (US) locale | `citation-style-language/locales@21a175a1d84cc1792dd73f5a627de004fba5b207/locales-en-US.xml` | `ac864c7c21166b4390d82c31792cdc509400727fa0060b43d8aa17e07f9cb079` | CC BY-SA 3.0; translators listed in the source file |

Source files are available locally at `apps/web/public/csl/`; they include each style's original author and license metadata. The full [Creative Commons Attribution-ShareAlike 3.0 license](https://creativecommons.org/licenses/by-sa/3.0/legalcode) applies to CSL styles and locale.

`citeproc` is dual-licensed `CPAL-1.0 OR AGPL-1.0`. StudyVault elects the CPAL for this dependency. Its full license, package notice, and exact distributed processor source are shipped at `apps/web/public/licenses/CPAL-1.0.txt`, `citeproc-package-notice.txt`, and `citeproc-2.4.63.js`. The in-product formatter panel displays the required Frank Bennett / citeproc-js attribution at session use and links to the license and source. Citation.js and its format plugins are MIT-licensed; their license notices are shipped separately in the same `licenses/` directory.

The import boundary is 256 KiB and 50 records per batch. DOI, URL, and ISBN are normalized offline; ISBN checksum failures and unsafe URLs are omitted with a visible review warning. Exact DOI and ISBN matches and exact case-folded title matches are only duplicate candidates. Applying an import loads it into the editable form; an explicit save is required to create or revision-update a private record. Exports include BibTeX, RIS, and CSL-JSON. Golden format and import/export round-trip fixtures are in `apps/web/tests/citation-toolkit.test.ts`.
