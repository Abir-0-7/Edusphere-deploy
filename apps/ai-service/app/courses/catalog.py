"""Original prebuilt Python/PyTorch lessons; answers stay in this server package.

The supporting official reference URLs were checked 2026-11-18. These are static
concept and tracing lessons, not executable environments or installed torch APIs.
"""

import uuid

from app.courses.contracts import CourseRelease

NAMESPACE = uuid.UUID("88ca9aad-2c93-4c75-81ce-7cb712862310")


def stable_id(value: str) -> str:
    return str(uuid.uuid5(NAMESPACE, value))


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
    return CourseRelease.model_validate(
        {
            "id": stable_id(f"{slug}/release/1"),
            "course_id": stable_id(f"{slug}/course"),
            "slug": slug,
            "title": title,
            "description": description,
            "version": "1",
            "size": "mini",
            "origin": "prebuilt",
            "visibility": "private",
            # Authored curricula remain hidden until a human reviewer approves
            # the answer key, citations, and source licensing for a release.
            "status": "draft",
            "estimated_minutes": 75 if slug.startswith("python-") else 100,
            "prerequisites": prerequisites or [],
            "sources": sources,
            "evidence": evidence,
            "objectives": objectives,
            "lessons": lessons,
            "exercises": exercises,
            "modules": [{"id": f"{slug}-core", "title": title, "lesson_ids": [lesson["id"] for lesson in lessons]}],
        }
    )


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
