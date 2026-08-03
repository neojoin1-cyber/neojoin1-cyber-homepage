import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";


const portalRoot = resolve(import.meta.dirname, "..");
const publicPagePath = resolve(portalRoot, "card", "kim-younghee", "index.html");
const managePagePath = resolve(portalRoot, "card", "manage.html");
const publicScriptPath = resolve(portalRoot, "assets", "card", "card.js");
const manageScriptPath = resolve(portalRoot, "assets", "card", "card-admin.js");

for (const path of [publicPagePath, managePagePath, publicScriptPath, manageScriptPath]) {
  assert.equal(existsSync(path), true, `missing file: ${path}`);
}

const publicPage = readFileSync(publicPagePath, "utf8");
assert.match(publicPage, /김영희/);
assert.match(publicPage, /대표 <span aria-hidden="true">·<\/span> 이사/);
assert.match(publicPage, /특성화고 교육지원 시스템/);
assert.match(publicPage, /공직시험 연구소/);
assert.match(publicPage, /디지털 프로젝트 스튜디오/);
assert.match(publicPage, /data-save-contact/);
assert.match(publicPage, /data-open-exchange/);
assert.match(publicPage, /data-show-qr/);
assert.match(publicPage, /data-qr-dialog/);
assert.match(publicPage, /카카오톡·문자로 보내기/);
assert.match(publicPage, /개인정보 수집·이용에 동의합니다/);
assert.match(publicPage, /교환일로부터 3년/);
const identityBlock = publicPage.match(/<section class="identity">([\s\S]*?)<\/section>/)?.[1] || "";
assert.doesNotMatch(identityBlock, /mode-label|class="company"/);
assert.match(identityBlock, /name-wordmark/);

const publicScript = readFileSync(publicScriptPath, "utf8");
assert.match(publicScript, /BEGIN:VCARD/);
assert.match(publicScript, /\/api\/card\/exchange/);
assert.match(publicScript, /source/);
assert.match(publicScript, /mode/);
assert.match(publicScript, /new URL\(window\.location\.href\)/);
assert.match(publicScript, /QR_VARIANTS/);
assert.match(publicScript, /buildOfficialUrl/);
for (const mode of ["general", "vocational", "exam", "studio"]) {
  assert.match(publicPage, new RegExp(`data-qr-mode="${mode}"`));
  assert.match(publicScript, new RegExp(`${mode}: \\{`));
}

const managePage = readFileSync(managePagePath, "utf8");
const manageScript = readFileSync(manageScriptPath, "utf8");
for (const name of ["qr-general.png", "qr-vocational.png", "qr-exam.png", "qr-studio.png"]) {
  assert.match(managePage, new RegExp(name.replace(".", "\\.")));
  const imagePath = resolve(portalRoot, "assets", "card", name);
  assert.equal(existsSync(imagePath), true, `missing QR: ${name}`);
  const bytes = readFileSync(imagePath);
  assert.equal(bytes.subarray(1, 4).toString("ascii"), "PNG", `invalid PNG: ${name}`);
  assert.equal(bytes.readUInt32BE(16), 720, `unexpected QR width: ${name}`);
  assert.equal(bytes.readUInt32BE(20), 720, `unexpected QR height: ${name}`);
}
assert.match(manageScript, /\/api\/admin\/card\/contacts/);
assert.match(manageScript, /CSV 내보내기|exportCsv/);

for (const [htmlPath, html] of [[publicPagePath, publicPage], [managePagePath, managePage]]) {
  const references = [...html.matchAll(/(?:src|href)="([^"#?]+)"/g)].map((match) => match[1]);
  for (const reference of references) {
    if (/^(?:https?:|mailto:|tel:)/.test(reference) || reference === "./" || reference.endsWith("/")) continue;
    const localPath = resolve(dirname(htmlPath), reference);
    assert.equal(existsSync(localPath), true, `broken local reference: ${reference} in ${htmlPath}`);
  }
}

console.log("verify-digital-card: ok");
