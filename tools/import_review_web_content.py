#!/usr/bin/env python
"""Snapshot the civil-service web manuscripts into the review workroom.

The source and target are both linked Supabase projects owned by Sugar & Salt.
Only the eight configured civil-service subjects are read. Source content is
converted to immutable, hashed review documents; no service-role key is read,
printed, or written to disk.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path
from typing import Any

from import_review_content import Block, clean_text, html_blocks, sql_text


SOURCE_PROJECT = "infivcpgxgawclrkwtai"
EXPECTED_EXAMS = 30
MAX_SQL_BATCH_CHARS = 700_000
SUPABASE_CLI = shutil.which("supabase.cmd" if os.name == "nt" else "supabase") or "supabase"

SOURCE_SUBJECTS = (
    ("헌법(국가직 7급)", "constitution", "헌법", "국가직 7급"),
    ("헌법(지방직 7급)", "constitution", "헌법", "지방직 7급"),
    ("경제학원론(국가직 7급)", "economics", "경제학원론", "국가직 7급"),
    ("경제학원론(지방직 7급)", "economics", "경제학원론", "지방직 7급"),
    ("행정법총론(국가직 7급)", "administrative-law", "행정법총론", "국가직 7급"),
    ("행정법총론(지방직 7급)", "administrative-law", "행정법총론", "지방직 7급"),
    ("행정학개론(국가직 7급)", "public-administration", "행정학개론", "국가직 7급"),
    ("행정학개론(지방직 7급)", "public-administration", "행정학개론", "지방직 7급"),
)


def run_query(workdir: Path, sql: str) -> list[dict[str, Any]]:
    # The npm .cmd shim on Windows treats embedded newlines as command breaks.
    sql = " ".join(sql.split())
    completed = subprocess.run(
        [SUPABASE_CLI, "db", "query", "--linked", "--output", "json", sql],
        cwd=workdir,
        check=False,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
    )
    if completed.returncode:
        message = clean_text(completed.stderr or completed.stdout)
        raise RuntimeError(f"Supabase 읽기 실패: {message[:800]}")
    try:
        payload = json.loads(completed.stdout)
    except json.JSONDecodeError as error:
        raise RuntimeError("Supabase 응답을 JSON으로 해석하지 못했습니다.") from error
    rows = payload.get("rows")
    if not isinstance(rows, list):
        raise RuntimeError("Supabase 응답에 rows 배열이 없습니다.")
    return rows


def source_rows(source_workdir: Path, source_name: str) -> list[dict[str, Any]]:
    safe_name = source_name.replace("'", "''")
    sql = f"""
select
  c.id::text as id,
  c.kind,
  c.sort_order,
  c.title,
  c.body,
  c.created_at::text as created_at
from public.content_items c
join public.subjects s on s.id = c.subject_id
where s.category = '공무원'
  and s.name = '{safe_name}'
  and c.kind in ('summary', 'exam')
order by c.kind, c.sort_order, c.created_at;
""".strip()
    rows = run_query(source_workdir, sql)
    if not rows:
        raise RuntimeError(f"원본 웹 원고가 없습니다: {source_name}")
    return rows


def source_rows_all(source_workdir: Path, source_names: list[str]) -> dict[str, list[dict[str, Any]]]:
    if not source_names:
        return {}
    names_sql = ", ".join(sql_text(name) for name in source_names)
    rows = run_query(source_workdir, f"""
select
  s.name as source_name,
  c.id::text as id,
  c.kind,
  c.sort_order,
  c.title,
  c.body,
  c.created_at::text as created_at
from public.content_items c
join public.subjects s on s.id = c.subject_id
where s.category = '공무원'
  and s.name in ({names_sql})
  and c.kind in ('summary', 'exam')
