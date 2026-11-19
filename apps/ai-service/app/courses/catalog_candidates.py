"""Authored SQL/Git course definitions and their isolated draft fixtures.

catalog() promotes copies for the four-course release explicitly requested by
the user on 2026-11-19. Draft definitions remain available for publication-gate
tests; assessment keys and lab targets stay server-only in both states.
"""

from app.courses.catalog import _choice, _course, _numeric
from app.courses.contracts import CourseRelease

SQL_FROM = "https://www.postgresql.org/docs/18/queries-table-expressions.html"
SQL_SELECT = "https://www.postgresql.org/docs/18/queries-select-lists.html"
SQL_ORDER = "https://www.postgresql.org/docs/18/queries-order.html"
SQL_LIMIT = "https://www.postgresql.org/docs/18/queries-limit.html"
SQL_AGG = "https://www.postgresql.org/docs/18/functions-aggregate.html"
SQL_COMPARE = "https://www.postgresql.org/docs/18/functions-comparison.html"
GIT_CHANGES = "https://git-scm.com/book/en/v2/Git-Basics-Recording-Changes-to-the-Repository"
GIT_BRANCH = "https://git-scm.com/book/en/v2/Git-Branching-Branches-in-a-Nutshell"
GIT_DIFF = "https://git-scm.com/docs/git-diff"
GIT_LOG = "https://git-scm.com/docs/git-log"
GIT_MERGE = "https://git-scm.com/docs/git-merge"
GIT_SHOW = "https://git-scm.com/docs/git-show"
GIT_SWITCH = "https://git-scm.com/docs/git-switch"


def _draft(
    slug: str,
    title: str,
    description: str,
    rows,
    references,
    *,
    minutes: int,
    language: str,
    labs: list[dict],
    assignments: list[dict],
) -> CourseRelease:
    data = _course(slug, title, description, rows, references).model_dump(mode="json")
    data["status"] = "draft"
    data["estimated_minutes"] = minutes
    data["labs"] = labs
    data["assignments"] = assignments
    for lesson in data["lessons"]:
        for block in lesson["blocks"]:
            if block["type"] == "code":
                block["language"] = language
    return CourseRelease.model_validate(data)


