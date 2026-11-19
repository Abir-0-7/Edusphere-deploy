# Practical Python Foundations: human review packet

**Status: Abir approved this entire unchanged packet on 2026-11-20 with no
corrections and authorized publication to the local repository catalog.** No
production deployment is authorized. This editor-only packet contains assessment
keys and is not served by the learner API.

The original pending row labels and generated gate result below are preserved as
the review template presented to Abir. Current decisions are recorded separately
in `practical-python-human-review.json`, including the explicit approval wording
and confirmation time. The original pending JSON form is preserved unchanged.

Release: `78afc1e3-47dc-5e13-a73b-9264662bdb20`

SHA-256: `8d0d00657b631698c83363fa4f68fbc3d8f7a24ce75d66090310c32d9fb87f1e`

The complete scope is 16 lessons in four modules, 40 instructional blocks, 80 practice/checkpoint keys, 17 evidence locators and four capstone rubric criteria. Automatic excerpt matching passes for 17/17 sources. The completed human receipt transcribes approval of all 40 blocks, 80 keys and 17 locators from Abir's entire-packet confirmation; this is not an independent reviewer-performance or model-quality measurement.

## Record the human review

Use the matching JSON packet to record reviewer.name, a timezone-aware reviewer.reviewed_at and reviewer.human_review_confirmed. Confirm rights, the duration/scope estimate, disabled execution and the capstone cases only after checking them. For every claim record human_support and a supporting reference/rationale; verify every evidence locator, assessment key, lesson and rubric criterion. Unknown/pending fields must stay pending. A model assessment is not the required human review.

Target at least 95% claim support, all accepted locators confirmed, no unresolved assessment-key errors and adequate curriculum/rubric coverage. Record corrections before approval. Edits to release content change the hash and require a fresh review scope.

The JSON checker reports readiness only and never publishes. From apps/ai-service: `python -m scripts.export_full_course_review --check-review PATH_TO_COMPLETED_COPY.json`.

## Course and capstone

Planning estimate: 840 minutes including guided workshops, checkpoints, capstone and revision; this duration has not been validated with learners. Python Foundations or its equivalent diagnostic is required. All learner code/SQL remains inert text.

### Reliable input contracts

- Turn a question into an explicit data contract (`pp-contract`)
- Read records without confusing keys, positions and aliases (`pp-records`)
- Validate and normalize before accepting a dataset (`pp-validation`)
- Module1 composite checkpoint (`pp-module-1-checkpoint`)

### Deterministic transformations

- Trace selection and accumulation as separate decisions (`pp-filter`)
- Group transformed records without overwriting earlier work (`pp-group`)
- Specify deterministic presentation and tie behavior (`pp-order`)
- Module2 composite checkpoint (`pp-module-2-checkpoint`)

### Functions and testable design

- Separate returned results from hidden state changes (`pp-functions`)
- Decompose a pipeline at meaningful trust boundaries (`pp-pipeline`)
- Choose test cases that distinguish correct and incorrect rules (`pp-tests`)
- Module3 composite checkpoint (`pp-module-3-checkpoint`)

### Integrated report and evidence

- Make invalid input a visible whole-pipeline outcome (`pp-errors`)
- Trace the complete analyzer and reconcile its invariants (`pp-integration`)
- Explain what the report and its evidence can actually establish (`pp-evidence`)
- Cumulative course checkpoint (`pp-module-4-checkpoint`)

### Capstone: Design and explain a study-session analyzer

Design a study-session analyzer for a list of records with exactly the fields id,
topic, minutes and completed. id and topic are nonblank strings after stripping
outer whitespace. Normalized IDs must be unique. Normalized topics are case
sensitive: Python and python are different topics. minutes must have exact type
int, excluding bool, and lie in the inclusive interval 1..180. completed must
have exact type bool. Validate every record, including incomplete records,
before producing a report. Reject the entire input on an invalid record rather
than returning a silent partial report. Do not mutate the input.

For valid input, count only completed records and sum their minutes. Group their
minutes by normalized topic. Return completed_count, total_minutes and topics;
topics is a list of [topic, minutes] pairs sorted by descending minutes then
ascending topic text for ties. Empty valid input and valid all-incomplete input
return zero count, zero total and an empty topics list. Do not divide by count.

Provide pseudocode or Python as text, a manual trace, at least six test cases
covering ordinary/boundary/invalid input, expected results, and an explanation
linked to course evidence. No submitted code runs in StudyVault. Submission is
not a correctness grade, an execution result or certification of mastery.


Fixed input for your manual trace:
[{"id": "s-1", "topic": "Python", "minutes": 25, "completed": true}, {"id": "s-2", "topic": "SQL", "minutes": 40, "completed": false}, {"id": "s-3", "topic": "Python", "minutes": 35, "completed": true}, {"id": "s-4", "topic": "Math", "minutes": 20, "completed": true}, {"id": "s-5", "topic": "SQL", "minutes": 30, "completed": true}]

Author at least six of your own justified normal,boundary and invalid test cases. The fixed case's worked result is count4,total110,ordered topics Python60,SQL30,Math20.

Deliverable: Four structured text sections: contract/algorithm,manual trace,independent test plan,and limitations/evidence. Code or pseudocode stays text. At least six justified test cases; no execution claim.

- **Contract and algorithm** (120–3000 characters): State the contract,helper boundaries and error path. Provide nonmutating pseudocode or Python as inert text.
- **Manual report trace** (100–3000 characters): Trace the five fixed records through validation,selection,grouping and ordering. Reconcile count4,total110 and Python60/SQL30/Math20.
- **Independent test plan** (160–3000 characters): Give at least six case IDs,inputs,expected reports/errors,and contract-based reasons. Include normal,boundary and invalid cases.
- **Evidence and limitations** (100–2000 characters): Connect design claims to selected course evidence. Distinguish specification from Python references and state that submission is unexecuted and needs human review.

Submission checks completeness only. It is not a rubric pass, execution result, mastery score or XP award.

## Evidence and locator inventory

### pp-contract-evidence

Source: `pp-contract-source`; locator: `authored/pp-contract/explanation/paragraph-1`.

> A useful data contract states required fields, allowed types, boundaries and failure behavior before the calculation begins.

Mechanical excerpt match: yes. Human locator confirmation: **pending**.

Supporting reference: https://docs.python.org/3.12/tutorial/datastructures.html#dictionaries

### pp-records-evidence

Source: `pp-records-source`; locator: `authored/pp-records/explanation/paragraph-1`.

> A dictionary lookup uses a key, while a list lookup uses a position; copying a list alone does not copy its nested dictionaries.

Mechanical excerpt match: yes. Human locator confirmation: **pending**.

Supporting reference: https://docs.python.org/3.12/tutorial/datastructures.html#dictionaries

### pp-validation-evidence

Source: `pp-validation-source`; locator: `authored/pp-validation/explanation/paragraph-1`.

> Normalization makes a chosen representation consistent; it does not excuse an invalid value or silently change the stated policy.

Mechanical excerpt match: yes. Human locator confirmation: **pending**.

Supporting reference: https://docs.python.org/3.12/library/stdtypes.html#boolean-type-bool

### pp-module-1-checkpoint-evidence

Source: `pp-module-1-checkpoint-source`; locator: `authored/pp-module-1-checkpoint/review/paragraph-final`.

> A composite checkpoint requires the complete justified selection for its stated case; selecting only some correct statements is insufficient.

Mechanical excerpt match: yes. Human locator confirmation: **pending**.

Supporting reference: https://docs.python.org/3.12/tutorial/

### pp-filter-evidence

Source: `pp-filter-source`; locator: `authored/pp-filter/explanation/paragraph-1`.

> Filtering decides which valid records contribute; accumulation combines their values without changing the rule halfway through the loop.

Mechanical excerpt match: yes. Human locator confirmation: **pending**.

Supporting reference: https://docs.python.org/3.12/tutorial/controlflow.html#for-statements

### pp-group-evidence

Source: `pp-group-source`; locator: `authored/pp-group/explanation/paragraph-1`.

> Grouping uses the normalized topic as a key and adds to its existing total rather than replacing earlier sessions.

Mechanical excerpt match: yes. Human locator confirmation: **pending**.

Supporting reference: https://docs.python.org/3.12/tutorial/datastructures.html#dictionaries

### pp-order-evidence

Source: `pp-order-source`; locator: `authored/pp-order/explanation/paragraph-1`.

> A deterministic report specifies a primary sort key and an explicit tie key instead of relying on whichever record happened to arrive first.

Mechanical excerpt match: yes. Human locator confirmation: **pending**.

Supporting reference: https://docs.python.org/3.12/howto/sorting.html#key-functions

### pp-module-2-checkpoint-evidence

Source: `pp-module-2-checkpoint-source`; locator: `authored/pp-module-2-checkpoint/review/paragraph-final`.

> A composite checkpoint requires the complete justified selection for its stated case; selecting only some correct statements is insufficient.

Mechanical excerpt match: yes. Human locator confirmation: **pending**.

Supporting reference: https://docs.python.org/3.12/tutorial/

### pp-functions-evidence

Source: `pp-functions-source`; locator: `authored/pp-functions/explanation/paragraph-1`.

> A function's inputs and returned result form a clearer testing boundary when it does not also change hidden shared state.

Mechanical excerpt match: yes. Human locator confirmation: **pending**.

Supporting reference: https://docs.python.org/3.12/tutorial/controlflow.html#defining-functions

### pp-pipeline-evidence

Source: `pp-pipeline-source`; locator: `authored/pp-pipeline/explanation/paragraph-1`.

> Validate and normalize the entire input before summarizing it, then order and present the resulting report without silently changing the accepted data.

Mechanical excerpt match: yes. Human locator confirmation: **pending**.

Supporting reference: https://docs.python.org/3.12/tutorial/controlflow.html#defining-functions

### pp-tests-evidence

Source: `pp-tests-source`; locator: `authored/pp-tests/explanation/paragraph-1`.

> An expected result must be justified independently of the implementation under test, and boundary cases should distinguish plausible wrong rules.

Mechanical excerpt match: yes. Human locator confirmation: **pending**.

Supporting reference: https://docs.python.org/3.12/library/unittest.html#basic-example

### pp-module-3-checkpoint-evidence

Source: `pp-module-3-checkpoint-source`; locator: `authored/pp-module-3-checkpoint/review/paragraph-final`.

> A composite checkpoint requires the complete justified selection for its stated case; selecting only some correct statements is insufficient.

Mechanical excerpt match: yes. Human locator confirmation: **pending**.

Supporting reference: https://docs.python.org/3.12/tutorial/

### pp-errors-evidence

Source: `pp-errors-source`; locator: `authored/pp-errors/explanation/paragraph-1`.

> A failure path should state which rule failed and prevent a normal-looking partial report from being mistaken for accepted output.

Mechanical excerpt match: yes. Human locator confirmation: **pending**.

Supporting reference: https://docs.python.org/3.12/tutorial/errors.html#handling-exceptions

### pp-integration-evidence

Source: `pp-integration-source`; locator: `authored/pp-integration/explanation/paragraph-1`.

> An integration trace follows validation, selection, totals, grouping and ordering together; agreement at only one intermediate stage is insufficient.

Mechanical excerpt match: yes. Human locator confirmation: **pending**.

Supporting reference: https://docs.python.org/3.12/tutorial/datastructures.html#looping-techniques

### pp-evidence-evidence

Source: `pp-evidence-source`; locator: `authored/pp-evidence/explanation/paragraph-1`.

> A saved explanation, a passing checkpoint and a submitted project are different evidence events; none alone proves that learner code executed correctly.

Mechanical excerpt match: yes. Human locator confirmation: **pending**.

Supporting reference: https://docs.python.org/3.12/library/unittest.html#basic-example

### pp-module-4-checkpoint-evidence

Source: `pp-module-4-checkpoint-source`; locator: `authored/pp-module-4-checkpoint/review/paragraph-final`.

> A composite checkpoint requires the complete justified selection for its stated case; selecting only some correct statements is insufficient.

