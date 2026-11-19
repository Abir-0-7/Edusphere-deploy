"""Original prebuilt Python/PyTorch lessons; answers stay in this server package.

The supporting official reference URLs were checked 2026-11-18. These are static
concept and tracing lessons, not executable environments or installed torch APIs.
"""

import uuid

from app.courses.contracts import CourseRelease

NAMESPACE = uuid.UUID("88ca9aad-2c93-4c75-81ce-7cb712862310")


def stable_id(value: str) -> str:
    return str(uuid.uuid5(NAMESPACE, value))


def _git_shell_lab(course_prefix: str, objective_id: str, evidence_id: str) -> dict:
    task_prefix = f"{course_prefix}-shell"
    return {
        "id": f"{course_prefix}-git-practice-shell",
        "title": "Simulated Git shell: inspect and review a change",
        "kind": "git_shell",
        "instructions": "Use allowlisted Git commands in a fake repository; real files are untouched.",
        "workspace": "Branch main. README.md is modified; reports/summary.md is new. Real files remain untouched.",
        "starter": "git status",
        "tasks": [
            {
                "id": f"{task_prefix}-stage",
                "title": "Review and stage the intended file",
                "prompt": "Inspect status, stage only reports/summary.md, then inspect the staged diff.",
                "objective_ids": [objective_id],
                "evidence_ids": [evidence_id],
            },
            {
                "id": f"{task_prefix}-commit",
                "title": "Commit the reviewed change",
                "prompt": "Commit the staged summary with a short descriptive message.",
                "objective_ids": [objective_id],
                "evidence_ids": [evidence_id],
            },
            {
                "id": f"{task_prefix}-branch",
                "title": "Create a branch and inspect history",
                "prompt": "Create feature/weekly-summary and inspect the commit graph.",
                "objective_ids": [objective_id],
                "evidence_ids": [evidence_id],
            },
        ],
    }


