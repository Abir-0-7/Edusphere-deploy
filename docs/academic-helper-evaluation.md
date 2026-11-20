# Academic helper evaluation

The user selected the rubric-based draft checklist as the first useful candidate
on 2026-11-20. E12 evaluates three separate workflows; only the checklist is
promoted to E12a. These tools do not award grades, readiness or mastery.

| Candidate | Input and evidence | Output and storage | Useful workflow and decision |
| --- | --- | --- | --- |
| Outline builder | A stated assignment question, bounded reviewed notes and exact source locators; no invented reading | Editable outline with source references and gaps, saved per assignment | Existing F03 already plans course outlines. A separate academic essay outline needs a concrete assignment and learner demand to justify overlap. Deferred. |
| Equation and reference sheet | Reviewed formulas, variable meanings, units, assumptions and exact authorized source locators | An editable, versioned sheet with cited formulas and exclusions; print/export is a separate acceptance check | Useful for a named course/exam, but no course-specific formula set has been requested. Generic automatic formula generation risks omitted conditions. Deferred pending a concrete source set. |
| Rubric-based draft checklist | Learner-supplied rubric and editable draft; each supported item must quote an exact substring of the current draft | An editable checklist with not-reviewed/supported/needs-work states, saved local revisions and JSON artifact; optional course lesson-note handoff | Selected by the user. The sample below shows a claim is present while evidence and limitations still need revision. Promote E12a after this saved evaluation. |

The pre-implementation artifact is
`docs/evaluations/rubric-checklist-example.json`. Its draft states a conclusion,
but does not provide measurements or a limitation. The reviewer can mark the
conclusion supported with its exact excerpt and leave the evidence/limitations
criteria as needs-work. After revising the draft, changed evidence is rechecked;
removing an excerpt clears its supported status. No model judges correctness.

E12a uses the existing authenticated course notes for deliberate handoff. Device
drafts are private under account keys and downloadable; they do not imply server
sync or inclusion in the server account export. No uploaded file, external URL,
reference fetch, code execution, new provider or paid service is needed.

Before expanding either deferred candidate, record a named assignment/course,
source rights and locators, sample input/output, how edits are preserved, artifact
storage/export and an observed useful learner workflow. A candidate list alone
does not authorize automatic generation or publication.

## Selected checklist pilot verification

E12a was promoted before implementation after the user's selection and the saved
sample evaluation. Its shared Zod contract bounds a draft at 10,000 characters,
12 criteria, 1,500 characters of exact evidence per criterion and 500 characters
per revision note. Supported items require an exact current draft excerpt.
Editing the draft clears removed evidence and resets its review status.
No AI, grade, automatic assessment, code execution or mastery state is involved.

Named local drafts use owner/id keys and atomic expected-revision checks.
Conflicting tabs keep their edits and can save a separate copy. Twelve saved
checklists per account bound retention; Remove Saved Copy leaves the open text as
a new unsaved draft. A downloaded versioned JSON artifact preserves all fields.
The existing course-note API receives only the deliberately chosen checklist
summary and exact excerpts after enrollment/lesson selection. An oversized note
fails visibly under the existing 5,000-character limit.

Three unit tests verify exact evidence/invalidation, owner separation, two-tab
atomic saves and retention/schema bounds. Three Chromium journeys verify
downloaded artifacts, reload, revision changes, account separation, conflict/copy
recovery/removal, 390px fit and the authenticated chosen-lesson note handoff.
The small course fixture uses contract-valid HTTP transport; existing course API
ownership and revision behavior is tested separately. The real pre-implementation
artifact remains distinct from the running application. No deferred helper is
counted as implemented.