Mechanical excerpt match: yes. Human locator confirmation: **pending**.

Supporting reference: https://docs.python.org/3.12/tutorial/

### pp-capstone-evidence

Source: `pp-capstone-source`; locator: `authored/pp-capstone/specification/final-paragraph`.

> No submitted code runs in StudyVault. Submission is
> not a correctness grade, an execution result or certification of mastery.

Mechanical excerpt match: yes. Human locator confirmation: **pending**.

Supporting reference: https://docs.python.org/3.12/tutorial/datastructures.html
Supporting reference: https://docs.python.org/3.12/library/unittest.html

## Instructional claim sample: all 40 blocks

### Claim 1: pp-contract / pp-contract-explanation

Module: `pp-module-1`. Evidence: `pp-contract-evidence`

A useful data contract states required fields, allowed types, boundaries and failure behavior before the calculation begins.

Our running task is to summarize study sessions, not to judge whether somebody
learned a topic. A session record describes an ID, topic, duration and completion
flag. Those field names alone do not answer important questions: may duration be
zero, is the upper boundary included, and should a malformed incomplete record
be ignored? An implementation cannot choose a correct policy until the task
defines one. Write those decisions down in ordinary language first.

For this course the duration interval is 1 through 180 minutes, both included.
The value must be an integer rather than a numeric-looking string, and Boolean
values are rejected even though Python treats bool as a subtype of int. The flag
must be an actual Boolean. Validate every record before reporting anything. A
bad record fails the dataset instead of quietly disappearing from the totals.
These are authored product rules, not universal laws of study tracking.

Separate input validity from report inclusion. A valid incomplete session is
accepted input but contributes no completed minutes. An invalid incomplete
session still causes rejection. This distinction prevents a filter from hiding
bad data. A contract should also state the output shape and avoid overstating
what it proves: minutes describe recorded activity, not mastery or readiness.

Before solving a new variant, make a two-column table: requirement and a small
example that would violate it. Include the lower and upper duration boundaries,
an unexpected field, a missing field, and a string flag. Then explain which
decisions came from the task and which came from Python's language behavior.


Human support: **pending**. Supporting reference/rationale and corrections: **pending**.

### Claim 2: pp-contract / pp-contract-example

Module: `pp-module-1`. Evidence: `pp-contract-evidence`

```python
# Read and reason only; this text is not executed by StudyVault.
valid = {"id": "a", "topic": "Python", "minutes": 1, "completed": False}
# Valid input, but contributes zero completed minutes.
invalid = {"id": "b", "topic": "Python", "minutes": 181, "completed": False}
# Invalid input even though it is incomplete: reject the dataset.

```

Human support: **pending**. Supporting reference/rationale and corrections: **pending**.

### Claim 3: pp-contract / pp-contract-activity

Module: `pp-module-1`. Evidence: `pp-contract-evidence`

Extended paper activity (planning estimate25–35minutes): Write the analyzer's input and output contract. Classify 0, 1, 180, 181, True and '30' as durations, explain each boundary, and invent two conflicting policies to show why the contract matters.

Explain your trace and assumptions before checking the independent question.

Human support: **pending**. Supporting reference/rationale and corrections: **pending**.

### Claim 4: pp-records / pp-records-explanation

Module: `pp-module-1`. Evidence: `pp-records-evidence`

A dictionary lookup uses a key, while a list lookup uses a position; copying a list alone does not copy its nested dictionaries.

A list is useful for the sequence of submitted sessions. Each dictionary is a
record whose keys name the meaning of its values. sessions[0] selects a record;
sessions[0]['minutes'] selects that record's duration. Swapping the order of a
dictionary's literal fields does not change which value the minutes key names.
Do not replace a named field with an assumed position merely because an example
prints fields in a convenient order.

Assignment can make two names refer to the same mutable dictionary. If alias =
record and alias['minutes'] is changed, reading record['minutes'] sees that change.
Likewise, list(sessions) creates a new outer list but retains the nested record
objects. A shallow outer copy is not permission to edit all nested values. Our
analyzer promises not to mutate the input, so build normalized output records or
separate totals instead of overwriting submitted records.

Required-field validation should happen before the direct lookups used in the
calculation. A missing field is a contract error, not a reason to fabricate a
duration of zero. Optional fields can have explicit defaults in a different
contract, but required and optional are deliberate distinctions. Avoid hiding
missing required information behind a convenient get default.

Draw the list and its record objects as separate boxes. Trace one list append,
one alias mutation and one fresh dictionary construction by hand. State which
operations affect the original input. The point is to reason about ownership,
not to memorize a single copy method or to claim every object requires a deep
copy. The safest transformation here never mutates the nested input at all.


Human support: **pending**. Supporting reference/rationale and corrections: **pending**.

### Claim 5: pp-records / pp-records-example

Module: `pp-module-1`. Evidence: `pp-records-evidence`

```python
sessions = [{"id": "a", "minutes": 25}, {"id": "b", "minutes": 40}]
record = sessions[0]
alias = record
alias["minutes"] = 30
# sessions[0]["minutes"] is now 30; both names refer to the same record.
normalized = {"id": record["id"], "minutes": record["minutes"]}
# normalized is a new dictionary; later edits to it need not edit record.

```

Human support: **pending**. Supporting reference/rationale and corrections: **pending**.

### Claim 6: pp-records / pp-records-activity

Module: `pp-module-1`. Evidence: `pp-records-evidence`

Extended paper activity (planning estimate25–35minutes): Draw the object-reference diagram for a two-record list and a shallow outer copy. Make a fresh normalized record on paper, then explain why changing that new record differs from changing an alias.

Explain your trace and assumptions before checking the independent question.

Human support: **pending**. Supporting reference/rationale and corrections: **pending**.

### Claim 7: pp-validation / pp-validation-explanation

Module: `pp-module-1`. Evidence: `pp-validation-evidence`

Normalization makes a chosen representation consistent; it does not excuse an invalid value or silently change the stated policy.

Our contract strips outer whitespace from IDs and topics. It does not merge
different capitalization: Python and python remain different topics. After
stripping, neither ID nor topic may be empty. Explain this policy before doing
it; otherwise a learner cannot know whether apparent duplicate labels should
combine. Do not turn a missing topic into an invented label.

Validation must be ordered so checks are meaningful. Confirm that a record has
the exact required field names, confirm string types before stripping them,
check the duration's exact type and range, and confirm the Boolean flag. A
string 'True' is not the actual flag True. For the duration, isinstance(True,
int) would accept a Boolean; the course's exact-type rule deliberately rejects
that value. Type rules are part of this application contract, not a claim that
Python's numeric relationships are wrong.

Keep a set of normalized IDs seen so far. Reject a repeated ID rather than
counting the same submitted event twice. Validate incomplete records too.
Crucially, do not publish a partial summary as the final result if a later record
fails. One simple design first constructs a validated normalized list and only
then passes it to summarization. This costs another pass but makes the boundary
between accepted data and reporting clear for a small bounded input.

Trace the order with a blank topic, a Boolean duration, and two IDs that become
equal after stripping. For each case, write the failing rule and the expected
absence of a report. Then discuss the tradeoff: normalization can reduce accidental
differences, but more aggressive normalization can merge records the task meant
to distinguish. The code should implement the written rule, not guess intent.


Human support: **pending**. Supporting reference/rationale and corrections: **pending**.

### Claim 8: pp-validation / pp-validation-example

Module: `pp-module-1`. Evidence: `pp-validation-evidence`

```python
raw_id = "  s-7 "
normalized_id = raw_id.strip()  # "s-7"
# A later record with id "s-7" is a duplicate under this contract.
# A topic "   " becomes blank and is rejected.
# minutes=True is rejected: type(True) is bool, not the required exact int.

```

Human support: **pending**. Supporting reference/rationale and corrections: **pending**.

### Claim 9: pp-validation / pp-validation-activity

Module: `pp-module-1`. Evidence: `pp-validation-evidence`

Extended paper activity (planning estimate25–35minutes): Construct a validation table containing a missing field, extra field, blank string, Boolean duration, duplicate normalized ID and incomplete invalid record. State which dataset is rejected and confirm no partial report is accepted.

Explain your trace and assumptions before checking the independent question.

Human support: **pending**. Supporting reference/rationale and corrections: **pending**.

### Claim 10: pp-module-1-checkpoint / pp-module-1-checkpoint-recap

Module: `pp-module-1`. Evidence: `pp-contract-evidence`, `pp-records-evidence`, `pp-validation-evidence`, `pp-module-1-checkpoint-evidence`

This checkpoint combines the preceding rules in one case. Select every justified statement; a partial selection is not a pass. The question alternatives are fresh variants,not separate required items. A solution reveal is learning support and cannot count as an independent pass.

A useful data contract states required fields, allowed types, boundaries and failure behavior before the calculation begins.

A dictionary lookup uses a key, while a list lookup uses a position; copying a list alone does not copy its nested dictionaries.

Normalization makes a chosen representation consistent; it does not excuse an invalid value or silently change the stated policy.

A composite checkpoint requires the complete justified selection for its stated case; selecting only some correct statements is insufficient.

Human support: **pending**. Supporting reference/rationale and corrections: **pending**.

### Claim 11: pp-filter / pp-filter-explanation

Module: `pp-module-2`. Evidence: `pp-filter-evidence`

Filtering decides which valid records contribute; accumulation combines their values without changing the rule halfway through the loop.

After validation, the analyzer can trust each record's shape and types. Now ask
a separate question: does this record's completed flag equal True? Only those
records contribute to the completed count and completed-minute total. An
incomplete but valid 40-minute record does not contribute 40 and is not itself an
error. Keep this distinction visible when tracing the algorithm.

Initialize total and count before the loop. For every included record, add its
minutes once and increment count once. A useful loop invariant is: after the
first k records, total equals the sum of completed minutes among those k records
and count equals their number. Check the invariant with a table after every
record; a final plausible answer alone can hide two mistakes that cancel out.

Starting total at the first record's minutes can accidentally include an
incomplete record or fail on an empty list. Starting inside the loop resets the
sum on each iteration. Our zero initialization handles both empty valid input
and all-incomplete input naturally. The summary contains no average, so empty
input needs no division and no fabricated denominator.

Work through a mixed sequence twice: once in its given order and once reordered.
The intermediate rows change but the count and total should agree, because the
contract's selection rule is independent of position. This is a useful test idea,
not proof of the entire program. It cannot detect every duplicated ID or type
error; those remain the responsibility of the validated-input boundary.


Human support: **pending**. Supporting reference/rationale and corrections: **pending**.

### Claim 12: pp-filter / pp-filter-example

Module: `pp-module-2`. Evidence: `pp-filter-evidence`

```python
# Assume all records have already passed validation.
count = 0
total = 0
for record in records:
    if record["completed"]:
        count += 1
        total += record["minutes"]
# For (25,True), (40,False), (35,True): count=2, total=60.

```

Human support: **pending**. Supporting reference/rationale and corrections: **pending**.

### Claim 13: pp-filter / pp-filter-activity

Module: `pp-module-2`. Evidence: `pp-filter-evidence`

Extended paper activity (planning estimate25–35minutes): Build an invariant table for the five capstone records. Then reverse the list, trace again, compare the totals and explain why starting total at records[0]['minutes'] is unsafe.

Explain your trace and assumptions before checking the independent question.

Human support: **pending**. Supporting reference/rationale and corrections: **pending**.

### Claim 14: pp-group / pp-group-explanation

Module: `pp-module-2`. Evidence: `pp-group-evidence`

Grouping uses the normalized topic as a key and adds to its existing total rather than replacing earlier sessions.

A single total answers how much completed activity was recorded, but a topic
summary needs one accumulator per topic. A dictionary maps each normalized topic
to the completed minutes seen for it so far. A new topic starts at zero; a later
session adds to its existing value. Assigning totals[topic] = minutes on every
record loses the earlier sessions for that topic.

