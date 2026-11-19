"""Canonical F05 draft retained for exact-version review and content authoring.

All examples are inert teaching text. Answer keys and review cases stay server
side. Its approved published copy is guarded in full_course_release.py after
Abir's 2026-11-20 human review. Any edits require fresh review of the draft hash;
schema tests and these original explanations are not that approval.
"""

import json

from app.courses.catalog import stable_id
from app.courses.contracts import CourseRelease

SLUG = "practical-python-foundations"
PYTHON_REFERENCE_VERSION = "3.12"
BASE = "https://docs.python.org/3.12/"

FIXED_RECORDS = [
    {"id": "s-1", "topic": "Python", "minutes": 25, "completed": True},
    {"id": "s-2", "topic": "SQL", "minutes": 40, "completed": False},
    {"id": "s-3", "topic": "Python", "minutes": 35, "completed": True},
    {"id": "s-4", "topic": "Math", "minutes": 20, "completed": True},
    {"id": "s-5", "topic": "SQL", "minutes": 30, "completed": True},
]

# Authored review vectors, not an execution API or automatic project grader.
CAPSTONE_CASES = [
    {
        "id": "normal",
        "records": FIXED_RECORDS,
        "expected": {"completed_count": 4, "total_minutes": 110, "topics": [["Python", 60], ["SQL", 30], ["Math", 20]]},
    },
    {"id": "empty", "records": [], "expected": {"completed_count": 0, "total_minutes": 0, "topics": []}},
    {
        "id": "minimum",
        "records": [{"id": "a", "topic": "Math", "minutes": 1, "completed": True}],
        "expected": {"completed_count": 1, "total_minutes": 1, "topics": [["Math", 1]]},
    },
    {
        "id": "maximum",
        "records": [{"id": "a", "topic": "Math", "minutes": 180, "completed": True}],
        "expected": {"completed_count": 1, "total_minutes": 180, "topics": [["Math", 180]]},
    },
    {
        "id": "ties",
        "records": [
            {"id": "b", "topic": "Python", "minutes": 20, "completed": True},
            {"id": "a", "topic": "Math", "minutes": 20, "completed": True},
        ],
        "expected": {"completed_count": 2, "total_minutes": 40, "topics": [["Math", 20], ["Python", 20]]},
    },
    {
        "id": "incomplete",
        "records": [{"id": "a", "topic": "Math", "minutes": 30, "completed": False}],
        "expected": {"completed_count": 0, "total_minutes": 0, "topics": []},
    },
    {
        "id": "boolean-minutes",
        "records": [{"id": "a", "topic": "Math", "minutes": True, "completed": True}],
        "error": "invalid_minutes",
    },
    {
        "id": "duplicate",
        "records": [
            {"id": "a", "topic": "Math", "minutes": 10, "completed": True},
            {"id": "a", "topic": "SQL", "minutes": 20, "completed": True},
        ],
        "error": "duplicate_id",
    },
    {
        "id": "blank-topic",
        "records": [{"id": "a", "topic": "   ", "minutes": 10, "completed": True}],
        "error": "invalid_topic",
    },
    {
        "id": "too-long",
        "records": [{"id": "a", "topic": "Math", "minutes": 181, "completed": True}],
        "error": "invalid_minutes",
    },
    {"id": "missing-field", "records": [{"id": "a", "topic": "Math", "minutes": 10}], "error": "invalid_fields"},
]

CAPSTONE_CONTRACT = """Design a study-session analyzer for a list of records with exactly the fields id,
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
"""


def _exercise(identifier, mode, definition, objective_ids, evidence_ids):
    kind, prompt, answer, choices, hint, explanation = definition
    return {
        "id": identifier,
        "kind": kind,
        "mode": mode,
        "prompt": prompt,
        "answer": answer,
        "choices": [{"id": key, "label": value} for key, value in choices],
        "hint": hint,
        "explanation": explanation,
        "objective_ids": objective_ids,
        "evidence_ids": evidence_ids,
    }


def _number(prompt, answer, hint, explanation):
    return "number", prompt, answer, [], hint, explanation


def _choice(prompt, answer, choices, hint, explanation):
    return "choice", prompt, answer, choices, hint, explanation


def _multiple(prompt, answer, choices, hint, explanation):
    return "multiple", prompt, answer, choices, hint, explanation


def _ordered(prompt, answer, choices, hint, explanation):
    return "ordered", prompt, answer, choices, hint, explanation


