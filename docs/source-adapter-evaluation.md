# Phase 8.F07 source adapter evaluation

The first pass used synthetic learning material with a heading, indented
Python and a two-column table. The fixtures were written for this project. A
learner's permission to use other material requires its own declaration. The
findings below apply to the formats and fixtures sampled.

| Candidate | Offline result | Acceptance work remaining |
| --- | --- | --- |
| Pasted notes | Preserving lines and spaces kept the heading, code indentation and Markdown table. Collapsing whitespace lost the structure. | Verify the private-use declaration, UTF-8 byte cap, stable line locators and cancellation at the actual save boundary. |
| Plain text file | Strict UTF-8 decoding accepted a BOM and preserved line numbering after CRLF normalization. Malformed UTF-8 and embedded NUL were rejected. The source bytes and normalized text had distinct hashes. | Verify bounded streaming, type detection, cancellation and zero partial persistence in the upload flow. |
| EPUB | A small offline EPUB followed its spine order even with the archive members and manifest in reverse order. Extracting code blocks and table cells separately preserved indentation and cell boundaries. The probe reported an unsupported spine item, rejected the wrong media type and over-limit members, and returned no result after cancellation before the second chapter. | Verify archive and XML handling against malformed input, content rights, uncertain or omitted content and cancellation in the actual worker. Use the [EPUB 3.3 spine specification](https://www.w3.org/TR/epub-33/#sec-spine-elem) to define the reading order. |
| Web page | An offline HTML sample preserved code and table cells when extracted by structure. The probe identified an omitted image and a spanning table cell, excluded script text, rejected an oversized or wrong-type response, and aborted without a partial result during parsing. | Verify the allowed origins and material, measured quality on representative pages, bounded transport, redirects and cancellation before enabling URL input. See [HTTP Semantics on representation media type](https://www.rfc-editor.org/rfc/rfc9110.html#name-content-type) and [redirects](https://www.rfc-editor.org/rfc/rfc9110.html#name-redirection-3xx). |

The PDF and GitHub baseline passed 333 fixture tests, in addition to two PDF
cancellation tests. Seven disposable PostgreSQL cases passed. Two real OCR
tests skipped because Tesseract was unavailable, and two database lock tests
were excluded after a local lock wait stalled. An in-memory PDF example lost
Python indentation and flattened a ruled table. GitHub kept the equivalent
indentation and Markdown table markers as text. The GitHub fixture also
verified commit and line locators, notebook cells and cancellation without a
partial snapshot. These results establish a fixture baseline for measuring new
adapters against representative course material.

The subsequent per-adapter application acceptance is recorded in [local-text-sources.md](local-text-sources.md).
This table preserves the initial offline evaluation and its then-pending checks. The offline EPUB
and HTML probes used small test limits to exercise their rejection branches.
The task keeps original retention and arbitrary crawling outside its scope.