Filter first or put the inclusion condition immediately around the update. In
either design, incomplete records must not create a positive completed total.
Our report omits a topic that has no completed records; a valid all-incomplete
dataset produces an empty topic list. This is a stated output policy rather than
an accidental consequence of iteration.

Build fresh result structures. Reading record['topic'] and record['minutes']
does not require editing the record. That avoids the aliasing problem from the
first module. A concise comprehension may be appropriate later, but a visible
loop is helpful while you learn the selection and accumulation rules. Clarity
lets a reviewer connect each update to the written contract.

Trace two topics interleaved with a repeated topic. After each record, write the
entire totals dictionary. Finally check that sum(totals.values()) equals the
completed-minute total from the previous lesson. If those differ, investigate
filtering and accumulation rather than merely adjusting the displayed final
number. This consistency check is useful but cannot alone prove the topics are
correctly named or that records were valid.


Human support: **pending**. Supporting reference/rationale and corrections: **pending**.

### Claim 15: pp-group / pp-group-example

Module: `pp-module-2`. Evidence: `pp-group-evidence`

```python
totals = {}
for record in valid_records:
    if record["completed"]:
        topic = record["topic"]
        totals[topic] = totals.get(topic, 0) + record["minutes"]
# Completed Python 25, SQL 30, Python 35 -> {'Python': 60, 'SQL': 30}.
# The input records are read, not overwritten.

```

Human support: **pending**. Supporting reference/rationale and corrections: **pending**.

### Claim 16: pp-group / pp-group-activity

Module: `pp-module-2`. Evidence: `pp-group-evidence`

Extended paper activity (planning estimate25–35minutes): Trace a topic dictionary after each of six interleaved records, including one incomplete record. Compare addition with overwrite, verify its sum against the overall total, and explain the first point where the incorrect algorithm diverges.

Explain your trace and assumptions before checking the independent question.

Human support: **pending**. Supporting reference/rationale and corrections: **pending**.

### Claim 17: pp-order / pp-order-explanation

Module: `pp-module-2`. Evidence: `pp-order-evidence`

A deterministic report specifies a primary sort key and an explicit tie key instead of relying on whichever record happened to arrive first.

The capstone report orders topics by decreasing completed minutes. Two equal
totals still need a policy. We choose increasing normalized topic text for ties.
This is a course reporting rule, not a statement that alphabetic order is always
the best product choice. Explain the tie key so a reader can predict the report
without knowing the original order of records.

Python's sorted builds a new sorted list. A tuple key is compared component by
component: (-minutes, topic) puts larger numeric totals first because their
negatives are smaller, then compares topic text for equal totals. In this
course's ASCII topic examples Math comes before Python. Do not claim this simple
text order is a human-language collation policy for every alphabet.

A sort that uses only -minutes can preserve prior insertion order on ties. That
behavior can be deterministic for one exact input but differ when the same
records are reordered. Stable sorting and an explicit secondary business rule
are different ideas. The report contract calls for the latter. The transformation
must also preserve the total values; sorting should change presentation, not
recalculate or discard contributions.

On paper, write the key for each (topic, total) pair, sort the keys, then map back
to rows. Include equal totals and a single topic. Compare results from two input
orders. Finish by describing which result properties are mathematical totals
and which are presentation choices. This makes tests more precise: total checks
alone cannot validate the report order.


Human support: **pending**. Supporting reference/rationale and corrections: **pending**.

### Claim 18: pp-order / pp-order-example

Module: `pp-module-2`. Evidence: `pp-order-evidence`

```python
pairs = [("Python", 20), ("SQL", 35), ("Math", 20)]
ordered = sorted(pairs, key=lambda pair: (-pair[1], pair[0]))
# [('SQL',35), ('Math',20), ('Python',20)]
# Keys: SQL -> (-35,'SQL'); Math -> (-20,'Math'); Python -> (-20,'Python').

```

Human support: **pending**. Supporting reference/rationale and corrections: **pending**.

### Claim 19: pp-order / pp-order-activity

Module: `pp-module-2`. Evidence: `pp-order-evidence`

Extended paper activity (planning estimate25–35minutes): Make two differently ordered inputs with equal topic totals. Derive each tuple key and the expected final row order. Contrast an explicit tie rule with an insertion-order tie and discuss the ASCII-only examples' limitation.

Explain your trace and assumptions before checking the independent question.

Human support: **pending**. Supporting reference/rationale and corrections: **pending**.

### Claim 20: pp-module-2-checkpoint / pp-module-2-checkpoint-recap

Module: `pp-module-2`. Evidence: `pp-filter-evidence`, `pp-group-evidence`, `pp-order-evidence`, `pp-module-2-checkpoint-evidence`

This checkpoint combines the preceding rules in one case. Select every justified statement; a partial selection is not a pass. The question alternatives are fresh variants,not separate required items. A solution reveal is learning support and cannot count as an independent pass.

Filtering decides which valid records contribute; accumulation combines their values without changing the rule halfway through the loop.

Grouping uses the normalized topic as a key and adds to its existing total rather than replacing earlier sessions.

A deterministic report specifies a primary sort key and an explicit tie key instead of relying on whichever record happened to arrive first.

A composite checkpoint requires the complete justified selection for its stated case; selecting only some correct statements is insufficient.

Human support: **pending**. Supporting reference/rationale and corrections: **pending**.

### Claim 21: pp-functions / pp-functions-explanation

Module: `pp-module-3`. Evidence: `pp-functions-evidence`

A function's inputs and returned result form a clearer testing boundary when it does not also change hidden shared state.

Think of summarize(valid_records) as a transformation from accepted data to a
fresh report. The caller supplies the records, the function calculates local
totals, and return hands a result back. A printed report is not the same thing
as a returned data structure. Printing may help a person read a result, but a
caller that needs totals should not have to scrape output text.

Local accumulator variables are created for each call. If an accumulator instead
lives in a shared global dictionary, a second call may add to the first call's
results. A test that calls the function once cannot expose that contamination.
Call the same function with the same valid data twice in a proposed test plan
and compare both outputs and the unchanged input. These are useful properties
for this pure transformation design.

Do not confuse rebinding a local name with mutating an argument. total += n on a
local integer accumulator does not edit the submitted record, while assigning to
record['minutes'] does. Returning a new report helps keep the ownership boundary
visible. Other applications legitimately have effects, but here the contract
explicitly promises no input mutation and no external writes.

Trace a small function call by drawing a new frame for its local count and total.
Follow the returned value into the caller. Then trace an intentionally faulty
global accumulator across two calls. Explain why a correct first output is not
sufficient evidence. The objective is to make results reproducible and reviewable,
not to label every short function 'pure' without examining what it touches.


Human support: **pending**. Supporting reference/rationale and corrections: **pending**.

### Claim 22: pp-functions / pp-functions-example

Module: `pp-module-3`. Evidence: `pp-functions-evidence`

```python
def add_completed(records):
    total = 0
    for record in records:
        if record["completed"]:
            total += record["minutes"]
    return total

# Two calls with the same unchanged valid records each return their own sum.
# They do not share a total variable from the previous call.

```

Human support: **pending**. Supporting reference/rationale and corrections: **pending**.

### Claim 23: pp-functions / pp-functions-activity

Module: `pp-module-3`. Evidence: `pp-functions-evidence`

Extended paper activity (planning estimate25–35minutes): Draw two call frames for the same records and compare returned data with printed text. Design a test that exposes a shared-global accumulator and a second test that detects an argument mutation.

Explain your trace and assumptions before checking the independent question.

Human support: **pending**. Supporting reference/rationale and corrections: **pending**.

### Claim 24: pp-pipeline / pp-pipeline-explanation

Module: `pp-module-3`. Evidence: `pp-pipeline-evidence`

Validate and normalize the entire input before summarizing it, then order and present the resulting report without silently changing the accepted data.

Decomposition is more useful when each function has one clear responsibility
than when an arbitrary number of lines is moved into helpers. A normalizer can
return fresh valid records or an error. A summarizer can consume those accepted
records and return counts and grouped totals. A presenter can order the topic
rows and format a report. State the input/output contract of each boundary.

The ordering matters. If aggregation runs before validation, an invalid later
record may leave a plausible partial total. If filtering out incomplete records
happens before their validation, malformed incomplete records can bypass the
dataset contract. A helper's convenient name does not prove it has preserved the
policy. Trace the data that crosses each boundary.

Passing ordinary data rather than a preformatted report between helpers keeps
tests precise. Test normalization on one invalid record without involving
sorting. Test summation on a short already-valid list. Test ordering on two equal
topic totals. Then add an integration test that checks their composition. A
unit test can isolate a failure, but only a whole-pipeline example can catch a
caller using the helpers in the wrong order.

Draw the pipeline as four boxes with a success arrow and one error exit from
validation. Write the shape of the data on every arrow. Finally remove a helper
and explain what becomes harder to test or reason about. Do not introduce files,
network calls, databases or a framework merely to make this small transformation
look sophisticated; those are outside this authored contract.


Human support: **pending**. Supporting reference/rationale and corrections: **pending**.

### Claim 25: pp-pipeline / pp-pipeline-example

Module: `pp-module-3`. Evidence: `pp-pipeline-evidence`

```python
# Proposed order, shown as inert pseudocode:
normalized_records = validate_and_normalize(all_records)
summary = summarize(normalized_records)
ordered_topics = order_topic_rows(summary["topic_totals"])
report = present(summary, ordered_topics)
# If validation fails, no later step produces a final report.

```

Human support: **pending**. Supporting reference/rationale and corrections: **pending**.

### Claim 26: pp-pipeline / pp-pipeline-activity

Module: `pp-module-3`. Evidence: `pp-pipeline-evidence`

Extended paper activity (planning estimate25–35minutes): Specify each helper's input, output and failure behavior. Trace an invalid final record, identify which functions must not run, and design one isolated test plus one end-to-end test for the same pipeline.

Explain your trace and assumptions before checking the independent question.

Human support: **pending**. Supporting reference/rationale and corrections: **pending**.

### Claim 27: pp-tests / pp-tests-explanation

Module: `pp-module-3`. Evidence: `pp-tests-evidence`

An expected result must be justified independently of the implementation under test, and boundary cases should distinguish plausible wrong rules.

A test consists of a chosen input, an expected outcome and a reason that outcome
follows from the contract. Copying a program's current output into the expected
column only records what it did; it does not establish correctness. Derive small
totals by hand, write down which records are excluded, and verify the result with
another representation such as a trace table.

Normal cases are necessary but weak on their own. A duration of 30 cannot tell
whether an incorrect strict upper-bound check rejects 180. Use 1 and 180 as
accepted boundary cases and 0 and 181 as rejected neighbors. Use empty input,
all-incomplete input, duplicate normalized IDs, a blank topic and Boolean minutes
to test different rules. State why each case is in the suite instead of collecting
many large examples that all exercise the same happy path.

Tests should also check important properties beyond one final number. Reordering
valid records should not change the completed count or topic totals, while the
explicit tie rule should make the report row order agree. Repeating a call should
not accumulate old state. An unchanged input check can expose an alias mutation.
None of these properties makes the function universally correct; they target
specific failure modes that a human can review.

Make a table with columns case ID, input, expected report/error, rule and a named
fault the test catches. Add one deliberately insufficient test and explain why
both a correct and faulty implementation would pass it. Test design is an
argument about evidence, not a count of green indicators. The app stores your
project text; it does not run it or award a code correctness grade.


Human support: **pending**. Supporting reference/rationale and corrections: **pending**.

### Claim 28: pp-tests / pp-tests-example

Module: `pp-module-3`. Evidence: `pp-tests-evidence`

```python
# Proposed test cases, not executed learner code:
# duration=180 -> valid: catches an incorrect minutes < 180 boundary.
# duration=True -> invalid: catches an isinstance(minutes, int)-only check.
# [] -> count0,total0,topics[]: catches first-record initialization.
# repeat the same valid call -> same report: catches shared accumulation.

```

Human support: **pending**. Supporting reference/rationale and corrections: **pending**.

### Claim 29: pp-tests / pp-tests-activity

Module: `pp-module-3`. Evidence: `pp-tests-evidence`