def _published_practice(slug: str) -> dict:
    """Return authored coding/shell labs and assignments for published courses."""
    if slug == "python-foundations":
        return {
            "labs": [
                {
                    "id": "python-foundations-code-lab",
                    "title": "Python coding lab: summarize scores",
                    "kind": "code_editor",
                    "instructions": "Write a Python program and run fixed tests in an isolated sandbox.",
                    "workspace": "Python standard input/output challenge. Network and filesystem access are disabled.",
                    "starter": "values = list(map(int, input().split()))\n# Print the requested result.",
                    "tasks": [
                        {
                            "id": "python-code-average",
                            "title": "Average a list",
                            "prompt": "Read a line of non-empty integers and print their arithmetic mean.",
                            "objective_ids": ["py-functions-objective", "py-loops-objective"],
                            "evidence_ids": ["py-functions-evidence", "py-loops-evidence"],
                            "runner_problem_id": "python-average",
                            "starter": "\n".join(
                                ["values = list(map(int, input().split()))", "# Calculate and print the mean."]
                            ),
                            "starter_javascript": "\n".join(
                                [
                                    "const fs = require('fs');",
                                    "const values = fs.readFileSync(0, 'utf8').trim().split(/\\s+/).map(Number);",
                                    "// Calculate and print the mean.",
                                ]
                            ),
                        },
                        {
                            "id": "python-code-passing",
                            "title": "Count passing scores",
                            "prompt": "Read integer scores and print how many are at least 60.",
                            "objective_ids": ["py-branches-objective", "py-loops-objective"],
                            "evidence_ids": ["py-branches-evidence", "py-loops-evidence"],
                            "runner_problem_id": "python-passing-count",
                            "starter": "\n".join(
                                [
                                    "scores = list(map(int, input().split()))",
                                    "# Print how many scores are at least 60.",
                                ]
                            ),
                            "starter_javascript": "\n".join(
                                [
                                    "const fs = require('fs');",
                                    "const scores = fs.readFileSync(0, 'utf8').trim().split(/\\s+/).map(Number);",
                                    "// Print how many scores are at least 60.",
                                ]
                            ),
                        },
                        {
                            "id": "python-code-paid-total",
                            "title": "Aggregate selected records",
                            "prompt": "Read paid-flag and amount pairs. Print the total amount for paid records.",
                            "objective_ids": ["py-records-objective", "py-loops-objective"],
                            "evidence_ids": ["py-records-evidence", "py-loops-evidence"],
                            "runner_problem_id": "paid-total",
                            "starter": "\n".join(
                                [
                                    "count = int(input())",
                                    "total = 0",
                                    "for _ in range(count):",
                                    "    paid, amount = map(int, input().split())",
                                    "    # Update total when the record is paid.",
                                    "print(total)",
                                ]
                            ),
                            "starter_javascript": "\n".join(
                                [
                                    "const fs = require('fs');",
                                    "const data = fs.readFileSync(0, 'utf8').trim().split(/\\s+/).map(Number);",
                                    "const count = data[0];",
                                    "let total = 0;",
                                    "for (let i = 0; i < count; i += 1) {",
                                    "  const paid = data[1 + i * 2];",
                                    "  const amount = data[2 + i * 2];",
                                    "  // Update total when the record is paid.",
                                    "}",
                                    "console.log(total);",
                                ]
                            ),
                        },
                    ],
                },
                _git_shell_lab("python-foundations", "py-functions-objective", "py-functions-evidence"),
            ],
            "assignments": [
                {
                    "id": "python-foundations-mini-project",
                    "title": "Assignment: build a study summary",
                    "prompt": "Design a study summary and explain its filter, accumulator, and one boundary case.",
                    "deliverable": "Submit a 150-300 word explanation plus a short function sketch.",
                    "rubric": [
                        "Uses clear names, parameters and a return value.",
                        "Explains a filter and an accumulator accurately.",
                        "Includes one boundary or empty-input case.",
                        "Connects the design to the course evidence.",
                    ],
                    "objective_ids": ["py-functions-objective", "py-records-objective", "py-loops-objective"],
                    "evidence_ids": ["py-functions-evidence", "py-records-evidence", "py-loops-evidence"],
                }
            ],
        }
    if slug == "pytorch-fundamentals":
        return {
            "labs": [
                {
                    "id": "pytorch-fundamentals-code-lab",
                    "title": "Tensor coding lab: shape and update traces",
                    "kind": "code_editor",
                    "instructions": "Run fixed shape and update tests in Python. The sandbox does not install Torch.",
                    "workspace": "Python standard input/output challenge. Network and filesystem access are disabled.",
                    "starter": "rows, columns = map(int, input().split())\n# Print the requested count.",
                    "tasks": [
                        {
                            "id": "pytorch-code-count",
                            "title": "Count tensor values",
                            "prompt": "Calculate the number of values in a tensor with shape (4, 3).",
                            "objective_ids": ["pt-tensors-objective", "pt-reshape-objective"],
                            "evidence_ids": ["pt-tensors-evidence", "pt-reshape-evidence"],
                            "runner_problem_id": "tensor-value-count",
                            "starter": "\n".join(
                                ["rows, columns = map(int, input().split())", "# Print the number of tensor values."]
                            ),
                            "starter_javascript": "\n".join(
                                [
                                    "const fs = require('fs');",
                                    "const values = fs.readFileSync(0, 'utf8').trim().split(/\\s+/).map(Number);",
                                    "// Print the number of tensor values.",
                                ]
                            ),
                        },
                        {
                            "id": "pytorch-code-broadcast",
                            "title": "Trace a broadcast shape",
                            "prompt": "Shapes (batch, 1) and (1, 3) broadcast to (batch, 3). Print the output count.",
                            "objective_ids": ["pt-broadcast-objective"],
                            "evidence_ids": ["pt-broadcast-evidence"],
                            "runner_problem_id": "broadcast-value-count",
                            "starter": "\n".join(["batch = int(input())", "# Print the output element count."]),
                            "starter_javascript": "\n".join(
                                [
                                    "const fs = require('fs');",
                                    "const batch = Number(fs.readFileSync(0, 'utf8').trim());",
                                    "// Print the output element count.",
                                ]
                            ),
                        },
                        {
                            "id": "pytorch-code-update",
                            "title": "Apply one update",
                            "prompt": "Apply new = old - rate * gradient to integer inputs.",
                            "objective_ids": ["pt-autograd-objective", "pt-training-objective"],
                            "evidence_ids": ["pt-autograd-evidence", "pt-training-evidence"],
                            "runner_problem_id": "parameter-update",
                            "starter": "\n".join(
                                ["old, rate, gradient = map(int, input().split())", "# Print the updated value."]
                            ),
                            "starter_javascript": "\n".join(
                                [
                                    "const fs = require('fs');",
                                    "const values = fs.readFileSync(0, 'utf8').trim().split(/\\s+/).map(Number);",
                                    "const [old, rate, gradient] = values;",
                                    "// Print the updated value.",
                                ]
                            ),
                        },
                    ],
                },
                _git_shell_lab("pytorch-fundamentals", "pt-training-objective", "pt-training-evidence"),
            ],
            "assignments": [
                {
                    "id": "pytorch-fundamentals-training-note",
                    "title": "Assignment: explain one training step",
                    "prompt": "Explain a tensor training step and include a shape or gradient check.",
                    "deliverable": "Submit a 150-300 word explanation with a short pseudocode trace.",
                    "rubric": [
                        "Separates shape metadata from values and dtype/device.",
                        "Distinguishes gradient calculation from parameter update.",
                        "Uses a correct broadcast or update example.",
                        "Names one evaluation or debugging check.",
                    ],
                    "objective_ids": ["pt-tensors-objective", "pt-broadcast-objective", "pt-training-objective"],
                    "evidence_ids": ["pt-tensors-evidence", "pt-broadcast-evidence", "pt-training-evidence"],
                }
            ],
        }
    return {"labs": [], "assignments": []}


