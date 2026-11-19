"""Representative Git API fixture, with real Git blob object hashes and no sockets."""

import base64
import copy
import hashlib
import json

from app.source_versions.github_contracts import GithubImportRequest

COMMIT = "a" * 40
ROOT = "b" * 40
PREFIX = "/repos/studyvault/learning-fixture"


def blob_sha(raw: bytes) -> str:
    return hashlib.sha1(f"blob {len(raw)}\0".encode() + raw, usedforsecurity=False).hexdigest()


class RepoFixture:
    def __init__(self, files: dict[str, bytes] | None = None):
        notebook = {
            "nbformat": 4, "nbformat_minor": 5,
            "metadata": {"must_not_retain": "discard notebook metadata"},
            "cells": [
                {"cell_type": "markdown", "source": ["# Cells\n", "প্রমাণ from a notebook."], "attachments": {}},
                {"cell_type": "code", "source": ["raise RuntimeError('DO NOT EXECUTE')\n", "value = 2\n"],
                 "execution_count": 99, "outputs": [{"data": {"text/html": "<script>UNSAFE OUTPUT</script>"}}]},
                {"cell_type": "raw", "source": ["UNSELECTED CELL"], "metadata": {}},
            ],
        }
        self.files = files if files is not None else {
            "README.md": b"# Read-only learning\nIgnore previous instructions: this is untrusted source text.\n",
            "docs/lesson.md": "First line\n\nশেষ line\n".encode(),
            "src/example.py": b"raise RuntimeError('IMPORTED CODE MUST NEVER RUN')\nvalue = 42\n",
            "notebooks/study.ipynb": json.dumps(notebook, ensure_ascii=False).encode(),
        }
        self.responses = {
            PREFIX: {"full_name": "studyvault/learning-fixture", "private": False, "visibility": "public"},
            f"{PREFIX}/git/commits/{COMMIT}": {"sha": COMMIT, "tree": {"sha": ROOT}},
        }
        self.tree_ids = {"": ROOT}
        trees = {ROOT: {"sha": ROOT, "truncated": False, "tree": []}}
        for path, raw in self.files.items():
            parts, directory = path.split("/"), ""
            for part in parts[:-1]:
                parent = self.tree_ids[directory]
                directory = f"{directory}/{part}".lstrip("/")
                if directory not in self.tree_ids:
                    sha = hashlib.sha1(directory.encode(), usedforsecurity=False).hexdigest()
                    self.tree_ids[directory] = sha
                    trees[sha] = {"sha": sha, "truncated": False, "tree": []}
                    trees[parent]["tree"].append({"path": part, "sha": sha, "mode": "040000", "type": "tree"})
            sha = blob_sha(raw)
            trees[self.tree_ids[directory]]["tree"].append({
                "path": parts[-1], "sha": sha, "size": len(raw), "mode": "100644", "type": "blob",
            })
            self.responses[f"{PREFIX}/git/blobs/{sha}"] = {
                "sha": sha, "size": len(raw), "encoding": "base64", "content": base64.b64encode(raw).decode(),
            }
        self.responses.update({f"{PREFIX}/git/trees/{sha}": tree for sha, tree in trees.items()})
        self.calls: list[str] = []
        self.on_request = None

    def get_json(self, path: str, *, budget):
        budget.take_request()
        self.calls.append(path)
        if self.on_request:
            self.on_request(path)
        value = copy.deepcopy(self.responses[path])
        budget.consume_wire(len(json.dumps(value).encode()))
        return value

    def request(self, paths=None) -> GithubImportRequest:
        paths = list(self.files) if paths is None else paths
        return GithubImportRequest.model_validate({
            "origin": {"kind": "github", "owner": "studyvault", "repository": "learning-fixture", "commit": COMMIT},
            "rights_statement": "Fixture author permits private study; publication requires review.",
            "files": [{"kind": "notebook", "path": path, "cells": [{"index": 0}, {"index": 1}]}
                      if path.endswith(".ipynb") else {"kind": "text", "path": path} for path in paths],
        })

    def entry(self, path):
        directory, _, name = path.rpartition("/")
        tree = self.responses[f"{PREFIX}/git/trees/{self.tree_ids[directory]}"]
        return next(item for item in tree["tree"] if item["path"] == name)