Extended paper activity (planning estimate25–35minutes): Design at least eight cases and name the fault caught by each. Independently calculate one normal report, then compare which faults are not detected by a suite containing only ordinary 30-minute sessions.

Explain your trace and assumptions before checking the independent question.

Human support: **pending**. Supporting reference/rationale and corrections: **pending**.

### Claim 30: pp-module-3-checkpoint / pp-module-3-checkpoint-recap

Module: `pp-module-3`. Evidence: `pp-functions-evidence`, `pp-pipeline-evidence`, `pp-tests-evidence`, `pp-module-3-checkpoint-evidence`

This checkpoint combines the preceding rules in one case. Select every justified statement; a partial selection is not a pass. The question alternatives are fresh variants,not separate required items. A solution reveal is learning support and cannot count as an independent pass.

A function's inputs and returned result form a clearer testing boundary when it does not also change hidden shared state.

Validate and normalize the entire input before summarizing it, then order and present the resulting report without silently changing the accepted data.

An expected result must be justified independently of the implementation under test, and boundary cases should distinguish plausible wrong rules.

A composite checkpoint requires the complete justified selection for its stated case; selecting only some correct statements is insufficient.

Human support: **pending**. Supporting reference/rationale and corrections: **pending**.

### Claim 31: pp-errors / pp-errors-explanation

Module: `pp-module-4`. Evidence: `pp-errors-evidence`

A failure path should state which rule failed and prevent a normal-looking partial report from being mistaken for accepted output.

An exception is one possible way for a Python function to signal invalid input;
a structured error return is another design. Our educational contract does not
require a particular UI or framework. It requires the same observable policy:
invalid input produces no accepted report, and the explanation identifies a
meaningful rule without pretending the data was repaired.

For a Boolean duration, invalid_minutes is more useful review evidence than a
catch-all 'something happened.' For a repeated normalized ID, duplicate_id tells
the caller which uniqueness rule needs attention. Do not expose unrelated
internal details or claim a source fact changed merely because a user entered a
bad record. Errors about input validity and comments about learning progress are
different kinds of information.

Avoid a broad catch that returns whatever total has accumulated so far. That
can turn a genuine failure into a plausible but incomplete answer. Likewise,
catching a missing key and silently substituting zero violates the required-field
contract. Catch specific failures only when you can preserve the stated meaning;
otherwise allow the validation error to reach the designated error boundary.

Trace one valid record followed by an invalid record. Write the local work that
may have occurred and the single observable error result that is allowed. Then
compare a failure-before-calculation design with a design that validates while
collecting fresh records but still never publishes partial output. Both can
respect the policy if no partial report is accepted; a hidden catch that changes
the policy cannot. Your project explanation should make this choice reviewable.


Human support: **pending**. Supporting reference/rationale and corrections: **pending**.

### Claim 32: pp-errors / pp-errors-example

Module: `pp-module-4`. Evidence: `pp-errors-evidence`

```python
# Inert pseudocode illustrating the policy, not a required API:
normalized = validate_every_record(records)  # may signal invalid_minutes
# Only a successful validation result reaches the following line.
report = summarize(normalized)
# Do not catch invalid_minutes merely to return an earlier partial total.

```

Human support: **pending**. Supporting reference/rationale and corrections: **pending**.

### Claim 33: pp-errors / pp-errors-activity

Module: `pp-module-4`. Evidence: `pp-errors-evidence`

Extended paper activity (planning estimate25–35minutes): Trace late invalid input and write an error message for each contract rule. Compare exceptions with structured errors, explain why silent skip/default behavior is disallowed, and identify the exact point a normal report becomes accepted.

Explain your trace and assumptions before checking the independent question.

Human support: **pending**. Supporting reference/rationale and corrections: **pending**.

### Claim 34: pp-integration / pp-integration-explanation

Module: `pp-module-4`. Evidence: `pp-integration-evidence`

An integration trace follows validation, selection, totals, grouping and ordering together; agreement at only one intermediate stage is insufficient.

Use the five fixed capstone records, not a changing remote dataset. First check
their fields, types, duration bounds and unique normalized IDs. Then mark the
four completed records. The incomplete SQL40 record stays valid input but does
not contribute to the completed report. The completed count is four and the
completed-minute total is 25+35+20+30=110.

Group the same included records: Python receives 60 minutes, SQL30 and Math20.
Their sum is again 110. This reconciles the global and grouped totals. Order the
topic rows by the stated key to produce Python60, SQL30, Math20. A display that
shows 110 but omits Math is not correct; a grouped sum of110 with two wrongly
labelled topics is not proven correct by its sum either.

Now change one assumption at a time. Mark SQL40 complete and recompute both
global and per-topic totals. Change a valid duration to181 and explain why the
correct result is an error, not the new arithmetic total. Reverse the valid
input and check that the report still follows the explicit ordering rule. This
distinguishes rules that depend on content from incidental input order.

Your final manual trace should be understandable without running the code. Show
the included-record markers, accumulator changes, topic rows and resulting
report. Keep expected results separate from any implementation output. Those
artifacts let a human assess the reasoning while the app's execution gate remains
closed. They do not turn a read-and-reason submission into evidence of successful
runtime execution or measured learner competence.


Human support: **pending**. Supporting reference/rationale and corrections: **pending**.

### Claim 35: pp-integration / pp-integration-example

Module: `pp-module-4`. Evidence: `pp-integration-evidence`

```python
[
  {
    "id": "s-1",
    "topic": "Python",
    "minutes": 25,
    "completed": true
  },
  {
    "id": "s-2",
    "topic": "SQL",
    "minutes": 40,
    "completed": false
  },
  {
    "id": "s-3",
    "topic": "Python",
    "minutes": 35,
    "completed": true
  },
  {
    "id": "s-4",
    "topic": "Math",
    "minutes": 20,
    "completed": true
  },
  {
    "id": "s-5",
    "topic": "SQL",
    "minutes": 30,
    "completed": true
  }
]
# Expected: count4,total110,topics Python60 / SQL30 / Math20.

```

Human support: **pending**. Supporting reference/rationale and corrections: **pending**.

### Claim 36: pp-integration / pp-integration-activity

Module: `pp-module-4`. Evidence: `pp-integration-evidence`

Extended paper activity (planning estimate25–35minutes): Complete the five-record trace and reconciliation. Mark SQL40 complete and derive the changed report; then replace one duration with181 and explain why no arithmetic report is accepted. Check that reversed valid input yields the same ordered report.

Explain your trace and assumptions before checking the independent question.

Human support: **pending**. Supporting reference/rationale and corrections: **pending**.

### Claim 37: pp-evidence / pp-evidence-explanation

Module: `pp-module-4`. Evidence: `pp-evidence-evidence`

A saved explanation, a passing checkpoint and a submitted project are different evidence events; none alone proves that learner code executed correctly.

The analyzer describes recorded completed activity under an authored contract.
It cannot infer that25minutes caused learning, that a topic was mastered, or
that the learner is ready for a career. Those would need different measures and
validation. A careful report states the data and assumptions it used instead of
turning an activity count into a capability claim.

Course evidence links should identify the exact authored explanation that
supports a rule or reasoning step. The explicit duration range comes from this
project's specification. Dictionary and function behavior is supported by the
versioned Python3.12 references. Those are different sources of authority. A
link to a Python tutorial does not by itself establish our product's180-minute
maximum, and an exact quote locator does not automatically prove every sentence
in a learner explanation is semantically supported.

The app records answers to deterministic static checkpoints separately from a
capstone submission. A required capstone can be submitted with structured text,
expected cases and selected evidence, but it still needs human rubric review.
An evidence checkbox, word count or model-generated comment is not a correctness
grade. Explain limitations rather than silently promoting submission to mastery.

Prepare a short design note with a claim, its supporting authored evidence ID,
and a sentence explaining the connection. Include one deliberately unsupported
claim and explain why the source cannot establish it. End with the execution
limitation: StudyVault does not execute the submitted Python, SQL or shell code.
The reviewable result here is a reasoned project artifact, not a measured runtime
or automatically certified program.


Human support: **pending**. Supporting reference/rationale and corrections: **pending**.

### Claim 38: pp-evidence / pp-evidence-example

Module: `pp-module-4`. Evidence: `pp-evidence-evidence`

```python
Claim: The example's completed-minute total is110.
Support: pp-integration-evidence and the fixed-record trace.
Limitation:110 recorded minutes do not establish mastery of Python.
Submission status: submitted for human review; code was not executed by StudyVault.

```

Human support: **pending**. Supporting reference/rationale and corrections: **pending**.

### Claim 39: pp-evidence / pp-evidence-activity

Module: `pp-module-4`. Evidence: `pp-evidence-evidence`

Extended paper activity (planning estimate25–35minutes): Write three supported design claims and their exact evidence IDs, plus two claims the report cannot establish. Distinguish specification authority from language references, and draft a limitation statement for your capstone.

Explain your trace and assumptions before checking the independent question.

Human support: **pending**. Supporting reference/rationale and corrections: **pending**.

### Claim 40: pp-module-4-checkpoint / pp-module-4-checkpoint-recap

Module: `pp-module-4`. Evidence: `pp-contract-evidence`, `pp-records-evidence`, `pp-validation-evidence`, `pp-filter-evidence`, `pp-group-evidence`, `pp-order-evidence`, `pp-functions-evidence`, `pp-pipeline-evidence`, `pp-tests-evidence`, `pp-errors-evidence`, `pp-integration-evidence`, `pp-evidence-evidence`, `pp-module-4-checkpoint-evidence`

This checkpoint combines the preceding rules in one case. Select every justified statement; a partial selection is not a pass. The question alternatives are fresh variants,not separate required items. A solution reveal is learning support and cannot count as an independent pass.

A useful data contract states required fields, allowed types, boundaries and failure behavior before the calculation begins.

A dictionary lookup uses a key, while a list lookup uses a position; copying a list alone does not copy its nested dictionaries.

Normalization makes a chosen representation consistent; it does not excuse an invalid value or silently change the stated policy.

Filtering decides which valid records contribute; accumulation combines their values without changing the rule halfway through the loop.

Grouping uses the normalized topic as a key and adds to its existing total rather than replacing earlier sessions.

A deterministic report specifies a primary sort key and an explicit tie key instead of relying on whichever record happened to arrive first.

A function's inputs and returned result form a clearer testing boundary when it does not also change hidden shared state.

Validate and normalize the entire input before summarizing it, then order and present the resulting report without silently changing the accepted data.

An expected result must be justified independently of the implementation under test, and boundary cases should distinguish plausible wrong rules.

A failure path should state which rule failed and prevent a normal-looking partial report from being mistaken for accepted output.

An integration trace follows validation, selection, totals, grouping and ordering together; agreement at only one intermediate stage is insufficient.

A saved explanation, a passing checkpoint and a submitted project are different evidence events; none alone proves that learner code executed correctly.

A composite checkpoint requires the complete justified selection for its stated case; selecting only some correct statements is insufficient.

Human support: **pending**. Supporting reference/rationale and corrections: **pending**.

## Assessment keys: editor only

Check each prompt and every alternative against independently derived reasoning. A server fixture accepting its own key does not prove that key is correct.

### Key 1: pp-contract-practice

Lesson: `pp-contract`; module: `pp-module-1`; mode: practice; kind: choice.

Under the stated 1..180 exact-integer contract, which duration is valid?

- `one`: 1
- `zero`: 0
- `bool`: True
- `text`: '30'

Expected server key: `"one"`

1 is an integer inside the inclusive interval.

Human key correctness: **pending**. Severe issue: **unknown**. Corrections: **pending**.

### Key 2: pp-contract-checkpoint-1

Lesson: `pp-contract`; module: `pp-module-1`; mode: checkpoint; kind: choice.

A completed flag is False. Its duration is 1. What should validation do?

- `accept`: Accept as valid input; exclude it from completed totals
- `reject`: Reject the dataset as invalid input
- `ignore`: Skip all validation because it is incomplete

Expected server key: `"accept"`

