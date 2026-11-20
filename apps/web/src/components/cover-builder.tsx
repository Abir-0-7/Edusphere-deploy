'use client';

import { useEffect, useMemo, useState, type ChangeEvent, type FormEvent } from 'react';
import {
  AcademicCoverDraftSchema,
  type AcademicCoverContent,
  type CoverPageSize,
  type CoverTemplateId,
} from '@studyvault/types';
import { COVER_PAPER, COVER_TEMPLATES } from '@/lib/cover-layout';
import { COVER_PALETTES } from '@/lib/cover-decoration';
import {
  createCoverPdf,
  coverPdfFilename,
  InvalidCoverLogoError,
  prepareCoverLayout,
  type CoverLayoutResult,
  UnsupportedCoverTextError,
  validateCoverLogo,
  type CoverLogoAsset,
} from '@/lib/cover-pdf';
import {
  applyInstitutionPreset,
  deleteCoverArtifact,
  deleteCoverDraft,
  deleteInstitutionPreset,
  listCoverArtifacts,
  listCoverDrafts,
  listInstitutionPresets,
  presetFromDraft,
  saveCoverArtifact,
  saveCoverDraft,
  saveInstitutionPreset,
  type SavedCoverArtifact,
  type SavedCoverDraft,
  type SavedInstitutionPreset,
} from '@/lib/cover-vault';

const TEMPLATE_IDS = Object.keys(COVER_TEMPLATES) as CoverTemplateId[];
const SAMPLE_TITLES: Record<CoverTemplateId, string> = {
  'university-assignment': 'Literature and Context',
  'lab-report': 'Water Quality Lab',
  'project-report': 'Campus Design Project',
  'minimal-professional': 'Research Portfolio',
};

const initialDraft = AcademicCoverDraftSchema.parse({
  templateId: 'university-assignment',
  pageSize: 'a4',
  content: { title: 'Course assignment' },
});

type SelectedLogo = { asset: CoverLogoAsset; src: string; name: string };

const PREVIEW_FONTS = {
  'times-roman': 'Times New Roman, serif',
  courier: 'Courier New, monospace',
  helvetica: 'Arial, sans-serif',
};

function CoverArtwork({ layout, logo }: { layout: CoverLayoutResult; logo?: SelectedLogo | null }) {
  return (
    <>
      <g aria-hidden="true">
        {layout.decorations.map((shape, index) =>
          shape.kind === 'rect' ? (
            <rect
              key={index}
              x={shape.x}
              y={shape.y}
              width={shape.width}
              height={shape.height}
              fill={shape.fill}
            />
          ) : (
            <circle key={index} cx={shape.x} cy={shape.y} r={shape.radius} fill={shape.fill} />
          ),
        )}
      </g>
      {layout.logo && logo && (
        <image
          href={logo.src}
          x={layout.logo.x}
          y={layout.logo.y}
          width={layout.logo.width}
          height={layout.logo.height}
          preserveAspectRatio="xMidYMid meet"
        />
      )}
      {layout.lines.map((line, index) => (
        <text
          key={`${line.field}-${index}`}
          x={line.x}
          y={line.y}
          fontFamily={PREVIEW_FONTS[line.fontFamily]}
          fontSize={line.fontSize}
          fontWeight={line.bold ? 700 : 400}
          fill={line.color}
          textLength={line.width}
          lengthAdjust="spacingAndGlyphs"
        >
          {line.text}
        </text>
      ))}
    </>
  );
}

function helpForError(error: unknown): string {
  if (error instanceof UnsupportedCoverTextError) return error.message;
  if (error instanceof InvalidCoverLogoError) return error.message;
  if (error instanceof Error) return error.message;
  return 'The cover could not be prepared. Check the fields and try again.';
}

