# Python and PyTorch: authored mini courses

Prepared 2026-11-18 for Phase 8.B. Status: **private editorial drafts; publication
remains pending human review and the 8.B10 acceptance journey**.
The authored releases remain hidden from learner catalog and enrollment until
review approves the content, answer keys, evidence, and source use.
The references below were opened on 2026-11-18. No PyTorch runtime, downloaded
dataset, paid source or executable learner code is required by these drafts.

## Publication and assessment contract

The current catalog builds version `1` releases for `python-foundations` and
`pytorch-fundamentals`. Both are Mini/prebuilt courses. Python is the starter;
PyTorch enrollment requires Python Foundations completion or a passing optional
diagnostic. Times are estimates, not completion guarantees or limits.

The release builder creates one objective per lesson, separate explanation/code
teaching blocks, one practice item, and fresh checkpoint variants. Active objective
IDs are `py-values-objective`, `py-branches-objective`, `py-loops-objective`,
`py-functions-objective`, `py-records-objective`, `pt-tensors-objective`,
`pt-reshape-objective`, `pt-broadcast-objective`, `pt-autograd-objective`, and
`pt-training-objective`. Lesson labels below are descriptive; the authored release
builder is the source of active prompts and keys. A learner must pass an independent
checkpoint in each lesson. Continue, hints, reveals, and practice cannot grant
independent mastery.

All answer keys below are **editor-only**. Production seeds must keep them in
server-only exercise definitions; course/catalog/session responses omit keys until
the relevant feedback/reveal action permits them. Never grade from a client-sent
correctness flag. Idempotency/revision checks apply before saving attempts.

The current releases use numeric and single-choice answers only. Ordered and
multiple-choice answer contracts exist in the service but are not used in these
lessons. Reject unknown choices and malformed input; do not evaluate strings as
Python. Free text does not establish a pass without a separately reviewed rubric.

## Sources and evidence

The authored excerpts in this file are the primary instructional material. At
publication, snapshot each lesson's original text as a versioned authored source
with paragraph/block locators, hash, review status and platform allowed-use record.
Enrollments materialize those sources privately through the existing owner-scoped
document/chunk bridge. Source references must resolve to the exact stored version.
External links are supporting references, not permission to copy entire pages.