1 is the included lower boundary.

Human key correctness: **pending**. Severe issue: **unknown**. Corrections: **pending**.

### Key 3: pp-contract-checkpoint-2

Lesson: `pp-contract`; module: `pp-module-1`; mode: checkpoint; kind: choice.

A completed flag is False. Its duration is 180. What should validation do?

- `accept`: Accept as valid input; exclude it from completed totals
- `reject`: Reject the dataset as invalid input
- `ignore`: Skip all validation because it is incomplete

Expected server key: `"accept"`

180 is the included upper boundary.

Human key correctness: **pending**. Severe issue: **unknown**. Corrections: **pending**.

### Key 4: pp-contract-checkpoint-3

Lesson: `pp-contract`; module: `pp-module-1`; mode: checkpoint; kind: choice.

A completed flag is False. Its duration is 0. What should validation do?

- `accept`: Accept as valid input; exclude it from completed totals
- `reject`: Reject the dataset as invalid input
- `ignore`: Skip all validation because it is incomplete

Expected server key: `"reject"`

0 lies below the allowed interval.

Human key correctness: **pending**. Severe issue: **unknown**. Corrections: **pending**.

### Key 5: pp-contract-checkpoint-4

Lesson: `pp-contract`; module: `pp-module-1`; mode: checkpoint; kind: choice.

A completed flag is False. Its duration is 181. What should validation do?

- `accept`: Accept as valid input; exclude it from completed totals
- `reject`: Reject the dataset as invalid input
- `ignore`: Skip all validation because it is incomplete

Expected server key: `"reject"`

181 lies above the allowed interval.

Human key correctness: **pending**. Severe issue: **unknown**. Corrections: **pending**.

### Key 6: pp-records-practice

Lesson: `pp-records`; module: `pp-module-1`; mode: practice; kind: number.

For rows = [{'minutes': 25}, {'minutes': 40}], what is rows[1]['minutes']?


Expected server key: `40`

Position 1 selects the second record, whose minutes is 40.

Human key correctness: **pending**. Severe issue: **unknown**. Corrections: **pending**.

### Key 7: pp-records-checkpoint-1

Lesson: `pp-records`; module: `pp-module-1`; mode: checkpoint; kind: number.

record = {'minutes': 12}; alias = record; alias['minutes'] += 3. What is record['minutes']?


Expected server key: `15`

The shared dictionary now contains 15 minutes.

Human key correctness: **pending**. Severe issue: **unknown**. Corrections: **pending**.

### Key 8: pp-records-checkpoint-2

Lesson: `pp-records`; module: `pp-module-1`; mode: checkpoint; kind: number.

record = {'minutes': 18}; alias = record; alias['minutes'] += 2. What is record['minutes']?


Expected server key: `20`

The shared dictionary now contains 20 minutes.

Human key correctness: **pending**. Severe issue: **unknown**. Corrections: **pending**.

### Key 9: pp-records-checkpoint-3

Lesson: `pp-records`; module: `pp-module-1`; mode: checkpoint; kind: number.

record = {'minutes': 24}; alias = record; alias['minutes'] += 6. What is record['minutes']?


Expected server key: `30`

The shared dictionary now contains 30 minutes.

Human key correctness: **pending**. Severe issue: **unknown**. Corrections: **pending**.

### Key 10: pp-records-checkpoint-4

Lesson: `pp-records`; module: `pp-module-1`; mode: checkpoint; kind: number.

record = {'minutes': 35}; alias = record; alias['minutes'] += 5. What is record['minutes']?


Expected server key: `40`

The shared dictionary now contains 40 minutes.

Human key correctness: **pending**. Severe issue: **unknown**. Corrections: **pending**.

### Key 11: pp-validation-practice

Lesson: `pp-validation`; module: `pp-module-1`; mode: practice; kind: choice.

After stripping IDs, are ' s-7 ' and 's-7' unique events under this contract?

- `unique`: Yes, because their original strings differ
- `duplicate`: No; the normalized IDs duplicate one another

Expected server key: `"duplicate"`

Both normalize to s-7.

Human key correctness: **pending**. Severe issue: **unknown**. Corrections: **pending**.

### Key 12: pp-validation-checkpoint-1

Lesson: `pp-validation`; module: `pp-module-1`; mode: checkpoint; kind: choice.

A record has id='a', topic=' Math ', minutes=10, completed=True. Is it valid (assuming unique ID and exact fields)?

- `valid`: Valid
- `invalid`: Invalid

Expected server key: `"valid"`

The topic normalizes to Math and all other fields pass.

Human key correctness: **pending**. Severe issue: **unknown**. Corrections: **pending**.

### Key 13: pp-validation-checkpoint-2

Lesson: `pp-validation`; module: `pp-module-1`; mode: checkpoint; kind: choice.

A record has id='a', topic='   ', minutes=10, completed=True. Is it valid (assuming unique ID and exact fields)?

- `valid`: Valid
- `invalid`: Invalid

Expected server key: `"invalid"`

Stripping leaves a blank topic.

Human key correctness: **pending**. Severe issue: **unknown**. Corrections: **pending**.

### Key 14: pp-validation-checkpoint-3

Lesson: `pp-validation`; module: `pp-module-1`; mode: checkpoint; kind: choice.

A record has id='a', topic='Math', minutes=True, completed=False. Is it valid (assuming unique ID and exact fields)?

- `valid`: Valid
- `invalid`: Invalid

Expected server key: `"invalid"`

A Boolean is rejected as the duration.

Human key correctness: **pending**. Severe issue: **unknown**. Corrections: **pending**.

### Key 15: pp-validation-checkpoint-4

Lesson: `pp-validation`; module: `pp-module-1`; mode: checkpoint; kind: choice.

A record has id='a', topic='Math', minutes=10, completed='False'. Is it valid (assuming unique ID and exact fields)?

- `valid`: Valid
- `invalid`: Invalid

Expected server key: `"invalid"`

The text 'False' is not a Boolean flag.

Human key correctness: **pending**. Severe issue: **unknown**. Corrections: **pending**.

### Key 16: pp-module-1-checkpoint-practice

Lesson: `pp-module-1-checkpoint`; module: `pp-module-1`; mode: practice; kind: multiple.

Prepare for Reliable input contracts. Select EVERY sound review action.

- `contract`: Restate the relevant input/output and failure rules
- `trace`: Trace the stated case and explain each inclusion or rejection
- `derive`: Derive expected results from the contract rather than copying program output
- `guess`: Mark every option correct whenever a final total looks plausible

Expected server key: `["contract", "trace", "derive"]`

Restate the rules,trace the case,and independently justify results. Guessing from appearance is insufficient.

Human key correctness: **pending**. Severe issue: **unknown**. Corrections: **pending**.

### Key 17: pp-module-1-checkpoint-1

Lesson: `pp-module-1-checkpoint`; module: `pp-module-1`; mode: checkpoint; kind: multiple.

Module1 case: record A has id=' a ',topic='Math',minutes=20,completed=False; record B has id='a',topic='SQL',minutes=10,completed=True. Select EVERY true statement.

- `normalized`: A's normalized ID is a
- `duplicate`: Together A and B violate the normalized-ID uniqueness rule
- `type`: A's integer duration20 passes the duration type/range rule
- `skip`: A needs no validation because it is incomplete
- `report`: The pair must produce a successful partial10-minute report
- `positions`: A's dictionary fields must be read by numeric position

Expected server key: `["normalized", "duplicate", "type"]`

Strip A's ID to a; its duration is valid, but B duplicates that ID, so reject the pair.

Human key correctness: **pending**. Severe issue: **unknown**. Corrections: **pending**.

### Key 18: pp-module-1-checkpoint-2

Lesson: `pp-module-1-checkpoint`; module: `pp-module-1`; mode: checkpoint; kind: multiple.

Module1 case: record A has id=' a ',topic='Math',minutes=25,completed=False; record B has id='a',topic='SQL',minutes=10,completed=True. Select EVERY true statement.

- `normalized`: A's normalized ID is a
- `duplicate`: Together A and B violate the normalized-ID uniqueness rule
- `type`: A's integer duration25 passes the duration type/range rule
- `skip`: A needs no validation because it is incomplete
- `report`: The pair must produce a successful partial10-minute report
- `positions`: A's dictionary fields must be read by numeric position

Expected server key: `["normalized", "duplicate", "type"]`

Strip A's ID to a; its duration is valid, but B duplicates that ID, so reject the pair.

Human key correctness: **pending**. Severe issue: **unknown**. Corrections: **pending**.

### Key 19: pp-module-1-checkpoint-3

Lesson: `pp-module-1-checkpoint`; module: `pp-module-1`; mode: checkpoint; kind: multiple.

Module1 case: record A has id=' a ',topic='Math',minutes=30,completed=False; record B has id='a',topic='SQL',minutes=10,completed=True. Select EVERY true statement.

- `normalized`: A's normalized ID is a
- `duplicate`: Together A and B violate the normalized-ID uniqueness rule
- `type`: A's integer duration30 passes the duration type/range rule
- `skip`: A needs no validation because it is incomplete
- `report`: The pair must produce a successful partial10-minute report
- `positions`: A's dictionary fields must be read by numeric position

Expected server key: `["normalized", "duplicate", "type"]`

Strip A's ID to a; its duration is valid, but B duplicates that ID, so reject the pair.

Human key correctness: **pending**. Severe issue: **unknown**. Corrections: **pending**.

### Key 20: pp-module-1-checkpoint-4

Lesson: `pp-module-1-checkpoint`; module: `pp-module-1`; mode: checkpoint; kind: multiple.

Module1 case: record A has id=' a ',topic='Math',minutes=35,completed=False; record B has id='a',topic='SQL',minutes=10,completed=True. Select EVERY true statement.

- `normalized`: A's normalized ID is a
- `duplicate`: Together A and B violate the normalized-ID uniqueness rule
- `type`: A's integer duration35 passes the duration type/range rule
- `skip`: A needs no validation because it is incomplete
- `report`: The pair must produce a successful partial10-minute report
- `positions`: A's dictionary fields must be read by numeric position

Expected server key: `["normalized", "duplicate", "type"]`

Strip A's ID to a; its duration is valid, but B duplicates that ID, so reject the pair.

Human key correctness: **pending**. Severe issue: **unknown**. Corrections: **pending**.

### Key 21: pp-filter-practice

Lesson: `pp-filter`; module: `pp-module-2`; mode: practice; kind: number.

Valid durations/flags are (25,True), (40,False), (35,True). What is the completed total?


Expected server key: `60`

25 + 35 is 60.

Human key correctness: **pending**. Severe issue: **unknown**. Corrections: **pending**.

### Key 22: pp-filter-checkpoint-1

Lesson: `pp-filter`; module: `pp-module-2`; mode: checkpoint; kind: number.

Valid durations/flags are (12,True), (50,False), (18,True). What is the completed total?


Expected server key: `30`

The completed total is 12 + 18 = 30.

Human key correctness: **pending**. Severe issue: **unknown**. Corrections: **pending**.

### Key 23: pp-filter-checkpoint-2

Lesson: `pp-filter`; module: `pp-module-2`; mode: checkpoint; kind: number.

Valid durations/flags are (15,True), (20,False), (25,True). What is the completed total?


Expected server key: `40`

The completed total is 15 + 25 = 40.

Human key correctness: **pending**. Severe issue: **unknown**. Corrections: **pending**.

### Key 24: pp-filter-checkpoint-3

Lesson: `pp-filter`; module: `pp-module-2`; mode: checkpoint; kind: number.

Valid durations/flags are (1,True), (180,False), (9,True). What is the completed total?


Expected server key: `10`

The completed total is 1 + 9 = 10.

Human key correctness: **pending**. Severe issue: **unknown**. Corrections: **pending**.

### Key 25: pp-filter-checkpoint-4

Lesson: `pp-filter`; module: `pp-module-2`; mode: checkpoint; kind: number.

Valid durations/flags are (60,True), (30,False), (45,True). What is the completed total?


Expected server key: `105`

