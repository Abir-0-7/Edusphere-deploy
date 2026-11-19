# Whiteboard renderer gate (Phase 8.E06)

## Decision

Do not ship the existing tldraw 5.6.0 SDK integration into production under the development-only terms. tldraw currently requires a valid production SDK key; its official license docs distinguish commercial and discretionary noncommercial hobby use, and the editor disables itself when no valid key is present. A commercial key adds a paid dependency, so StudyVault's free-tier rule rules out this renderer absent an explicit product/business decision and license approval.

Choose the exact `@excalidraw/excalidraw@0.18.1` renderer for E07 implementation. Its versioned package manifest is MIT-licensed and supports the current React 19 peer range. Version 0.18.1 includes the upstream Mermaid XSS security fix; do not pin the earlier 0.18.0 release. Record all dependency licenses when installation is part of E07. No renderer code is changed in this gate task.

The future E07 implementation must bundle required production fonts and their
license notices locally rather than fetching them from a CDN. No Excalidraw
editor code, fonts, server routes or production migration is included in E06.

Excalidraw's host integration provides persistence callbacks, but does not include collaboration; multi-tab coordination, server revisions and recovery remain StudyVault responsibilities.

## App-owned snapshot contract

E07 stores scene snapshots in a versioned StudyVault envelope, never as trusted renderer-native blobs:

```json
{
  "format": "studyvault-whiteboard",
  "schema_version": 1,
  "board_id": "uuid",
  "title": "string",
  "revision": 1,
  "updated_at": "RFC3339 timestamp",
  "renderer": { "id": "excalidraw", "version": "0.18.1" },
  "scene": {
    "elements": [],
    "app_state": {},
    "file_ids": []
  }
}
```

Authenticated owner identity is stored and checked outside this client-controlled JSON, in the scoped record/query and storage key. A payload-supplied owner never grants access. Scene decoding uses a strict Zod boundary and then Excalidraw's documented restore helpers; restore helpers handle renderer schema/defaults, not ownership or asset safety.

For initial migration, cap the serialized envelope at 5 MiB, the scene at 10,000 elements, the allowed JSON nesting at 32 levels, and each string at 100 KiB. Reject prototype keys, unrecognized top-level fields, unsupported renderer/version pairs, broken element references, and embedded or external content URLs. PNG/JPEG/WebP assets are stored separately behind opaque per-owner IDs: sniff bytes (never trust the MIME header), cap each image at 10 MiB and each board at 50 MiB, validate SHA-256, disallow remote fetches, and hydrate only those authorized files immediately before rendering. Revisit limits against real usage data in E07.

## Legacy migration fixtures

Fixtures in `apps/web/tests/fixtures/whiteboard/` capture the current tldraw 5.6.0 output shape (`getSnapshot(editor.store)` returns `{ document, session }`), existing manual `studyvault:whiteboard:v2:<encoded Clerk owner>` data, built-in persistence-key behavior, native shapes, assets, malformed and oversized JSON, unsupported custom shapes, and unscoped shared legacy keys. Migration must retain original bytes for recovery, never read legacy data without an owner-scoped key, and report non-migratable shapes/assets for legacy export instead of silently discarding them. Feature acceptance for the Excalidraw editor itself belongs to the following board-ownership task.

## Sources

- tldraw [license](https://tldraw.dev/community/license) and [production SDK license key behavior](https://tldraw.dev/sdk-features/license-key).
- Excalidraw 0.18.1 [package manifest](https://github.com/excalidraw/excalidraw/blob/v0.18.1/packages/excalidraw/package.json), [release notes/security fix](https://github.com/excalidraw/excalidraw/releases/tag/v0.18.1), [host props/persistence API](https://github.com/excalidraw/excalidraw/blob/v0.18.1/dev-docs/docs/%40excalidraw/excalidraw/api/props/props.mdx), [restore implementation](https://github.com/excalidraw/excalidraw/blob/v0.18.1/packages/excalidraw/data/restore.ts), and [collaboration FAQ](https://docs.excalidraw.com/docs/%40excalidraw/excalidraw/faq).
