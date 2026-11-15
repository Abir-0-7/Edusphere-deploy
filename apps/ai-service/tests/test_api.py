from fastapi.routing import APIRoute
from fastapi.testclient import TestClient

from app.main import app, current_user_id

client = TestClient(app)


def test_parse_pdf_requires_auth() -> None:
    resp = client.post("/api/parse-pdf", files={"file": ("a.pdf", b"x", "application/pdf")})
    assert resp.status_code == 401
    assert resp.json()["error"]["code"] == "unauthorized"


def test_job_status_requires_auth() -> None:
    assert client.get("/api/jobs/some-id").status_code == 401


def test_parse_pdf_returns_job_and_document_ids_and_polls() -> None:
    from tests.test_pdf import make_text_pdf

    resp = client.post(
        "/api/parse-pdf",
        headers={"Authorization": "Bearer dev-user-1"},
        files={"file": ("lecture.pdf", make_text_pdf(1), "application/pdf")},
    )
    assert resp.status_code == 202
    job_id = resp.json()["job_id"]
    document_id = resp.json()["document_id"]
    assert document_id
    status = client.get(f"/api/jobs/{job_id}", headers={"Authorization": "Bearer dev-user-1"})
    assert status.status_code == 200
    assert status.json()["status"] == "pending"


def test_job_not_visible_to_other_user() -> None:
    import uuid

    from app.jobs.worker import Job
    from app.main import job_store

    jid = str(uuid.uuid4())
    job_store.add(Job(id=jid, kind="parse_pdf", payload={"user_id": "alice"}))
    resp = client.get(f"/api/jobs/{jid}", headers={"Authorization": "Bearer bob"})
    assert resp.status_code == 404
    resp = client.get(f"/api/jobs/{jid}", headers={"Authorization": "Bearer alice"})
    assert resp.status_code == 200


def test_error_shape_is_shared_format() -> None:
    resp = client.post(
        "/api/parse-pdf", headers={"Authorization": "Bearer u"}, files={"file": ("a.txt", b"x", "text/plain")}
    )
    body = resp.json()
    assert resp.status_code == 400
    assert body["error"]["code"] == "invalid_input"
    assert "message" in body["error"]


def test_cors_allows_configured_browser_origin_only() -> None:
    allowed = client.options(
        "/api/parse-pdf",
        headers={
            "Origin": "http://localhost:3000",
            "Access-Control-Request-Method": "POST",
            "Access-Control-Request-Headers": "authorization,content-type",
        },
    )
    assert allowed.status_code == 200
    assert allowed.headers["access-control-allow-origin"] == "http://localhost:3000"

    denied = client.options(
        "/api/parse-pdf",
        headers={"Origin": "https://untrusted.example", "Access-Control-Request-Method": "POST"},
    )
    assert denied.status_code == 400


def test_every_api_route_requires_authenticated_user() -> None:
    api_routes = [route for route in app.routes if isinstance(route, APIRoute) and route.path.startswith("/api/")]
    assert api_routes
    for route in api_routes:
        dependencies = {dependency.call for dependency in route.dependant.dependencies}
        assert current_user_id in dependencies, f"{route.path} is missing the authenticated-user dependency"


# --- Phase 2: upload -> worker -> chapters through the HTTP API -------------


def test_oversized_content_length_rejected_before_reading() -> None:
    resp = client.post(
        "/api/parse-pdf",
        headers={"Authorization": "Bearer u", "Content-Length": str(500 * 1024 * 1024)},
        content=b"x",
    )
    assert resp.status_code == 413
    assert resp.json()["error"]["code"] == "file_too_large"


def test_encrypted_upload_rejected_with_clear_error() -> None:
    from tests.test_pdf import make_encrypted_pdf

    resp = client.post(
        "/api/parse-pdf",
        headers={"Authorization": "Bearer u"},
        files={"file": ("locked.pdf", make_encrypted_pdf(), "application/pdf")},
    )
    assert resp.status_code == 400
    assert "password" in resp.json()["error"]["message"]


def test_upload_to_chapters_end_to_end() -> None:
    import httpx
    import respx

    from app.main import worker
    from tests.test_pdf import make_text_pdf

    auth = {"Authorization": "Bearer e2e-user"}
    resp = client.post(
        "/api/parse-pdf", headers=auth, files={"file": ("bio.pdf", make_text_pdf(2), "application/pdf")}
    )
    job_id = resp.json()["job_id"]

    llm = '{"chapters": [{"title": "Photosynthesis", "start_page": 1, "end_page": 2, "summary": "light"}]}'
    with respx.mock:
        respx.post("https://primary.test/v1/chat/completions").mock(
            return_value=httpx.Response(200, json={"choices": [{"message": {"content": llm}}]})
        )
        while worker.process_one():
            pass

    job = client.get(f"/api/jobs/{job_id}", headers=auth).json()
    assert job["status"] == "done"
    doc_id = job["result"]["document_id"]
    structure = client.get(f"/api/jobs/{job['result']['next_job_id']}", headers=auth).json()
    assert structure["status"] == "done"
    assert structure["result"]["structure_source"] == "llm"

    chapters = client.get(f"/api/documents/{doc_id}/chapters", headers=auth)
    assert chapters.status_code == 200
    assert [(c["title"], c["ordinal"], c["start_page"], c["end_page"]) for c in chapters.json()] == [
        ("Photosynthesis", 1, 1, 2)
    ]
    # another user cannot see the document
    other = client.get(f"/api/documents/{doc_id}/chapters", headers={"Authorization": "Bearer intruder"})
    assert other.status_code == 404