The completed total is 60 + 45 = 105.

Human key correctness: **pending**. Severe issue: **unknown**. Corrections: **pending**.

### Key 26: pp-group-practice

Lesson: `pp-group`; module: `pp-module-2`; mode: practice; kind: number.

Completed Python sessions have 25 and 35 minutes; SQL has 30. What is Python's grouped total?


Expected server key: `60`

25 + 35 is 60.

Human key correctness: **pending**. Severe issue: **unknown**. Corrections: **pending**.

### Key 27: pp-group-checkpoint-1

Lesson: `pp-group`; module: `pp-module-2`; mode: checkpoint; kind: number.

A grouping loop uses totals[t] = totals.get(t,0) + minutes. Completed topic X appears with 10 and 15 minutes. What is totals['X']?


Expected server key: `25`

The total is 25, not only 15.

Human key correctness: **pending**. Severe issue: **unknown**. Corrections: **pending**.

### Key 28: pp-group-checkpoint-2

Lesson: `pp-group`; module: `pp-module-2`; mode: checkpoint; kind: number.

A grouping loop uses totals[t] = totals.get(t,0) + minutes. Completed topic X appears with 1 and 1 minutes. What is totals['X']?


Expected server key: `2`

The total is 2, not only 1.

Human key correctness: **pending**. Severe issue: **unknown**. Corrections: **pending**.

### Key 29: pp-group-checkpoint-3

Lesson: `pp-group`; module: `pp-module-2`; mode: checkpoint; kind: number.

A grouping loop uses totals[t] = totals.get(t,0) + minutes. Completed topic X appears with 60 and 40 minutes. What is totals['X']?


Expected server key: `100`

The total is 100, not only 40.

Human key correctness: **pending**. Severe issue: **unknown**. Corrections: **pending**.

### Key 30: pp-group-checkpoint-4

Lesson: `pp-group`; module: `pp-module-2`; mode: checkpoint; kind: number.

A grouping loop uses totals[t] = totals.get(t,0) + minutes. Completed topic X appears with 75 and 5 minutes. What is totals['X']?


Expected server key: `80`

The total is 80, not only 5.

Human key correctness: **pending**. Severe issue: **unknown**. Corrections: **pending**.

### Key 31: pp-order-practice

Lesson: `pp-order`; module: `pp-module-2`; mode: practice; kind: ordered.

Order rows by descending minutes then ascending topic: Python20, SQL35, Math20.

- `python`: Python20
- `sql`: SQL35
- `math`: Math20

Expected server key: `["sql", "math", "python"]`

SQL35 precedes Math20 and Python20; Math precedes Python.

Human key correctness: **pending**. Severe issue: **unknown**. Corrections: **pending**.

### Key 32: pp-order-checkpoint-1

Lesson: `pp-order`; module: `pp-module-2`; mode: checkpoint; kind: ordered.

Use descending minutes then ascending topic. Order Python30, Math20, SQL30.

- `python`: Python30
- `math`: Math20
- `sql`: SQL30

Expected server key: `["python", "sql", "math"]`

Python and SQL tie at30; Python precedes SQL.

Human key correctness: **pending**. Severe issue: **unknown**. Corrections: **pending**.

### Key 33: pp-order-checkpoint-2

Lesson: `pp-order`; module: `pp-module-2`; mode: checkpoint; kind: ordered.

Use descending minutes then ascending topic. Order Python20, Math30, SQL30.

- `python`: Python20
- `math`: Math30
- `sql`: SQL30

Expected server key: `["math", "sql", "python"]`

Math and SQL tie at30; Math precedes SQL.

Human key correctness: **pending**. Severe issue: **unknown**. Corrections: **pending**.

### Key 34: pp-order-checkpoint-3

Lesson: `pp-order`; module: `pp-module-2`; mode: checkpoint; kind: ordered.

Use descending minutes then ascending topic. Order Python35, Math20, SQL10.

- `python`: Python35
- `math`: Math20
- `sql`: SQL10

Expected server key: `["python", "math", "sql"]`

All totals differ:35,20,10 in descending order.

Human key correctness: **pending**. Severe issue: **unknown**. Corrections: **pending**.

### Key 35: pp-order-checkpoint-4

Lesson: `pp-order`; module: `pp-module-2`; mode: checkpoint; kind: ordered.

Use descending minutes then ascending topic. Order Python20, Math20, SQL40.

- `python`: Python20
- `math`: Math20
- `sql`: SQL40

Expected server key: `["sql", "math", "python"]`

SQL is largest; Math precedes Python on the20 tie.

Human key correctness: **pending**. Severe issue: **unknown**. Corrections: **pending**.

### Key 36: pp-module-2-checkpoint-practice

Lesson: `pp-module-2-checkpoint`; module: `pp-module-2`; mode: practice; kind: multiple.

Prepare for Deterministic transformations. Select EVERY sound review action.

- `contract`: Restate the relevant input/output and failure rules
- `trace`: Trace the stated case and explain each inclusion or rejection
- `derive`: Derive expected results from the contract rather than copying program output
- `guess`: Mark every option correct whenever a final total looks plausible

Expected server key: `["contract", "trace", "derive"]`

Restate the rules,trace the case,and independently justify results. Guessing from appearance is insufficient.

Human key correctness: **pending**. Severe issue: **unknown**. Corrections: **pending**.

### Key 37: pp-module-2-checkpoint-1

Lesson: `pp-module-2-checkpoint`; module: `pp-module-2`; mode: checkpoint; kind: multiple.

Module2 case: completed Python20, completed Math20, incomplete SQL40, completed Python10. All input validates. Select EVERY true report statement.

- `total`: The total is50
- `python`: Python's grouped total is30
- `order`: Ordered topics are Python30, then Math20
- `sql`: Incomplete SQL40 adds40 to the completed total
- `overwrite`: Python's total should be overwritten with the final10
- `mutation`: The original records must be edited to build totals

Expected server key: `["total", "python", "order"]`

Filter SQL40, add repeated Python contributions, then order:30>20.

Human key correctness: **pending**. Severe issue: **unknown**. Corrections: **pending**.

### Key 38: pp-module-2-checkpoint-2

Lesson: `pp-module-2-checkpoint`; module: `pp-module-2`; mode: checkpoint; kind: multiple.

Module2 case: completed Python25, completed Math25, incomplete SQL40, completed Python10. All input validates. Select EVERY true report statement.

- `total`: The total is60
- `python`: Python's grouped total is35
- `order`: Ordered topics are Python35, then Math25
- `sql`: Incomplete SQL40 adds40 to the completed total
- `overwrite`: Python's total should be overwritten with the final10
- `mutation`: The original records must be edited to build totals

Expected server key: `["total", "python", "order"]`

Filter SQL40, add repeated Python contributions, then order:35>25.

Human key correctness: **pending**. Severe issue: **unknown**. Corrections: **pending**.

### Key 39: pp-module-2-checkpoint-3

Lesson: `pp-module-2-checkpoint`; module: `pp-module-2`; mode: checkpoint; kind: multiple.

Module2 case: completed Python30, completed Math30, incomplete SQL40, completed Python10. All input validates. Select EVERY true report statement.

- `total`: The total is70
- `python`: Python's grouped total is40
- `order`: Ordered topics are Python40, then Math30
- `sql`: Incomplete SQL40 adds40 to the completed total
- `overwrite`: Python's total should be overwritten with the final10
- `mutation`: The original records must be edited to build totals

Expected server key: `["total", "python", "order"]`

Filter SQL40, add repeated Python contributions, then order:40>30.

Human key correctness: **pending**. Severe issue: **unknown**. Corrections: **pending**.

### Key 40: pp-module-2-checkpoint-4

Lesson: `pp-module-2-checkpoint`; module: `pp-module-2`; mode: checkpoint; kind: multiple.

Module2 case: completed Python35, completed Math35, incomplete SQL40, completed Python10. All input validates. Select EVERY true report statement.

- `total`: The total is80
- `python`: Python's grouped total is45
- `order`: Ordered topics are Python45, then Math35
- `sql`: Incomplete SQL40 adds40 to the completed total
- `overwrite`: Python's total should be overwritten with the final10
- `mutation`: The original records must be edited to build totals

Expected server key: `["total", "python", "order"]`

Filter SQL40, add repeated Python contributions, then order:45>35.

Human key correctness: **pending**. Severe issue: **unknown**. Corrections: **pending**.

### Key 41: pp-functions-practice

Lesson: `pp-functions`; module: `pp-module-3`; mode: practice; kind: number.

A function starts local total=0, adds 12 then 18 and returns total. What does a second identical call return?


Expected server key: `30`

The second call again returns 30, not 60.

Human key correctness: **pending**. Severe issue: **unknown**. Corrections: **pending**.

### Key 42: pp-functions-checkpoint-1

Lesson: `pp-functions`; module: `pp-module-3`; mode: checkpoint; kind: number.

f(records) initializes local total=0 and returns the sum of 4 and 6. After one call, what does a second identical call return?


Expected server key: `10`

Both calls independently return 10.

Human key correctness: **pending**. Severe issue: **unknown**. Corrections: **pending**.

### Key 43: pp-functions-checkpoint-2

Lesson: `pp-functions`; module: `pp-module-3`; mode: checkpoint; kind: number.

f(records) initializes local total=0 and returns the sum of 11 and 9. After one call, what does a second identical call return?


Expected server key: `20`

Both calls independently return 20.

Human key correctness: **pending**. Severe issue: **unknown**. Corrections: **pending**.

### Key 44: pp-functions-checkpoint-3

Lesson: `pp-functions`; module: `pp-module-3`; mode: checkpoint; kind: number.

f(records) initializes local total=0 and returns the sum of 20 and 30. After one call, what does a second identical call return?


Expected server key: `50`

Both calls independently return 50.

Human key correctness: **pending**. Severe issue: **unknown**. Corrections: **pending**.

### Key 45: pp-functions-checkpoint-4

Lesson: `pp-functions`; module: `pp-module-3`; mode: checkpoint; kind: number.

f(records) initializes local total=0 and returns the sum of 1 and 179. After one call, what does a second identical call return?


Expected server key: `180`

Both calls independently return 180.

Human key correctness: **pending**. Severe issue: **unknown**. Corrections: **pending**.

### Key 46: pp-pipeline-practice

Lesson: `pp-pipeline`; module: `pp-module-3`; mode: practice; kind: ordered.

Order the pipeline so malformed incomplete records cannot bypass validation.

- `present`: Present report
- `order`: Order grouped rows
- `summarize`: Summarize valid completed records
- `validate`: Validate and normalize every record

Expected server key: `["validate", "summarize", "order", "present"]`

Validate all input, summarize, order rows, then present.

Human key correctness: **pending**. Severe issue: **unknown**. Corrections: **pending**.

### Key 47: pp-pipeline-checkpoint-1

Lesson: `pp-pipeline`; module: `pp-module-3`; mode: checkpoint; kind: choice.

Validation fails on the last row. Which next action would violate the pipeline contract?

- `summarize`: Summarize earlier rows and present a successful report
- `signal`: Signal the validation error without an accepted report

Expected server key: `"summarize"`

A normal-looking partial report would bypass the validation boundary.

Human key correctness: **pending**. Severe issue: **unknown**. Corrections: **pending**.

### Key 48: pp-pipeline-checkpoint-2

Lesson: `pp-pipeline`; module: `pp-module-3`; mode: checkpoint; kind: choice.

Which input contract should summarize(valid_records) rely on?

- `raw`: Arbitrary unvalidated rows
- `validated`: Every row has passed normalization and validation
- `printed`: Already formatted display text

Expected server key: `"validated"`

The summarizer consumes accepted records rather than reinterpreting arbitrary input or display text.

Human key correctness: **pending**. Severe issue: **unknown**. Corrections: **pending**.

### Key 49: pp-pipeline-checkpoint-3

Lesson: `pp-pipeline`; module: `pp-module-3`; mode: checkpoint; kind: choice.

An incomplete row has minutes181. Which pipeline ordering violates the contract?