def _lessons():
    """Original teaching text, task design and independent question alternatives."""
    return [
        {
            "id": "pp-contract",
            "title": "Turn a question into an explicit data contract",
            "reference": "tutorial/datastructures.html#dictionaries",
            "quote": (
                "A useful data contract states required fields, allowed types, boundaries and "
                "failure behavior before the calculation begins."
            ),
            "explanation": (
                "A useful data contract states required fields, allowed types, boundaries and "
                "failure behavior before the calculation begins.\n"
                "\n"
                "Our running task is to summarize study sessions, not to judge whether somebody\n"
                "learned a topic. A session record describes an ID, topic, duration and completion\n"
                "flag. Those field names alone do not answer important questions: may duration be\n"
                "zero, is the upper boundary included, and should a malformed incomplete record\n"
                "be ignored? An implementation cannot choose a correct policy until the task\n"
                "defines one. Write those decisions down in ordinary language first.\n"
                "\n"
                "For this course the duration interval is 1 through 180 minutes, both included.\n"
                "The value must be an integer rather than a numeric-looking string, and Boolean\n"
                "values are rejected even though Python treats bool as a subtype of int. The flag\n"
                "must be an actual Boolean. Validate every record before reporting anything. A\n"
                "bad record fails the dataset instead of quietly disappearing from the totals.\n"
                "These are authored product rules, not universal laws of study tracking.\n"
                "\n"
                "Separate input validity from report inclusion. A valid incomplete session is\n"
                "accepted input but contributes no completed minutes. An invalid incomplete\n"
                "session still causes rejection. This distinction prevents a filter from hiding\n"
                "bad data. A contract should also state the output shape and avoid overstating\n"
                "what it proves: minutes describe recorded activity, not mastery or readiness.\n"
                "\n"
                "Before solving a new variant, make a two-column table: requirement and a small\n"
                "example that would violate it. Include the lower and upper duration boundaries,\n"
                "an unexpected field, a missing field, and a string flag. Then explain which\n"
                "decisions came from the task and which came from Python's language behavior.\n"
            ),
            "example": """# Read and reason only; this text is not executed by StudyVault.
valid = {"id": "a", "topic": "Python", "minutes": 1, "completed": False}
# Valid input, but contributes zero completed minutes.
invalid = {"id": "b", "topic": "Python", "minutes": 181, "completed": False}
# Invalid input even though it is incomplete: reject the dataset.
""",
            "activity": (
                "Write the analyzer's input and output contract. Classify 0, 1, 180, 181, True and "
                "'30' as durations, explain each boundary, and invent two conflicting policies to "
                "show why the contract matters."
            ),
            "practice": _choice(
                "Under the stated 1..180 exact-integer contract, which duration is valid?",
                "one",
                [("one", "1"), ("zero", "0"), ("bool", "True"), ("text", "'30'")],
                "Type and range must both pass.",
                "1 is an integer inside the inclusive interval.",
            ),
            "checkpoints": [
                _choice(
                    f"A completed flag is False. Its duration is {value}. What should validation do?",
                    result,
                    [
                        ("accept", "Accept as valid input; exclude it from completed totals"),
                        ("reject", "Reject the dataset as invalid input"),
                        ("ignore", "Skip all validation because it is incomplete"),
                    ],
                    "Validate incomplete records too, using both interval endpoints.",
                    explanation,
                )
                for value, result, explanation in (
                    (1, "accept", "1 is the included lower boundary."),
                    (180, "accept", "180 is the included upper boundary."),
                    (0, "reject", "0 lies below the allowed interval."),
                    (181, "reject", "181 lies above the allowed interval."),
                )
            ],
        },
        {
            "id": "pp-records",
            "title": "Read records without confusing keys, positions and aliases",
            "reference": "tutorial/datastructures.html#dictionaries",
            "quote": (
                "A dictionary lookup uses a key, while a list lookup uses a position; copying a "
                "list alone does not copy its nested dictionaries."
            ),
            "explanation": (
                "A dictionary lookup uses a key, while a list lookup uses a position; copying a "
                "list alone does not copy its nested dictionaries.\n"
                "\n"
                "A list is useful for the sequence of submitted sessions. Each dictionary is a\n"
                "record whose keys name the meaning of its values. sessions[0] selects a record;\n"
                "sessions[0]['minutes'] selects that record's duration. Swapping the order of a\n"
                "dictionary's literal fields does not change which value the minutes key names.\n"
                "Do not replace a named field with an assumed position merely because an example\n"
                "prints fields in a convenient order.\n"
                "\n"
                "Assignment can make two names refer to the same mutable dictionary. If alias =\n"
                "record and alias['minutes'] is changed, reading record['minutes'] sees that change.\n"
                "Likewise, list(sessions) creates a new outer list but retains the nested record\n"
                "objects. A shallow outer copy is not permission to edit all nested values. Our\n"
                "analyzer promises not to mutate the input, so build normalized output records or\n"
                "separate totals instead of overwriting submitted records.\n"
                "\n"
                "Required-field validation should happen before the direct lookups used in the\n"
                "calculation. A missing field is a contract error, not a reason to fabricate a\n"
                "duration of zero. Optional fields can have explicit defaults in a different\n"
                "contract, but required and optional are deliberate distinctions. Avoid hiding\n"
                "missing required information behind a convenient get default.\n"
                "\n"
                "Draw the list and its record objects as separate boxes. Trace one list append,\n"
                "one alias mutation and one fresh dictionary construction by hand. State which\n"
                "operations affect the original input. The point is to reason about ownership,\n"
                "not to memorize a single copy method or to claim every object requires a deep\n"
                "copy. The safest transformation here never mutates the nested input at all.\n"
            ),
            "example": """sessions = [{"id": "a", "minutes": 25}, {"id": "b", "minutes": 40}]
record = sessions[0]
alias = record
alias["minutes"] = 30
# sessions[0]["minutes"] is now 30; both names refer to the same record.
normalized = {"id": record["id"], "minutes": record["minutes"]}
# normalized is a new dictionary; later edits to it need not edit record.
""",
            "activity": (
                "Draw the object-reference diagram for a two-record list and a shallow outer copy. "
                "Make a fresh normalized record on paper, then explain why changing that new record "
                "differs from changing an alias."
            ),
            "practice": _number(
                "For rows = [{'minutes': 25}, {'minutes': 40}], what is rows[1]['minutes']?",
                40,
                "The first position is zero.",
                "Position 1 selects the second record, whose minutes is 40.",
            ),
            "checkpoints": [
                _number(
                    f"record = {{'minutes': {start}}}; alias = record; alias['minutes'] += {delta}. "
                    "What is record['minutes']?",
                    start + delta,
                    "The two names refer to the same mutable record.",
                    f"The shared dictionary now contains {start + delta} minutes.",
                )
                for start, delta in ((12, 3), (18, 2), (24, 6), (35, 5))
            ],
        },
        {
            "id": "pp-validation",
            "title": "Validate and normalize before accepting a dataset",
            "reference": "library/stdtypes.html#boolean-type-bool",
            "quote": (
                "Normalization makes a chosen representation consistent; it does not excuse an "
                "invalid value or silently change the stated policy."
            ),
            "explanation": (
                "Normalization makes a chosen representation consistent; it does not excuse an "
                "invalid value or silently change the stated policy.\n"
                "\n"
                "Our contract strips outer whitespace from IDs and topics. It does not merge\n"
                "different capitalization: Python and python remain different topics. After\n"
                "stripping, neither ID nor topic may be empty. Explain this policy before doing\n"
                "it; otherwise a learner cannot know whether apparent duplicate labels should\n"
                "combine. Do not turn a missing topic into an invented label.\n"
                "\n"
                "Validation must be ordered so checks are meaningful. Confirm that a record has\n"
                "the exact required field names, confirm string types before stripping them,\n"
                "check the duration's exact type and range, and confirm the Boolean flag. A\n"
                "string 'True' is not the actual flag True. For the duration, isinstance(True,\n"
                "int) would accept a Boolean; the course's exact-type rule deliberately rejects\n"
                "that value. Type rules are part of this application contract, not a claim that\n"
                "Python's numeric relationships are wrong.\n"
                "\n"
                "Keep a set of normalized IDs seen so far. Reject a repeated ID rather than\n"
                "counting the same submitted event twice. Validate incomplete records too.\n"
                "Crucially, do not publish a partial summary as the final result if a later record\n"
                "fails. One simple design first constructs a validated normalized list and only\n"
                "then passes it to summarization. This costs another pass but makes the boundary\n"
                "between accepted data and reporting clear for a small bounded input.\n"
                "\n"
                "Trace the order with a blank topic, a Boolean duration, and two IDs that become\n"
                "equal after stripping. For each case, write the failing rule and the expected\n"
                "absence of a report. Then discuss the tradeoff: normalization can reduce accidental\n"
                "differences, but more aggressive normalization can merge records the task meant\n"
                "to distinguish. The code should implement the written rule, not guess intent.\n"
            ),
            "example": """raw_id = "  s-7 "
normalized_id = raw_id.strip()  # "s-7"
# A later record with id "s-7" is a duplicate under this contract.
# A topic "   " becomes blank and is rejected.
# minutes=True is rejected: type(True) is bool, not the required exact int.
""",
            "activity": (
                "Construct a validation table containing a missing field, extra field, blank "
                "string, Boolean duration, duplicate normalized ID and incomplete invalid record. "
                "State which dataset is rejected and confirm no partial report is accepted."
            ),
            "practice": _choice(
                "After stripping IDs, are ' s-7 ' and 's-7' unique events under this contract?",
                "duplicate",
                [
                    ("unique", "Yes, because their original strings differ"),
                    ("duplicate", "No; the normalized IDs duplicate one another"),
                ],
                "Apply the stated normalization before the uniqueness check.",
                "Both normalize to s-7.",
            ),
            "checkpoints": [
                _choice(
                    f"A record has id='a', topic={topic}, minutes={minutes}, completed={flag}. "
                    "Is it valid (assuming unique ID and exact fields)?",
                    result,
                    [("valid", "Valid"), ("invalid", "Invalid")],
                    "Check nonblank topic, exact integer duration 1..180 and exact Boolean flag.",
                    explanation,
                )
                for topic, minutes, flag, result, explanation in (
                    ("' Math '", "10", "True", "valid", "The topic normalizes to Math and all other fields pass."),
                    ("'   '", "10", "True", "invalid", "Stripping leaves a blank topic."),
                    ("'Math'", "True", "False", "invalid", "A Boolean is rejected as the duration."),
                    ("'Math'", "10", "'False'", "invalid", "The text 'False' is not a Boolean flag."),
                )
            ],
        },
        {
            "id": "pp-filter",
            "title": "Trace selection and accumulation as separate decisions",
            "reference": "tutorial/controlflow.html#for-statements",
            "quote": (
                "Filtering decides which valid records contribute; accumulation combines their "
                "values without changing the rule halfway through the loop."
            ),
            "explanation": (
                "Filtering decides which valid records contribute; accumulation combines their "
                "values without changing the rule halfway through the loop.\n"
                "\n"
                "After validation, the analyzer can trust each record's shape and types. Now ask\n"
                "a separate question: does this record's completed flag equal True? Only those\n"
                "records contribute to the completed count and completed-minute total. An\n"
                "incomplete but valid 40-minute record does not contribute 40 and is not itself an\n"
                "error. Keep this distinction visible when tracing the algorithm.\n"
                "\n"
                "Initialize total and count before the loop. For every included record, add its\n"
                "minutes once and increment count once. A useful loop invariant is: after the\n"
                "first k records, total equals the sum of completed minutes among those k records\n"
                "and count equals their number. Check the invariant with a table after every\n"
                "record; a final plausible answer alone can hide two mistakes that cancel out.\n"
                "\n"
                "Starting total at the first record's minutes can accidentally include an\n"
                "incomplete record or fail on an empty list. Starting inside the loop resets the\n"
                "sum on each iteration. Our zero initialization handles both empty valid input\n"
                "and all-incomplete input naturally. The summary contains no average, so empty\n"
                "input needs no division and no fabricated denominator.\n"
                "\n"
                "Work through a mixed sequence twice: once in its given order and once reordered.\n"
                "The intermediate rows change but the count and total should agree, because the\n"
                "contract's selection rule is independent of position. This is a useful test idea,\n"
                "not proof of the entire program. It cannot detect every duplicated ID or type\n"
                "error; those remain the responsibility of the validated-input boundary.\n"
            ),
            "example": """# Assume all records have already passed validation.
count = 0
total = 0
for record in records:
    if record["completed"]:
        count += 1
        total += record["minutes"]
# For (25,True), (40,False), (35,True): count=2, total=60.
""",
            "activity": (
                "Build an invariant table for the five capstone records. Then reverse the list, "
                "trace again, compare the totals and explain why starting total at "
                "records[0]['minutes'] is unsafe."
            ),
            "practice": _number(
                "Valid durations/flags are (25,True), (40,False), (35,True). What is the completed total?",
                60,
                "Exclude the incomplete record.",
                "25 + 35 is 60.",
            ),
            "checkpoints": [
                _number(
                    f"Valid durations/flags are ({a},True), ({skip},False), ({b},True). What is the completed total?",
                    a + b,
                    "Add only the records whose flag is True.",
                    f"The completed total is {a} + {b} = {a + b}.",
                )
                for a, skip, b in ((12, 50, 18), (15, 20, 25), (1, 180, 9), (60, 30, 45))
            ],
        },
        {
            "id": "pp-group",
            "title": "Group transformed records without overwriting earlier work",
            "reference": "tutorial/datastructures.html#dictionaries",
            "quote": (
                "Grouping uses the normalized topic as a key and adds to its existing total rather "
                "than replacing earlier sessions."
            ),
            "explanation": (
                "Grouping uses the normalized topic as a key and adds to its existing total rather "
                "than replacing earlier sessions.\n"
                "\n"
                "A single total answers how much completed activity was recorded, but a topic\n"
                "summary needs one accumulator per topic. A dictionary maps each normalized topic\n"
                "to the completed minutes seen for it so far. A new topic starts at zero; a later\n"
                "session adds to its existing value. Assigning totals[topic] = minutes on every\n"
                "record loses the earlier sessions for that topic.\n"
                "\n"
                "Filter first or put the inclusion condition immediately around the update. In\n"
                "either design, incomplete records must not create a positive completed total.\n"
                "Our report omits a topic that has no completed records; a valid all-incomplete\n"
                "dataset produces an empty topic list. This is a stated output policy rather than\n"
                "an accidental consequence of iteration.\n"
                "\n"
                "Build fresh result structures. Reading record['topic'] and record['minutes']\n"
                "does not require editing the record. That avoids the aliasing problem from the\n"
                "first module. A concise comprehension may be appropriate later, but a visible\n"
                "loop is helpful while you learn the selection and accumulation rules. Clarity\n"
                "lets a reviewer connect each update to the written contract.\n"
                "\n"
                "Trace two topics interleaved with a repeated topic. After each record, write the\n"
                "entire totals dictionary. Finally check that sum(totals.values()) equals the\n"
                "completed-minute total from the previous lesson. If those differ, investigate\n"
                "filtering and accumulation rather than merely adjusting the displayed final\n"
                "number. This consistency check is useful but cannot alone prove the topics are\n"
                "correctly named or that records were valid.\n"
            ),
            "example": """totals = {}
for record in valid_records:
    if record["completed"]:
        topic = record["topic"]
        totals[topic] = totals.get(topic, 0) + record["minutes"]
# Completed Python 25, SQL 30, Python 35 -> {'Python': 60, 'SQL': 30}.
# The input records are read, not overwritten.
""",
            "activity": (
                "Trace a topic dictionary after each of six interleaved records, including one "
                "incomplete record. Compare addition with overwrite, verify its sum against the "
                "overall total, and explain the first point where the incorrect algorithm diverges."
            ),
            "practice": _number(
                "Completed Python sessions have 25 and 35 minutes; SQL has 30. What is Python's grouped total?",
                60,
                "A repeated key adds rather than replaces.",
                "25 + 35 is 60.",
            ),
            "checkpoints": [
                _number(
                    "A grouping loop uses totals[t] = totals.get(t,0) + minutes. "
                    f"Completed topic X appears with {a} and {b} minutes. What is totals['X']?",
                    a + b,
                    "The second record retains the first contribution.",
                    f"The total is {a + b}, not only {b}.",
                )
                for a, b in ((10, 15), (1, 1), (60, 40), (75, 5))
            ],
        },
        {
            "id": "pp-order",
            "title": "Specify deterministic presentation and tie behavior",
            "reference": "howto/sorting.html#key-functions",
            "quote": (
                "A deterministic report specifies a primary sort key and an explicit tie key "
                "instead of relying on whichever record happened to arrive first."
            ),
            "explanation": (
                "A deterministic report specifies a primary sort key and an explicit tie key "
                "instead of relying on whichever record happened to arrive first.\n"
                "\n"
                "The capstone report orders topics by decreasing completed minutes. Two equal\n"
                "totals still need a policy. We choose increasing normalized topic text for ties.\n"
                "This is a course reporting rule, not a statement that alphabetic order is always\n"
                "the best product choice. Explain the tie key so a reader can predict the report\n"
                "without knowing the original order of records.\n"
                "\n"
                "Python's sorted builds a new sorted list. A tuple key is compared component by\n"
                "component: (-minutes, topic) puts larger numeric totals first because their\n"
                "negatives are smaller, then compares topic text for equal totals. In this\n"
                "course's ASCII topic examples Math comes before Python. Do not claim this simple\n"
                "text order is a human-language collation policy for every alphabet.\n"
                "\n"
                "A sort that uses only -minutes can preserve prior insertion order on ties. That\n"
                "behavior can be deterministic for one exact input but differ when the same\n"
                "records are reordered. Stable sorting and an explicit secondary business rule\n"
                "are different ideas. The report contract calls for the latter. The transformation\n"
                "must also preserve the total values; sorting should change presentation, not\n"
                "recalculate or discard contributions.\n"
                "\n"
                "On paper, write the key for each (topic, total) pair, sort the keys, then map back\n"
                "to rows. Include equal totals and a single topic. Compare results from two input\n"
                "orders. Finish by describing which result properties are mathematical totals\n"
                "and which are presentation choices. This makes tests more precise: total checks\n"
                "alone cannot validate the report order.\n"
            ),
            "example": """pairs = [("Python", 20), ("SQL", 35), ("Math", 20)]
ordered = sorted(pairs, key=lambda pair: (-pair[1], pair[0]))
# [('SQL',35), ('Math',20), ('Python',20)]
# Keys: SQL -> (-35,'SQL'); Math -> (-20,'Math'); Python -> (-20,'Python').
""",
            "activity": (
                "Make two differently ordered inputs with equal topic totals. Derive each tuple key "
                "and the expected final row order. Contrast an explicit tie rule with an "
                "insertion-order tie and discuss the ASCII-only examples' limitation."
            ),
            "practice": _ordered(
                "Order rows by descending minutes then ascending topic: Python20, SQL35, Math20.",
                ["sql", "math", "python"],
                [("python", "Python20"), ("sql", "SQL35"), ("math", "Math20")],
                "Sort the largest total first, then compare equal-total topics.",
                "SQL35 precedes Math20 and Python20; Math precedes Python.",
            ),
            "checkpoints": [
                _ordered(
                    f"Use descending minutes then ascending topic. Order Python{python}, Math{math}, SQL{sql}.",
                    answer,
                    [("python", f"Python{python}"), ("math", f"Math{math}"), ("sql", f"SQL{sql}")],
                    "Compare numeric totals first; resolve equal totals with the topic-text key.",
                    explanation,
                )
                for python, math, sql, answer, explanation in (
                    (30, 20, 30, ["python", "sql", "math"], "Python and SQL tie at30; Python precedes SQL."),
                    (20, 30, 30, ["math", "sql", "python"], "Math and SQL tie at30; Math precedes SQL."),
                    (35, 20, 10, ["python", "math", "sql"], "All totals differ:35,20,10 in descending order."),
                    (20, 20, 40, ["sql", "math", "python"], "SQL is largest; Math precedes Python on the20 tie."),
                )
            ],
        },
        {
            "id": "pp-functions",
            "title": "Separate returned results from hidden state changes",
            "reference": "tutorial/controlflow.html#defining-functions",
            "quote": (
                "A function's inputs and returned result form a clearer testing boundary when it "
                "does not also change hidden shared state."
            ),
            "explanation": (
                "A function's inputs and returned result form a clearer testing boundary when it "
                "does not also change hidden shared state.\n"
                "\n"
                "Think of summarize(valid_records) as a transformation from accepted data to a\n"
                "fresh report. The caller supplies the records, the function calculates local\n"
                "totals, and return hands a result back. A printed report is not the same thing\n"
                "as a returned data structure. Printing may help a person read a result, but a\n"
                "caller that needs totals should not have to scrape output text.\n"
                "\n"
                "Local accumulator variables are created for each call. If an accumulator instead\n"
                "lives in a shared global dictionary, a second call may add to the first call's\n"
                "results. A test that calls the function once cannot expose that contamination.\n"
                "Call the same function with the same valid data twice in a proposed test plan\n"
                "and compare both outputs and the unchanged input. These are useful properties\n"
                "for this pure transformation design.\n"
                "\n"
                "Do not confuse rebinding a local name with mutating an argument. total += n on a\n"
                "local integer accumulator does not edit the submitted record, while assigning to\n"
                "record['minutes'] does. Returning a new report helps keep the ownership boundary\n"
                "visible. Other applications legitimately have effects, but here the contract\n"
                "explicitly promises no input mutation and no external writes.\n"
                "\n"
                "Trace a small function call by drawing a new frame for its local count and total.\n"
                "Follow the returned value into the caller. Then trace an intentionally faulty\n"
                "global accumulator across two calls. Explain why a correct first output is not\n"
                "sufficient evidence. The objective is to make results reproducible and reviewable,\n"
                "not to label every short function 'pure' without examining what it touches.\n"
            ),
            "example": """def add_completed(records):
    total = 0
    for record in records:
        if record["completed"]:
            total += record["minutes"]
    return total

# Two calls with the same unchanged valid records each return their own sum.
# They do not share a total variable from the previous call.
""",
            "activity": (
                "Draw two call frames for the same records and compare returned data with printed "
                "text. Design a test that exposes a shared-global accumulator and a second test "
                "that detects an argument mutation."
            ),
            "practice": _number(
                (
                    "A function starts local total=0, adds 12 then 18 and returns total. What does a "
                    "second identical call return?"
                ),
                30,
                "Each call initializes its own local total.",
                "The second call again returns 30, not 60.",
            ),
            "checkpoints": [
                _number(
                    f"f(records) initializes local total=0 and returns the sum of {a} and {b}. "
                    "After one call, what does a second identical call return?",
                    a + b,
                    "Local initialization happens on every call.",
                    f"Both calls independently return {a + b}.",
                )
                for a, b in ((4, 6), (11, 9), (20, 30), (1, 179))
            ],
        },
        {
            "id": "pp-pipeline",
            "title": "Decompose a pipeline at meaningful trust boundaries",
            "reference": "tutorial/controlflow.html#defining-functions",
            "quote": (
                "Validate and normalize the entire input before summarizing it, then order and "
                "present the resulting report without silently changing the accepted data."
            ),
            "explanation": (
                "Validate and normalize the entire input before summarizing it, then order and "
                "present the resulting report without silently changing the accepted data.\n"
                "\n"
                "Decomposition is more useful when each function has one clear responsibility\n"
                "than when an arbitrary number of lines is moved into helpers. A normalizer can\n"
                "return fresh valid records or an error. A summarizer can consume those accepted\n"
                "records and return counts and grouped totals. A presenter can order the topic\n"
                "rows and format a report. State the input/output contract of each boundary.\n"
                "\n"
                "The ordering matters. If aggregation runs before validation, an invalid later\n"
                "record may leave a plausible partial total. If filtering out incomplete records\n"
                "happens before their validation, malformed incomplete records can bypass the\n"
                "dataset contract. A helper's convenient name does not prove it has preserved the\n"
                "policy. Trace the data that crosses each boundary.\n"
                "\n"
                "Passing ordinary data rather than a preformatted report between helpers keeps\n"
                "tests precise. Test normalization on one invalid record without involving\n"
                "sorting. Test summation on a short already-valid list. Test ordering on two equal\n"
                "topic totals. Then add an integration test that checks their composition. A\n"
                "unit test can isolate a failure, but only a whole-pipeline example can catch a\n"
                "caller using the helpers in the wrong order.\n"
                "\n"
                "Draw the pipeline as four boxes with a success arrow and one error exit from\n"
                "validation. Write the shape of the data on every arrow. Finally remove a helper\n"
                "and explain what becomes harder to test or reason about. Do not introduce files,\n"
                "network calls, databases or a framework merely to make this small transformation\n"
                "look sophisticated; those are outside this authored contract.\n"
            ),
            "example": """# Proposed order, shown as inert pseudocode:
normalized_records = validate_and_normalize(all_records)
summary = summarize(normalized_records)
ordered_topics = order_topic_rows(summary["topic_totals"])
report = present(summary, ordered_topics)
# If validation fails, no later step produces a final report.
""",
            "activity": (
                "Specify each helper's input, output and failure behavior. Trace an invalid final "
                "record, identify which functions must not run, and design one isolated test plus "
                "one end-to-end test for the same pipeline."
            ),
            "practice": _ordered(
                "Order the pipeline so malformed incomplete records cannot bypass validation.",
                ["validate", "summarize", "order", "present"],
                [
                    ("present", "Present report"),
                    ("order", "Order grouped rows"),
                    ("summarize", "Summarize valid completed records"),
                    ("validate", "Validate and normalize every record"),
                ],
                "The trust boundary comes before selection and calculation.",
                "Validate all input, summarize, order rows, then present.",
            ),
            "checkpoints": [
                _choice(
                    "Validation fails on the last row. Which next action would violate the pipeline contract?",
                    "summarize",
                    [
                        ("summarize", "Summarize earlier rows and present a successful report"),
                        ("signal", "Signal the validation error without an accepted report"),
                    ],
                    "Later helpers consume accepted input,not an invalid partial dataset.",
                    "A normal-looking partial report would bypass the validation boundary.",
                ),
                _choice(
                    "Which input contract should summarize(valid_records) rely on?",
                    "validated",
                    [
                        ("raw", "Arbitrary unvalidated rows"),
                        ("validated", "Every row has passed normalization and validation"),
                        ("printed", "Already formatted display text"),
                    ],
                    "Each helper needs a meaningful boundary.",
                    "The summarizer consumes accepted records rather than reinterpreting arbitrary input "
                    "or display text.",
                ),
                _choice(
                    "An incomplete row has minutes181. Which pipeline ordering violates the contract?",
                    "filter-first",
                    [
                        ("validate-first", "Validate every row before selecting completed rows"),
                        ("filter-first", "Remove incomplete rows before validating the remaining rows"),
                    ],
                    "A selection step must not conceal invalid input.",
                    "Filtering first hides the malformed incomplete row that should reject the whole dataset.",
                ),
                _multiple(
                    "Select every useful pairing of helper and isolated test.",
                    ["normalizer", "ordering", "composition"],
                    [
                        ("normalizer", "Normalizer: a blank topic must reject input"),
                        ("ordering", "Ordering helper: equal totals use topic-text order"),
                        ("composition", "Whole pipeline: invalid last row produces no accepted report"),
                        ("skip", "Normalizer: silently drop any invalid incomplete row"),
                    ],
                    "Match a test to its rule and include a composition check.",
                    "The first three cases verify distinct boundaries; silently dropping invalid rows "
                    "changes the policy.",
                ),
            ],
        },
        {
            "id": "pp-tests",
            "title": "Choose test cases that distinguish correct and incorrect rules",
            "reference": "library/unittest.html#basic-example",
            "quote": (
                "An expected result must be justified independently of the implementation under "
                "test, and boundary cases should distinguish plausible wrong rules."
            ),
            "explanation": (
                "An expected result must be justified independently of the implementation under "
                "test, and boundary cases should distinguish plausible wrong rules.\n"
                "\n"
                "A test consists of a chosen input, an expected outcome and a reason that outcome\n"
                "follows from the contract. Copying a program's current output into the expected\n"
                "column only records what it did; it does not establish correctness. Derive small\n"
                "totals by hand, write down which records are excluded, and verify the result with\n"
                "another representation such as a trace table.\n"
                "\n"
                "Normal cases are necessary but weak on their own. A duration of 30 cannot tell\n"
                "whether an incorrect strict upper-bound check rejects 180. Use 1 and 180 as\n"
                "accepted boundary cases and 0 and 181 as rejected neighbors. Use empty input,\n"
                "all-incomplete input, duplicate normalized IDs, a blank topic and Boolean minutes\n"
                "to test different rules. State why each case is in the suite instead of collecting\n"
                "many large examples that all exercise the same happy path.\n"
                "\n"
                "Tests should also check important properties beyond one final number. Reordering\n"
                "valid records should not change the completed count or topic totals, while the\n"
                "explicit tie rule should make the report row order agree. Repeating a call should\n"
                "not accumulate old state. An unchanged input check can expose an alias mutation.\n"
                "None of these properties makes the function universally correct; they target\n"
                "specific failure modes that a human can review.\n"
                "\n"
                "Make a table with columns case ID, input, expected report/error, rule and a named\n"
                "fault the test catches. Add one deliberately insufficient test and explain why\n"
                "both a correct and faulty implementation would pass it. Test design is an\n"
                "argument about evidence, not a count of green indicators. The app stores your\n"
                "project text; it does not run it or award a code correctness grade.\n"
            ),
            "example": """# Proposed test cases, not executed learner code:
# duration=180 -> valid: catches an incorrect minutes < 180 boundary.
# duration=True -> invalid: catches an isinstance(minutes, int)-only check.
# [] -> count0,total0,topics[]: catches first-record initialization.
# repeat the same valid call -> same report: catches shared accumulation.
""",
            "activity": (
                "Design at least eight cases and name the fault caught by each. Independently "
                "calculate one normal report, then compare which faults are not detected by a suite "
                "containing only ordinary 30-minute sessions."
            ),
            "practice": _choice(
                "Which case distinguishes minutes <=180 from the incorrect minutes <180?",
                "edge",
                [("normal", "minutes=30"), ("edge", "minutes=180"), ("outside", "minutes=181")],
                "The two conditions disagree exactly at their boundary.",
                "180 is accepted by <= and rejected by <.",
            ),
            "checkpoints": [
                _choice(
                    prompt,
                    answer,
                    choices,
                    "Choose a case whose expected result differs under the named fault.",
                    explanation,
                )
                for prompt, answer, choices, explanation in (
                    (
                        "Which case exposes starting total from records[0]?",
                        "empty",
                        [("empty", "Empty input"), ("one", "One completed record")],
                        "Empty input has no first record but must return a zero report.",
                    ),
                    (
                        "Which duration exposes accepting every isinstance(x,int) value?",
                        "bool",
                        [("bool", "True"), ("int", "30")],
                        "The contract rejects bool even though it is an int subtype.",
                    ),
                    (
                        "Which pair exposes missing normalized-ID uniqueness?",
                        "duplicate",
                        [("duplicate", "IDs ' a ' and 'a'"), ("unique", "IDs 'a' and 'b'")],
                        "The first pair becomes duplicate after stripping.",
                    ),
                    (
                        "Which case exposes reporting before validating incomplete records?",
                        "invalid",
                        [("valid", "Valid incomplete duration30"), ("invalid", "Incomplete duration181")],
                        "An invalid incomplete record must reject the dataset.",
                    ),
                )
            ],
        },
        {
            "id": "pp-errors",
            "title": "Make invalid input a visible whole-pipeline outcome",
            "reference": "tutorial/errors.html#handling-exceptions",
            "quote": (
                "A failure path should state which rule failed and prevent a normal-looking partial "
                "report from being mistaken for accepted output."
            ),
            "explanation": (
                "A failure path should state which rule failed and prevent a normal-looking partial "
                "report from being mistaken for accepted output.\n"
                "\n"
                "An exception is one possible way for a Python function to signal invalid input;\n"
                "a structured error return is another design. Our educational contract does not\n"
                "require a particular UI or framework. It requires the same observable policy:\n"
                "invalid input produces no accepted report, and the explanation identifies a\n"
                "meaningful rule without pretending the data was repaired.\n"
                "\n"
                "For a Boolean duration, invalid_minutes is more useful review evidence than a\n"
                "catch-all 'something happened.' For a repeated normalized ID, duplicate_id tells\n"
                "the caller which uniqueness rule needs attention. Do not expose unrelated\n"
                "internal details or claim a source fact changed merely because a user entered a\n"
                "bad record. Errors about input validity and comments about learning progress are\n"
                "different kinds of information.\n"
                "\n"
                "Avoid a broad catch that returns whatever total has accumulated so far. That\n"
                "can turn a genuine failure into a plausible but incomplete answer. Likewise,\n"
                "catching a missing key and silently substituting zero violates the required-field\n"
                "contract. Catch specific failures only when you can preserve the stated meaning;\n"
                "otherwise allow the validation error to reach the designated error boundary.\n"
                "\n"
                "Trace one valid record followed by an invalid record. Write the local work that\n"
                "may have occurred and the single observable error result that is allowed. Then\n"
                "compare a failure-before-calculation design with a design that validates while\n"
                "collecting fresh records but still never publishes partial output. Both can\n"
                "respect the policy if no partial report is accepted; a hidden catch that changes\n"
                "the policy cannot. Your project explanation should make this choice reviewable.\n"
            ),
            "example": """# Inert pseudocode illustrating the policy, not a required API:
normalized = validate_every_record(records)  # may signal invalid_minutes
# Only a successful validation result reaches the following line.
report = summarize(normalized)
# Do not catch invalid_minutes merely to return an earlier partial total.
""",
            "activity": (
                "Trace late invalid input and write an error message for each contract rule. "
                "Compare exceptions with structured errors, explain why silent skip/default "
                "behavior is disallowed, and identify the exact point a normal report becomes "
                "accepted."
            ),
            "practice": _choice(
                "A valid completed25-minute record is followed by duration181. What is the accepted result?",
                "error",
                [
                    ("partial", "A 25-minute report"),
                    ("error", "An invalid_minutes error and no accepted report"),
                    ("skip", "Silently skip the second record"),
                ],
                "The entire input must validate.",
                "The later invalid record prevents an accepted report.",
            ),
            "checkpoints": [
                _choice(
                    "A dataset has three valid records followed by an invalid incomplete record. What is accepted?",
                    "error",
                    [
                        ("partial", "A report for only the first three records"),
                        ("error", "A validation error; no normal report"),
                        ("zero", "A zero report, labelled successful"),
                    ],
                    "The count of earlier valid records does not change failure policy.",
                    "A late invalid record rejects the whole dataset.",
                ),
                _choice(
                    "A required minutes field is missing. Which handling preserves the contract?",
                    "reject",
                    [
                        ("zero", "Substitute zero and mark the report successful"),
                        ("reject", "Signal invalid_fields and accept no normal report"),
                    ],
                    "Required information must not be invented.",
                    "A missing required field is a validation failure.",
                ),
                _choice(
                    "A broad catch returns the partial total after any validation exception. What is wrong?",
                    "policy",
                    [
                        ("policy", "It disguises failure as an accepted partial report"),
                        ("nothing", "Nothing: catching any error proves robustness"),
                    ],
                    "Check what the caller is told, not only whether an exception disappears.",
                    "The contract rejects the whole dataset; suppressing an error does not repair its meaning.",
                ),
                _choice(
                    "Which signaling design can satisfy the authored failure policy?",
                    "either",
                    [
                        ("exception-only", "Only exceptions, regardless of what the caller does"),
                        (
                            "either",
                            "A specific exception or structured error, provided invalid input has no accepted report",
                        ),
                        ("partial", "Any design that returns the earlier total"),
                    ],
                    "The observable contract matters more than one syntax choice.",
                    "Either error mechanism can work when the caller preserves whole-dataset failure.",
                ),
            ],
        },
        {
            "id": "pp-integration",
            "title": "Trace the complete analyzer and reconcile its invariants",
            "reference": "tutorial/datastructures.html#looping-techniques",
            "quote": (
                "An integration trace follows validation, selection, totals, grouping and ordering "
                "together; agreement at only one intermediate stage is insufficient."
            ),
            "explanation": (
                "An integration trace follows validation, selection, totals, grouping and ordering "
                "together; agreement at only one intermediate stage is insufficient.\n"
                "\n"
                "Use the five fixed capstone records, not a changing remote dataset. First check\n"
                "their fields, types, duration bounds and unique normalized IDs. Then mark the\n"
                "four completed records. The incomplete SQL40 record stays valid input but does\n"
                "not contribute to the completed report. The completed count is four and the\n"
                "completed-minute total is 25+35+20+30=110.\n"
                "\n"
                "Group the same included records: Python receives 60 minutes, SQL30 and Math20.\n"
                "Their sum is again 110. This reconciles the global and grouped totals. Order the\n"
                "topic rows by the stated key to produce Python60, SQL30, Math20. A display that\n"
                "shows 110 but omits Math is not correct; a grouped sum of110 with two wrongly\n"
                "labelled topics is not proven correct by its sum either.\n"
                "\n"
                "Now change one assumption at a time. Mark SQL40 complete and recompute both\n"
                "global and per-topic totals. Change a valid duration to181 and explain why the\n"
                "correct result is an error, not the new arithmetic total. Reverse the valid\n"
                "input and check that the report still follows the explicit ordering rule. This\n"
                "distinguishes rules that depend on content from incidental input order.\n"
                "\n"
                "Your final manual trace should be understandable without running the code. Show\n"
                "the included-record markers, accumulator changes, topic rows and resulting\n"
                "report. Keep expected results separate from any implementation output. Those\n"
                "artifacts let a human assess the reasoning while the app's execution gate remains\n"
                "closed. They do not turn a read-and-reason submission into evidence of successful\n"
                "runtime execution or measured learner competence.\n"
            ),
            "example": json.dumps(FIXED_RECORDS, indent=2)
            + "\n# Expected: count4,total110,topics Python60 / SQL30 / Math20.\n",
            "activity": (
                "Complete the five-record trace and reconciliation. Mark SQL40 complete and derive "
                "the changed report; then replace one duration with181 and explain why no "
                "arithmetic report is accepted. Check that reversed valid input yields the same "
                "ordered report."
            ),
            "practice": _number(
                "For the five fixed capstone records, what is the completed-minute total?",
                110,
                "Exclude SQL40, which is incomplete.",
                "25+35+20+30 = 110.",
            ),
            "checkpoints": [
                _number(
                    "The fixed report totals110. If the incomplete SQL40 session becomes completed "
                    f"and a new valid completed Math{extra} session is added, what is the new total?",
                    150 + extra,
                    "Add both newly included contributions to the original110.",
                    f"110+40+{extra} = {150 + extra}.",
                )
                for extra in (5, 10, 15, 25)
            ],
        },
        {
            "id": "pp-evidence",
            "title": "Explain what the report and its evidence can actually establish",
            "reference": "library/unittest.html#basic-example",
            "quote": (
                "A saved explanation, a passing checkpoint and a submitted project are different "
                "evidence events; none alone proves that learner code executed correctly."
            ),
            "explanation": (
                "A saved explanation, a passing checkpoint and a submitted project are different "
                "evidence events; none alone proves that learner code executed correctly.\n"
                "\n"
                "The analyzer describes recorded completed activity under an authored contract.\n"
                "It cannot infer that25minutes caused learning, that a topic was mastered, or\n"
                "that the learner is ready for a career. Those would need different measures and\n"
                "validation. A careful report states the data and assumptions it used instead of\n"
                "turning an activity count into a capability claim.\n"
                "\n"
                "Course evidence links should identify the exact authored explanation that\n"
                "supports a rule or reasoning step. The explicit duration range comes from this\n"
                "project's specification. Dictionary and function behavior is supported by the\n"
                "versioned Python3.12 references. Those are different sources of authority. A\n"
                "link to a Python tutorial does not by itself establish our product's180-minute\n"
                "maximum, and an exact quote locator does not automatically prove every sentence\n"
                "in a learner explanation is semantically supported.\n"
                "\n"
                "The app records answers to deterministic static checkpoints separately from a\n"
                "capstone submission. A required capstone can be submitted with structured text,\n"
                "expected cases and selected evidence, but it still needs human rubric review.\n"
                "An evidence checkbox, word count or model-generated comment is not a correctness\n"
                "grade. Explain limitations rather than silently promoting submission to mastery.\n"
                "\n"
                "Prepare a short design note with a claim, its supporting authored evidence ID,\n"
                "and a sentence explaining the connection. Include one deliberately unsupported\n"
                "claim and explain why the source cannot establish it. End with the execution\n"
                "limitation: StudyVault does not execute the submitted Python, SQL or shell code.\n"
                "The reviewable result here is a reasoned project artifact, not a measured runtime\n"
                "or automatically certified program.\n"
            ),
            "example": """Claim: The example's completed-minute total is110.
Support: pp-integration-evidence and the fixed-record trace.
Limitation:110 recorded minutes do not establish mastery of Python.
Submission status: submitted for human review; code was not executed by StudyVault.
""",
            "activity": (
                "Write three supported design claims and their exact evidence IDs, plus two claims "
                "the report cannot establish. Distinguish specification authority from language "
                "references, and draft a limitation statement for your capstone."
            ),
            "practice": _choice(
                "Which statement is justified by a saved project submission alone?",
                "submitted",
                [
                    ("executed", "The submitted code executed correctly"),
                    ("mastered", "The learner mastered Python"),
                    ("submitted", "A project artifact was submitted for human review"),
                ],
                "Submission and correctness are different evidence events.",
                "Saving text establishes submission, not execution or mastery.",
            ),
            "checkpoints": [
                _choice(
                    "A review note says: 'The capstone text is saved and has evidence links.' "
                    "Which conclusion is supported?",
                    "artifact",
                    [
                        ("artifact", "There is a reviewable saved artifact"),
                        ("runtime", "All code passed runtime tests"),
                        ("career", "The learner is career-ready"),
                    ],
                    "Do not infer execution or ability from a submission event.",
                    "The saved artifact supports a review workflow only.",
                ),
                _choice(
                    "Which source establishes this project's maximum duration of180 minutes?",
                    "spec",
                    [
                        ("python", "Python's general dictionary documentation"),
                        ("spec", "The authored analyzer specification"),
                        ("timer", "The learner's recorded study time"),
                    ],
                    "Distinguish application policy from language semantics.",
                    "The180-minute boundary is an authored project rule,not a Python dictionary rule.",
                ),
                _choice(
                    "What can a completed-minute total of110 establish?",
                    "activity",
                    [
                        ("activity", "The amount of recorded completed activity under the stated contract"),
                        ("mastery", "Calibrated mastery of Python"),
                        ("execution", "Successful execution of the submitted program"),
                    ],
                    "Do not turn one kind of evidence into a stronger claim.",
                    "The report summarizes its records; it does not calibrate ability or execute a program.",
                ),
                _choice(
                    "Every quote locator resolves. Which further review is still needed?",
                    "support",
                    [
                        ("none", "None; matching text proves every claim correct"),
                        ("support", "A human must assess whether the located material supports each teaching claim"),
                    ],
                    "Location correctness and semantic support are different checks.",
                    "Exact locators establish where text is stored,not that every interpretation is justified.",
                ),
            ],
        },
    ]