order by s.name, c.kind, c.sort_order, c.created_at, c.id;
""".strip())
    grouped: dict[str, list[dict[str, Any]]] = {name: [] for name in source_names}
    for row in rows:
        source_name = clean_text(row.pop("source_name", ""))
        if source_name in grouped:
            grouped[source_name].append(row)
    missing = [name for name, items in grouped.items() if not items]
    if missing:
        raise RuntimeError(f"원본 웹 원고가 없습니다: {', '.join(missing)}")
    return grouped


def summary_blocks(items: list[dict[str, Any]]) -> list[Block]:
    blocks: list[Block] = []
    for item in items:
        title = clean_text(item.get("title")) or "핵심노트"
        body = item.get("body") or {}
        html = body.get("html") if isinstance(body, dict) else ""
        if not isinstance(html, str) or not html.strip():
            raise RuntimeError(f"핵심노트 HTML이 없습니다: {title}")
        parsed = html_blocks(html)
        for block in parsed:
            heading = title if block.heading == "원문" else f"{title} · {block.heading}"
            blocks.append(Block(heading, block.body))
    return blocks


def question_body(question: dict[str, Any]) -> str:
    stem = clean_text(question.get("stem") or question.get("question"))
    choices = question.get("choices") if isinstance(question.get("choices"), list) else []
    choice_lines = [f"{index}. {clean_text(choice)}" for index, choice in enumerate(choices, 1)]
    answer = clean_text(question.get("answer"))
    solution = clean_text(question.get("solution") or question.get("explanation"))
    points = clean_text(question.get("points"))
    parts = [f"문제\n{stem}"]
    if choice_lines:
        parts.append("선택지\n" + "\n".join(choice_lines))
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
            body_text = question_body(question)
            if body_text:
                blocks.append(Block(heading, body_text))
    return blocks


def canonical_hash(items: list[dict[str, Any]]) -> str:
    encoded = json.dumps(items, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


def document_sql(
    *,
    subject_code: str,
    title: str,
    kind: str,
    source_name: str,
    source_items: list[dict[str, Any]],
    blocks: list[Block],
    version: str,
) -> str:
    digest = canonical_hash(source_items)
    rows = []
    for index, block in enumerate(blocks, 1):
        fingerprint = hashlib.sha256(block.body.encode("utf-8")).hexdigest()
        rows.append(
            f"(v_document, 'b{index:05d}', {sql_text(block.heading)}, "
            f"{sql_text(block.body)}, {index}, '{fingerprint}')"
        )
    if not rows:
        raise RuntimeError(f"검수 문단이 없습니다: {title}")
    source_path = f"supabase://{SOURCE_PROJECT}/content_items/{source_name}"
    return f"""begin;
do $review_web_import$
declare
  v_subject uuid;
  v_document uuid;
begin
  select id into v_subject
    from public.review_subjects
   where program_id = 'civil' and code = {sql_text(subject_code)};
  if v_subject is null then
    raise exception '검수 과목을 찾지 못했습니다: civil/{subject_code}';
  end if;
  if exists (
    select 1 from public.review_documents
     where subject_id = v_subject and title = {sql_text(title)} and version = {sql_text(version)}
  ) then
    raise notice 'skip existing review document: {title}';
    return;
  end if;
  insert into public.review_documents
    (subject_id, kind, title, version, review_stage, source_object_path, source_sha256, status)
  values
    (v_subject, {sql_text(kind)}, {sql_text(title)}, {sql_text(version)}, '1차 검수',
     {sql_text(source_path)}, '{digest}', 'staged')
  returning id into v_document;
  insert into public.review_blocks
    (document_id, block_key, heading, body, sort_order, source_fingerprint)
  values
    {',\n    '.join(rows)};
end
$review_web_import$;
commit;
"""


def global_activation_sql(*, sources: list[tuple[str, str, int]], version: str) -> str:
    checks: list[str] = []
    updates: list[str] = []
    for subject_code, source_name, expected_documents in sources:
        source_path = f"supabase://{SOURCE_PROJECT}/content_items/{source_name}"
        checks.append(f"""
  select id into v_subject
    from public.review_subjects
   where program_id = 'civil' and code = {sql_text(subject_code)};
  if v_subject is null then
    raise exception '검수 과목을 찾지 못했습니다: civil/{subject_code}';
  end if;
  select count(*) into v_count
    from public.review_documents
   where subject_id = v_subject
     and source_object_path = {sql_text(source_path)}
     and version = {sql_text(version)}
     and status = 'staged';
  if v_count <> {expected_documents} then
    raise exception '새 검수본 문서 수 불일치 ({source_name}): expected %, actual %', {expected_documents}, v_count;
  end if;""")
        updates.append(f"""
  update public.review_documents
     set status = 'superseded'
   where subject_id = (select id from public.review_subjects where program_id = 'civil' and code = {sql_text(subject_code)})
     and source_object_path = {sql_text(source_path)}
     and version <> {sql_text(version)}
     and status in ('staged', 'review_ready', 'reviewing', 'approved');
  update public.review_documents
     set status = 'review_ready'
   where subject_id = (select id from public.review_subjects where program_id = 'civil' and code = {sql_text(subject_code)})
     and source_object_path = {sql_text(source_path)}
     and version = {sql_text(version)}
     and status = 'staged';""")
    return f"""begin;
do $review_web_activate$
declare
  v_subject uuid;
  v_count integer;