- `validate-first`: Validate every row before selecting completed rows
- `filter-first`: Remove incomplete rows before validating the remaining rows

Expected server key: `"filter-first"`

Filtering first hides the malformed incomplete row that should reject the whole dataset.

Human key correctness: **pending**. Severe issue: **unknown**. Corrections: **pending**.

### Key 50: pp-pipeline-checkpoint-4

Lesson: `pp-pipeline`; module: `pp-module-3`; mode: checkpoint; kind: multiple.

Select every useful pairing of helper and isolated test.

- `normalizer`: Normalizer: a blank topic must reject input
- `ordering`: Ordering helper: equal totals use topic-text order
- `composition`: Whole pipeline: invalid last row produces no accepted report
- `skip`: Normalizer: silently drop any invalid incomplete row

Expected server key: `["normalizer", "ordering", "composition"]`

The first three cases verify distinct boundaries; silently dropping invalid rows changes the policy.

Human key correctness: **pending**. Severe issue: **unknown**. Corrections: **pending**.

### Key 51: pp-tests-practice

Lesson: `pp-tests`; module: `pp-module-3`; mode: practice; kind: choice.

Which case distinguishes minutes <=180 from the incorrect minutes <180?

- `normal`: minutes=30
- `edge`: minutes=180
- `outside`: minutes=181

Expected server key: `"edge"`

180 is accepted by <= and rejected by <.

Human key correctness: **pending**. Severe issue: **unknown**. Corrections: **pending**.

### Key 52: pp-tests-checkpoint-1

Lesson: `pp-tests`; module: `pp-module-3`; mode: checkpoint; kind: choice.

Which case exposes starting total from records[0]?

- `empty`: Empty input
- `one`: One completed record

Expected server key: `"empty"`

Empty input has no first record but must return a zero report.

Human key correctness: **pending**. Severe issue: **unknown**. Corrections: **pending**.

### Key 53: pp-tests-checkpoint-2

Lesson: `pp-tests`; module: `pp-module-3`; mode: checkpoint; kind: choice.

Which duration exposes accepting every isinstance(x,int) value?

- `bool`: True
- `int`: 30

Expected server key: `"bool"`

The contract rejects bool even though it is an int subtype.

Human key correctness: **pending**. Severe issue: **unknown**. Corrections: **pending**.

### Key 54: pp-tests-checkpoint-3

Lesson: `pp-tests`; module: `pp-module-3`; mode: checkpoint; kind: choice.

Which pair exposes missing normalized-ID uniqueness?

- `duplicate`: IDs ' a ' and 'a'
- `unique`: IDs 'a' and 'b'

Expected server key: `"duplicate"`

The first pair becomes duplicate after stripping.

Human key correctness: **pending**. Severe issue: **unknown**. Corrections: **pending**.

### Key 55: pp-tests-checkpoint-4

Lesson: `pp-tests`; module: `pp-module-3`; mode: checkpoint; kind: choice.

Which case exposes reporting before validating incomplete records?

- `valid`: Valid incomplete duration30
- `invalid`: Incomplete duration181

Expected server key: `"invalid"`

An invalid incomplete record must reject the dataset.

Human key correctness: **pending**. Severe issue: **unknown**. Corrections: **pending**.

### Key 56: pp-module-3-checkpoint-practice

Lesson: `pp-module-3-checkpoint`; module: `pp-module-3`; mode: practice; kind: multiple.

Prepare for Functions and testable design. Select EVERY sound review action.

- `contract`: Restate the relevant input/output and failure rules
- `trace`: Trace the stated case and explain each inclusion or rejection
- `derive`: Derive expected results from the contract rather than copying program output
- `guess`: Mark every option correct whenever a final total looks plausible

Expected server key: `["contract", "trace", "derive"]`

Restate the rules,trace the case,and independently justify results. Guessing from appearance is insufficient.

Human key correctness: **pending**. Severe issue: **unknown**. Corrections: **pending**.

### Key 57: pp-module-3-checkpoint-1

Lesson: `pp-module-3-checkpoint`; module: `pp-module-3`; mode: checkpoint; kind: multiple.

A helper keeps a global total,filters before validation,and has only an ordinary30-minute test. Select EVERY justified repair.

- `local`: Initialize a fresh local accumulator for each call
- `validate`: Validate every input row before summarizing
- `tests`: Add independently justified empty,boundary and repeated-call cases
- `copy`: Copy the current program output as the sole expected result
- `hide`: Skip malformed incomplete records before validation

Expected server key: `["local", "validate", "tests"]`

Fresh locals,correct pipeline order and discriminating independent tests target the three faults.

Human key correctness: **pending**. Severe issue: **unknown**. Corrections: **pending**.

### Key 58: pp-module-3-checkpoint-2

Lesson: `pp-module-3-checkpoint`; module: `pp-module-3`; mode: checkpoint; kind: multiple.

A proposed analyzer edits input records,prints its report instead of returning data,and catches late validation failure to return a partial sum. Select EVERY justified repair.

- `fresh`: Construct fresh result structures without editing submitted records
- `return`: Return a report data structure for the caller
- `error`: Signal invalid input without an accepted partial report
- `global`: Keep totals globally so repeated calls can accumulate old work
- `skip`: Leave incomplete rows unvalidated

Expected server key: `["fresh", "return", "error"]`

Preserve ownership,return usable data,and keep the whole-dataset failure boundary visible.

Human key correctness: **pending**. Severe issue: **unknown**. Corrections: **pending**.

### Key 59: pp-module-3-checkpoint-3

Lesson: `pp-module-3-checkpoint`; module: `pp-module-3`; mode: checkpoint; kind: multiple.

A test plan copies current implementation output,omits duration endpoints,and calls the analyzer only once. Select EVERY improvement that supplies independent evidence.

- `manual`: Derive small expected reports manually from the written contract
- `boundaries`: Include accepted1/180 and rejected0/181 durations
- `repeat`: Repeat unchanged valid input and verify stable output and unchanged input
- `count`: Replace these checks with many ordinary30-minute examples only
- `belief`: Assume a helper name proves the implementation obeys its contract

Expected server key: `["manual", "boundaries", "repeat"]`

Independent results,boundary distinctions and repeat/nonmutation checks target different faults.

Human key correctness: **pending**. Severe issue: **unknown**. Corrections: **pending**.

### Key 60: pp-module-3-checkpoint-4

Lesson: `pp-module-3-checkpoint`; module: `pp-module-3`; mode: checkpoint; kind: multiple.

A pipeline formats raw input first,then validates only completed rows,and sends formatted text to a numeric summarizer. Select EVERY justified boundary repair.

- `all`: Validate and normalize all records before selection
- `data`: Pass accepted record data to the summarizer
- `last`: Order and present the report after summarization
- `ignore`: Treat a formatted string as proof the numeric fields are valid
- `partial`: Publish early totals before the last row is checked

Expected server key: `["all", "data", "last"]`

Trust boundaries and helper input/output shapes must agree across the complete pipeline.

Human key correctness: **pending**. Severe issue: **unknown**. Corrections: **pending**.

### Key 61: pp-errors-practice

Lesson: `pp-errors`; module: `pp-module-4`; mode: practice; kind: choice.

A valid completed25-minute record is followed by duration181. What is the accepted result?

- `partial`: A 25-minute report
- `error`: An invalid_minutes error and no accepted report
- `skip`: Silently skip the second record

Expected server key: `"error"`

The later invalid record prevents an accepted report.

Human key correctness: **pending**. Severe issue: **unknown**. Corrections: **pending**.

### Key 62: pp-errors-checkpoint-1

Lesson: `pp-errors`; module: `pp-module-4`; mode: checkpoint; kind: choice.

A dataset has three valid records followed by an invalid incomplete record. What is accepted?

- `partial`: A report for only the first three records
- `error`: A validation error; no normal report
- `zero`: A zero report, labelled successful

Expected server key: `"error"`

A late invalid record rejects the whole dataset.

Human key correctness: **pending**. Severe issue: **unknown**. Corrections: **pending**.

### Key 63: pp-errors-checkpoint-2

Lesson: `pp-errors`; module: `pp-module-4`; mode: checkpoint; kind: choice.

A required minutes field is missing. Which handling preserves the contract?

- `zero`: Substitute zero and mark the report successful
- `reject`: Signal invalid_fields and accept no normal report

Expected server key: `"reject"`

A missing required field is a validation failure.

Human key correctness: **pending**. Severe issue: **unknown**. Corrections: **pending**.

### Key 64: pp-errors-checkpoint-3

Lesson: `pp-errors`; module: `pp-module-4`; mode: checkpoint; kind: choice.

A broad catch returns the partial total after any validation exception. What is wrong?

- `policy`: It disguises failure as an accepted partial report
- `nothing`: Nothing: catching any error proves robustness

Expected server key: `"policy"`

The contract rejects the whole dataset; suppressing an error does not repair its meaning.

Human key correctness: **pending**. Severe issue: **unknown**. Corrections: **pending**.

### Key 65: pp-errors-checkpoint-4

Lesson: `pp-errors`; module: `pp-module-4`; mode: checkpoint; kind: choice.

Which signaling design can satisfy the authored failure policy?

- `exception-only`: Only exceptions, regardless of what the caller does
- `either`: A specific exception or structured error, provided invalid input has no accepted report
- `partial`: Any design that returns the earlier total

Expected server key: `"either"`

Either error mechanism can work when the caller preserves whole-dataset failure.

Human key correctness: **pending**. Severe issue: **unknown**. Corrections: **pending**.

### Key 66: pp-integration-practice

Lesson: `pp-integration`; module: `pp-module-4`; mode: practice; kind: number.

For the five fixed capstone records, what is the completed-minute total?


Expected server key: `110`

25+35+20+30 = 110.

Human key correctness: **pending**. Severe issue: **unknown**. Corrections: **pending**.

### Key 67: pp-integration-checkpoint-1

Lesson: `pp-integration`; module: `pp-module-4`; mode: checkpoint; kind: number.

The fixed report totals110. If the incomplete SQL40 session becomes completed and a new valid completed Math5 session is added, what is the new total?


Expected server key: `155`

110+40+5 = 155.

Human key correctness: **pending**. Severe issue: **unknown**. Corrections: **pending**.

### Key 68: pp-integration-checkpoint-2

Lesson: `pp-integration`; module: `pp-module-4`; mode: checkpoint; kind: number.

The fixed report totals110. If the incomplete SQL40 session becomes completed and a new valid completed Math10 session is added, what is the new total?


Expected server key: `160`

110+40+10 = 160.

Human key correctness: **pending**. Severe issue: **unknown**. Corrections: **pending**.

### Key 69: pp-integration-checkpoint-3

Lesson: `pp-integration`; module: `pp-module-4`; mode: checkpoint; kind: number.

The fixed report totals110. If the incomplete SQL40 session becomes completed and a new valid completed Math15 session is added, what is the new total?


Expected server key: `165`

110+40+15 = 165.

Human key correctness: **pending**. Severe issue: **unknown**. Corrections: **pending**.

### Key 70: pp-integration-checkpoint-4

Lesson: `pp-integration`; module: `pp-module-4`; mode: checkpoint; kind: number.

The fixed report totals110. If the incomplete SQL40 session becomes completed and a new valid completed Math25 session is added, what is the new total?


Expected server key: `175`

110+40+25 = 175.

Human key correctness: **pending**. Severe issue: **unknown**. Corrections: **pending**.

### Key 71: pp-evidence-practice

Lesson: `pp-evidence`; module: `pp-module-4`; mode: practice; kind: choice.

Which statement is justified by a saved project submission alone?

- `executed`: The submitted code executed correctly
- `mastered`: The learner mastered Python
- `submitted`: A project artifact was submitted for human review

Expected server key: `"submitted"`

Saving text establishes submission, not execution or mastery.

Human key correctness: **pending**. Severe issue: **unknown**. Corrections: **pending**.

### Key 72: pp-evidence-checkpoint-1

Lesson: `pp-evidence`; module: `pp-module-4`; mode: checkpoint; kind: choice.