| Reference ID | Official reference | Relevant topics |
|---|---|---|
| `py-intro` | [Python tutorial: informal introduction](https://docs.python.org/3/tutorial/introduction.html) | Values, arithmetic, strings, lists |
| `py-flow` | [Python tutorial: control flow](https://docs.python.org/3/tutorial/controlflow.html) | Conditions, iteration, range, functions |
| `py-data` | [Python tutorial: data structures](https://docs.python.org/3/tutorial/datastructures.html) | Lists, dictionaries and iteration |
| `pt-intro` | [PyTorch: Learn the Basics](https://docs.pytorch.org/tutorials/beginner/basics/intro.html) | Learning sequence and training workflow |
| `pt-tensor` | [PyTorch: Tensors](https://docs.pytorch.org/tutorials/beginner/basics/tensorqs_tutorial.html) | Shape, dtype, device, indexing, operations |
| `pt-broadcast` | [PyTorch: Broadcasting semantics](https://docs.pytorch.org/docs/stable/notes/broadcasting.html) | Trailing-dimension compatibility; stable link currently resolves to version 2.15 |
| `pt-autograd` | [PyTorch: Automatic differentiation](https://docs.pytorch.org/tutorials/beginner/basics/autogradqs_tutorial.html) | Gradient tracking, backward and accumulated gradients |
| `pt-opt` | [PyTorch: Optimizing model parameters](https://docs.pytorch.org/tutorials/beginner/basics/optimization_tutorial.html) | Loss, SGD, zeroing gradients, parameter updates and evaluation |

The `/3/` Python links currently report Python 3.15; the small language subset used
here also works with the repository's Python 3.12 runtime. Pin a reviewed reference
snapshot/version during publication rather than interpreting a moving URL as an
immutable source. PyTorch snippets are illustrative reference syntax, not installed
API dependencies or a promise of an embedded execution environment.

## Course 1: Python Foundations

Slug: `python-foundations`. Suggested effort: 60-90 minutes. Prerequisite: none.
Outcome: trace a small data-processing function and explain its values, branches,
iteration and result. No installation is needed; all exercises are read-and-reason.

### PY01: Values, names and expressions

Release objective: `py-values-objective`. Evidence: authored `PY01` material;
supporting `py-intro`.

**Explanation:** A name identifies a value that the program can use later.
Assignment evaluates the expression on the right before binding the name on the
left. Arithmetic expressions have an order: multiplication is evaluated before
addition unless parentheses change the grouping. A quoted number is text; it is
not automatically the same value as the corresponding integer.

```python
boxes = 4
items_per_box = 3
loose_items = 2
total_items = boxes * items_per_box + loose_items
```

Example result: `total_items` is the integer `14`.

Practice `py01-practice`: integer answer, `5 + 3 * 2` -> **11**. Feedback: the
multiplication produces 6, then addition produces 11.

Active checkpoint variants ask for `2 * (n + 1) - 3` for generated values
`n = 7..22`; the first key is **13**. These variants test arithmetic and grouping.

### PY02: Conditions and boundaries

Release objective: `py-branches-objective`. Evidence: authored `PY02` material;
supporting `py-flow`.

**Explanation:** A condition selects a path. In an `if`/`elif`/`else` chain, the
first true condition selects its block and the remaining alternatives are skipped.
Boundary values matter: `>= 60` includes 60, while `> 60` excludes it.

```python
score = 68
if score >= 80:
    band = "advanced"
elif score >= 60:
    band = "ready"
else:
    band = "practice"
```

Example result: `band` is `"ready"`; the second condition is the first true one.

Practice `py02-practice`: same rule, `score = 80`; choices `advanced`, `ready`,
`practice` -> **advanced**.

Active checkpoint variants use generated `temperature`, lower and upper bounds in
an `if/elif/else` chain, with a single-choice result `cold`, `mild`, or `warm`.
The first generated variant has `temperature = 10` and the key is **mild**. The
release varies strict-boundary cases; it does not reuse the fixed score example as
a checkpoint.

### PY03: Lists, iteration and accumulators

Release objective: `py-loops-objective`. Evidence: authored `PY03` material;
supporting `py-flow`, `py-data`.

**Explanation:** A list preserves item order. Its first item has index 0.
A `for` loop visits each item in order. An accumulator keeps a running result;
the starting value and update rule together determine the final value.

```python
readings = [3, 6, 9]
total = 0
for reading in readings:
    total = total + reading
```

Example trace: `total` becomes 3, then 9, then 18.

Practice `py03-practice`: integer answer, `readings[1]` -> **6**.

Active checkpoint variants start with `total = 1`, add each value in a three-item
list, and ask for the final numeric total; the first variant is `[2, 5, 1]` and
its key is **9**.
Practice tests zero-based list access. Checkpoints do not currently ask for
intermediate totals or the number of `range(2, 5)` iterations.

### PY04: Functions, parameters and results

Release objective: `py-functions-objective`. Evidence: authored `PY04` material;
supporting `py-flow`.

**Explanation:** A function names a reusable computation. Parameters receive
arguments when the function is called. `return` sends a result to the caller;
printing displays text but is not a substitute for returning a result.

```python
def add_fee(price, fee):
    return price + fee

invoice = add_fee(12, 3)
```

Example result: `invoice` is 15. Neither parameter changes the caller's literal
arguments; the function calculates a result from them.

Practice `py04-practice`: integer answer, `add_fee(8, 2)` -> **10**.

Active checkpoint variants trace `scale_then_add(value, 3)` for generated values
`value = 4..19`; the first key is **13**. The release does not currently include
the outlined choice comparing `return`, `print`, and `pass`.

### PY05: Dictionaries and useful aggregation

Release objective: `py-records-objective`. Evidence: authored `PY05` material;
supporting `py-data` and prior authored Python lessons.

**Explanation:** A dictionary associates a key with a value. A list of dictionaries
can represent records with the same fields. A condition can select records while
a loop combines their values. Read the selected field and update only when the
condition is true.

```python
orders = [
    {"paid": True, "amount": 7},
    {"paid": False, "amount": 5},
    {"paid": True, "amount": 4},
]
total = 0
for order in orders:
    if order["paid"]:
        total = total + order["amount"]
```

Example result: total paid amount is 11; the unpaid order is skipped.

Practice `py05-practice`: integer answer, `orders[1]["amount"]` -> **5**.

Active checkpoint variants generate three records with `active` flags and ask for
the sum of `minutes` from active records; the first key is **14**. Practice tests
dictionary field access. The outlined boundary-filter item is not currently active.

Completion requires all five checkpoints independently passed. Hand off cards for
assignment/expression order, branch boundaries, zero-based indexing, accumulator
state, function return and dictionary access. Cards remain linked to authored
evidence, and card practice does not replace checkpoint evidence.

## Course 2: PyTorch Fundamentals

Slug: `pytorch-fundamentals`. Suggested effort: 90-120 minutes. Prerequisite:
complete Python Foundations or pass the optional entry diagnostic. Outcome: trace
basic tensor shapes, broadcasting counts, gradient arithmetic and a parameter
update. Evaluation is discussed in the lesson text but not independently assessed
in the active release.

### PT01: Tensors carry values and structure

Release objective: `pt-tensors-objective`. Evidence: authored `PT01` material;
supporting `pt-intro`, `pt-tensor`.

**Explanation:** A tensor combines numerical values with shape information.
Shape describes the length of each dimension. A two-row, three-column table has
shape `(2, 3)` and contains six values. Dtype describes how values are represented;
device identifies where they are stored. Shape and dtype are different properties.

```python
import torch

samples = torch.tensor([[1.0, 2.0, 3.0], [4.0, 5.0, 6.0]])
```

Illustration: `samples.shape` is `(2, 3)`; this lesson does not execute the snippet.

Practice `pt01-practice`: integer answer, number of values -> **6**.

Active checkpoint variants ask for the number of values in a batch with a sample
count from 4 through 19 and two features; the first key is **8**. They do not ask
which metadata property identifies the device.

### PT02: Indexing and reshaping

Release objective: `pt-reshape-objective`. Evidence: authored `PT02` material;
supporting `pt-tensor`.

**Explanation:** Indexing selects values or slices. Reshaping changes the grouping
of the same values; it cannot invent or discard values. A proposed reshape must
preserve the total count. Tensor operations can have additional constraints; count
preservation is the check needed for these contiguous toy examples.

```python
values = torch.tensor([2, 4, 6, 8, 10, 12])
table = values.reshape(2, 3)
```

Illustration: `table` groups the six values as two rows of three.

Practice `pt02-practice`: can six values have shape `(3, 2)`? Choices `yes`, `no`
-> **yes**.

Active checkpoint variants give a generated count divisible by three and ask how
many columns result when reshaping into three rows; the first key is **4**. The
practice checks whether six values can be reshaped to `(3, 2)`. The outlined
multiple-select shape question is not currently active.

### PT03: Broadcasting and elementwise arithmetic

Release objective: `pt-broadcast-objective`. Evidence: authored `PT03` material;
supporting `pt-broadcast`.

**Explanation:** For ordinary elementwise operations, compare shape dimensions
from right to left. Two positions are compatible when their sizes match or one
size is 1. A missing leading dimension behaves as size 1. The output uses the
larger compatible size at each position. This rule describes elementwise arithmetic,
not matrix multiplication.

Example: adding shapes `(2, 3)` and `(3,)` yields `(2, 3)`. The vector's values
are applied across both rows. This is a shape rule, not a copy command in the lesson.

Practice asks how many output values result from `(4, 1) + (1, 3)` -> **12**.
Active checkpoint variants use shapes `({n}, 1)` and `(1, 3)` for generated
`n = 5..20`, then ask for the output element count; the first key is **15**. They
do not currently ask for a full output-shape answer or compatibility rejection.

### PT04: Gradients describe a local direction

Release objective: `pt-autograd-objective`. Evidence: authored `PT04` material;
supporting `pt-autograd`.

**Explanation:** A gradient measures how a loss changes near the current parameter
value. PyTorch can record operations involving values that require gradients.
Calling backward computes gradients; it does not by itself update parameters.
Gradient buffers accumulate contributions, so a training loop must deliberately
clear old gradients between optimization steps.

```python
w = torch.tensor(2.0, requires_grad=True)
loss = (w - 5) ** 2
loss.backward()
```

Illustration: the derivative is `2 * (w - 5)`, so the gradient at 2 is -6.

Practice `pt04-practice`: integer answer, derivative of `(w - 4)^2` at `w = 1`
-> **-6**.

Active checkpoint variants provide the derivative rule for `(w - 2)^2` and ask
for its value at generated `w = 5..20`; the first key is **6**. The release does
not currently ask whether `backward()` alone changes the parameter or test gradient
accumulation.

### PT05: One training step and honest evaluation

Release objective: `pt-training-objective`. Evidence: authored `PT05` material;
supporting `pt-opt` and `pt-autograd`.

**Explanation:** A training step predicts an output, measures its error, calculates
gradients and uses an optimizer to change parameters. Old gradients must be cleared
before the next backward calculation. A simple convention is to clear them at the
start of every batch. Evaluation measures behavior without updating parameters;
switching the model to evaluation mode and disabling gradient tracking serve
different purposes. Neither is a replacement for a separate evaluation dataset.

```python
optimizer.zero_grad()
predictions = model(inputs)
loss = loss_fn(predictions, targets)
loss.backward()
optimizer.step()
```

The snippet assumes an already-created model, optimizer, inputs, targets and loss
function. It illustrates order; it is not a complete runnable training program.

Practice asks which of `backward`, `step`, or `zero_grad` uses computed gradients
to update parameters -> **step**. Active checkpoint variants provide a generated
parameter, gradient 4, learning rate 0.25 and update rule; the first is parameter
3 and the key is **2**. They do not currently test training-step order, evaluation
mode, or disabling gradient tracking.

Completion requires PT01-PT05 checkpoints independently passed. Planned review
handoff includes shape vs dtype/device, reshape count, broadcasting dimensions,
backward vs step, gradient accumulation and evaluation. GPU training, executable
notebooks, model downloads and learner code execution are outside this mini-course
release.

**Assessment alignment gap:** the active release checks Python expression tracing,
branch outcomes, list accumulation, function results, dictionary aggregation, basic
tensor element counts, reshape divisibility, broadcast output counts, supplied-rule
gradient arithmetic, and the optimizer update formula. Some teaching text mentions
device/dtype, indexing, return semantics, gradient accumulation, and evaluation, but
the active checkpoints do not assess several of those topics. The release also
uses generated variants rather than the exact fixed checkpoint examples in this
document's earlier draft. Keep the courses private until a human reviewer either
approves this narrower assessment scope and aligns the stated outcomes, or the
release exercises are expanded to cover the full teaching claims.

## Editorial QA before publication

- [ ] Curriculum reviewer verifies every excerpt, example trace and answer key;
  records reviewer/date and fixes known errors before setting `reviewed`.
- [ ] Each objective has a clear explanation, original example, useful feedback
  and a distinct independent checkpoint. Required prerequisite IDs are acyclic.
- [ ] Rendered learner payload contains no server-only key or grading rule that
  reveals an unreleased answer. Malformed/duplicate/stale attempts are tested.
- [ ] Every source/evidence ID resolves to the pinned authored lesson version;
  official references are attributed and refreshed deliberately, not live-rewritten.
- [ ] Trace arithmetic, branch boundaries, shape compatibility, gradients and
  parameter updates with deterministic fixture tests; execute no user input.
- [ ] Publish no claim that code was run, a model trained, mastery calibrated or
  the learner is career-ready from these static concept exercises.
- [ ] Check keyboard/screen-reader/mobile rendering of snippets, choices, numeric
  and ordered answers; no color-only meaning or clipped code is required to pass.
- [ ] Run the full catalog -> enrollment -> practice -> independent checkpoint ->
  cards/review -> reload/resume journey and record 8.B10 evidence. A written draft
  alone does not satisfy publication, a human support benchmark or release acceptance.