def _course(slug, title, description, rows, references, prerequisites=None):
    sources, evidence, objectives, lessons, exercises = [], [], [], [], []
    for index, row in enumerate(rows):
        lesson_id, heading, explanation, code, practice, checkpoints = row
        objective_id, source_id, evidence_id = (f"{lesson_id}-{kind}" for kind in ("objective", "source", "evidence"))
        sources.append(
            {
                "id": source_id,
                "title": heading,
                "body": explanation + "\n\n" + code,
                "reference_urls": references[index],
            }
        )
        evidence.append(
            {
                "id": evidence_id,
                "source_id": source_id,
                "locator": f"lesson/{lesson_id}/explanation",
                "quote": explanation,
            }
        )
        objectives.append(
            {
                "id": objective_id,
                "title": heading,
                "prerequisites": [f"{rows[index - 1][0]}-objective"] if index else [],
            }
        )
        practice_id = f"{lesson_id}-practice"
        lesson_checkpoints = []
        for identifier, mode, definition in [(practice_id, "practice", practice)] + [
            (f"{lesson_id}-checkpoint-{n + 1}", "checkpoint", definition) for n, definition in enumerate(checkpoints)
        ]:
            prompt, answer, choices, hint, feedback = definition
            exercises.append(
                {
                    "id": identifier,
                    "kind": "choice" if choices else "number",
                    "mode": mode,
                    "prompt": prompt,
                    "answer": answer,
                    "choices": [{"id": value, "label": label} for value, label in choices],
                    "objective_ids": [objective_id],
                    "evidence_ids": [evidence_id],
                    "hint": hint,
                    "explanation": feedback,
                }
            )
            if mode == "checkpoint":
                lesson_checkpoints.append(identifier)
        lessons.append(
            {
                "id": lesson_id,
                "title": heading,
                "objective_ids": [objective_id],
                "blocks": [
                    {
                        "id": f"{lesson_id}-explain",
                        "type": "explanation",
                        "content": explanation,
                        "evidence_ids": [evidence_id],
                    },
                    {
                        "id": f"{lesson_id}-example",
                        "type": "code",
                        "content": code,
                        "language": "python",
                        "evidence_ids": [evidence_id],
                    },
                ],
                "practice_ids": [practice_id],
                "checkpoint_ids": lesson_checkpoints,
            }
        )
    payload = {
        "id": stable_id(f"{slug}/release/2"),
        "course_id": stable_id(f"{slug}/course"),
        "slug": slug,
        "title": title,
        "description": description,
        "version": "2",
        "size": "mini",
        "origin": "prebuilt",
        "visibility": "catalog",
        "status": "published",
        "estimated_minutes": 75 if slug.startswith("python-") else 100,
        "prerequisites": prerequisites or [],
        "sources": sources,
        "evidence": evidence,
        "objectives": objectives,
        "lessons": lessons,
        "exercises": exercises,
        "modules": [{"id": f"{slug}-core", "title": title, "lesson_ids": [lesson["id"] for lesson in lessons]}],
        **_published_practice(slug),
    }
    return CourseRelease.model_validate(payload)


