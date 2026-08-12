#!/usr/bin/env python
"""Snapshot current civil-service web manuscripts into immutable review documents.

The source and target are two linked Supabase projects owned by Sugar & Salt.
Run in preview mode first. ``--apply`` writes a new version without changing or
deleting previous review snapshots.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
from dataclasses import dataclass
from html.parser import HTMLParser
from pathlib import Path
from typing import Any


SOURCE_PROJECT = "infivcpgxgawclrkwtai"
VERSION = "2026.08.13-web-v3"
EXPECTED_EXAMS = 30
MAX_SQL_BATCH_CHARS = 700_000
SUPABASE_CLI = shutil.which("supabase.cmd" if os.name == "nt" else "supabase") or "supabase"

SOURCE_SUBJECTS = (
    ("헌법(국가직 7급)", "constitution", "헌법", "국가직 7급"),
    ("헌법(지방직 7급)", "constitution", "헌법", "지방직 7급"),
    ("경제학(국가직 7급)", "economics", "경제학원론", "국가직 7급"),
    ("경제학원론(지방직 7급)", "economics", "경제학원론", "지방직 7급"),
    ("행정법(국가직 7급)", "administrative-law", "행정법총론", "국가직 7급"),
    ("행정법(지방직 7급)", "administrative-law", "행정법총론", "지방직 7급"),
    ("행정학(국가직 7급)", "public-administration", "행정학개론", "국가직 7급"),
    ("행정학(지방직 7급)", "public-administration", "행정학개론", "지방직 7급"),
)


@dataclass
class Block:
    heading: str
    body: str


def clean_text(value: Any) -> str:
    text = str(value or "").replace("\x00", "")
    text = text.replace("\r\n", "\n").replace("\r", "\n")
    text = re.sub(r"[ \t]+\n", "\n", text)
    text = re.sub(r"\n{4,}", "\n\n\n", text)
    return text.strip()


def sql_text(value: Any) -> str:
    return "'" + str(value or "").replace("'", "''") + "'"


def paragraph_blocks(text: str, prefix: str = "문단") -> list[Block]:
    parts = [clean_text(item) for item in re.split(r"\n\s*\n", clean_text(text))]
    return [Block(f"{prefix} {index}", item) for index, item in enumerate(parts, 1) if item]


class SectionParser(HTMLParser):
    SKIP = {"script", "style", "noscript", "template", "svg"}
    HEADINGS = {"h1", "h2", "h3", "h4", "h5", "h6"}
    CONTENT = {"p", "li", "blockquote", "pre", "td", "th"}

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.skip_depth = 0
        self.capture: str | None = None
        self.buffer: list[str] = []
        self.heading = "원문"
        self.blocks: list[Block] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        tag = tag.lower()
        if tag in self.SKIP:
            self.skip_depth += 1
        if not self.skip_depth and tag in self.HEADINGS | self.CONTENT:
            self.capture = tag
            self.buffer = []
        elif not self.skip_depth and tag == "br" and self.capture:
            self.buffer.append("\n")

    def handle_endtag(self, tag: str) -> None:
        tag = tag.lower()
        if tag in self.SKIP and self.skip_depth:
            self.skip_depth -= 1
            return
        if self.skip_depth or tag != self.capture:
            return
        text = clean_text("".join(self.buffer))
        if text and tag in self.HEADINGS:
            self.heading = text
        elif text:
            self.blocks.append(Block(self.heading, text))
        self.capture = None
        self.buffer = []

    def handle_data(self, data: str) -> None:
        if not self.skip_depth and self.capture:
            self.buffer.append(data)


def html_blocks(html: str) -> list[Block]:
    parser = SectionParser()
    parser.feed(html)
    return parser.blocks or paragraph_blocks(re.sub(r"<[^>]+>", " ", html))


def run_query(workdir: Path, sql: str) -> list[dict[str, Any]]:
    completed = subprocess.run(
        [SUPABASE_CLI, "db", "query", "--linked", "--output", "json", " ".join(sql.split())],
        cwd=workdir, check=False, capture_output=True, text=True,
        encoding="utf-8", errors="replace",
    )
    if completed.returncode:
        raise RuntimeError(f"Supabase 읽기 실패: {clean_text(completed.stderr or completed.stdout)[:800]}")
    rows = json.loads(completed.stdout).get("rows")
    if not isinstance(rows, list):
        raise RuntimeError("Supabase 응답에 rows 배열이 없습니다.")
    return rows


def source_rows(source_workdir: Path, source_name: str) -> list[dict[str, Any]]:
    rows = run_query(source_workdir, f"""
        select c.id::text as id, c.kind, c.sort_order, c.title, c.body, c.created_at::text as created_at
          from public.content_items c join public.subjects s on s.id = c.subject_id
         where s.category = '공무원' and s.name = {sql_text(source_name)}
           and c.kind in ('summary', 'exam')
         order by c.kind, c.sort_order, c.created_at;
    """)
    if not rows:
        raise RuntimeError(f"원본 웹 원고가 없습니다: {source_name}")
    return rows


def summary_blocks(items: list[dict[str, Any]]) -> list[Block]:
    blocks: list[Block] = []
    for item in items:
        title = clean_text(item.get("title")) or "핵심노트"
        body = item.get("body") or {}
        html = body.get("html") if isinstance(body, dict) else ""
        if not isinstance(html, str) or not html.strip():
            raise RuntimeError(f"핵심노트 HTML이 없습니다: {title}")
        for block in html_blocks(html):
            heading = title if block.heading == "원문" else f"{title} · {block.heading}"
            blocks.append(Block(heading, block.body))
    return blocks


def question_body(question: dict[str, Any]) -> str:
    stem = clean_text(question.get("stem") or question.get("question"))
    choices = question.get("choices") if isinstance(question.get("choices"), list) else []
    parts = [f"문제\n{stem}"]
    if choices:
        parts.append("선택지\n" + "\n".join(f"{i}. {clean_text(choice)}" for i, choice in enumerate(choices, 1)))
    answer = clean_text(question.get("answer"))
    solution = clean_text(question.get("solution") or question.get("explanation"))
    points = clean_text(question.get("points"))
    if answer:
        parts.append(f"정답\n{answer}")
    if solution:
        parts.append(f"해설\n{solution}")
    if points:
        parts.append(f"배점\n{points}점")
    return "\n\n".join(parts)


def exam_blocks(items: list[dict[str, Any]]) -> list[Block]:
    blocks: list[Block] = []
    for item in items:
        title = clean_text(item.get("title")) or "모의고사"
        body = item.get("body") or {}
        questions = body.get("items") if isinstance(body, dict) else None
        if not isinstance(questions, list) or not questions:
            raise RuntimeError(f"모의고사 문항이 없습니다: {title}")
        for index, question in enumerate(questions, 1):
            if not isinstance(question, dict):
                continue
            qno = clean_text(question.get("qno")) or str(index)
            domain = clean_text(question.get("domain"))
            heading = f"{title} · {qno}번" + (f" · {domain}" if domain else "")
            blocks.append(Block(heading, question_body(question)))
    return blocks


def canonical_hash(items: list[dict[str, Any]]) -> str:
    encoded = json.dumps(items, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


def build_documents(rows: list[dict[str, Any]], subject_code: str, display_name: str, track: str, source_name: str) -> list[dict[str, Any]]:
    summaries = [item for item in rows if item.get("kind") == "summary"]
    exams = [item for item in rows if item.get("kind") == "exam"]
    if not summaries or len(exams) != EXPECTED_EXAMS:
        raise RuntimeError(f"원고 구성이 올바르지 않습니다: {source_name} (핵심노트 {len(summaries)}, 모의고사 {len(exams)})")
    documents: list[dict[str, Any]] = []
    for index, item in enumerate(summaries, 1):
        original_title = clean_text(item.get("title"))
        chapter = original_title.split(" - ", 1)[-1] if " - " in original_title else original_title
        documents.append({"subject_code": subject_code, "title": f"[{track}] {display_name} 핵심노트 {index:02d} · {chapter}", "kind": "핵심노트", "source_name": source_name, "items": [item], "blocks": summary_blocks([item])})
    for start in (0, 10, 20):
        batch = exams[start:start + 10]
        documents.append({"subject_code": subject_code, "title": f"[{track}] {display_name} 모의고사 {start + 1:02d}~{start + 10:02d}회", "kind": "모의고사", "source_name": source_name, "items": batch, "blocks": exam_blocks(batch)})
    return documents


def document_sql(document: dict[str, Any]) -> str:
    digest = canonical_hash(document["items"])
    rows = []
    for index, block in enumerate(document["blocks"], 1):
        fingerprint = hashlib.sha256(block.body.encode("utf-8")).hexdigest()
        rows.append(f"(v_document, 'b{index:05d}', {sql_text(block.heading)}, {sql_text(block.body)}, {index}, '{fingerprint}')")
    source_path = f"supabase://{SOURCE_PROJECT}/content_items/{document['source_name']}"
    return f"""begin;
