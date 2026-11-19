"""Bounded course practice: fixed-query checks, authored code checks and a simulated Git terminal."""

import re
import shlex
from typing import Any

from app.courses.contracts import CourseLab, CourseLabView, LabRunRequest, LabRunResponse
from app.courses.lab_receipts import verify_code_receipt
from app.errors import InvalidInput

_SQL_TOKEN = re.compile(r"[A-Za-z_][A-Za-z0-9_$]*|\d+(?:\.\d+)?|'(?:''|[^'])*'|<=|>=|<>|!=|[(),.*=<>;]")
_BRANCH = re.compile(r"[A-Za-z0-9][A-Za-z0-9._/-]{0,63}\Z")
_MAX_SHELL_LINE = 200


def public_lab(lab: CourseLab) -> CourseLabView:
    """Strip target answers from the public teaching API."""
    payload = lab.model_dump(mode="json")
    payload["tasks"] = [
        task.model_dump(mode="json", exclude={"expected_query", "expected_output"}) for task in lab.tasks
    ]
    return CourseLabView.model_validate(payload)


def _sql_tokens(query: str) -> list[str] | None:
    if not query.strip() or len(query) > 4000 or "--" in query or "/*" in query or "*/" in query:
        return None
    result: list[str] = []
    position = 0
    for match in _SQL_TOKEN.finditer(query):
        if query[position : match.start()].strip():
            return None
        result.append(match.group().casefold())
        position = match.end()
    if query[position:].strip():
        return None
    if not result or result[0] != "select":
        return None
    if ";" in result:
        if result.count(";") != 1 or result[-1] != ";":
            return None
        result.pop()
    return result


def _shell_initial() -> dict[str, Any]:
    return {
        "branch": "main",
        "branches": ["main"],
        "staged": [],
        "stage_reviewed": False,
        "commit_created": False,
        "branch_created": False,
        "history_viewed": False,
    }


def _git_status(shell: dict[str, Any]) -> str:
    staged = shell["staged"]
    lines = [f"On branch {shell['branch']}"]
    if staged:
        lines.extend(
            ["Changes to be committed:", *(f"\tnew file: {path}" for path in staged if path == "reports/summary.md")]
        )
    lines.extend(["Changes not staged for commit:", "\tmodified: README.md"])
    if "reports/summary.md" not in staged and not shell["commit_created"]:
        lines.extend(["Untracked files:", "\treports/summary.md"])
    lines.append("\nno command has changed real files")
    return "\n".join(lines)


def _run_git(shell: dict[str, Any], command: str, progress: int) -> tuple[str, int, bool]:
    if (
        len(command) > _MAX_SHELL_LINE
        or "\n" in command
        or "\r" in command
        or any(char in command for char in ";|&><$`(){}")
    ):
        return (
            "Rejected: enter one allowlisted Git command. Nothing was run by an operating-system shell.",
            progress,
            False,
        )
    try:
        words = shlex.split(command, posix=True)
    except ValueError:
        return "Could not parse that command. Check its quotes and try one Git command.", progress, False
    if not words or words[0] != "git":
        return (
            "Only the simulated git command is available; programs and shell operators are disabled.",
            progress,
            False,
        )
    if words == ["git", "status"]:
        return _git_status(shell), progress, True
    if words == ["git", "diff"]:
        return "diff -- README.md\n+Weekly report index\n-Old study notes", progress, True
    if words == ["git", "diff", "--staged"]:
        if shell["staged"] == ["reports/summary.md"]:
            shell["stage_reviewed"] = True
            progress = max(progress, 1)
            output = "diff --cached -- reports/summary.md\n+# Weekly summary\n+Reviewed milestones and next steps."
        elif shell["staged"]:
            output = (
                "diff --cached -- " + ", ".join(shell["staged"]) + "\nReview which files are staged before committing."
            )
        else:
            output = "(no staged changes)"
        return output, progress, True
    if len(words) == 3 and words[:2] == ["git", "add"] and words[2] in {"README.md", "reports/summary.md"}:
        if words[2] not in shell["staged"]:
            shell["staged"].append(words[2])
        return f"Staged {words[2]} in the simulated index.", progress, True
    if len(words) == 4 and words[:3] == ["git", "restore", "--staged"] and words[3] in shell["staged"]:
        shell["staged"].remove(words[3])
        shell["stage_reviewed"] = False
        return f"Unstaged {words[3]} in the simulated index; the working-tree file remains unchanged.", progress, True
    if len(words) == 4 and words[:2] == ["git", "commit"] and words[2] == "-m":
        message = words[3]
        if not message or len(message) > 80:
            return "Use a descriptive commit message of at most 80 characters.", progress, False
        if shell["staged"] != ["reports/summary.md"] or not shell["stage_reviewed"]:
            return "Review and stage only reports/summary.md before committing.", progress, False
        shell["staged"] = []
        shell["commit_created"] = True
        progress = max(progress, 2)
        return f"[feature work pending] b31aa04 {message}\n1 file changed, 2 insertions(+)", progress, True
    if len(words) == 4 and words[:3] == ["git", "switch", "-c"]:
        branch = words[3]
        if not _BRANCH.fullmatch(branch) or ".." in branch or branch.endswith(("/", ".lock")) or "@{" in branch:
            return "Choose a valid new branch name.", progress, False
        if not shell["commit_created"]:
            return "Commit the reviewed summary before creating the feature branch.", progress, False
        if branch in shell["branches"]:
            return "That branch already exists in this practice repository.", progress, False
        shell["branches"].append(branch)
        shell["branch"] = branch
        shell["branch_created"] = True
        return f"Switched to a new branch '{branch}'", progress, True
    if words == ["git", "log", "--oneline", "--graph"]:
        if shell["commit_created"] and shell["branch_created"]:
            shell["history_viewed"] = True
            progress = max(progress, 3)
        branch_line = f"* b31aa04 (HEAD -> {shell['branch']}) Weekly summary"
        start_line = "* a0b12c1 (main) Add course starter files"
        return "\n".join([branch_line, start_line] if shell["commit_created"] else [start_line]), progress, True
    if words == ["git", "show", "HEAD"]:
        if shell["commit_created"]:
            return "commit b31aa04\nWeekly summary\n\n reports/summary.md | 2 ++", progress, True
        return "HEAD is the starter commit a0b12c1; no new commit has been made yet.", progress, True
    return (
        "Unsupported command. Try git status, git add, git diff, git commit, git switch, git log, or git show.",
        progress,
        False,
    )


