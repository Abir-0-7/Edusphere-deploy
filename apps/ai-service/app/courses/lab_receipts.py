"""Short-lived proof that a course solution passed the isolated code runner."""

import hashlib
import hmac
import time


def verify_code_receipt(
    receipt: str | None,
    *,
    secret: str | None,
    enrollment_id: str,
    lab_id: str,
    task_id: str,
    problem_id: str,
    language: str,
    source: str,
    now: int | None = None,
) -> bool:
    if not receipt or not secret or len(secret) < 32:
        return False
    parts = receipt.split(".")
    if len(parts) != 3 or not parts[0].isdigit() or len(parts[1]) != 64 or len(parts[2]) != 64:
        return False
    expires = int(parts[0])
    current = int(time.time()) if now is None else now
    if expires < current or expires > current + 180:
        return False
    source_hash = hashlib.sha256(source.encode("utf-8")).hexdigest()
    if not hmac.compare_digest(source_hash, parts[1]):
        return False
    claims = "\n".join([str(expires), enrollment_id, lab_id, task_id, problem_id, language, source_hash])
    expected = hmac.new(secret.encode("utf-8"), claims.encode("utf-8"), hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, parts[2])
