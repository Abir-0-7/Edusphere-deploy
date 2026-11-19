"""Explicit public repository selection; never accepts a URL or an auth token."""

from typing import Annotated, Literal

from pydantic import Field, StrictInt, model_validator

from app.source_versions.contracts import Contract, GithubLocator, GithubOrigin


class LineSelection(Contract):
    start_line: StrictInt = Field(default=1, ge=1, le=1000000)
    end_line: StrictInt | None = Field(default=None, ge=1, le=1000000)

    @model_validator(mode="after")
    def ordered_lines(self):
        if self.end_line is not None and (
            self.end_line < self.start_line or self.end_line - self.start_line >= 1000
        ):
            raise ValueError("select at most 1000 ordered lines")
        return self


class NotebookCellSelection(LineSelection):
    index: StrictInt = Field(ge=0, le=255)


class TextFileSelection(LineSelection):
    kind: Literal["text"]
    path: str = Field(min_length=1, max_length=500)

    @model_validator(mode="after")
    def path_locator(self):
        GithubLocator(path=self.path, start_line=1, end_line=1)
        if self.path.lower().endswith(".ipynb"):
            raise ValueError("notebooks require explicit cell selections")
        return self


class NotebookFileSelection(Contract):
    kind: Literal["notebook"]
    path: str = Field(min_length=1, max_length=500)
    cells: list[NotebookCellSelection] = Field(min_length=1, max_length=8)

    @model_validator(mode="after")
    def path_and_cells(self):
        GithubLocator(path=self.path, start_line=1, end_line=1)
        if not self.path.lower().endswith(".ipynb"):
            raise ValueError("notebook selections require an .ipynb file")
        if len({item.index for item in self.cells}) != len(self.cells):
            raise ValueError("notebook cell indexes must be unique")
        return self


GithubFileSelection = Annotated[TextFileSelection | NotebookFileSelection, Field(discriminator="kind")]


class GithubImportRequest(Contract):
    origin: GithubOrigin
    files: list[GithubFileSelection] = Field(min_length=1, max_length=16)
    rights_statement: str = Field(min_length=1, max_length=1000)

    @model_validator(mode="after")
    def distinct_files_and_permission(self):
        if len({item.path for item in self.files}) != len(self.files):
            raise ValueError("selected file paths must be unique")
        if not self.rights_statement.strip():
            raise ValueError("confirm permission for the intended private study use")
        return self