def _numeric(prompt, answer, hint, explanation):
    return prompt, answer, [], hint, explanation


def _choice(prompt, answer, choices, hint, explanation):
    return prompt, answer, choices, hint, explanation


def python_foundations():
    intro = "https://docs.python.org/3/tutorial/introduction.html"
    flow = "https://docs.python.org/3/tutorial/controlflow.html"
    data = "https://docs.python.org/3/tutorial/datastructures.html"
    rows = [
        (
            "py-values",
            "Trace values and expressions",
            "A name identifies a value. Assignment evaluates the expression on the right before binding the name "
            "on the left. Multiplication takes precedence over addition, while parentheses change the grouping. "
            "Quoted digits are text rather than an automatically converted integer.",
            "boxes = 4\nitems_per_box = 3\nloose_items = 2\ntotal_items = boxes * items_per_box + loose_items\n"
            "# total_items is 14",
            _numeric("What is the value of 5 + 3 * 2?", 11, "Multiply before adding.", "3 * 2 is 6; 5 + 6 is 11."),
            [
                _numeric(
                    f"What is the value of 2 * ({n} + 1) - 3?",
                    2 * (n + 1) - 3,
                    "Evaluate parentheses, then multiplication, then subtraction.",
                    f"The value is {2 * (n + 1) - 3}.",
                )
                for n in range(7, 23)
            ],
        ),
        (
            "py-branches",
            "Choose the first true branch",
            "An if/elif/else chain runs the first branch whose condition is true. Later alternatives are skipped. "
            "Boundary values matter: >= 60 includes 60, while > 60 excludes it.",
            'score = 68\nif score >= 80:\n    band = "advanced"\nelif score >= 60:\n    band = "ready"\n'
            'else:\n    band = "practice"\n# band is "ready"',
            _choice(
                "In the example, what is band if score is 80?",
                "advanced",
                [("advanced", "advanced"), ("ready", "ready"), ("practice", "practice")],
                "Check the branches from top to bottom.",
                "The first condition includes 80.",
            ),
            [
                _choice(
                    f'For temperature = {n + (-1, 0, 10)[n % 3]}: if temperature < {n}: state = "cold"; '
                    f'elif temperature < {n + 10}: state = "mild"; else: state = "warm". What is state?',
                    ("cold", "mild", "warm")[n % 3],
                    [("cold", "cold"), ("mild", "mild"), ("warm", "warm")],
                    "A strict less-than comparison does not include its boundary.",
                    f"The first true branch (or final else) gives {('cold', 'mild', 'warm')[n % 3]}.",
                )
                for n in range(10, 26)
            ],
        ),
        (
            "py-loops",
            "Trace a list accumulator",
            "A list preserves item order, and its first item has index 0. A for loop visits each item in order. "
            "An accumulator keeps a running result; both its starting value and its update rule matter.",
            "readings = [3, 6, 9]\ntotal = 0\nfor reading in readings:\n    total = total + reading\n"
            "# successive totals: 3, 9, 18",
            _numeric(
                "For readings = [3, 6, 9], what is readings[1]?",
                6,
                "The first index is zero.",
                "Index 1 identifies the second value, 6.",
            ),
            [
                _numeric(
                    f"Start total = 1. Add each value in [{n}, 5, 1] to total. What is the final total?",
                    n + 7,
                    "Include the initial accumulator value.",
                    f"1 + {n} + 5 + 1 is {n + 7}.",
                )
                for n in range(2, 18)
            ],
        ),
        (
            "py-functions",
            "Use parameters and return values",
            "A function names a reusable computation. Parameters receive arguments when the function is called. "
            "A return statement passes a result to the caller. Printing displays text and does not replace return.",
            "def add_fee(price, fee):\n    return price + fee\n\ninvoice = add_fee(12, 3)\n# invoice is 15",
            _numeric(
                "What does add_fee(8, 2) return?",
                10,
                "Substitute the arguments for the two parameters.",
                "8 + 2 is 10.",
            ),
            [
                _numeric(
                    f"def scale_then_add(value, factor): return value * factor + 1\n"
                    f"What does scale_then_add({n}, 3) return?",
                    n * 3 + 1,
                    "Substitute arguments before calculating.",
                    f"{n} * 3 + 1 is {n * 3 + 1}.",
                )
                for n in range(4, 20)
            ],
        ),
        (
            "py-records",
            "Filter and aggregate records",
            "A dictionary associates keys with values. A list of dictionaries represents records with common fields. "
            "A condition selects which records contribute to an accumulator; skipped records do not contribute.",
            'orders = [{"paid": True, "amount": 7}, {"paid": False, "amount": 5}, {"paid": True, "amount": 4}]\n'
            'total = 0\nfor order in orders:\n    if order["paid"]:\n        total += order["amount"]\n# total is 11',
            _numeric(
                'For the example, what is orders[1]["amount"]?',
                5,
                "Select the second record, then its amount.",
                "The unpaid record still stores amount 5.",
            ),
            [
                _numeric(
                    f'Consider [{{"active": True, "minutes": {n}}}, {{"active": False, "minutes": 10}}, '
                    f'{{"active": True, "minutes": 8}}]. What is the sum of minutes for active records?',
                    n + 8,
                    "Skip records whose active value is false.",
                    f"Only {n} and 8 contribute, giving {n + 8}.",
                )
                for n in range(6, 22)
            ],
        ),
    ]
    return _course(
        "python-foundations",
        "Python Foundations",
        "Trace expressions, branches, loops, functions and records through five guided lessons.",
        rows,
        [[intro], [flow], [flow, data], [flow], [data]],
    )