do $review_web_import$
declare v_subject uuid; v_document uuid;
begin
  select id into v_subject from public.review_subjects where program_id = 'civil' and code = {sql_text(document['subject_code'])};
  if v_subject is null then raise exception '검수 과목 없음'; end if;
  if exists (select 1 from public.review_documents where subject_id=v_subject and title={sql_text(document['title'])} and version='{VERSION}') then return; end if;
  insert into public.review_documents (subject_id, kind, title, version, review_stage, source_object_path, source_sha256, status)
  values (v_subject, {sql_text(document['kind'])}, {sql_text(document['title'])}, '{VERSION}', '1차 검수', {sql_text(source_path)}, '{digest}', 'review_ready')
  returning id into v_document;
  insert into public.review_blocks (document_id, block_key, heading, body, sort_order, source_fingerprint) values {','.join(rows)};
end $review_web_import$;
commit;
"""


def apply_sql(target_workdir: Path, sql: str) -> None:
    path: Path | None = None
    try:
        with tempfile.NamedTemporaryFile("w", suffix=".sql", encoding="utf-8", delete=False) as handle:
            handle.write(sql)
            path = Path(handle.name)
        completed = subprocess.run([SUPABASE_CLI, "db", "query", "--linked", "--file", str(path)], cwd=target_workdir, check=False, capture_output=True, text=True, encoding="utf-8", errors="replace")
        if completed.returncode:
            raise RuntimeError(f"검수 DB 적재 실패: {clean_text(completed.stdout + completed.stderr)[:1000]}")
    finally:
        if path and path.exists():
            path.unlink()


def main() -> int:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    parser = argparse.ArgumentParser(description="웹 공무원 원고를 전문위원 검수 DB에 버전 고정 적재")
    parser.add_argument("--source-workdir", type=Path, required=True)
    parser.add_argument("--target-workdir", type=Path, required=True)
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args()
    total_documents = total_blocks = 0
    print(f"source={SOURCE_PROJECT} version={VERSION} mode={'apply' if args.apply else 'preview'}")
    for source_name, subject_code, display_name, track in SOURCE_SUBJECTS:
        documents = build_documents(source_rows(args.source_workdir.resolve(), source_name), subject_code, display_name, track, source_name)
        statements: list[str] = []
        for document in documents:
            digest = canonical_hash(document["items"])
            print(f"{document['title']}: blocks={len(document['blocks'])} sha256={digest[:12]}")
            statements.append(document_sql(document))
            total_documents += 1
            total_blocks += len(document["blocks"])
        if args.apply:
            batch: list[str] = []
            size = 0
            for statement in statements:
                statement_size = len(statement.encode("utf-8"))
                if batch and size + statement_size > MAX_SQL_BATCH_CHARS:
                    apply_sql(args.target_workdir.resolve(), "\n".join(batch))
                    batch, size = [], 0
                batch.append(statement)
                size += statement_size
            if batch:
                apply_sql(args.target_workdir.resolve(), "\n".join(batch))
    print(f"complete documents={total_documents} blocks={total_blocks}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