begin
{''.join(checks)}
{''.join(updates)}
end
$review_web_activate$;
commit;
"""


def audit_source(target_workdir: Path, *, subject_code: str, source_name: str, documents: list[dict[str, Any]]) -> str:
    source_path = f"supabase://{SOURCE_PROJECT}/content_items/{source_name}"
    rows = run_query(target_workdir, f"""
select
  d.title,
  d.version,
  d.source_sha256,
  d.status,
  (select count(*) from public.review_blocks b where b.document_id = d.id) as block_count
from public.review_documents d
join public.review_subjects s on s.id = d.subject_id
where s.program_id = 'civil'
  and s.code = {sql_text(subject_code)}
  and d.source_object_path = {sql_text(source_path)}
  and d.status in ('review_ready', 'approved')
order by d.title;
""".strip())
    if not rows:
        raise RuntimeError(f"활성 검수본이 없습니다: {source_name}")
    versions = {clean_text(row.get("version")) for row in rows}
    if len(versions) != 1:
        raise RuntimeError(f"활성 검수본 버전이 하나가 아닙니다: {source_name} ({', '.join(sorted(versions))})")
    actual_by_title = {clean_text(row.get("title")): row for row in rows}
    if len(actual_by_title) != len(rows):
        raise RuntimeError(f"활성 검수본 제목이 중복되었습니다: {source_name}")
    expected_by_title = {document["title"]: document for document in documents}
    missing = sorted(set(expected_by_title) - set(actual_by_title))
    extra = sorted(set(actual_by_title) - set(expected_by_title))
    if missing or extra:
        raise RuntimeError(f"원본·검수본 문서 구성이 다릅니다: {source_name} (누락 {len(missing)}, 추가 {len(extra)})")
    mismatches: list[str] = []
    for title, document in expected_by_title.items():
        actual = actual_by_title[title]
        expected_hash = canonical_hash(document["items"])
        expected_blocks = len(document["blocks"])
        actual_hash = clean_text(actual.get("source_sha256"))
        actual_blocks = int(actual.get("block_count") or 0)
        if actual_hash != expected_hash or actual_blocks != expected_blocks:
            mismatches.append(
                f"{title} [hash {actual_hash[:12]}→{expected_hash[:12]}, blocks {actual_blocks}→{expected_blocks}]"
            )
    if mismatches:
        sample = ", ".join(mismatches[:3])
        raise RuntimeError(f"원본과 활성 검수본의 해시 또는 문단 수가 다릅니다: {source_name} ({len(mismatches)}건: {sample})")
    return next(iter(versions))


def apply_sql(target_workdir: Path, sql: str) -> None:
    path: Path | None = None
    try:
        with tempfile.NamedTemporaryFile("w", suffix=".sql", encoding="utf-8", delete=False) as handle:
            handle.write(sql)
            path = Path(handle.name)
        completed = subprocess.run(
            [SUPABASE_CLI, "db", "query", "--linked", "--file", str(path)],
            cwd=target_workdir,
            check=False,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
        )
        if completed.returncode:
            message = clean_text("\n".join(part for part in (completed.stdout, completed.stderr) if part))
            raise RuntimeError(f"검수 DB 적재 실패: {message[:1000]}")
    finally:
        if path and path.exists():
            path.unlink()


def build_documents(rows: list[dict[str, Any]], subject_code: str, display_name: str, track: str, source_name: str) -> list[dict[str, Any]]:
    summaries = [item for item in rows if item.get("kind") == "summary"]
    exams = [item for item in rows if item.get("kind") == "exam"]
    if not summaries:
        raise RuntimeError(f"핵심노트가 없습니다: {source_name}")
    if len(exams) != EXPECTED_EXAMS:
        raise RuntimeError(f"모의고사 회차가 {EXPECTED_EXAMS}회가 아닙니다: {source_name} ({len(exams)}회)")
    documents: list[dict[str, Any]] = []
    for index, item in enumerate(summaries, 1):
        original_title = clean_text(item.get("title"))
        chapter = original_title.split(" - ", 1)[-1] if " - " in original_title else original_title
        documents.append({
            "subject_code": subject_code,
            "title": f"[{track}] {display_name} 핵심노트 {index:02d} · {chapter}",
            "kind": "핵심노트",
            "source_name": source_name,
            "items": [item],
            "blocks": summary_blocks([item]),
        })
    for start in (0, 10, 20):
        batch = exams[start:start + 10]
        documents.append({
            "subject_code": subject_code,
            "title": f"[{track}] {display_name} 모의고사 {start + 1:02d}~{start + 10:02d}회",
            "kind": "모의고사",
            "source_name": source_name,
            "items": batch,
            "blocks": exam_blocks(batch),
        })
    return documents


def main() -> int:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    parser = argparse.ArgumentParser(description="웹 공무원 원고를 전문위원 검수 DB에 버전 고정 적재")
    parser.add_argument("--source-workdir", type=Path, required=True)
    parser.add_argument("--target-workdir", type=Path, required=True)
    parser.add_argument("--version", help="새 검수본의 고유 버전(예: 2026.08.12-web-v2). --audit에서는 생략")
    parser.add_argument("--source-name", action="append", help="특정 원본 과목명만 처리(반복 가능)")
    mode_group = parser.add_mutually_exclusive_group()
    mode_group.add_argument("--apply", action="store_true")
    mode_group.add_argument("--audit", action="store_true", help="원본과 현재 활성 검수본의 해시·문단 수·버전을 대조")
    args = parser.parse_args()
    source_workdir = args.source_workdir.resolve()
    target_workdir = args.target_workdir.resolve()
    version = clean_text(args.version) if args.version else ""
    if not args.audit and (len(version) < 8 or len(version) > 80):
        raise RuntimeError("버전은 날짜와 차수를 포함한 8~80자 값으로 입력해 주세요.")
    total_documents = 0
    total_blocks = 0
    audit_failures: list[str] = []
    staged_sources: list[tuple[str, str, int]] = []
    mode = "apply" if args.apply else "audit" if args.audit else "preview"
    print(f"source={SOURCE_PROJECT} version={version or 'active'} mode={mode}")
    configured_sources = SOURCE_SUBJECTS
    if args.source_name:
        selected = set(args.source_name)
        configured_sources = tuple(item for item in SOURCE_SUBJECTS if item[0] in selected)
        missing = selected - {item[0] for item in configured_sources}
        if missing:
            raise RuntimeError(f"지원하지 않는 원본 과목명: {', '.join(sorted(missing))}")
    source_snapshot = source_rows_all(source_workdir, [item[0] for item in configured_sources])
    for source_name, subject_code, display_name, track in configured_sources:
        rows = source_snapshot[source_name]
        documents = build_documents(rows, subject_code, display_name, track, source_name)
        if args.audit:
            source_blocks = sum(len(document["blocks"]) for document in documents)
            total_documents += len(documents)
            total_blocks += source_blocks
            try:
                active_version = audit_source(target_workdir, subject_code=subject_code, source_name=source_name, documents=documents)
                print(f"  audit passed {source_name}: version={active_version} documents={len(documents)} blocks={source_blocks}")
            except RuntimeError as error:
                audit_failures.append(str(error))
                print(f"  audit FAILED {source_name}: {error}")
            continue
        source_sql: list[str] = []
        for document in documents:
            blocks = document["blocks"]
            digest = canonical_hash(document["items"])
            print(f"{document['title']}: source={len(document['items'])} blocks={len(blocks)} sha256={digest[:12]}")
            if args.apply:
                source_sql.append(document_sql(
                    subject_code=document["subject_code"],
                    title=document["title"],
                    kind=document["kind"],
                    source_name=document["source_name"],
                    source_items=document["items"],
                    blocks=blocks,
                    version=version,
                ))
            total_documents += 1
            total_blocks += len(blocks)
        if args.apply:
            batches: list[list[str]] = []
            current_batch: list[str] = []
            current_size = 0
            for statement in source_sql:
                statement_size = len(statement.encode("utf-8"))
                if current_batch and current_size + statement_size > MAX_SQL_BATCH_CHARS:
                    batches.append(current_batch)
                    current_batch = []
                    current_size = 0
                current_batch.append(statement)
                current_size += statement_size
            if current_batch:
                batches.append(current_batch)
            for batch_index, batch in enumerate(batches, 1):
                apply_sql(target_workdir, "\n".join(batch))
                print(f"  batch {batch_index}/{len(batches)} applied: documents={len(batch)}")
            staged_sources.append((subject_code, source_name, len(documents)))
            print(f"  staged {source_name}: version={version} documents={len(documents)}")
    if audit_failures:
        raise RuntimeError(f"원고 무결성 감사 실패 {len(audit_failures)}개 원본\n- " + "\n- ".join(audit_failures))
    if args.apply:
        apply_sql(target_workdir, global_activation_sql(sources=staged_sources, version=version))
        print(f"globally activated version={version}: sources={len(staged_sources)}")
    print(f"complete documents={total_documents} blocks={total_blocks}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