def pytorch_fundamentals():
    base = "https://docs.pytorch.org/tutorials/beginner/basics/"
    tensor, autograd, optimization = (
        base + name for name in ("tensorqs_tutorial.html", "autogradqs_tutorial.html", "optimization_tutorial.html")
    )
    broadcast = "https://docs.pytorch.org/docs/stable/notes/broadcasting.html"
    rows = [
        (
            "pt-tensors",
            "Describe tensor shape and metadata",
            "A tensor carries numerical values and shape information. Shape records the length of each dimension. "
            "A two-row, three-column table has shape (2, 3) and contains six values. Dtype describes representation; "
            "device identifies storage location. Shape, dtype and device are distinct properties.",
            "import torch\nsamples = torch.tensor([[1.0, 2.0, 3.0], [4.0, 5.0, 6.0]])\n"
            "# illustrative shape: (2, 3); this lesson does not execute code",
            _numeric("How many values are in shape (2, 3)?", 6, "Multiply dimension lengths.", "2 * 3 is 6."),
            [
                _numeric(
                    f"A batch has {n} samples and 2 features per sample. How many values does it contain?",
                    n * 2,
                    "Multiply samples by features.",
                    f"{n} * 2 is {n * 2}.",
                )
                for n in range(4, 20)
            ],
        ),
        (
            "pt-reshape",
            "Preserve values when reshaping",
            "Indexing selects values or slices. Reshaping changes the grouping of the same values; it cannot create "
            "or discard elements. Count preservation is the required check for these simple contiguous examples.",
            "values = torch.tensor([2, 4, 6, 8, 10, 12])\ntable = values.reshape(2, 3)\n"
            "# six values grouped into two rows of three",
            _choice(
                "Can six values be reshaped to (3, 2)?",
                "yes",
                [("yes", "Yes"), ("no", "No")],
                "Compare total element counts.",
                "3 * 2 preserves six values.",
            ),
            [
                _numeric(
                    f"A contiguous tensor contains {n * 3} values. Reshape it into 3 equal rows. How many columns?",
                    n,
                    "Divide the total element count by the number of rows.",
                    f"{n * 3} / 3 is {n}.",
                )
                for n in range(4, 20)
            ],
        ),
        (
            "pt-broadcast",
            "Reason about broadcasting",
            "For ordinary elementwise arithmetic, compare dimensions from right to left. Sizes are compatible when "
            "they match or one is 1; an absent leading dimension acts like 1. The output takes the larger compatible "
            "size in each position. This is not the matrix-multiplication rule.",
            "# Elementwise shape reasoning:\n# (2, 3) + (3,) -> (2, 3)\n# (4, 1) + (1, 3) -> (4, 3)",
            _numeric(
                "Shapes (4, 1) and (1, 3) broadcast to (4, 3). How many output values?",
                12,
                "Find the output count, not the sum of input counts.",
                "4 * 3 is 12.",
            ),
            [
                _numeric(
                    f"Shapes ({n}, 1) and (1, 3) are added elementwise. How many values are in the output?",
                    n * 3,
                    "The broadcast output has the larger compatible size on each axis.",
                    f"The output shape is ({n}, 3), with {n * 3} values.",
                )
                for n in range(5, 21)
            ],
        ),
        (
            "pt-autograd",
            "Separate gradients from updates",
            "A gradient describes how a loss changes near a parameter value. PyTorch can record operations involving "
            "values that require gradients. Backward computes gradients but does not itself update parameters. "
            "Gradient buffers accumulate contributions, so clear old gradients deliberately between update steps.",
            "w = torch.tensor(2.0, requires_grad=True)\nloss = (w - 5) ** 2\nloss.backward()\n"
            "# derivative: 2 * (w - 5); at w=2 the gradient is -6",
            _numeric(
                "Given derivative 2 * (w - 4), what is the gradient at w = 1?",
                -6,
                "Substitute w before multiplying.",
                "2 * (1 - 4) is -6.",
            ),
            [
                _numeric(
                    f"For loss (w - 2)^2, the derivative is 2 * (w - 2). What is the gradient at w = {n}?",
                    2 * (n - 2),
                    "Use the derivative rule provided; backward calculates rather than applies this gradient.",
                    f"2 * ({n} - 2) is {2 * (n - 2)}.",
                )
                for n in range(5, 21)
            ],
        ),
        (
            "pt-training",
            "Trace a training step and evaluation",
            "A training step predicts, measures loss, calculates gradients and updates parameters using an optimizer. "
            "One clear convention is to clear old gradients at the start of each batch. Evaluation avoids parameter "
            "updates; evaluation mode and disabling gradient tracking serve different purposes. A separate evaluation "
            "dataset helps measure behavior beyond the training examples.",
            "optimizer.zero_grad()\npredictions = model(inputs)\nloss = loss_fn(predictions, targets)\n"
            "loss.backward()\noptimizer.step()\n# assumes model, data, loss and optimizer already exist",
            _choice(
                "Which operation changes parameters using calculated gradients?",
                "step",
                [("backward", "backward"), ("step", "optimizer.step"), ("clear", "optimizer.zero_grad")],
                "Distinguish calculating a gradient from using it.",
                "optimizer.step applies the update.",
            ),
            [
                _numeric(
                    f"Parameter = {n}, gradient = 4, learning rate = 0.25. Using new = old - rate * gradient, "
                    "what is the new parameter?",
                    n - 1,
                    "Calculate rate times gradient, then subtract.",
                    f"{n} - 0.25 * 4 is {n - 1}.",
                )
                for n in range(3, 19)
            ],
        ),
    ]
    return _course(
        "pytorch-fundamentals",
        "PyTorch Fundamentals",
        "Understand tensors, shapes, broadcasting, gradients and a training step without installing a runtime.",
        rows,
        [[base + "intro.html", tensor], [tensor], [broadcast], [autograd], [optimization]],
        ["python-foundations"],
    )


def catalog() -> tuple[CourseRelease, ...]:
    return python_foundations(), pytorch_fundamentals()


# Diagnostic permits an experienced learner to enter PyTorch without fabricating
# completion of the Python course. Answers are server-owned and never in catalog JSON.
DIAGNOSTIC = {
    "expression": ("What is 2 + 3 * 4?", 14),
    "boundary": ("For x = 5, is x >= 5 true? Answer true or false.", "true"),
    "loop": ("Start total = 0 and add 2, then 3, then 4. What is total?", 9),
    "function": ("def f(x): return x * 2 + 1. What does f(3) return?", 7),
    "record": ('For item = {"amount": 6}, what is item["amount"]?', 6),
}