def sql_query_foundations() -> CourseRelease:
    rows = [
        (
            "sql-filter",
            "Select fields and filter rows",
            "FROM identifies the input table. WHERE keeps rows for which the predicate is true, including the "
            "boundary for >=. SELECT chooses output columns without modifying the input rows.",
            "-- products(product_id, name, active): (10, 'Cup', TRUE), (11, 'Tray', FALSE)\n"
            "SELECT product_id, name FROM products WHERE active = TRUE;\n"
            "-- one output row: (10, 'Cup')",
            _choice(
                "Which clause filters rows?",
                "where",
                [("select", "SELECT"), ("where", "WHERE"), ("order", "ORDER BY")],
                "The condition is checked for each row.",
                "WHERE keeps rows that satisfy its condition.",
            ),
            [
                _choice(
                    f"Include exam records with score {n} or higher, and return only student_id. Which query?",
                    "ge",
                    [
                        ("gt", f"SELECT student_id FROM exams WHERE score > {n}"),
                        ("ge", f"SELECT student_id FROM exams WHERE score >= {n}"),
                        ("le", f"SELECT student_id, score FROM exams WHERE score <= {n}"),
                    ],
                    "Check which column is returned and whether equality is included.",
                    f"Selecting student_id returns the requested field, and score >= {n} includes the boundary.",
                )
                for n in range(10, 26)
            ],
        ),
        (
            "sql-null",
            "Combine predicates and test for NULL",
            "AND is true when both conditions are true; OR is true when at least one is true. Parentheses make "
            "the grouping explicit. NULL represents a missing or unknown value; test it with IS NULL, because "
            "an ordinary equality comparison with NULL is unknown.",
            "-- orders(order_id, total, coupon_code): (10, 30, NULL), (11, 20, 'SAVE')\n"
            "SELECT order_id FROM orders WHERE total >= 25 AND coupon_code IS NULL;\n"
            "-- one output row: 10",
            _choice(
                "Which test checks for a missing value?",
                "null",
                [("equal", "coupon_code = NULL"), ("null", "coupon_code IS NULL"), ("empty", "coupon_code = ''")],
                "NULL and an empty string differ.",
                "IS NULL tests for a missing value.",
            ),
            [
                _choice(
                    f"Order {n} is unpaid and its coupon_code is NULL. Does the WHERE predicate "
                    "status = 'paid' OR coupon_code IS NULL keep it?",
                    "yes",
                    [("yes", "Yes"), ("no", "No"), ("unknown", "No: predicate is unknown")],
                    "One side of OR can be enough.",
                    "The status comparison is false, but IS NULL is true, making OR true.",
                )
                for n in range(10, 26)
            ],
        ),
        (
            "sql-order",
            "Order rows before limiting results",
            "ORDER BY specifies result order. If the first sort values tie, the next sort key decides between "
            "them. LIMIT keeps at most a fixed number of the sorted rows. With no ORDER BY, order is unspecified.",
            "-- products(product_id, price): (10, 7), (12, 9), (11, 9)\n"
            "SELECT product_id, price FROM products ORDER BY price DESC, product_id ASC LIMIT 2;\n"
            "-- ordered result: (11, 9), (12, 9)",
            _choice(
                "Which clause specifies output order?",
                "order",
                [("from", "FROM"), ("where", "WHERE"), ("order", "ORDER BY")],
                "Choose the sorting clause.",
                "ORDER BY specifies sorted output.",
            ),
            [
                _numeric(
                    f"Scores are (id, score): ({n + 2}, 9), ({n}, 9), ({n + 1}, 8). Which id does "
                    "ORDER BY score DESC, id ASC LIMIT 1 return?",
                    n,
                    "Sort by score first; resolve the tie using id.",
                    f"The two scores of 9 tie; id {n} is smaller than {n + 2}.",
                )
                for n in range(1, 17)
            ],
        ),
        (
            "sql-group",
            "Aggregate and group rows",
            "COUNT(*) counts every row in a group. COUNT(column) only counts rows with a non-NULL value in that "
            "column. GROUP BY forms groups. WHERE filters rows before grouping, and HAVING filters groups afterward.",
            "-- products(category, units): ('A', 1), ('A', NULL), ('B', 3)\n"
            "SELECT category, COUNT(*) AS row_count, COUNT(units) AS counted_units\n"
            "FROM products GROUP BY category HAVING COUNT(*) >= 2;\n"
            "-- one output row: ('A', 2, 1)",
            _choice(
                "Which clause filters groups by an aggregate?",
                "having",
                [("where", "WHERE"), ("having", "HAVING"), ("limit", "LIMIT")],
                "The condition applies after grouping.",
                "HAVING filters grouped results.",
            ),
            [
                _numeric(
                    f"A group contains {n + 2} rows, two with NULL units. What does COUNT(units) return?",
                    n,
                    "COUNT(units) excludes rows missing a units value.",
                    f"Subtract the two NULL values from {n + 2}; {n} rows have a units value.",
                )
                for n in range(1, 17)
            ],
        ),
        (
            "sql-join",
            "Join matching rows",
            "An inner join pairs rows satisfying ON and omits rows without a match. If one customer matches several "
            "orders, that customer appears in several joined rows.",
            "-- customers(customer_id, name): (1, 'Mina'), (2, 'Isha')\n"
            "-- orders(customer_id, order_id): (1, 40), (1, 42)\n"
            "SELECT c.name, o.order_id FROM customers AS c\n"
            "INNER JOIN orders AS o ON o.customer_id = c.customer_id;\n"
            "-- result rows in unspecified order: ('Mina', 40), ('Mina', 42)",
            _choice(
                "Where is the join matching condition?",
                "on",
                [("select", "SELECT"), ("on", "ON"), ("limit", "LIMIT")],
                "The condition belongs beside the relationship.",
                "ON defines which rows match.",
            ),
            [
                _numeric(
                    f"An INNER JOIN matches {n} orders to Mina, 2 orders to Isha, and no orders to Rei. There are "
                    "no other customers or orders. How many result rows are there?",
                    n + 2,
                    "Each matching order contributes a row; a customer without orders contributes nothing.",
                    f"The result contains {n} for Mina and 2 for Isha, for {n + 2} rows.",
                )
                for n in range(1, 17)
            ],
        ),
    ]
    return _draft(
        "sql-query-foundations",
        "SQL Query Foundations",
        "Read and reason about filtered, ordered, grouped queries and joins with fixed examples.",
        rows,
        [
            [SQL_FROM, SQL_SELECT, SQL_COMPARE],
            [SQL_FROM, SQL_COMPARE],
            [SQL_ORDER, SQL_LIMIT],
            [SQL_FROM, SQL_AGG],
            [SQL_FROM],
        ],
        minutes=45,
        language="sql",
        labs=[
            {
                "id": "sql-query-lab",
                "title": "Read-only SQL Query Lab",
                "kind": "sql_query",
                "instructions": (
                    "Write one SELECT query for each task. The query is checked against a fixed authored target; "
                    "it is not sent to a database or executed. Only the supplied read-only examples are supported."
                ),
                "workspace": (
                    "products(product_id, product_name, category, price, active): "
                    "(1, 'Keyboard', 'electronics', 45.00, TRUE), (2, 'Mug', 'home', 12.00, TRUE), "
                    "(3, 'Mouse', 'electronics', 28.00, TRUE), (4, 'Lamp', 'home', 30.00, FALSE).\n"
                    "customers(customer_id, name): (1, 'Mina'), (2, 'Isha').\n"
                    "orders(order_id, customer_id, total): (9001, 1, 56.00), (9002, 1, 23.00), (9003, 3, 90.00)."
                ),
                "starter": (
                    "SELECT product_name, price\nFROM products\nWHERE active = TRUE\n"
                    "ORDER BY price DESC, product_id ASC\nLIMIT 2;"
                ),
                "tasks": [
                    {
                        "id": "active-products",
                        "title": "Filter and sort active products",
                        "prompt": (
                            "Return the two highest-priced active products as product_name and price; "
                            "break price ties by product_id ascending."
                        ),
                        "objective_ids": ["sql-filter-objective", "sql-order-objective"],
                        "evidence_ids": ["sql-filter-evidence", "sql-order-evidence"],
                        "expected_query": (
                            "SELECT product_name, price FROM products WHERE active = TRUE "
                            "ORDER BY price DESC, product_id ASC LIMIT 2"
                        ),
                        "expected_output": "product_name | price\nKeyboard | 45.00\nMouse | 28.00",
                    },
                    {
                        "id": "product-groups",
                        "title": "Count products by category",
                        "prompt": (
                            "For active products, show each category and its product count, keeping only "
                            "groups with at least two rows."
                        ),
                        "objective_ids": ["sql-group-objective"],
                        "evidence_ids": ["sql-group-evidence"],
                        "expected_query": (
                            "SELECT category, COUNT(*) AS product_count FROM products WHERE active = TRUE "
                            "GROUP BY category HAVING COUNT(*) >= 2 ORDER BY category ASC"
                        ),
                        "expected_output": "category | product_count\nelectronics | 2",
                    },
                    {
                        "id": "customer-orders",
                        "title": "Join customer orders",
                        "prompt": (
                            "Show each matching customer's name, order_id, and total; sort by order_id ascending. "
                            "Exclude orders without a matching customer."
                        ),
                        "objective_ids": ["sql-join-objective"],
                        "evidence_ids": ["sql-join-evidence"],
                        "expected_query": (
                            "SELECT c.name, o.order_id, o.total FROM customers AS c "
                            "INNER JOIN orders AS o ON o.customer_id = c.customer_id ORDER BY o.order_id ASC"
                        ),
                        "expected_output": "name | order_id | total\nMina | 9001 | 56.00\nMina | 9002 | 23.00",
                    },
                ],
            }
        ],
        assignments=[
            {
                "id": "sql-category-report",
                "title": "Assignment: Prepare a category report",
                "prompt": (
                    "Create a short report from the practice tables. Write a query that returns one row per "
                    "category with an item count and highest price, then explain how your grouping and ordering work. "
                    "Include one additional query that checks for a missing value without treating NULL as an "
                    "empty string."
                ),
                "deliverable": "Submit your SQL text and a brief explanation (about 150–300 words).",
                "rubric": [
                    "Uses only read-only SELECT statements against the supplied example tables.",
                    "Groups and aggregates at the category level without mixing row and group filters.",
                    "Explains the output ordering and handles NULL with an explicit NULL predicate.",
                    "Includes a small expected-result table or clearly stated result rows.",
                ],
                "objective_ids": ["sql-filter-objective", "sql-group-objective", "sql-join-objective"],
                "evidence_ids": ["sql-filter-evidence", "sql-group-evidence", "sql-join-evidence"],
            }
        ],
    )