def run_lab(lab: CourseLab, enrollment: dict[str, Any], request: LabRunRequest, user_id: str) -> LabRunResponse:
    """Apply a bounded practice action without creating checkpoint or review evidence."""
    state = enrollment["state"]
    lab_states = state.setdefault("labs", {})
    lab_state = lab_states.setdefault(lab.id, {"progress": 0, "completed_tasks": [], "transcript": []})
    transcript = lab_state["transcript"]
    actions = state.setdefault("lab_actions", {})
    fingerprint = {
        "lab_id": lab.id,
        "task_id": request.task_id,
        "text": request.text,
        "revision": request.revision,
        "runner_receipt": request.runner_receipt,
        "runner_problem_id": request.runner_problem_id,
        "runner_language": request.runner_language,
    }
    action_id = str(request.id)
    prior = actions.get(action_id)
    if prior is not None:
        if prior["fingerprint"] != fingerprint:
            raise InvalidInput("lab action id was already used with different input")
        return LabRunResponse.model_validate({**prior["result"], "replayed": True})
    if enrollment["revision"] != request.revision:
        raise InvalidInput("Learning session changed; reload it before submitting", status_code=409)
    if len(transcript) >= 20:
        raise InvalidInput("This lab reached its 20-action session limit; reset the lab to practice again")

    progress = int(lab_state["progress"])
    if lab.kind == "sql_query":
        task = next((item for item in lab.tasks if item.id == request.task_id), None)
        query = request.text
        if task is None:
            output, accepted = "Select a valid authored task and enter one read-only SELECT query.", False
        elif task.id in lab_state["completed_tasks"]:
            output, accepted = task.expected_output or "This query task is already complete.", True
        elif task != next(
            (item for item in lab.tasks if item.id not in lab_state["completed_tasks"]), None
        ):
            output, accepted = "Complete the current authored task before moving ahead.", False
        else:
            supplied, expected = _sql_tokens(query), _sql_tokens(task.expected_query or "")
            accepted = supplied is not None and supplied == expected
            if accepted:
                lab_state["completed_tasks"].append(task.id)
                progress = len(lab_state["completed_tasks"])
                output = task.expected_output or "The authored query target matched."
            elif supplied is None:
                output = (
                    "Rejected: enter one bounded SELECT statement with no comments or SQL commands. "
                    "Nothing was executed."
                )
            else:
                output = (
                    "The query does not match this task yet. Check the selected columns, filters, grouping, "
                    "join, and order."
                )
    elif lab.kind == "code_editor":
        task = next((item for item in lab.tasks if item.id == request.task_id), None)
        from app.settings import get_settings

        secret = get_settings().course_lab_receipt_secret
        receipt_valid = bool(
            task
            and task.runner_problem_id == request.runner_problem_id
            and request.runner_language
            and verify_code_receipt(
                request.runner_receipt,
                secret=secret,
                enrollment_id=enrollment["id"],
                lab_id=lab.id,
                task_id=task.id,
                problem_id=task.runner_problem_id,
                language=request.runner_language,
                source=request.text,
            )
        )
        if not receipt_valid or task is None:
            output, accepted = "Run this task successfully in the isolated coding arena before recording it.", False
        elif task.id in lab_state["completed_tasks"]:
            output, accepted = "This coding task is already complete.", True
        elif task != next((item for item in lab.tasks if item.id not in lab_state["completed_tasks"]), None):
            output, accepted = "Complete the current coding task before moving ahead.", False
        else:
            lab_state["completed_tasks"].append(task.id)
            progress = len(lab_state["completed_tasks"])
            output, accepted = "Accepted. The isolated code runner passed every fixed test.", True
    else:
        shell = lab_state.setdefault("shell", _shell_initial())
        output, progress, accepted = _run_git(shell, request.text, progress)

    lab_state["progress"] = progress
    enrollment["revision"] += 1
    complete = progress >= len(lab.tasks)
    result = LabRunResponse(
        id=request.id,
        lab_id=lab.id,
        output=output[:2000],
        accepted=accepted,
        progress=progress,
        complete=complete,
        revision=enrollment["revision"],
        replayed=False,
    )
    transcript.append(
        {"text": request.text[:4000], "output": result.output, "accepted": accepted, "progress": progress}
    )
    lab_state["transcript"] = transcript[-20:]
    actions[action_id] = {"fingerprint": fingerprint, "result": result.model_dump(mode="json")}
    for stale_id in list(actions)[:-40]:
        del actions[stale_id]
    return result
