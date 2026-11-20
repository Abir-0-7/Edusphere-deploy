# Academic cover draft storage and language gate

Updated 2026-11-19.

The refreshed templates share decorative shapes and colors across preview, PDF
and editable DOCX export. Reopening a saved draft uses the current template;
previously saved PDF artifacts preserve their exact original bytes.

Cover drafts, institution presets, and exported PDF copies are stored in the
current browser's IndexedDB. Every key is the pair `(ownerId, recordId)`, and
all reads, updates, listings, and deletions use both parts. This keeps browser
accounts separate on a shared device. It is local storage: records do not sync
to other devices and are not included in server account export/deletion. Drafts
and presets carry a schema version and monotonically increasing revision. The
vault retains at most 12 drafts, 20 presets, and 5 PDF copies per signed-in
account; each PDF copy is limited to 4 MiB. Oldest records are evicted only at
the matching account's cap.

## Bangla remains disabled

The cover PDF renderer is `pdf-lib` 1.17.1 with its standard Helvetica, Times,
and Courier fonts. Its installed README states these fonts use Windows-1252 and
do not cover all Unicode characters. `createCoverPdf` converts unsupported
glyph errors into a visible error and does not produce an export. The same
limitation is tested for the existing renderer. The PDF preview and download
share one measured layout, but that does not prove Bengali shaping: the
installed `pdf-lib` custom-font embedder's `widthOfTextAtSize` and `encodeText`
consume the glyphs returned by `font.layout` while PDF text drawing does not
preserve the shaped glyph positions. No embedded font plus PDF renderer has
been proven with Bengali conjuncts, reordering, and vowel marks in exported
files. Therefore Bangla PDF entry is intentionally unsupported and no Bangla
template is advertised as supported.

Before enabling Bengali, select a redistributable font with a reviewed license
and a renderer that preserves Bengali shaping in the actual exported PDF. Add
fixtures for conjuncts, vowel signs, punctuation, and mixed Latin/Bengali;
export and render them with Poppler and a second PDF viewer; inspect text
clipping and glyph order at both A4 and Letter sizes. A font embedding pass or
browser SVG preview alone is insufficient evidence.