def git_foundations() -> CourseRelease:
    rows = [
        (
            "git-stage",
            "Stage a change and record a commit",
            "Git separates the working tree, staged content, and committed snapshots. git add stages selected "
            "content at the moment you run it. Later working-tree edits need to be staged again if they belong "
            "in the next commit. A plain git commit records the staged snapshot.",
            'git status\ngit add reports/summary.md\ngit diff --staged\ngit commit -m "Add weekly summary"',
            _choice(
                "Which command records staged content?",
                "commit",
                [("add", "git add"), ("commit", "git commit"), ("status", "git status")],
                "One command stages; another records.",
                "git commit records the staged snapshot.",
            ),
            [
                _choice(
                    f"You stage report-{n}.md, then change its heading without staging it again. "
                    "Which heading appears in a plain git commit?",
                    "staged",
                    [
                        ("edited", "The newly edited heading"),
                        ("staged", "The previously staged heading"),
                        ("blank", "No heading at all"),
                    ],
                    "A later edit only changes the working tree.",
                    "The commit records the previously staged version of the file.",
                )
                for n in range(1, 17)
            ],
        ),
        (
            "git-diff",
            "Inspect staged and unstaged edits",
            "git status summarizes changes. For a tracked file, git diff compares the working version against "
            "the staged version; git diff --staged compares the staged version against the current commit. "
            "A file can have changes in both comparisons.",
            "git status\ngit diff -- report.md\ngit add report.md\ngit diff --staged -- report.md",
            _choice(
                "Which command reviews staged changes?",
                "staged",
                [("unstaged", "git diff"), ("staged", "git diff --staged"), ("history", "git log")],
                "The index contains staged content.",
                "git diff --staged reviews the next commit.",
            ),
            [
                _choice(
                    f"You stage a title edit to report-{n}.md, then make an unstaged footer edit. "
                    "Which command shows the footer change alone?",
                    "diff",
                    [("diff", "git diff"), ("staged", "git diff --staged"), ("history", "git log")],
                    "The footer edit is only in the working tree.",
                    "git diff compares the working tree with the index, so it sees only the later footer edit.",
                )
                for n in range(1, 17)
            ],
        ),
        (
            "git-branch",
            "Develop a change on a separate branch",
            "A branch is a name that points to a commit. git switch -c starts a new branch at the current "
            "commit and makes it current. Recording a commit advances the current branch; another branch at "
            "the starting commit stays there.",
            "git switch -c feature/weekly-summary\n# make and stage a focused change\n"
            'git commit -m "Write weekly summary"\ngit log --oneline --decorate',
            _choice(
                "Which command creates and switches to feature/report?",
                "switch",
                [
                    ("switch", "git switch -c feature/report"),
                    ("show", "git show feature/report"),
                    ("log", "git log feature/report"),
                ],
                "Use the branch-creation form.",
                "git switch -c creates and checks out a branch.",
            ),
            [
                _choice(
                    f"main and feature/change-{n} both point to commit A. On feature/change-{n}, you record "
                    "commit B. Which branch now points to B?",
                    "feature",
                    [
                        ("main", "main only"),
                        ("feature", f"feature/change-{n} only"),
                        ("both", "Both branches"),
                    ],
                    "Only the checked-out branch advances.",
                    f"feature/change-{n} advances to B while main stays at A.",
                )
                for n in range(1, 17)
            ],
        ),
        (
            "git-merge",
            "Integrate a branch and resolve conflicts",
            "A merge combines another branch into the checked-out branch. For overlapping edits, inspect conflict "
            "markers, edit the intended result, remove markers, stage the resolution and complete the merge.",
            "git switch main\ngit merge feature/weekly-summary\n"
            "# If a conflict occurs, edit reports/summary.md to the intended content and remove markers.\n"
            "git add reports/summary.md\ngit merge --continue",
            _choice(
                "To merge feature/report into main, which branch is the target?",
                "main",
                [("main", "main"), ("feature", "feature/report"), ("any", "any branch")],
                "Merge applies into the current branch.",
                "Switch to main, then merge feature/report.",
            ),
            [
                _choice(
                    f"During a merge, report-{n}.md conflicts. You repaired it and removed markers. Which action "
                    "records the resolution before finishing the merge?",
                    "stage",
                    [("stage", f"git add report-{n}.md"), ("show", "git show HEAD"), ("log", "git log --oneline")],
                    "Stage the resolved version so it becomes part of the merged result.",
                    f"git add report-{n}.md stages the resolved file; finish the merge after resolving all files.",
                )
                for n in range(1, 17)
            ],
        ),
        (
            "git-history",
            "Inspect history before requesting review",
            "git log displays history. --oneline summarizes commits and --graph depicts topology. git show "
            "inspects one commit and its patch. These are read-only review views.",
            "git log --oneline --graph --decorate\ngit show HEAD\ngit status",
            _choice(
                "Which command shows compact history with topology?",
                "graph",
                [("graph", "git log --oneline --graph"), ("stage", "git add --graph"), ("merge", "git merge --graph")],
                "Choose a history command.",
                "git log with --graph depicts branch structure.",
            ),
            [
                _choice(
                    f"The compact log identifies commit {n:07x} as the one to review. Which command shows its patch?",
                    "show",
                    [("log", "git log --oneline"), ("show", f"git show {n:07x}"), ("status", "git status")],
                    "Inspect one commit by passing its identifier to the command.",
                    f"git show {n:07x} shows the selected commit's details and patch.",
                )
                for n in range(1, 17)
            ],
        ),
    ]
    return _draft(
        "git-foundations",
        "Git Foundations",
        "Reason through local staging, commits, branches, merges and review without running commands.",
        rows,
        [[GIT_CHANGES], [GIT_CHANGES, GIT_DIFF], [GIT_BRANCH, GIT_SWITCH], [GIT_MERGE], [GIT_LOG, GIT_SHOW]],
        minutes=40,
        language="shell",
        labs=[
            {
                "id": "git-practice-shell",
                "title": "Git Practice Shell",
                "kind": "git_shell",
                "instructions": (
                    "Practice in a fake repository. This terminal accepts a small allowlist of Git commands and "
                    "prints simulated output; it never starts an operating-system shell or changes real files."
                ),
                "workspace": (
                    "Branch: main. README.md has one unstaged edit. reports/summary.md is a new file. "
                    "The existing history contains a starter commit. The practice workspace is isolated to this page."
                ),
                "starter": "git status",
                "tasks": [
                    {
                        "id": "stage-summary",
                        "title": "Stage the intended file",
                        "prompt": "Inspect the repository, stage only reports/summary.md, and inspect the staged diff.",
                        "objective_ids": ["git-stage-objective", "git-diff-objective"],
                        "evidence_ids": ["git-stage-evidence", "git-diff-evidence"],
                    },
                    {
                        "id": "commit-summary",
                        "title": "Commit the staged snapshot",
                        "prompt": "Commit the staged summary with a short descriptive message.",
                        "objective_ids": ["git-stage-objective"],
                        "evidence_ids": ["git-stage-evidence"],
                    },
                    {
                        "id": "branch-history",
                        "title": "Create a branch and inspect history",
                        "prompt": "Create feature/weekly-summary and inspect the commit graph.",
                        "objective_ids": ["git-branch-objective", "git-history-objective"],
                        "evidence_ids": ["git-branch-evidence", "git-history-evidence"],
                    },
                ],
            }
        ],
        assignments=[
            {
                "id": "git-release-workflow",
                "title": "Assignment: Plan a small Git change",
                "prompt": (
                    "A teammate edits README.md while you add reports/summary.md. Write a safe, focused workflow "
                    "that checks status, stages only the summary, reviews the staged diff, commits it, creates a "
                    "feature branch, and inspects the history. Explain what you would check before merging and "
                    "how you would respond to a conflict."
                ),
                "deliverable": (
                    "Submit the command sequence with a one-sentence explanation per step "
                    "(about 150-300 words)."
                ),
                "rubric": [
                    "Separates the working tree, index, and committed snapshot accurately.",
                    "Stages and reviews only the intended file before committing.",
                    "Uses a descriptive commit and creates/inspects the requested branch and history.",
                    "Describes a safe merge/conflict check without using destructive reset or force-push commands.",
                ],
                "objective_ids": [
                    "git-stage-objective",
                    "git-diff-objective",
                    "git-branch-objective",
                    "git-merge-objective",
                    "git-history-objective",
                ],
                "evidence_ids": [
                    "git-stage-evidence",
                    "git-diff-evidence",
                    "git-branch-evidence",
                    "git-merge-evidence",
                    "git-history-evidence",
                ],
            }
        ],
    )


def candidates() -> tuple[CourseRelease, ...]:
    return sql_query_foundations(), git_foundations()
