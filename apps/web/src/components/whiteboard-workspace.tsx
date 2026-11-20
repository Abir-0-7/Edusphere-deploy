'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import '@excalidraw/excalidraw/index.css';
import type {
  BinaryFiles,
  DataURL,
  ExcalidrawImperativeAPI,
  ExcalidrawInitialDataState,
  ExcalidrawProps,
} from '@excalidraw/excalidraw/types';
import type { FileId } from '@excalidraw/excalidraw/element/types';
import type { BoardLearningResponse } from '@studyvault/types';
import Dexie, { type Table } from 'dexie';
import { BoardLearningPreview, type BoardGraphHandoff } from '@/components/board-learning-preview';
import {
  WhiteboardSelectionLearning,
  type BoardLearningScope,
} from '@/components/whiteboard-selection-learning';
import { authFetch, type GetToken } from '@/lib/ai-client';
import { loadLocalBoard } from '@/lib/local-boards';
import {
  boardExportName,
  boardRegion,
  renderBoardExport,
  type BoardExportFormat,
  type BoardScope,
} from '@/lib/whiteboard-export';
import {
  WHITEBOARD_SNAPSHOT_LIMITS,
  WhiteboardAssetManifestSchema,
  WhiteboardSnapshotSchema,
  WhiteboardCreateRequestSchema,
  WhiteboardUpdateRequestSchema,
  WhiteboardListResponseSchema,
  WhiteboardAssetListResponseSchema,
  WhiteboardAssetUploadSchema,
  parseWhiteboardSnapshot,
  validateWhiteboardAssets,
  type WhiteboardAssetManifest,
  type WhiteboardSnapshot,
} from '@/lib/whiteboard-contract';

type ExcalidrawModule = typeof import('@excalidraw/excalidraw');
type Scene = WhiteboardSnapshot['scene'];
type ExcalidrawInitial = ExcalidrawInitialDataState;

type LocalBoard = {
  ownerId: string;
  boardId: string;
  title: string;
  snapshot: WhiteboardSnapshot;
  revision: number;
  localRevision: number;
  updatedAt: string;
  remoteKnown: boolean;
};

type LocalAsset = {
  ownerId: string;
  boardId: string;
  fileId: string;
  assetId: string;
  mimeType: string;
  blob: Blob;
  sha256: string;
  remoteKnown: boolean;
  updatedAt: string;
};
type LocalDraft = {
  ownerId: string;
  boardId: string;
  tabId: string;
  snapshot: WhiteboardSnapshot;
  baseRevision: number;
  remoteKnown: boolean;
  editId: string;
};
type WorkspaceBoot = {
  snapshot: WhiteboardSnapshot;
  files: BinaryFiles;
  manifests: WhiteboardAssetManifest[];
  remoteKnown: boolean;
};

class WhiteboardCache extends Dexie {
  boards!: Table<LocalBoard, [string, string]>;
  assets!: Table<LocalAsset, [string, string, string]>;
  drafts!: Table<LocalDraft, [string, string, string]>;

  constructor() {
    super('studyvault-whiteboard-cache-v1');
    this.version(1).stores({
      boards: '[ownerId+boardId], ownerId, updatedAt',
      assets: '[ownerId+boardId+fileId], [ownerId+boardId], updatedAt',
    });
    this.version(2).stores({ drafts: '[ownerId+boardId+tabId], [ownerId+tabId], ownerId' });
  }
}

const localCache = new WhiteboardCache();
const defaultScene: Scene = { elements: [], app_state: {}, file_ids: [] };
const defaultEnvelope = (boardId: string, title: string): WhiteboardSnapshot => ({
  format: 'studyvault-whiteboard',
  schema_version: 1,
  board_id: boardId,
  title,
  revision: 1,
  updated_at: new Date().toISOString(),
  renderer: { id: 'excalidraw', version: '0.18.1' },
  scene: defaultScene,
});

async function readJson<T>(
  response: Response,
  schema: { parse(value: unknown): T },
  operation: string,
): Promise<T> {
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new Error(`${operation} returned invalid JSON (${response.status}).`);
  }
  if (!response.ok) {
    const message =
      body &&
      typeof body === 'object' &&
      'error' in body &&
      body.error &&
      typeof body.error === 'object' &&
      'message' in body.error &&
      typeof body.error.message === 'string'
        ? body.error.message
        : `${operation} failed (${response.status}).`;
    const error = new Error(message) as Error & { status?: number; body?: unknown };
    error.status = response.status;
    error.body = body;
    throw error;
  }
  try {
    return schema.parse(body);
  } catch {
    throw new Error(`${operation} returned an invalid response.`);
  }
}

function dataUrlToBlob(dataUrl: string, mimeType: string): Blob {
  if (dataUrl.length > Math.ceil(WHITEBOARD_SNAPSHOT_LIMITS.singleFileBytes * 1.4)) {
    throw new Error('An image is larger than the 10 MiB limit.');
  }
  if (!/^data:image\/(?:png|jpeg|webp);base64,/i.test(dataUrl)) {
    throw new Error('Only PNG, JPEG and WebP whiteboard images are supported.');
  }
  const actualMime = dataUrl.slice(5, dataUrl.indexOf(';')).toLowerCase();
  if (actualMime !== mimeType.toLowerCase())
    throw new Error('Image type metadata does not match its content.');
  const decoded = atob(dataUrl.slice(dataUrl.indexOf(',') + 1));
  if (!decoded.length || decoded.length > WHITEBOARD_SNAPSHOT_LIMITS.singleFileBytes) {
    throw new Error('An image must be between 1 byte and 10 MiB.');
  }
  const bytes = new Uint8Array(decoded.length);
  for (let index = 0; index < decoded.length; index += 1) bytes[index] = decoded.charCodeAt(index);
  return new Blob([bytes], { type: actualMime });
}