export function CoverBuilder({ ownerId }: { ownerId: string | null }) {
  const [draft, setDraft] = useState(initialDraft);
  const [logo, setLogo] = useState<SelectedLogo | null>(null);
  const [layout, setLayout] = useState<CoverLayoutResult | null>(null);
  const [templateLayouts, setTemplateLayouts] = useState<Partial<Record<CoverTemplateId, CoverLayoutResult>>>(
    {},
  );
  const [layoutError, setLayoutError] = useState('');
  const [exportError, setExportError] = useState('');
  const [logoError, setLogoError] = useState('');
  const [vaultError, setVaultError] = useState('');
  const [vaultMessage, setVaultMessage] = useState('');
  const [savedDrafts, setSavedDrafts] = useState<SavedCoverDraft[]>([]);
  const [savedPresets, setSavedPresets] = useState<SavedInstitutionPreset[]>([]);
  const [savedArtifacts, setSavedArtifacts] = useState<SavedCoverArtifact[]>([]);
  const [currentDraftId, setCurrentDraftId] = useState<string | undefined>();
  const [currentDraftRevision, setCurrentDraftRevision] = useState(1);
  const [draftDirty, setDraftDirty] = useState(true);
  const [selectedDraftId, setSelectedDraftId] = useState('');
  const [presetName, setPresetName] = useState('');
  const [selectedPresetId, setSelectedPresetId] = useState('');
  const [preparing, setPreparing] = useState(false);
  const [exporting, setExporting] = useState<'pdf' | 'docx' | null>(null);

  const template = COVER_TEMPLATES[draft.templateId];
  const paper = COVER_PAPER[draft.pageSize];
  const previewStyle = useMemo(
    () => ({ aspectRatio: `${paper.width} / ${paper.height}` }),
    [paper.height, paper.width],
  );

  useEffect(() => {
    let current = true;
    setDraft(initialDraft);
    setLogo(null);
    setSavedDrafts([]);
    setSavedPresets([]);
    setSavedArtifacts([]);
    setCurrentDraftId(undefined);
    setCurrentDraftRevision(1);
    setSelectedDraftId('');
    setSelectedPresetId('');
    setPresetName('');
    setVaultError('');
    setVaultMessage('');
    if (!ownerId)
      return () => {
        current = false;
      };
    void Promise.all([listCoverDrafts(ownerId), listInstitutionPresets(ownerId), listCoverArtifacts(ownerId)])
      .then(([drafts, presets, artifacts]) => {
        if (!current) return;
        setSavedDrafts(drafts);
        setSavedPresets(presets);
        setSavedArtifacts(artifacts);
        setVaultError('');
      })
      .catch((error: unknown) => {
        if (current) setVaultError(helpForError(error));
      });
    return () => {
      current = false;
    };
  }, [ownerId]);

  useEffect(() => {
    if (!logo) return;
    return () => URL.revokeObjectURL(logo.src);
  }, [logo]);

  useEffect(() => {
    let current = true;
    setPreparing(true);
    setLayout(null);
    setLayoutError('');
    const content: AcademicCoverContent = {
      ...draft.content,
      students: draft.content.students.filter((student) => student.name.trim().length > 0),
    };
    void prepareCoverLayout(
      { ...draft, content },
      logo?.asset ? { width: logo.asset.width, height: logo.asset.height } : undefined,
    )
      .then((result) => {
        if (current) setLayout(result);
      })
      .catch((error: unknown) => {
        if (current) setLayoutError(helpForError(error));
      })
      .finally(() => {
        if (current) setPreparing(false);
      });
    return () => {
      current = false;
    };
  }, [draft, logo]);

  useEffect(() => {
    let current = true;
    void Promise.allSettled(
      TEMPLATE_IDS.map(async (templateId) => {
        const templateLayout = await prepareCoverLayout({
          templateId,
          pageSize: 'a4',
          content: {
            institutionName: 'North Campus',
            title: SAMPLE_TITLES[templateId],
            courseName: 'Coursework',
            students: [{ name: 'Alex Morgan' }],
          },
        });
        return [templateId, templateLayout] as const;
      }),
    ).then((entries) => {
      if (current) {
        setTemplateLayouts(
          Object.fromEntries(entries.flatMap((entry) => (entry.status === 'fulfilled' ? [entry.value] : []))),
        );
      }
    });
    return () => {
      current = false;
    };
  }, []);

  const updateContent = <K extends keyof AcademicCoverContent>(key: K, value: AcademicCoverContent[K]) => {
    setDraft((current) => ({
      ...current,
      content: { ...current.content, [key]: value },
    }));
    setDraftDirty(true);
    setExportError('');
  };

  const updateStudent = (
    index: number,
    key: keyof AcademicCoverContent['students'][number],
    value: string,
  ) => {
    const students = draft.content.students.map((student, studentIndex) =>
      studentIndex === index ? { ...student, [key]: value } : student,
    );
    updateContent('students', students);
  };

  const selectLogo = async (event: ChangeEvent<HTMLInputElement>) => {
    setLogoError('');
    const file = event.target.files?.[0];
    if (!file) return;
    if (file.size > 1024 * 1024) {
      setLogoError('Choose a logo smaller than or equal to 1 MB.');
      event.target.value = '';
      return;
    }
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const asset = validateCoverLogo(bytes, file.type);
      const src = URL.createObjectURL(new Blob([bytes], { type: asset.mimeType }));
      setLogo({ asset, src, name: file.name });
      setDraftDirty(true);
    } catch (error) {
      setLogoError(helpForError(error));
    } finally {
      event.target.value = '';
    }
  };

  const removeLogo = () => {
    setLogo(null);
    setDraftDirty(true);
    setLogoError('');
  };

  const reloadVault = async () => {
    if (!ownerId) return;
    const [drafts, presets, artifacts] = await Promise.all([
      listCoverDrafts(ownerId),
      listInstitutionPresets(ownerId),
      listCoverArtifacts(ownerId),
    ]);
    setSavedDrafts(drafts);
    setSavedPresets(presets);
    setSavedArtifacts(artifacts);
  };

  const persistDraft = async () => {
    if (!ownerId) return;
    setVaultError('');
    setVaultMessage('');
    try {
      const saved = await saveCoverDraft(ownerId, draft, logo?.asset ?? null, currentDraftId);
      setCurrentDraftId(saved.id);
      setCurrentDraftRevision(saved.revision);
      setDraftDirty(false);
      setSelectedDraftId(saved.id);
      await reloadVault();
      setVaultMessage(`Saved draft revision ${saved.revision}.`);
    } catch (error) {
      setVaultError(helpForError(error));
    }
  };

  const restoreDraft = async () => {
    if (!ownerId || !selectedDraftId) return;
    setVaultError('');
    setVaultMessage('');
    try {
      const saved = await listCoverDrafts(ownerId).then((items) =>
        items.find((item) => item.id === selectedDraftId),
      );
      if (!saved) throw new Error('Saved cover draft could not be found.');
      setDraft(AcademicCoverDraftSchema.parse(saved.draft));
      setCurrentDraftId(saved.id);
      setCurrentDraftRevision(saved.revision);
      setDraftDirty(false);
      setLogo(
        saved.logo
          ? {
              asset: validateCoverLogo(saved.logo.bytes, saved.logo.mimeType),
              src: URL.createObjectURL(new Blob([saved.logo.bytes], { type: saved.logo.mimeType })),
              name: 'Saved logo',
            }
          : null,
      );
      setVaultMessage(`Restored draft revision ${saved.revision}.`);
    } catch (error) {
      setVaultError(helpForError(error));
    }
  };

  const removeSavedDraft = async () => {
    if (!ownerId || !selectedDraftId) return;
    setVaultError('');
    try {
      await deleteCoverDraft(ownerId, selectedDraftId);
      if (currentDraftId === selectedDraftId) {
        setCurrentDraftId(undefined);
        setCurrentDraftRevision(1);
        setDraftDirty(true);
      }
      setSelectedDraftId('');
      await reloadVault();
      setVaultMessage('Saved draft removed.');
    } catch (error) {
      setVaultError(helpForError(error));
    }
  };

  const persistPreset = async () => {
    if (!ownerId) return;
    setVaultError('');
    try {
      const saved = await saveInstitutionPreset(
        ownerId,
        presetName,
        presetFromDraft(draft),
        selectedPresetId || undefined,
      );
      setPresetName(saved.name);
      setSelectedPresetId(saved.id);
      await reloadVault();
      setVaultMessage(`Saved preset revision ${saved.revision}.`);
    } catch (error) {
      setVaultError(helpForError(error));
    }
  };

  const applyPreset = async () => {
    const preset = savedPresets.find((item) => item.id === selectedPresetId);
    if (!preset) return;
    try {
      setDraft(applyInstitutionPreset(draft, preset.values));
      setDraftDirty(true);
      setVaultError('');
      setVaultMessage(`Applied ${preset.name} preset revision ${preset.revision}.`);
    } catch (error) {
      setVaultError(helpForError(error));
    }
  };

  const removePreset = async () => {
    if (!ownerId || !selectedPresetId) return;
    try {
      await deleteInstitutionPreset(ownerId, selectedPresetId);
      setSelectedPresetId('');
      setPresetName('');
      await reloadVault();
      setVaultMessage('Saved institution preset removed.');
    } catch (error) {
      setVaultError(helpForError(error));
    }
  };

  const downloadArtifact = (artifact: SavedCoverArtifact) => {
    const buffer = artifact.pdfBytes.slice().buffer;
    const url = URL.createObjectURL(new Blob([buffer], { type: 'application/pdf' }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = artifact.fileName;
    anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const removeArtifact = async (artifactId: string) => {
    if (!ownerId) return;
    try {
      await deleteCoverArtifact(ownerId, artifactId);
      await reloadVault();
      setVaultMessage('Saved PDF artifact removed.');
    } catch (error) {
      setVaultError(helpForError(error));
    }
  };

  const exportPdf = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setExportError('');
    setExporting('pdf');
    try {
      const content: AcademicCoverContent = {
        ...draft.content,
        students: draft.content.students.filter((student) => student.name.trim().length > 0),
      };
      const bytes = await createCoverPdf({ ...draft, content }, { logo: logo?.asset });
      const fileName = coverPdfFilename(draft.content.title);
      const safeBytes = bytes.slice().buffer;
      const blob = new Blob([safeBytes], { type: 'application/pdf' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = fileName;
      anchor.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      if (ownerId) {
        try {
          await saveCoverArtifact(
            ownerId,
            { ...draft, content },
            draftDirty ? null : currentDraftRevision,
            fileName,
            bytes,
            logo?.asset,
          );
          await reloadVault();
        } catch (error) {
          setVaultError(
            `The PDF downloaded, but its browser copy could not be saved: ${helpForError(error)}`,
          );
        }
      }
    } catch (error) {
      setExportError(helpForError(error));
    } finally {
      setExporting(null);
    }
  };

  const exportDocx = async () => {
    setExportError('');
    setExporting('docx');
    try {
      const { COVER_DOCX_MIME, coverDocxFilename, createCoverDocx } = await import('@/lib/cover-docx');
      const content: AcademicCoverContent = {
        ...draft.content,
        students: draft.content.students.filter((student) => student.name.trim().length > 0),
      };
      const bytes = await createCoverDocx({ ...draft, content }, { logo: logo?.asset });
      const url = URL.createObjectURL(new Blob([bytes], { type: COVER_DOCX_MIME }));
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = coverDocxFilename(content.title);
      anchor.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error) {
      setExportError(helpForError(error));
    } finally {
      setExporting(null);
    }
  };

  const inputClass = 'mt-1 min-w-0 w-full max-w-full rounded border border-neutral-300 px-3 py-2 text-sm';
  const labelClass = 'block min-w-0 text-sm font-medium text-neutral-800';

  return (
    <section className="cover-builder rounded-xl border border-neutral-200 bg-white p-5 shadow-sm">
      <div className="mb-5">
        <h2 className="text-lg font-semibold">Academic cover page</h2>
        <p className="mt-1 text-sm text-neutral-600">
          Enter the details you want printed. Blank optional fields are left out.
        </p>
      </div>
      <div className="cover-builder-layout">
        <form className="cover-builder-form space-y-4" onSubmit={(event) => void exportPdf(event)}>
          <fieldset>
            <legend className="text-sm font-medium text-neutral-800">Choose a cover template</legend>
            <div role="radiogroup" aria-label="Cover template" className="mt-2 grid grid-cols-2 gap-3">
              {TEMPLATE_IDS.map((id) => {
                const thumbnail = templateLayouts[id];
                return (
                  <button
                    key={id}
                    type="button"
                    role="radio"
                    aria-checked={draft.templateId === id}
                    aria-label={`Select ${COVER_TEMPLATES[id].label} template`}
                    className={`rounded-xl border p-2 text-left transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-700 ${draft.templateId === id ? 'border-blue-700 bg-blue-50/60 ring-1 ring-blue-700' : 'border-neutral-200 hover:border-neutral-400'}`}
                    onClick={() => {
                      setDraft((current) => ({ ...current, templateId: id }));
                      setDraftDirty(true);
                      setExportError('');
                    }}
                  >
                    {thumbnail ? (
                      <svg
                        aria-hidden="true"
                        viewBox={`0 0 ${thumbnail.width} ${thumbnail.height}`}
                        className="mx-auto block h-28 w-auto overflow-hidden border border-neutral-200 bg-white shadow-sm"
                      >
                        <CoverArtwork layout={thumbnail} />
                      </svg>
                    ) : (
                      <div className="mx-auto h-28 w-20 bg-neutral-100" />
                    )}
                    <span className="mt-2 block text-xs font-semibold">{COVER_TEMPLATES[id].label}</span>
                    <span className="mt-0.5 block text-xs text-neutral-600">
                      {COVER_PALETTES[id].caption}
                    </span>
                  </button>
                );
              })}
            </div>
          </fieldset>

          <div className="cover-builder-fields">
            <label className={labelClass}>
              Paper size
              <select
                className={inputClass}
                value={draft.pageSize}
                onChange={(event) => {
                  setDraft((current) => ({ ...current, pageSize: event.target.value as CoverPageSize }));
                  setDraftDirty(true);
                  setExportError('');
                }}
              >
                <option value="a4">A4</option>
                <option value="letter">US Letter</option>
              </select>
            </label>
          </div>

          <label className={labelClass}>
            Title{' '}
            <span aria-hidden="true" className="text-red-700">
              *
            </span>
            <input
              className={inputClass}
              value={draft.content.title}
              onChange={(event) => updateContent('title', event.target.value)}
              maxLength={400}
              required
              autoComplete="off"
            />
          </label>

          <div className="cover-builder-fields">
            <label className={labelClass}>
              Institution
              <input
                className={inputClass}
                value={draft.content.institutionName}
                maxLength={240}
                onChange={(event) => updateContent('institutionName', event.target.value)}
              />
            </label>
            <label className={labelClass}>
              Department
              <input
                className={inputClass}
                value={draft.content.department}
                maxLength={240}
                onChange={(event) => updateContent('department', event.target.value)}
              />
            </label>
            <label className={labelClass}>
              Course code
              <input
                className={inputClass}
                value={draft.content.courseCode}
                maxLength={80}
                onChange={(event) => updateContent('courseCode', event.target.value)}
              />
            </label>
            <label className={labelClass}>
              Course name
              <input
                className={inputClass}
                value={draft.content.courseName}
                maxLength={240}
                onChange={(event) => updateContent('courseName', event.target.value)}
              />
            </label>
            <label className={labelClass}>
              Assignment or lab number
              <input
                className={inputClass}
                value={draft.content.assignmentNumber}
                maxLength={80}
                onChange={(event) => updateContent('assignmentNumber', event.target.value)}
              />
            </label>
            <label className={labelClass}>
              Subtitle
              <input
                className={inputClass}
                value={draft.content.subtitle}
                maxLength={300}
                onChange={(event) => updateContent('subtitle', event.target.value)}
              />
            </label>
          </div>

          <fieldset className="space-y-3 rounded-lg border border-neutral-200 p-3">
            <legend className="px-1 text-sm font-medium">Students or group members</legend>
            {draft.content.students.map((student, index) => (
              <div className="cover-builder-student" key={`student-${index}`}>
                <label className={labelClass}>
                  <span className="sr-only">Student {index + 1} name</span>
                  <input
                    aria-label={`Student ${index + 1} name`}
                    className={inputClass}
                    placeholder="Name"
                    value={student.name}
                    maxLength={160}
                    onChange={(event) => updateStudent(index, 'name', event.target.value)}
                  />
                </label>
                <label className={labelClass}>
                  <span className="sr-only">Student {index + 1} ID</span>
                  <input
                    aria-label={`Student ${index + 1} ID`}
                    className={inputClass}
                    placeholder="Student ID"
                    value={student.id}
                    maxLength={80}
                    onChange={(event) => updateStudent(index, 'id', event.target.value)}
                  />
                </label>
                <label className={labelClass}>
                  <span className="sr-only">Student {index + 1} section</span>
                  <input
                    aria-label={`Student ${index + 1} section`}
                    className={inputClass}
                    placeholder="Section"
                    value={student.section}
                    maxLength={80}
                    onChange={(event) => updateStudent(index, 'section', event.target.value)}
                  />
                </label>
                <button
                  type="button"
                  className="mt-1 rounded border px-2 text-sm text-neutral-700"
                  aria-label={`Remove student ${index + 1}`}
                  onClick={() =>
                    updateContent(
                      'students',
                      draft.content.students.filter((_, at) => at !== index),
                    )
                  }
                >
                  Remove
                </button>
              </div>
            ))}
            <button
              type="button"
              className="rounded border px-3 py-1.5 text-sm"
              disabled={draft.content.students.length >= 40}
              onClick={() =>
                updateContent('students', [...draft.content.students, { name: '', id: '', section: '' }])
              }
            >
              Add student
            </button>
          </fieldset>

          <div className="cover-builder-fields">
            <label className={labelClass}>
              Group name
              <input
                className={inputClass}
                value={draft.content.groupName}
                maxLength={160}
                onChange={(event) => updateContent('groupName', event.target.value)}
              />
            </label>
            <label className={labelClass}>
              Instructor
              <input
                className={inputClass}
                value={draft.content.instructorName}
                maxLength={200}
                onChange={(event) => updateContent('instructorName', event.target.value)}
              />
            </label>
            <label className={labelClass}>
              Submission date
              <input
                className={inputClass}
                value={draft.content.date}
                maxLength={64}
                onChange={(event) => updateContent('date', event.target.value)}
                placeholder="YYYY-MM-DD"
              />
            </label>
          </div>

          <div className="rounded-lg border border-dashed border-neutral-300 p-3">
            <label className={labelClass} htmlFor="cover-logo">
              Institution logo (PNG or JPEG, up to 1 MB)
            </label>
            <input
              className="mt-2 block w-full text-sm"
              id="cover-logo"
              type="file"
              accept="image/png,image/jpeg"
              onChange={(event) => void selectLogo(event)}
            />
            {logo && (
              <div className="mt-2 flex items-center gap-3 text-sm">
                <img
                  src={logo.src}
                  alt="Selected institution logo"
                  className="h-12 max-w-24 object-contain"
                />
                <span className="min-w-0 flex-1 truncate">{logo.name}</span>
                <button type="button" className="rounded border px-2 py-1" onClick={removeLogo}>
                  Remove logo
                </button>
              </div>
            )}
            {logoError && (
              <p role="alert" className="mt-2 text-sm text-red-700">
                {logoError}
              </p>
            )}
          </div>

          <fieldset disabled={!ownerId} className="space-y-3 rounded-lg border border-neutral-200 p-3">
            <legend className="px-1 text-sm font-medium">Saved cover work on this browser</legend>
            <div className="cover-builder-saved-drafts">
              <button
                type="button"
                onClick={() => void persistDraft()}
                className="rounded border px-3 py-1.5 text-sm disabled:opacity-50"
              >
                {currentDraftId ? `Update draft (revision ${currentDraftRevision})` : 'Save draft'}
              </button>
              <label className="flex-1 text-sm">
                <span className="sr-only">Saved cover draft</span>
                <select
                  aria-label="Saved cover draft"
                  value={selectedDraftId}
                  onChange={(event) => setSelectedDraftId(event.target.value)}
                  className="w-full rounded border px-2 py-1.5"
                >
                  <option value="">Choose saved draft</option>
                  {savedDrafts.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name} · v{item.revision}
                    </option>
                  ))}
                </select>
              </label>
              <button
                type="button"
                onClick={() => void restoreDraft()}
                disabled={!selectedDraftId}
                className="rounded border px-3 py-1.5 text-sm disabled:opacity-50"
              >
                Load
              </button>
              <button
                type="button"
                onClick={() => void removeSavedDraft()}
                disabled={!selectedDraftId}
                className="rounded border px-3 py-1.5 text-sm disabled:opacity-50"
              >
                Delete
              </button>
            </div>
            <div className="cover-builder-presets">
              <label className="text-sm">
                <span className="sr-only">Preset name</span>
                <input
                  aria-label="Preset name"
                  value={presetName}
                  maxLength={80}
                  onChange={(event) => setPresetName(event.target.value)}
                  placeholder="Institution preset name"
                  className="w-full rounded border px-2 py-1.5"
                />
              </label>
              <label className="text-sm">
                <span className="sr-only">Institution preset</span>
                <select
                  aria-label="Institution preset"
                  value={selectedPresetId}
                  onChange={(event) => {
                    setSelectedPresetId(event.target.value);
                    const found = savedPresets.find((preset) => preset.id === event.target.value);
                    if (found) setPresetName(found.name);
                  }}
                  className="w-full rounded border px-2 py-1.5"
                >
                  <option value="">Choose institution preset</option>
                  {savedPresets.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name} · v{item.revision}
                    </option>
                  ))}
                </select>
              </label>
              <button
                type="button"
                onClick={() => void persistPreset()}
                disabled={!presetName.trim()}
                className="rounded border px-3 py-1.5 text-sm disabled:opacity-50"
              >
                {selectedPresetId ? 'Update preset' : 'Save preset'}
              </button>
              <button
                type="button"
                onClick={() => void applyPreset()}
                disabled={!selectedPresetId}
                className="rounded border px-3 py-1.5 text-sm disabled:opacity-50"
              >
                Apply
              </button>
              <button
                type="button"
                onClick={() => void removePreset()}
                disabled={!selectedPresetId}
                className="rounded border px-3 py-1.5 text-sm disabled:opacity-50"
              >
                Delete preset
              </button>
            </div>
            <p className="text-xs text-neutral-600">
              Drafts, presets, logos, and PDF copies stay in this browser and are separated by signed-in
              account. They do not sync to other devices.
            </p>
          </fieldset>
          {!ownerId && (
            <p className="text-xs text-neutral-600">Sign in to save drafts and institution presets.</p>
          )}
          {vaultError && (
            <p role="alert" className="text-sm text-red-700">
              {vaultError}
            </p>
          )}
          {vaultMessage && (
            <p role="status" className="text-sm text-green-800">
              {vaultMessage}
            </p>
          )}
          {savedArtifacts.length > 0 && (
            <div className="space-y-1 rounded-lg bg-neutral-50 p-3">
              <h3 className="text-sm font-medium">Saved PDF copies</h3>
              <ul className="space-y-1 text-sm">
                {savedArtifacts.map((artifact) => (
                  <li key={artifact.id} className="flex flex-wrap items-center gap-2">
                    <span className="min-w-0 flex-1 truncate">
                      {artifact.fileName} · {artifact.pageSize.toUpperCase()} · template v
                      {artifact.templateVersion}
                      {artifact.draftRevision
                        ? ` · draft revision ${artifact.draftRevision}`
                        : ' · unsaved snapshot'}
                    </span>
                    <button
                      type="button"
                      onClick={() => downloadArtifact(artifact)}
                      className="rounded border px-2 py-1"
                    >
                      Download copy
                    </button>
                    <button
                      type="button"
                      onClick={() => void removeArtifact(artifact.id)}
                      className="rounded border px-2 py-1"
                    >
                      Delete copy
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <p role="note" className="rounded bg-amber-50 p-3 text-xs text-amber-950">
            Bangla export is unavailable. The PDF fonts lack Bengali glyphs and the editable Word templates
            have yet to pass Bengali shaping checks.
          </p>

          <div className="flex flex-wrap gap-2">
            <button
              type="submit"
              disabled={Boolean(exporting) || preparing || !layout || layout.overflow}
              className="rounded bg-blue-700 px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
            >
              {exporting === 'pdf' ? 'Preparing PDF…' : 'Download PDF'}
            </button>
            <button
              type="button"
              disabled={Boolean(exporting) || preparing || !layout || layout.overflow}
              onClick={() => void exportDocx()}
              className="rounded border border-blue-700 px-4 py-2 text-sm font-medium text-blue-800 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {exporting === 'docx' ? 'Preparing Word document…' : 'Download editable DOCX'}
            </button>
          </div>
          <p className="text-xs text-neutral-500">
            The Word document keeps text and logos editable. Check the page after editing because text can
            reflow.
          </p>
          {exportError && (
            <p role="alert" className="text-sm text-red-700">
              {exportError}
            </p>
          )}
        </form>

        <div>
          <div className="mb-2 flex items-baseline justify-between gap-3">
            <h3 className="text-sm font-semibold">Live preview</h3>
            <span className="text-xs text-neutral-500">{draft.pageSize === 'a4' ? 'A4' : 'US Letter'}</span>
          </div>
          <div className="rounded-lg bg-neutral-100 p-3 sm:p-5">
            {layout ? (
              <svg
                viewBox={`0 0 ${layout.width} ${layout.height}`}
                style={previewStyle}
                role="img"
                aria-label={`${template.label} cover preview, ${draft.pageSize}`}
                className="mx-auto block max-h-[70vh] w-full overflow-hidden border border-neutral-200 bg-white shadow-md"
              >
                <CoverArtwork layout={layout} logo={logo} />
              </svg>
            ) : (
              <div
                className="flex min-h-80 items-center justify-center bg-white p-6 text-center text-sm text-neutral-600"
                role={layoutError ? 'alert' : 'status'}
              >
                {layoutError || (preparing ? 'Updating preview…' : 'Enter a title to see the preview.')}
              </div>
            )}
            {layout?.overflow && (
              <p role="alert" className="mt-2 text-sm text-red-700">
                Some content does not fit on the page. Shorten the title or reduce the group members.
              </p>
            )}
            <p className="mt-2 text-center text-xs text-neutral-500">
              The PDF uses this layout and colors. Standard PDF fonts support a limited character set.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
