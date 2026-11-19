"""Prepare/check an editorial packet; never publish or invent human review."""

import argparse
import json
from pathlib import Path

from app.courses.editorial import FullCourseReview, build_review_packet, evaluate_review


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check-review", type=Path,
                        help="Validate a human-completed copy against this exact candidate")
    parser.add_argument("--output", type=Path, help="Export a fresh pending packet to this path")
    args = parser.parse_args()
    from app.courses.full_course_candidate import practical_python_foundations

    release = practical_python_foundations()
    if args.check_review:
        try:
            packet = FullCourseReview.model_validate_json(args.check_review.read_text(encoding="utf-8"))
            result = evaluate_review(packet, release)
        except (OSError, ValueError) as exc:
            parser.error(str(exc))
        print(json.dumps(result, indent=2))
        return 0 if result["human_review_requirements_met"] else 1
    packet = build_review_packet(release)
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        try:
            # Exclusive creation prevents a concurrent human edit from being
            # overwritten between checking a path and exporting a fresh packet.
            with args.output.open("x", encoding="utf-8") as target:
                target.write(packet.model_dump_json(indent=2) + "\n")
        except FileExistsError:
            parser.error("Output already exists; choose a new path to preserve all existing review data")
    print(json.dumps(evaluate_review(packet, release), indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