def _module_checkpoint(module_index, objective_ids, evidence_ids):
    """One composite question per alternative, never multiple required IDs."""
    variants = []
    for offset in (0, 5, 10, 15):
        if module_index == 0:
            value = 20 + offset
            prompt = (
                f"Module1 case: record A has id=' a ',topic='Math',minutes={value},completed=False; "
                "record B has id='a',topic='SQL',minutes=10,completed=True. Select EVERY true statement."
            )
            choices = [
                ("normalized", "A's normalized ID is a"),
                ("duplicate", "Together A and B violate the normalized-ID uniqueness rule"),
                ("type", f"A's integer duration{value} passes the duration type/range rule"),
                ("skip", "A needs no validation because it is incomplete"),
                ("report", "The pair must produce a successful partial10-minute report"),
                ("positions", "A's dictionary fields must be read by numeric position"),
            ]
            correct = ["normalized", "duplicate", "type"]
            explanation = "Strip A's ID to a; its duration is valid, but B duplicates that ID, so reject the pair."
        elif module_index == 1:
            base = 20 + offset
            prompt = (
                f"Module2 case: completed Python{base}, completed Math{base}, incomplete SQL40, completed Python10. "
                "All input validates. Select EVERY true report statement."
            )
            choices = [
                ("total", f"The total is{2 * base + 10}"),
                ("python", f"Python's grouped total is{base + 10}"),
                ("order", f"Ordered topics are Python{base + 10}, then Math{base}"),
                ("sql", "Incomplete SQL40 adds40 to the completed total"),
                ("overwrite", "Python's total should be overwritten with the final10"),
                ("mutation", "The original records must be edited to build totals"),
            ]
            correct = ["total", "python", "order"]
            explanation = f"Filter SQL40, add repeated Python contributions, then order:{base + 10}>{base}."
        elif module_index == 2:
            prompt, choices, correct, explanation = [
                (
                    "A helper keeps a global total,filters before validation,and has only an ordinary30-minute test. "
                    "Select EVERY justified repair.",
                    [
                        ("local", "Initialize a fresh local accumulator for each call"),
                        ("validate", "Validate every input row before summarizing"),
                        ("tests", "Add independently justified empty,boundary and repeated-call cases"),
                        ("copy", "Copy the current program output as the sole expected result"),
                        ("hide", "Skip malformed incomplete records before validation"),
                    ],
                    ["local", "validate", "tests"],
                    "Fresh locals,correct pipeline order and discriminating independent tests target the three faults.",
                ),
                (
                    "A proposed analyzer edits input records,prints its report instead of returning data,and catches "
                    "late validation failure to return a partial sum. Select EVERY justified repair.",
                    [
                        ("fresh", "Construct fresh result structures without editing submitted records"),
                        ("return", "Return a report data structure for the caller"),
                        ("error", "Signal invalid input without an accepted partial report"),
                        ("global", "Keep totals globally so repeated calls can accumulate old work"),
                        ("skip", "Leave incomplete rows unvalidated"),
                    ],
                    ["fresh", "return", "error"],
                    "Preserve ownership,return usable data,and keep the whole-dataset failure boundary visible.",
                ),
                (
                    "A test plan copies current implementation output,omits duration endpoints,and calls the analyzer "
                    "only once. Select EVERY improvement that supplies independent evidence.",
                    [
                        ("manual", "Derive small expected reports manually from the written contract"),
                        ("boundaries", "Include accepted1/180 and rejected0/181 durations"),
                        ("repeat", "Repeat unchanged valid input and verify stable output and unchanged input"),
                        ("count", "Replace these checks with many ordinary30-minute examples only"),
                        ("belief", "Assume a helper name proves the implementation obeys its contract"),
                    ],
                    ["manual", "boundaries", "repeat"],
                    "Independent results,boundary distinctions and repeat/nonmutation checks target different faults.",
                ),
                (
                    "A pipeline formats raw input first,then validates only completed rows,and sends formatted text "
                    "to a numeric summarizer. Select EVERY justified boundary repair.",
                    [
                        ("all", "Validate and normalize all records before selection"),
                        ("data", "Pass accepted record data to the summarizer"),
                        ("last", "Order and present the report after summarization"),
                        ("ignore", "Treat a formatted string as proof the numeric fields are valid"),
                        ("partial", "Publish early totals before the last row is checked"),
                    ],
                    ["all", "data", "last"],
                    "Trust boundaries and helper input/output shapes must agree across the complete pipeline.",
                ),
            ][offset // 5]
        else:
            extra = 5 + offset
            prompt = (
                "Fixed records: completed Python25, incomplete SQL40, completed Python35, completed Math20, "
                "completed SQL30; all IDs are distinct and other fields valid. "
                "Cumulative case: the incomplete SQL40 becomes completed and a new valid completed "
                f"Math{extra} record with unique ID is added. Separately, consider a variant "
                "with an additional Boolean "
                "duration. Select EVERY statement justified by the whole course contract."
            )
            choices = [
                ("total", f"The valid changed dataset totals{150 + extra} completed minutes"),
                ("groups", f"Its topics have SQL70,Python60,Math{20 + extra} minutes"),
                ("order", f"The row order is SQL70,Python60,Math{20 + extra}"),
                ("invalid", "The separate Boolean-duration variant must error instead of returning a partial report"),
                (
                    "repeat",
                    (
                        "A fresh local,nonmutating analyzer should return the same report on repeated "
                        "unchanged valid input"
                    ),
                ),
                (
                    "test",
                    "Expected test results should be justified from the contract,not copied only from program output",
                ),
                ("evidence", "The input contract and authored integration trace can support these design claims"),
                ("status", "A saved text capstone is submitted evidence for human review,not proof of runtime success"),
                ("skip", "Incomplete records never need validation"),
                ("overwrite", "Grouping replaces Python's earlier25 with35"),
                ("execution", "Submitting code text authorizes the app to execute it"),
                ("mastery", "Recorded minutes certify career readiness"),
            ]
            correct = ["total", "groups", "order", "invalid", "repeat", "test", "evidence", "status"]
            explanation = (
                f"110+40+{extra}={150 + extra}; topic totals follow the same included records. "
                "Validation,repeatability,independent testing and honest submission/evidence limits still apply."
            )
        variants.append(
            _multiple(
                prompt,
                correct,
                choices,
                "Check every option against the full stated case; a partly correct selection is not enough.",
                explanation,
            )
        )
    return variants


def practical_python_foundations() -> CourseRelease:
    """Return the full draft; trusted acceptance fixtures may publish a COPY only."""
    rows = _lessons()
    sources, evidence, objectives, modules, lessons, exercises = [], [], [], [], [], []
    module_titles = [
        "Reliable input contracts",
        "Deterministic transformations",
        "Functions and testable design",
        "Integrated report and evidence",
    ]
    all_objectives, all_evidence = [], []
    for module_index in range(4):
        module_id = f"pp-module-{module_index + 1}"
        module_rows = rows[module_index * 3 : (module_index + 1) * 3]
        module_objectives, module_evidence, module_lessons = [], [], []
        for row in module_rows:
            identifier = row["id"]
            objective_id, source_id, evidence_id = (
                f"{identifier}-{kind}" for kind in ("objective", "source", "evidence")
            )
            prerequisites = [all_objectives[-1]] if all_objectives else []
            objectives.append({"id": objective_id, "title": row["title"], "prerequisites": prerequisites})
            all_objectives.append(objective_id)
            all_evidence.append(evidence_id)
            module_objectives.append(objective_id)
            module_evidence.append(evidence_id)
            body = row["explanation"] + "\n\n" + row["example"] + "\n\nExtended paper activity: " + row["activity"]
            sources.append(
                {"id": source_id, "title": row["title"], "body": body, "reference_urls": [BASE + row["reference"]]}
            )
            evidence.append(
                {
                    "id": evidence_id,
                    "source_id": source_id,
                    "locator": f"authored/{identifier}/explanation/paragraph-1",
                    "quote": row["quote"],
                }
            )
            practice_id = identifier + "-practice"
            checkpoint_ids = [f"{identifier}-checkpoint-{index + 1}" for index in range(len(row["checkpoints"]))]
            exercises.append(_exercise(practice_id, "practice", row["practice"], [objective_id], [evidence_id]))
            exercises.extend(
                _exercise(checkpoint_id, "checkpoint", definition, [objective_id], [evidence_id])
                for checkpoint_id, definition in zip(checkpoint_ids, row["checkpoints"], strict=True)
            )
            lessons.append(
                {
                    "id": identifier,
                    "title": row["title"],
                    "objective_ids": [objective_id],
                    "blocks": [
                        {
                            "id": identifier + "-explanation",
                            "type": "explanation",
                            "content": row["explanation"],
                            "evidence_ids": [evidence_id],
                        },
                        {
                            "id": identifier + "-example",
                            "type": "code",
                            "content": row["example"],
                            "language": "python",
                            "evidence_ids": [evidence_id],
                        },
                        {
                            "id": identifier + "-activity",
                            "type": "recap",
                            "content": "Extended paper activity (planning estimate25–35minutes): "
                            + row["activity"]
                            + "\n\nExplain your trace and assumptions before checking the independent question.",
                            "evidence_ids": [evidence_id],
                        },
                    ],
                    "practice_ids": [practice_id],
                    "checkpoint_ids": checkpoint_ids,
                }
            )
            module_lessons.append(identifier)
        checkpoint_id = f"pp-module-{module_index + 1}-checkpoint"
        # The final checkpoint is cumulative across all twelve teaching objectives.
        refs = list(all_evidence if module_index == 3 else module_evidence)
        objective_refs = list(all_objectives if module_index == 3 else module_objectives)
        definitions = _module_checkpoint(module_index, objective_refs, refs)
        quote_lookup = {item["id"]: item["quote"] for item in evidence}
        recap = "\n\n".join(quote_lookup[identifier] for identifier in refs)
        lesson_body = (
            "This checkpoint combines the preceding rules in one case. Select every justified statement; "
            "a partial selection is not a pass. The question alternatives are fresh variants,not separate "
            "required items. A solution reveal is learning support and cannot count as an independent pass.\n\n" + recap
        )
        source_id, evidence_id = checkpoint_id + "-source", checkpoint_id + "-evidence"
        checkpoint_quote = (
            "A composite checkpoint requires the complete justified selection for its stated "
            "case; selecting only some correct statements is insufficient."
        )
        lesson_body += "\n\n" + checkpoint_quote
        sources.append(
            {
                "id": source_id,
                "title": module_titles[module_index] + " review",
                "body": lesson_body,
                "reference_urls": [BASE + "tutorial/"],
            }
        )
        evidence.append(
            {
                "id": evidence_id,
                "source_id": source_id,
                "locator": f"authored/{checkpoint_id}/review/paragraph-final",
                "quote": checkpoint_quote,
            }
        )
        refs.append(evidence_id)
        practice_id = checkpoint_id + "-practice"
        review_practice = _multiple(
            f"Prepare for {module_titles[module_index]}. Select EVERY sound review action.",
            ["contract", "trace", "derive"],
            [
                ("contract", "Restate the relevant input/output and failure rules"),
                ("trace", "Trace the stated case and explain each inclusion or rejection"),
                ("derive", "Derive expected results from the contract rather than copying program output"),
                ("guess", "Mark every option correct whenever a final total looks plausible"),
            ],
            "A complete justified case matters more than a plausible-looking number.",
            "Restate the rules,trace the case,and independently justify results. "
            "Guessing from appearance is insufficient.",
        )
        exercises.append(_exercise(practice_id, "practice", review_practice, objective_refs, refs))
        checkpoint_ids = [checkpoint_id + f"-{index + 1}" for index in range(len(definitions))]
        exercises.extend(
            _exercise(identifier, "checkpoint", definition, objective_refs, refs)
            for identifier, definition in zip(checkpoint_ids, definitions, strict=True)
        )
        lessons.append(
            {
                "id": checkpoint_id,
                "title": (
                    "Cumulative course checkpoint"
                    if module_index == 3
                    else f"Module{module_index + 1} composite checkpoint"
                ),
                "objective_ids": objective_refs,
                "blocks": [
                    {"id": checkpoint_id + "-recap", "type": "recap", "content": lesson_body, "evidence_ids": refs}
                ],
                "practice_ids": [practice_id],
                "checkpoint_ids": checkpoint_ids,
            }
        )
        module_lessons.append(checkpoint_id)
        modules.append({"id": module_id, "title": module_titles[module_index], "lesson_ids": module_lessons})
    capstone_source, capstone_evidence = "pp-capstone-source", "pp-capstone-evidence"
    sources.append(
        {
            "id": capstone_source,
            "title": "Study-session analyzer: authored specification and cases",
            "body": CAPSTONE_CONTRACT
            + "\n\nFixed records:\n"
            + json.dumps(FIXED_RECORDS, indent=2)
            + "\n\nAuthored review vectors:\n"
            + json.dumps(CAPSTONE_CASES, indent=2),
            "reference_urls": [BASE + "tutorial/datastructures.html", BASE + "library/unittest.html"],
        }
    )
    capstone_quote = (
        "No submitted code runs in StudyVault. Submission is\n"
        "not a correctness grade, an execution result or certification of mastery."
    )
    evidence.append(
        {
            "id": capstone_evidence,
            "source_id": capstone_source,
            "locator": "authored/pp-capstone/specification/final-paragraph",
            "quote": capstone_quote,
        }
    )
    assignments = [
        {
            "id": "pp-capstone",
            "title": "Design and explain a study-session analyzer",
            "prompt": CAPSTONE_CONTRACT
            + "\n\nFixed input for your manual trace:\n"
            + json.dumps(FIXED_RECORDS, ensure_ascii=False)
            + "\n\nAuthor at least six of your own justified normal,boundary and invalid test cases. "
            "The fixed case's worked result is count4,total110,ordered topics Python60,SQL30,Math20.",
            "deliverable": (
                "Four structured text sections: contract/algorithm,manual trace,independent test "
                "plan,and limitations/evidence. Code or pseudocode stays text. At least six "
                "justified test cases; no execution claim."
            ),
            "rubric": [
                (
                    "Specification: exact fields,types,normalization,duplicate IDs,bounds and failure "
                    "policy are explicit."
                ),
                (
                    "Correctness reasoning: selection,counts,grouped totals and stable row order "
                    "reconcile with the fixed case."
                ),
                (
                    "Design and tests: clear nonmutating helpers and at least six independently "
                    "justified normal/boundary/invalid cases."
                ),
                (
                    "Evidence and honesty: claims link to exact course evidence; submission is not an "
                    "execution or mastery grade."
                ),
            ],
            "objective_ids": all_objectives,
            "evidence_ids": all_evidence + [capstone_evidence],
            "criteria": [
                {
                    "id": "specification",
                    "description": "State and apply the exact input/output contract.",
                    "objective_ids": all_objectives[:3],
                    "evidence_ids": all_evidence[:3],
                    "review_guidance": (
                        "Check all required fields,strict types,1..180,normalized-ID "
                        "uniqueness,case-sensitive stripped topics,validation of incomplete records and "
                        "whole-dataset failure."
                    ),
                },
                {
                    "id": "report",
                    "description": "Justify the full report with a nonmutating trace.",
                    "objective_ids": all_objectives[3:6] + [all_objectives[10]],
                    "evidence_ids": all_evidence[3:6] + [all_evidence[10]],
                    "review_guidance": (
                        "For fixed input require count4,total110,Python60/SQL30/Math20 in that order. Check "
                        "mixed completion,repeated topics and tie order; do not infer correctness from a "
                        "matching total alone."
                    ),
                },
                {
                    "id": "tests",
                    "description": "Provide a decomposed design and discriminating independent tests.",
                    "objective_ids": all_objectives[6:10],
                    "evidence_ids": all_evidence[6:10],
                    "review_guidance": (
                        "Require fresh local state,no input mutation and validation-before-summary. Verify "
                        "at least six cases including accepted endpoints,an invalid type,late invalid "
                        "input,empty input and ties/repeated calls; expected results must be derived "
                        "independently."
                    ),
                },
                {
                    "id": "evidence",
                    "description": "Explain source support and the limits of submission evidence.",
                    "objective_ids": [all_objectives[11]],
                    "evidence_ids": [all_evidence[11], capstone_evidence],
                    "review_guidance": (
                        "Each key design claim should cite a relevant stored source. Reject claims that "
                        "text length,self-review,stored minutes or app submission proves code "
                        "execution,semantic correctness or career readiness."
                    ),
                },
            ],
            "sections": [
                {
                    "id": "algorithm",
                    "title": "Contract and algorithm",
                    "prompt": (
                        "State the contract,helper boundaries and error path. Provide nonmutating "
                        "pseudocode or Python as inert text."
                    ),
                    "min_chars": 120,
                    "max_chars": 3000,
                },
                {
                    "id": "trace",
                    "title": "Manual report trace",
                    "prompt": (
                        "Trace the five fixed records through validation,selection,grouping and ordering. "
                        "Reconcile count4,total110 and Python60/SQL30/Math20."
                    ),
                    "min_chars": 100,
                    "max_chars": 3000,
                },
                {
                    "id": "test-plan",
                    "title": "Independent test plan",
                    "prompt": (
                        "Give at least six case IDs,inputs,expected reports/errors,and contract-based "
                        "reasons. Include normal,boundary and invalid cases."
                    ),
                    "min_chars": 160,
                    "max_chars": 3000,
                },
                {
                    "id": "limitations",
                    "title": "Evidence and limitations",
                    "prompt": (
                        "Connect design claims to selected course evidence. Distinguish specification from "
                        "Python references and state that submission is unexecuted and needs human review."
                    ),
                    "min_chars": 100,
                    "max_chars": 2000,
                },
            ],
            "require_evidence": True,
        }
    ]
    return CourseRelease.model_validate(
        {
            "id": stable_id(SLUG + "/release/1"),
            "course_id": stable_id(SLUG + "/course"),
            "slug": SLUG,
            "title": "Practical Python Foundations",
            "description": (
                "Design,trace and justify a small study-session analyzer across input "
                "contracts,deterministic transformations,testable functions and a reviewable "
                "capstone. All code remains inert text."
            ),
            "version": "1",
            "size": "full",
            "origin": "prebuilt",
            "visibility": "catalog",
            "status": "draft",
            "estimated_minutes": 840,
            "prerequisites": ["python-foundations"],
            "sources": sources,
            "evidence": evidence,
            "objectives": objectives,
            "modules": modules,
            "lessons": lessons,
            "exercises": exercises,
            "assignments": assignments,
            "required_assignment_ids": ["pp-capstone"],
        }
    )