async function sha256(blob: Blob): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function base64FromBlob(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Could not read this board image.'));
    reader.onload = () => {
      if (typeof reader.result !== 'string') reject(new Error('Could not encode this board image.'));
      else resolve(reader.result.slice(reader.result.indexOf(',') + 1));
    };
    reader.readAsDataURL(blob);
  });
}

async function blobToDataUrl(blob: Blob): Promise<string> {
  return `data:${blob.type};base64,${await base64FromBlob(blob)}`;
}

async function toScene(
  elements: readonly unknown[] | null | undefined,
  appState: unknown,
  files: BinaryFiles,
): Promise<{ scene: Scene; blobs: Map<string, Blob> }> {
  // Renderer objects contain optional undefined properties; the wire contract accepts JSON only.
  const typedElements = JSON.parse(JSON.stringify(elements ?? [])) as Scene['elements'];
  const imageElements = typedElements.filter(
    (element) => element.type === 'image' && typeof element.fileId === 'string',
  );
  const fileIds = [...new Set(imageElements.map((element) => String(element.fileId)))];
  const blobs = new Map<string, Blob>();
  for (const fileId of fileIds) {
    const file = files[fileId];
    if (!file || typeof file.dataURL !== 'string' || typeof file.mimeType !== 'string') {
      throw new Error(`Board image ${fileId} is unavailable; save stopped to protect the scene.`);
    }
    blobs.set(fileId, dataUrlToBlob(file.dataURL, file.mimeType));
  }
  const state = appState && typeof appState === 'object' ? (appState as Record<string, unknown>) : {};
  const safeAppState: Scene['app_state'] = {
    ...(typeof state.viewBackgroundColor === 'string'
      ? { viewBackgroundColor: state.viewBackgroundColor }
      : {}),
    ...(typeof state.gridSize === 'number' || state.gridSize === null ? { gridSize: state.gridSize } : {}),
    ...(state.zoom &&
    typeof state.zoom === 'object' &&
    'value' in state.zoom &&
    typeof state.zoom.value === 'number'
      ? { zoom: state.zoom.value }
      : {}),
    ...(typeof state.scrollX === 'number' ? { scrollX: state.scrollX } : {}),
    ...(typeof state.scrollY === 'number' ? { scrollY: state.scrollY } : {}),
  };
  return { scene: { elements: typedElements, app_state: safeAppState, file_ids: fileIds }, blobs };
}

async function hydrateFiles(
  ownerId: string,
  boardId: string,
  scene: Scene,
  manifests: WhiteboardAssetManifest[],
  getToken: GetToken,
): Promise<BinaryFiles> {
  const valid = validateWhiteboardAssets(
    scene.file_ids,
    manifests.filter((asset) => scene.file_ids.includes(asset.file_id)),
  );
  const files: BinaryFiles = {};
  for (const manifest of valid) {
    let blob = await localCache.assets.get([ownerId, boardId, manifest.file_id]).then((row) => row?.blob);
    if (!blob || (await sha256(blob)) !== manifest.sha256) {
      const response = await authFetch(
        getToken,
        `/api/whiteboards/${encodeURIComponent(boardId)}/assets/${encodeURIComponent(manifest.id)}/content`,
      );
      if (!response.ok)
        throw new Error(`Could not load an authorized whiteboard image (${response.status}).`);
      blob = await response.blob();
      if (
        blob.size !== manifest.size_bytes ||
        blob.type !== manifest.mime_type ||
        (await sha256(blob)) !== manifest.sha256
      ) {
        throw new Error('A whiteboard image did not match its verified manifest.');
      }
      await localCache.assets.put({
        ownerId,
        boardId,
        fileId: manifest.file_id,
        assetId: manifest.id,
        mimeType: blob.type,
        blob,
        sha256: manifest.sha256,
        remoteKnown: true,
        updatedAt: new Date().toISOString(),
      });
    }
    files[manifest.file_id] = {
      id: manifest.file_id as FileId,
      dataURL: (await blobToDataUrl(blob)) as DataURL,
      mimeType: manifest.mime_type,
      created: Date.now(),
      lastRetrieved: Date.now(),
    };
  }
  return files;
}

/** Each tab keeps its own unsynced draft; a remote save cannot erase another tab's work. */
export function WhiteboardWorkspace(props: {
  ownerId: string;
  getToken: GetToken;
  handoff?: BoardGraphHandoff | null;
}) {
  return <OwnedWhiteboard key={props.ownerId} {...props} />;
}