A review note says: 'The capstone text is saved and has evidence links.' Which conclusion is supported?

- `artifact`: There is a reviewable saved artifact
- `runtime`: All code passed runtime tests
- `career`: The learner is career-ready

Expected server key: `"artifact"`

The saved artifact supports a review workflow only.

Human key correctness: **pending**. Severe issue: **unknown**. Corrections: **pending**.

### Key 73: pp-evidence-checkpoint-2

Lesson: `pp-evidence`; module: `pp-module-4`; mode: checkpoint; kind: choice.

Which source establishes this project's maximum duration of180 minutes?

- `python`: Python's general dictionary documentation
- `spec`: The authored analyzer specification
- `timer`: The learner's recorded study time

Expected server key: `"spec"`

The180-minute boundary is an authored project rule,not a Python dictionary rule.

Human key correctness: **pending**. Severe issue: **unknown**. Corrections: **pending**.

### Key 74: pp-evidence-checkpoint-3

Lesson: `pp-evidence`; module: `pp-module-4`; mode: checkpoint; kind: choice.

What can a completed-minute total of110 establish?

- `activity`: The amount of recorded completed activity under the stated contract
- `mastery`: Calibrated mastery of Python
- `execution`: Successful execution of the submitted program

Expected server key: `"activity"`

The report summarizes its records; it does not calibrate ability or execute a program.

Human key correctness: **pending**. Severe issue: **unknown**. Corrections: **pending**.

### Key 75: pp-evidence-checkpoint-4

Lesson: `pp-evidence`; module: `pp-module-4`; mode: checkpoint; kind: choice.

Every quote locator resolves. Which further review is still needed?

- `none`: None; matching text proves every claim correct
- `support`: A human must assess whether the located material supports each teaching claim

Expected server key: `"support"`

Exact locators establish where text is stored,not that every interpretation is justified.

Human key correctness: **pending**. Severe issue: **unknown**. Corrections: **pending**.

### Key 76: pp-module-4-checkpoint-practice

Lesson: `pp-module-4-checkpoint`; module: `pp-module-4`; mode: practice; kind: multiple.

Prepare for Integrated report and evidence. Select EVERY sound review action.

- `contract`: Restate the relevant input/output and failure rules
- `trace`: Trace the stated case and explain each inclusion or rejection
- `derive`: Derive expected results from the contract rather than copying program output
- `guess`: Mark every option correct whenever a final total looks plausible

Expected server key: `["contract", "trace", "derive"]`

Restate the rules,trace the case,and independently justify results. Guessing from appearance is insufficient.

Human key correctness: **pending**. Severe issue: **unknown**. Corrections: **pending**.

### Key 77: pp-module-4-checkpoint-1

Lesson: `pp-module-4-checkpoint`; module: `pp-module-4`; mode: checkpoint; kind: multiple.

Fixed records: completed Python25, incomplete SQL40, completed Python35, completed Math20, completed SQL30; all IDs are distinct and other fields valid. Cumulative case: the incomplete SQL40 becomes completed and a new valid completed Math5 record with unique ID is added. Separately, consider a variant with an additional Boolean duration. Select EVERY statement justified by the whole course contract.

- `total`: The valid changed dataset totals155 completed minutes
- `groups`: Its topics have SQL70,Python60,Math25 minutes
- `order`: The row order is SQL70,Python60,Math25
- `invalid`: The separate Boolean-duration variant must error instead of returning a partial report
- `repeat`: A fresh local,nonmutating analyzer should return the same report on repeated unchanged valid input
- `test`: Expected test results should be justified from the contract,not copied only from program output
- `evidence`: The input contract and authored integration trace can support these design claims
- `status`: A saved text capstone is submitted evidence for human review,not proof of runtime success
- `skip`: Incomplete records never need validation
- `overwrite`: Grouping replaces Python's earlier25 with35
- `execution`: Submitting code text authorizes the app to execute it
- `mastery`: Recorded minutes certify career readiness

Expected server key: `["total", "groups", "order", "invalid", "repeat", "test", "evidence", "status"]`

110+40+5=155; topic totals follow the same included records. Validation,repeatability,independent testing and honest submission/evidence limits still apply.

Human key correctness: **pending**. Severe issue: **unknown**. Corrections: **pending**.

### Key 78: pp-module-4-checkpoint-2

Lesson: `pp-module-4-checkpoint`; module: `pp-module-4`; mode: checkpoint; kind: multiple.

Fixed records: completed Python25, incomplete SQL40, completed Python35, completed Math20, completed SQL30; all IDs are distinct and other fields valid. Cumulative case: the incomplete SQL40 becomes completed and a new valid completed Math10 record with unique ID is added. Separately, consider a variant with an additional Boolean duration. Select EVERY statement justified by the whole course contract.

- `total`: The valid changed dataset totals160 completed minutes
- `groups`: Its topics have SQL70,Python60,Math30 minutes
- `order`: The row order is SQL70,Python60,Math30
- `invalid`: The separate Boolean-duration variant must error instead of returning a partial report
- `repeat`: A fresh local,nonmutating analyzer should return the same report on repeated unchanged valid input
- `test`: Expected test results should be justified from the contract,not copied only from program output
- `evidence`: The input contract and authored integration trace can support these design claims
- `status`: A saved text capstone is submitted evidence for human review,not proof of runtime success
- `skip`: Incomplete records never need validation
- `overwrite`: Grouping replaces Python's earlier25 with35
- `execution`: Submitting code text authorizes the app to execute it
- `mastery`: Recorded minutes certify career readiness

Expected server key: `["total", "groups", "order", "invalid", "repeat", "test", "evidence", "status"]`

110+40+10=160; topic totals follow the same included records. Validation,repeatability,independent testing and honest submission/evidence limits still apply.

Human key correctness: **pending**. Severe issue: **unknown**. Corrections: **pending**.

### Key 79: pp-module-4-checkpoint-3

Lesson: `pp-module-4-checkpoint`; module: `pp-module-4`; mode: checkpoint; kind: multiple.

Fixed records: completed Python25, incomplete SQL40, completed Python35, completed Math20, completed SQL30; all IDs are distinct and other fields valid. Cumulative case: the incomplete SQL40 becomes completed and a new valid completed Math15 record with unique ID is added. Separately, consider a variant with an additional Boolean duration. Select EVERY statement justified by the whole course contract.

- `total`: The valid changed dataset totals165 completed minutes
- `groups`: Its topics have SQL70,Python60,Math35 minutes
- `order`: The row order is SQL70,Python60,Math35
- `invalid`: The separate Boolean-duration variant must error instead of returning a partial report
- `repeat`: A fresh local,nonmutating analyzer should return the same report on repeated unchanged valid input
- `test`: Expected test results should be justified from the contract,not copied only from program output
- `evidence`: The input contract and authored integration trace can support these design claims
- `status`: A saved text capstone is submitted evidence for human review,not proof of runtime success
- `skip`: Incomplete records never need validation
- `overwrite`: Grouping replaces Python's earlier25 with35
- `execution`: Submitting code text authorizes the app to execute it
- `mastery`: Recorded minutes certify career readiness

Expected server key: `["total", "groups", "order", "invalid", "repeat", "test", "evidence", "status"]`

110+40+15=165; topic totals follow the same included records. Validation,repeatability,independent testing and honest submission/evidence limits still apply.

Human key correctness: **pending**. Severe issue: **unknown**. Corrections: **pending**.

### Key 80: pp-module-4-checkpoint-4

Lesson: `pp-module-4-checkpoint`; module: `pp-module-4`; mode: checkpoint; kind: multiple.

Fixed records: completed Python25, incomplete SQL40, completed Python35, completed Math20, completed SQL30; all IDs are distinct and other fields valid. Cumulative case: the incomplete SQL40 becomes completed and a new valid completed Math20 record with unique ID is added. Separately, consider a variant with an additional Boolean duration. Select EVERY statement justified by the whole course contract.

- `total`: The valid changed dataset totals170 completed minutes
- `groups`: Its topics have SQL70,Python60,Math40 minutes
- `order`: The row order is SQL70,Python60,Math40
- `invalid`: The separate Boolean-duration variant must error instead of returning a partial report
- `repeat`: A fresh local,nonmutating analyzer should return the same report on repeated unchanged valid input
- `test`: Expected test results should be justified from the contract,not copied only from program output
- `evidence`: The input contract and authored integration trace can support these design claims
- `status`: A saved text capstone is submitted evidence for human review,not proof of runtime success
- `skip`: Incomplete records never need validation
- `overwrite`: Grouping replaces Python's earlier25 with35
- `execution`: Submitting code text authorizes the app to execute it
- `mastery`: Recorded minutes certify career readiness

Expected server key: `["total", "groups", "order", "invalid", "repeat", "test", "evidence", "status"]`

110+40+20=170; topic totals follow the same included records. Validation,repeatability,independent testing and honest submission/evidence limits still apply.

Human key correctness: **pending**. Severe issue: **unknown**. Corrections: **pending**.

## Capstone rubric checks

### specification: State and apply the exact input/output contract.

Check all required fields,strict types,1..180,normalized-ID uniqueness,case-sensitive stripped topics,validation of incomplete records and whole-dataset failure.

Objectives: pp-contract-objective, pp-records-objective, pp-validation-objective

Evidence: pp-contract-evidence, pp-records-evidence, pp-validation-evidence

Human approval: **pending**.

### report: Justify the full report with a nonmutating trace.

For fixed input require count4,total110,Python60/SQL30/Math20 in that order. Check mixed completion,repeated topics and tie order; do not infer correctness from a matching total alone.

Objectives: pp-filter-objective, pp-group-objective, pp-order-objective, pp-integration-objective

Evidence: pp-filter-evidence, pp-group-evidence, pp-order-evidence, pp-integration-evidence

Human approval: **pending**.

### tests: Provide a decomposed design and discriminating independent tests.

Require fresh local state,no input mutation and validation-before-summary. Verify at least six cases including accepted endpoints,an invalid type,late invalid input,empty input and ties/repeated calls; expected results must be derived independently.

Objectives: pp-functions-objective, pp-pipeline-objective, pp-tests-objective, pp-errors-objective

Evidence: pp-functions-evidence, pp-pipeline-evidence, pp-tests-evidence, pp-errors-evidence

Human approval: **pending**.

### evidence: Explain source support and the limits of submission evidence.

Each key design claim should cite a relevant stored source. Reject claims that text length,self-review,stored minutes or app submission proves code execution,semantic correctness or career readiness.

Objectives: pp-evidence-objective

Evidence: pp-evidence-evidence, pp-capstone-evidence

Human approval: **pending**.

## Original generated gate result before human review

```json
{
  "human_review_requirements_met": false,
  "published": false,
  "release_id": "78afc1e3-47dc-5e13-a73b-9264662bdb20",
  "content_hash": "8d0d00657b631698c83363fa4f68fbc3d8f7a24ce75d66090310c32d9fb87f1e",
  "sample_size": 40,
  "human_reviewed_claims": 0,
  "human_supported_claims": 0,
  "human_support_rate": null,
  "matching_claim_excerpts": 40,
  "evidence_items": 17,
  "matching_evidence_excerpts": 17,
  "human_confirmed_locators": 0,
  "assessment_keys": 80,
  "issues": [
    "A named human reviewer and timezone-aware review date are required",
    "Human confirmation missing: rights_review_approved",
    "Human confirmation missing: duration_scope_approved",
    "Human confirmation missing: execution_disabled_confirmed",
    "Human confirmation missing: capstone_cases_checked",
    "Every sampled instructional block needs a human support judgment",
    "Every evidence excerpt must match its source and its locator needs human confirmation",
    "Every assessment key requires human verification with no unresolved key errors",
    "Every lesson needs human curriculum-sufficiency review",
    "Every capstone criterion needs human rubric/evidence review"
  ]
}
```

This generated result describes the original pending template. The completed human receipt is `practical-python-human-review.json`; the hash-guarded catalog publication and current task state are recorded in `../full-course-review.md` and `../../TASKS.md`.