function OwnedWhiteboard({
  ownerId,
  getToken,
  handoff,
}: {
  ownerId: string;
  getToken: GetToken;
  handoff?: BoardGraphHandoff | null;
}) {
  const [module, setModule] = useState<ExcalidrawModule | null>(null);
  const [boot, setBoot] = useState<WorkspaceBoot | null>(null);
  const [api, setApi] = useState<ExcalidrawImperativeAPI | null>(null);
  const [projects, setProjects] = useState<WhiteboardSnapshot[]>([]);
  const [title, setTitle] = useState('Study board');
  const [status, setStatus] = useState('Loading your boards.');
  const [error, setError] = useState('');
  const [conflict, setConflict] = useState(false);
  const [saving, setSaving] = useState(false);
  const [switching, setSwitching] = useState(false);
  const [legacy, setLegacy] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [exportScope, setExportScope] = useState<BoardScope>('full');
  const [exportFormat, setExportFormat] = useState<BoardExportFormat>('png');
  const [exporting, setExporting] = useState(false);
  const [exportFeedback, setExportFeedback] = useState('');
  const mounted = useRef(true);
  const active = useRef<LocalDraft | null>(null);
  const sceneEpoch = useRef(0);
  const tokenReader = useRef(getToken);
  tokenReader.current = getToken;
  const tabId = useRef('');
  const editor = useRef<ExcalidrawImperativeAPI | null>(null);
  const workspace = useRef<HTMLElement | null>(null);
  const canvasHost = useRef<HTMLDivElement | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const busy = useRef(false);
  const blocked = useRef(false);
  const dirty = useRef(false);
  const localWrites = useRef<Promise<void>>(Promise.resolve());
  const lastScene = useRef('');
  const doSave = useRef<() => Promise<void>>(async () => {});
  const titleRef = useRef(title);
  titleRef.current = title;

  useEffect(() => {
    const host = canvasHost.current;
    const section = workspace.current;
    if (!api || !host || !section) return;
    let frame = 0;
    const refreshOffsets = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        const bounds = host.getBoundingClientRect();
        const state = api.getAppState();
        if (state.offsetLeft !== bounds.left || state.offsetTop !== bounds.top) api.refresh();
      });
    };
    // Excalidraw observes its own size. Expanding a panel above it changes only
    // its position, so refresh the renderer's pointer coordinates after layout.
    const observer = new ResizeObserver(refreshOffsets);
    observer.observe(section);
    observer.observe(document.body);
    section.addEventListener('toggle', refreshOffsets, true);
    window.addEventListener('scroll', refreshOffsets, true);
    window.addEventListener('resize', refreshOffsets);
    refreshOffsets();
    return () => {
      observer.disconnect();
      section.removeEventListener('toggle', refreshOffsets, true);
      window.removeEventListener('scroll', refreshOffsets, true);
      window.removeEventListener('resize', refreshOffsets);
      cancelAnimationFrame(frame);
    };
  }, [api]);

  const request = useCallback(async (path: string, init: RequestInit = {}) => {
    const token = await tokenReader.current();
    if (!mounted.current) throw new Error('This whiteboard account is no longer active.');
    return authFetch(async () => token, path, init);
  }, []);

  const report = useCallback((cause: unknown) => {
    if (mounted.current) setError(cause instanceof Error ? cause.message : 'Could not save this board.');
  }, []);

  const readLocalAssets = useCallback(
    async (snapshot: WhiteboardSnapshot) => {
      const rows = await localCache.assets
        .where('[ownerId+boardId]')
        .equals([ownerId, snapshot.board_id])
        .toArray();
      return rows
        .filter((asset) => snapshot.scene.file_ids.includes(asset.fileId))
        .map((asset) => ({
          id: asset.assetId,
          file_id: asset.fileId,
          mime_type: asset.mimeType as WhiteboardAssetManifest['mime_type'],
          size_bytes: asset.blob.size,
          sha256: asset.sha256,
        }));
    },
    [ownerId],
  );

  const rememberDraft = useCallback(
    async (draft: LocalDraft, blobs?: Map<string, Blob>) => {
      if (
        [...(blobs?.values() ?? [])].reduce((total, blob) => total + blob.size, 0) >
        WHITEBOARD_SNAPSHOT_LIMITS.boardFilesBytes
      ) {
        throw new Error('Board image storage is limited to 50 MiB.');
      }
      const assets: LocalAsset[] = [];
      for (const [fileId, blob] of blobs ?? []) {
        assets.push({
          ownerId,
          boardId: draft.boardId,
          fileId,
          assetId: crypto.randomUUID(),
          mimeType: blob.type,
          blob,
          sha256: await sha256(blob),
          remoteKnown: false,
          updatedAt: draft.snapshot.updated_at,
        });
      }
      await localCache.transaction(
        'rw',
        localCache.boards,
        localCache.drafts,
        localCache.assets,
        async () => {
          await localCache.drafts.put(draft);
          if (assets.length) await localCache.assets.bulkPut(assets);
          if (!draft.remoteKnown)
            await localCache.boards.put({
              ownerId,
              boardId: draft.boardId,
              title: draft.snapshot.title,
              snapshot: draft.snapshot,
              revision: draft.baseRevision,
              localRevision: draft.baseRevision + 1,
              updatedAt: draft.snapshot.updated_at,
              remoteKnown: false,
            });
        },
      );
    },
    [ownerId],
  );

  const capture = useCallback(() => {
    const current = active.current;
    const canvas = editor.current;
    if (!current || !canvas) return localWrites.current;
    const elements = canvas.getSceneElementsIncludingDeleted();
    const appState = canvas.getAppState();
    const files = canvas.getFiles();
    const name = titleRef.current.trim() || 'Study board';
    const epoch = sceneEpoch.current;
    // Capture arguments now; writes are ordered even when hashing images is asynchronous.
    const work = localWrites.current.catch(report).then(async () => {
      const { scene, blobs } = await toScene(elements, appState, files);
      // A queued save may have advanced the server revision or assigned the final board ID.
      const latest = sceneEpoch.current === epoch ? (active.current ?? current) : current;
      const snapshot = parseWhiteboardSnapshot({
        ...latest.snapshot,
        title: name,
        scene,
        updated_at: new Date().toISOString(),
      });
      const draft = { ...latest, snapshot, editId: crypto.randomUUID() };
      await rememberDraft(draft, blobs);
      if (sceneEpoch.current === epoch && mounted.current) {
        active.current = draft;
        dirty.current = true;
      }
    });
    localWrites.current = work;
    void work.catch(report);
    return work;
  }, [rememberDraft, report]);

  const schedule = useCallback(() => {
    dirty.current = true;
    if (!blocked.current) setStatus('Saving changes on this device.');
    void capture();
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      void doSave.current();
    }, 800);
  }, [capture]);

  const openBoard = useCallback(
    async (snapshot: WhiteboardSnapshot, remoteKnown: boolean, useDraft = true) => {
      const draft = useDraft
        ? await localCache.drafts.get([ownerId, snapshot.board_id, tabId.current])
        : undefined;
      const chosen = draft?.snapshot ?? snapshot;
      let manifests = await readLocalAssets(chosen);
      if (remoteKnown && navigator.onLine) {
        const response = await request('/api/whiteboards/' + snapshot.board_id + '/assets');
        const remote = (await readJson(response, WhiteboardAssetListResponseSchema, 'Load board images'))
          .assets;
        const byFile = new Map(remote.map((item) => [item.file_id, item]));
        for (const local of manifests) if (!byFile.has(local.file_id)) byFile.set(local.file_id, local);
        manifests = chosen.scene.file_ids.flatMap((fileId) =>
          byFile.has(fileId) ? [byFile.get(fileId)!] : [],
        );
      }
      const files = await hydrateFiles(ownerId, snapshot.board_id, chosen.scene, manifests, async () => {
        const token = await tokenReader.current();
        if (!mounted.current) throw new Error('This whiteboard account is no longer active.');
        return token;
      });
      if (!mounted.current) return;
      sceneEpoch.current += 1;
      active.current = draft ?? {
        ownerId,
        boardId: chosen.board_id,
        tabId: tabId.current,
        snapshot: chosen,
        baseRevision: snapshot.revision,
        remoteKnown,
        editId: '',
      };
      dirty.current = !!draft || !remoteKnown;
      blocked.current = !!draft && draft.remoteKnown && draft.baseRevision !== snapshot.revision;
      setConflict(blocked.current);
      setTitle(chosen.title);
      titleRef.current = chosen.title;
      editor.current = null;
      setApi(null);
      setSelectedIds([]);
      setExportFeedback('');
      lastScene.current = '';
      setBoot({ snapshot: chosen, files, manifests, remoteKnown });
      sessionStorage.setItem('studyvault-board-selected:' + ownerId, chosen.board_id);
      setStatus(
        blocked.current
          ? 'Changed elsewhere. Your local draft is preserved.'
          : dirty.current
            ? 'Unsynced local edits restored.'
            : 'Saved to your account.',
      );
    },
    [ownerId, readLocalAssets, request],
  );

  useEffect(() => {
    mounted.current = true;
    let cancelled = false;
    let releaseTabLock: (() => void) | undefined;
    const bootWorkspace = async () => {
      setLegacy(loadLocalBoard(ownerId));
      const key = 'studyvault-board-tab:' + ownerId;
      tabId.current = sessionStorage.getItem(key) ?? crypto.randomUUID();
      if (!navigator.locks)
        throw new Error('Board recovery requires a current browser with secure storage support.');
      // Duplicate Tab copies sessionStorage. A live browser lock makes the copied ID detectable.
      const claim = (id: string) =>
        new Promise<boolean>((resolve, reject) => {
          void navigator.locks
            .request('studyvault-board-tab:' + ownerId + ':' + id, { ifAvailable: true }, (lock) => {
              if (!lock || cancelled) {
                resolve(false);
                return;
              }
              return new Promise<void>((release) => {
                releaseTabLock = release;
                resolve(true);
              });
            })
            .catch(reject);
        });
      if (!(await claim(tabId.current))) {
        if (cancelled) return;
        tabId.current = crypto.randomUUID();
        if (!(await claim(tabId.current)))
          throw new Error('Could not open a separate recovery copy for this tab.');
      }
      sessionStorage.setItem(key, tabId.current);
      const local = await localCache.boards.where('ownerId').equals(ownerId).toArray();
      let items = local.map((row) => row.snapshot);
      let remoteIds = new Set(local.filter((row) => row.remoteKnown).map((row) => row.boardId));
      if (navigator.onLine) {
        try {
          const result = await readJson(
            await request('/api/whiteboards?limit=100&offset=0'),
            WhiteboardListResponseSchema,
            'Load whiteboards',
          );
          remoteIds = new Set(result.items.map((item) => item.board_id));
          items = [...result.items, ...local.filter((row) => !row.remoteKnown).map((row) => row.snapshot)];
          await localCache.boards.bulkPut(
            result.items.map((snapshot) => ({
              ownerId,
              boardId: snapshot.board_id,
              title: snapshot.title,
              snapshot,
              revision: snapshot.revision,
              localRevision: snapshot.revision,
              updatedAt: snapshot.updated_at,
              remoteKnown: true,
            })),
          );
        } catch (cause) {
          if (
            cause &&
            typeof cause === 'object' &&
            'status' in cause &&
            [401, 403].includes(Number(cause.status))
          )
            throw cause;
          if (!items.length) throw cause;
          if (!cancelled) report(cause);
        }
      }
      if (cancelled) return;
      const selected = sessionStorage.getItem('studyvault-board-selected:' + ownerId);
      const chosen = items.find((item) => item.board_id === selected) ?? items[0];
      if (chosen) {
        setProjects(items);
        await openBoard(chosen, remoteIds.has(chosen.board_id));
      } else {
        const snapshot = defaultEnvelope(crypto.randomUUID(), 'Study board');
        const draft = {
          ownerId,
          boardId: snapshot.board_id,
          tabId: tabId.current,
          snapshot,
          baseRevision: 1,
          remoteKnown: false,
          editId: crypto.randomUUID(),
        };
        await rememberDraft(draft);
        setProjects([snapshot]);
        await openBoard(snapshot, false);
      }
    };
    (window as Window & { EXCALIDRAW_ASSET_PATH?: string }).EXCALIDRAW_ASSET_PATH = '/whiteboard/';
    void import('@excalidraw/excalidraw')
      .then((loaded) => {
        if (!cancelled) setModule(loaded);
      })
      .catch(report);
    void bootWorkspace().catch(report);
    return () => {
      cancelled = true;
      mounted.current = false;
      releaseTabLock?.();
      if (timer.current) clearTimeout(timer.current);
    };
  }, [openBoard, ownerId, rememberDraft, report, request]);

  const saveCurrent = useCallback(async () => {
    if (!active.current || !editor.current || busy.current || blocked.current || !dirty.current) return;
    // A manual save consumes the queued autosave too. An unchanged second save
    // would create a new revision and invalidate an otherwise current preview.
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    busy.current = true;
    setSaving(true);
    setError('');
    try {
      await capture();
      let draft = active.current!;
      let target = draft.boardId;
      let revision = draft.baseRevision;
      const pinnedToken = await tokenReader.current();
      if (!mounted.current) return;
      const send = (path: string, init?: RequestInit) => {
        if (!mounted.current) throw new Error('This whiteboard account is no longer active.');
        return authFetch(async () => pinnedToken, path, init);
      };
      if (!navigator.onLine) {
        setStatus('Saved on this device. Waiting to sync.');
        return;
      }
      if (!draft.remoteKnown) {
        const created = await readJson(
          await send('/api/whiteboards', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(
              WhiteboardCreateRequestSchema.parse({ title: draft.snapshot.title, scene: defaultScene }),
            ),
          }),
          WhiteboardSnapshotSchema,
          'Create board',
        );
        target = created.board_id;
        revision = created.revision;
        const remap = localWrites.current.catch(report).then(async () => {
          const latest = active.current!;
          draft = {
            ...latest,
            boardId: target,
            remoteKnown: true,
            baseRevision: revision,
            snapshot: { ...latest.snapshot, board_id: target, revision },
          };
          await localCache.transaction(
            'rw',
            localCache.boards,
            localCache.drafts,
            localCache.assets,
            async () => {
              const rows = await localCache.assets
                .where('[ownerId+boardId]')
                .equals([ownerId, latest.boardId])
                .toArray();
              if (rows.length)
                await localCache.assets.bulkPut(rows.map((row) => ({ ...row, boardId: target })));
              await localCache.assets.where('[ownerId+boardId]').equals([ownerId, latest.boardId]).delete();
              await localCache.drafts.delete([ownerId, latest.boardId, tabId.current]);
              await localCache.drafts.put(draft);
              await localCache.boards.delete([ownerId, latest.boardId]);
              await localCache.boards.put({
                ownerId,
                boardId: target,
                title: draft.snapshot.title,
                snapshot: draft.snapshot,
                revision,
                localRevision: revision + 1,
                updatedAt: draft.snapshot.updated_at,
                remoteKnown: true,
              });
            },
          );
          active.current = draft;
        });
        localWrites.current = remap;
        await remap;
        sessionStorage.setItem('studyvault-board-selected:' + ownerId, target);
      }
      const files = await localCache.assets.where('[ownerId+boardId]').equals([ownerId, target]).toArray();
      for (const fileId of draft.snapshot.scene.file_ids) {
        const asset = files.find((row) => row.fileId === fileId);
        if (!asset) throw new Error('A board image is missing. Your draft is preserved.');
        await readJson(
          await send('/api/whiteboards/' + target + '/assets', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(
              WhiteboardAssetUploadSchema.parse({
                file_id: fileId,
                mime_type: asset.mimeType,
                data_base64: await base64FromBlob(asset.blob),
              }),
            ),
          }),
          WhiteboardAssetManifestSchema,
          'Save board image',
        );
      }
      const saved = await readJson(
        await send('/api/whiteboards/' + target, {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(
            WhiteboardUpdateRequestSchema.parse({
              title: draft.snapshot.title,
              scene: draft.snapshot.scene,
              expected_revision: revision,
            }),
          ),
        }),
        WhiteboardSnapshotSchema,
        'Save board',
      );
      let hasNewEdits = false;
      // Finalization shares the same queue as captures: no new draft can be erased in a DB await gap.
      const finalize = localWrites.current.catch(report).then(async () => {
        const latest = active.current!;
        hasNewEdits = latest.editId !== draft.editId;
        const next = {
          ...latest,
          baseRevision: saved.revision,
          remoteKnown: true,
          snapshot: { ...latest.snapshot, revision: saved.revision },
        };
        await localCache.transaction('rw', localCache.boards, localCache.drafts, async () => {
          await localCache.boards.put({
            ownerId,
            boardId: target,
            title: saved.title,
            snapshot: saved,
            revision: saved.revision,
            localRevision: saved.revision,
            updatedAt: saved.updated_at,
            remoteKnown: true,
          });
          if (hasNewEdits) await localCache.drafts.put(next);
          else await localCache.drafts.delete([ownerId, target, tabId.current]);
        });
        active.current = next;
        dirty.current = hasNewEdits;
      });
      localWrites.current = finalize;
      await finalize;
      if (!mounted.current) return;
      setProjects((items) => [
        saved,
        ...items.filter(
          (item) =>
            item.board_id !== draft.boardId &&
            item.board_id !== target &&
            item.board_id !== boot?.snapshot.board_id,
        ),
      ]);
      setStatus(
        hasNewEdits ? 'Newer edits saved locally. Syncing next.' : 'Saved. Revision ' + saved.revision + '.',
      );
      if (hasNewEdits)
        timer.current = setTimeout(() => {
          void doSave.current();
        }, 300);
    } catch (cause) {
      if (!mounted.current) return;
      if (cause && typeof cause === 'object' && 'status' in cause && cause.status === 409) {
        blocked.current = true;
        setConflict(true);
        setStatus('Conflict. Your local edits are safe on this device.');
      } else setStatus('Sync failed. Local recovery is available if the device save succeeded.');
      report(cause);
    } finally {
      busy.current = false;
      if (mounted.current) setSaving(false);
    }
  }, [boot?.snapshot.board_id, capture, ownerId, report]);
  doSave.current = saveCurrent;

  useEffect(() => {
    const online = () => {
      if (dirty.current) void doSave.current();
    };
    window.addEventListener('online', online);
    const unload = (event: BeforeUnloadEvent) => {
      if (dirty.current) {
        event.preventDefault();
        event.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', unload);
    return () => {
      window.removeEventListener('online', online);
      window.removeEventListener('beforeunload', unload);
    };
  }, []);

  const switchProject = async (id: string) => {
    if (busy.current) return;
    if (timer.current) clearTimeout(timer.current);
    await capture();
    const snapshot = projects.find((item) => item.board_id === id);
    if (!snapshot) return;
    const row = await localCache.boards.get([ownerId, id]);
    await openBoard(snapshot, row?.remoteKnown ?? false);
  };
  const newProject = async (copy = false) => {
    if (projects.length >= 100) throw new Error('This workspace supports at most 100 boards.');
    if (timer.current) clearTimeout(timer.current);
    await capture();
    const suffix = ' (recovery copy)';
    const snapshot = defaultEnvelope(
      crypto.randomUUID(),
      copy ? titleRef.current.slice(0, 200 - suffix.length) + suffix : 'New study board',
    );
    if (copy && active.current) {
      snapshot.scene = active.current.snapshot.scene;
      const assets = await localCache.assets
        .where('[ownerId+boardId]')
        .equals([ownerId, active.current.boardId])
        .toArray();
      if (assets.length)
        await localCache.assets.bulkPut(
          assets.map((asset) => ({ ...asset, boardId: snapshot.board_id, remoteKnown: false })),
        );
    }
    await rememberDraft({
      ownerId,
      boardId: snapshot.board_id,
      tabId: tabId.current,
      snapshot,
      baseRevision: 1,
      remoteKnown: false,
      editId: crypto.randomUUID(),
    });
    setProjects((items) => [...items, snapshot]);
    await openBoard(snapshot, false);
  };
  const reloadRemote = async () => {
    await capture();
    const id = active.current!.boardId;
    // Keep an independently named recovery project before opening the server revision.
    await newProject(true);
    const remote = await readJson(
      await request('/api/whiteboards/' + id),
      WhiteboardSnapshotSchema,
      'Load latest board',
    );
    await localCache.drafts.delete([ownerId, id, tabId.current]);
    await localCache.boards.put({
      ownerId,
      boardId: id,
      title: remote.title,
      snapshot: remote,
      revision: remote.revision,
      localRevision: remote.revision,
      updatedAt: remote.updated_at,
      remoteKnown: true,
    });
    await openBoard(remote, true, false);
  };
  const changeProject = async (operation: () => Promise<void>) => {
    setSwitching(true);
    try {
      await operation();
    } catch (cause) {
      report(cause);
    } finally {
      if (mounted.current) setSwitching(false);
    }
  };

  const onChange: ExcalidrawProps['onChange'] = (elements, appState) => {
    const ids = Object.keys(appState.selectedElementIds).filter((id) => appState.selectedElementIds[id]);
    setSelectedIds((current) =>
      current.length === ids.length && current.every((id, index) => id === ids[index]) ? current : ids,
    );
    // Selection/cursor changes do not create revisions; persist content and viewport only.
    const fingerprint = JSON.stringify([
      elements.map((element) => [element.id, element.version, element.isDeleted]),
      appState.viewBackgroundColor,
      appState.gridSize,
      appState.zoom.value,
      appState.scrollX,
      appState.scrollY,
    ]);
    if (!lastScene.current) {
      lastScene.current = fingerprint;
      return;
    }
    if (lastScene.current === fingerprint) return;
    lastScene.current = fingerprint;
    if (editor.current) schedule();
  };
  async function exportBoard() {
    if (!module || !editor.current || exporting || switching) return;
    const canvas = editor.current;
    const scene = canvas.getSceneElements();
    const state = canvas.getAppState();
    const elements = exportScope === 'selection' ? boardRegion(scene, state.selectedElementIds) : scene;
    const heading = titleRef.current;
    const nickname = exportScope === 'full' ? heading : `${heading} (selection)`;
    setExporting(true);
    setExportFeedback('');
    try {
      const data = await renderBoardExport(
        module,
        elements,
        canvas.getFiles(),
        state.viewBackgroundColor,
        nickname,
        exportFormat,
      );
      if (!mounted.current || editor.current !== canvas) return;
      const url = URL.createObjectURL(data);
      const link = document.createElement('a');
      link.href = url;
      link.download = boardExportName(heading, exportScope, exportFormat);
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setExportFeedback(`${exportFormat.toUpperCase()} downloaded.`);
    } catch (cause) {
      if (mounted.current && editor.current === canvas) report(cause);
    } finally {
      if (mounted.current) setExporting(false);
    }
  }
  function selectedTextIds() {
    const canvas = editor.current;
    if (!canvas) return [];
    return boardRegion(canvas.getSceneElements(), canvas.getAppState().selectedElementIds)
      .filter((element) => element.type === 'text' && element.text.trim())
      .map((element) => element.id)
      .sort();
  }
  function getLearningScope(): BoardLearningScope | null {
    const board = active.current;
    if (
      !board?.remoteKnown ||
      !mounted.current ||
      dirty.current ||
      busy.current ||
      blocked.current ||
      switching ||
      !navigator.onLine
    )
      return null;
    const shapeIds = selectedTextIds();
    if (!shapeIds.length) return null;
    return {
      boardId: board.boardId,
      revision: board.baseRevision,
      shapeIds,
      key: JSON.stringify([board.boardId, board.baseRevision, sceneEpoch.current, shapeIds]),
    };
  }
  async function addReviewedShapes(preview: BoardLearningResponse, expected: BoardLearningScope) {
    const canvas = editor.current;
    if (!module || !canvas || getLearningScope()?.key !== expected.key) {
      throw new Error('The board or selection changed. Prepare a fresh preview.');
    }
    const path = `/api/whiteboards/${expected.boardId}`;
    const saved = await readJson(await request(path), WhiteboardSnapshotSchema, 'Check saved board revision');
    if (
      !mounted.current ||
      editor.current !== canvas ||
      getLearningScope()?.key !== expected.key ||
      saved.revision !== expected.revision
    ) {
      throw new Error('The board or selection changed. Prepare a fresh preview.');
    }
    const region = boardRegion(canvas.getSceneElements(), canvas.getAppState().selectedElementIds);
    const [, top, right] = module.getCommonBounds(region);
    if (!Number.isFinite(right) || !Number.isFinite(top)) throw new Error('The selected area is invalid.');
    const x = right + 48;
    const sourceData = {
      studyvault_board_source_id: expected.boardId,
      studyvault_board_source_revision: expected.revision,
      studyvault_board_learning_action: preview.action,
    };
    type Skeleton = Parameters<ExcalidrawModule['convertToExcalidrawElements']>[0];
    const shapes: NonNullable<Skeleton> = [];
    function addText(text: string, atX: number, atY: number, excerptIds: string[], fontSize = 18) {
      // Keep bounded lines legible next to the original selection.
      const wrapped = text.split('\n').flatMap((line) => {
        const words = [...line];
        const lines: string[] = [];
        while (words.length > 48) {
          const leading = words.slice(0, 48).join('');
          const split = leading.lastIndexOf(' ');
          lines.push(
            words
              .splice(0, split > 20 ? split + 1 : 48)
              .join('')
              .trimEnd(),
          );
        }
        lines.push(words.join(''));
        return lines;
      });
      shapes.push({
        type: 'text',
        x: atX,
        y: atY,
        text: wrapped.join('\n'),
        fontSize,
        customData: { ...sourceData, studyvault_board_excerpt_ids: excerptIds },
      });
      return wrapped.length * (fontSize * 1.3);
    }
    if (preview.answer) {
      addText('Tutor answer', x, top, [], 23);
      addText(preview.answer, x, top + 40, preview.answer_excerpt_ids);
    } else if (preview.cards.length) {
      addText('Flashcards', x, top, [], 23);
      let y = top + 40;
      for (const card of preview.cards) {
        y += addText(`Q: ${card.front}`, x, y, card.excerpt_ids, 20) + 8;
        y += addText(`A: ${card.back}`, x, y, card.excerpt_ids) + 28;
      }
    } else {
      addText('Concept map', x, top, [], 23);
      let y = top + 64;
      for (const node of preview.nodes) {
        shapes.push({
          type: 'arrow',
          x: x + 16,
          y: top + 30,
          points: [
            [0, 0],
            [0, y - top - 19],
            [110, y - top - 19],
          ],
          customData: sourceData,
        });
        y += addText(node.label, x + 140, y, node.excerpt_ids, 20) + 20;
      }
    }
    const additions = module.convertToExcalidrawElements(shapes);
    canvas.updateScene({
      elements: [...canvas.getSceneElementsIncludingDeleted(), ...additions],
      captureUpdate: module.CaptureUpdateAction.IMMEDIATELY,
    });
    schedule();
  }
  const insertConcept = useCallback(
    (
      target: NonNullable<import('@studyvault/types').ConceptGraphNodeActions['board']>,
      sourceRevision: number,
    ) => {
      if (!editor.current || !module) throw new Error('The whiteboard is still loading.');
      const canvas = editor.current;
      if (
        canvas
          .getSceneElements()
          .some((element) => element.customData?.studyvault_graph_node === target.node_id)
      )
        return;
      const elements = module.convertToExcalidrawElements([
        {
          type: 'text',
          x: 80,
          y: 80,
          text:
            target.label +
            '\n\n' +
            target.quote +
            '\n\nSource ' +
            target.document_id +
            (target.page === null ? '' : ' · page ' + target.page),
          fontSize: 20,
          customData: {
            studyvault_document_id: target.document_id,
            studyvault_graph_node: target.node_id,
            studyvault_graph_revision: sourceRevision,
          },
        },
      ]);
      canvas.updateScene({
        elements: [...canvas.getSceneElementsIncludingDeleted(), ...elements],
        captureUpdate: module.CaptureUpdateAction.IMMEDIATELY,
      });
    },
    [module],
  );

  if (!boot || !module)
    return (
      <section id="whiteboard" className="rounded border p-4">
        <h2 className="text-sm font-semibold">Whiteboard</h2>
        <p role="status">{status}</p>
        {error && <p role="alert">{error}</p>}
      </section>
    );
  const Excalidraw = module.Excalidraw;
  const state = boot.snapshot.scene.app_state;
  const initialData: ExcalidrawInitial = {
    elements: boot.snapshot.scene.elements as unknown as ExcalidrawInitial['elements'],
    appState: {
      ...state,
      ...(state.zoom ? { zoom: { value: state.zoom } } : {}),
    } as ExcalidrawInitial['appState'],
    files: boot.files,
  };
  return (
    <section ref={workspace} id="whiteboard" className="space-y-2 rounded border p-4" aria-busy={switching}>
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="mr-auto text-sm font-semibold">Whiteboard</h2>
        <label>
          Project{' '}
          <select
            aria-label="Open board"
            value={active.current?.boardId ?? boot.snapshot.board_id}
            disabled={saving || switching}
            onChange={(event) => {
              void changeProject(() => switchProject(event.target.value));
            }}
          >
            {projects.map((project) => (
              <option key={project.board_id} value={project.board_id}>
                {project.title}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          disabled={saving || switching}
          onClick={() => {
            void changeProject(() => newProject());
          }}
        >
          New board
        </button>
        <label>
          Project name
          <input
            aria-label="Board title"
            value={title}
            disabled={switching}
            maxLength={200}
            onChange={(event) => {
              titleRef.current = event.target.value;
              setTitle(event.target.value);
              schedule();
            }}
          />
        </label>
        <button
          type="button"
          disabled={!api || saving || switching || conflict}
          onClick={() => {
            void saveCurrent();
          }}
        >
          Save now
        </button>
      </div>
      <p role="status" aria-live="polite">
        {status}
      </p>
      <details className="rounded border p-2 text-sm">
        <summary className="cursor-pointer font-semibold">Download board</summary>
        <div className="mt-2 flex flex-wrap items-end gap-2">
          <label className="flex flex-col">
            Board area
            <select
              value={exportScope}
              className="rounded border p-1"
              disabled={exporting}
              onChange={(event) => setExportScope(event.target.value === 'selection' ? 'selection' : 'full')}
            >
              <option value="full">Whole board</option>
              <option value="selection">Selected area</option>
            </select>
          </label>
          <label className="flex flex-col">
            File format
            <select
              value={exportFormat}
              className="rounded border p-1"
              disabled={exporting}
              onChange={(event) => {
                const selected = event.target.value;
                setExportFormat(selected === 'svg' || selected === 'pdf' ? selected : 'png');
              }}
            >
              <option value="png">PNG image</option>
              <option value="svg">SVG drawing</option>
              <option value="pdf">PDF document</option>
            </select>
          </label>
          <button
            type="button"
            className="rounded border px-3 py-1 disabled:opacity-60"
            disabled={!api || switching || exporting || (exportScope === 'selection' && !selectedIds.length)}
            onClick={() => void exportBoard()}
          >
            {exporting ? 'Preparing download' : 'Download file'}
          </button>
        </div>
        {exportScope === 'selection' && !selectedIds.length ? (
          <p className="mt-1">Select shapes or a frame on the board.</p>
        ) : null}
        {exportFeedback ? (
          <p aria-live="polite" className="mt-1">
            {exportFeedback}
          </p>
        ) : null}
      </details>
      <p className="text-xs text-neutral-600">
        Undo and redo are available in the editor. Unsynced drafts stay on this device under your account.
      </p>
      {legacy && (
        <div className="rounded border p-2 text-sm">
          <p>
            Your earlier board is preserved in its original format. Download it for recovery; this editor uses
            a new format.
          </p>
          <button
            type="button"
            onClick={() => {
              const url = URL.createObjectURL(new Blob([legacy], { type: 'application/json' }));
              const link = document.createElement('a');
              link.href = url;
              link.download = 'legacy-study-board.json';
              link.click();
              setTimeout(() => URL.revokeObjectURL(url), 1000);
            }}
          >
            Download earlier board
          </button>
        </div>
      )}
      <BoardLearningPreview
        ownerId={ownerId}
        getToken={getToken}
        handoff={handoff}
        onInsert={insertConcept}
      />
      <WhiteboardSelectionLearning
        getToken={getToken}
        selectionCount={selectedIds.length ? selectedTextIds().length : 0}
        getScope={getLearningScope}
        onAccept={addReviewedShapes}
      />
      {error && <p role="alert">{error}</p>}
      {conflict && (
        <div className="rounded border border-amber-400 p-3">
          <p>
            This board changed elsewhere. Keep a separate copy or open the latest version; your edits are
            preserved as a recovery project.
          </p>
          <button
            type="button"
            disabled={switching}
            onClick={() => {
              void changeProject(reloadRemote);
            }}
          >
            Reload latest
          </button>
          <button
            type="button"
            disabled={switching}
            onClick={() => {
              void changeProject(() => newProject(true));
            }}
          >
            Keep my local copy
          </button>
        </div>
      )}
      <div
        ref={canvasHost}
        style={{ minHeight: 360, height: 'min(65vh, 560px)', pointerEvents: switching ? 'none' : 'auto' }}
        aria-label="Whiteboard canvas"
      >
        <Excalidraw
          key={boot.snapshot.board_id + ':' + boot.snapshot.revision}
          initialData={initialData}
          excalidrawAPI={(value) => {
            editor.current = value;
            setApi(value);
          }}
          onChange={onChange}
          name={title}
          validateEmbeddable={false}
          autoFocus={false}
        />
      </div>
    </section>
  );
}
