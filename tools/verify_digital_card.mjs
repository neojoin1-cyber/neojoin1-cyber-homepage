import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";


const portalRoot = resolve(import.meta.dirname, "..");
const publicPagePath = resolve(portalRoot, "card", "kim-younghee", "index.html");
const managePagePath = resolve(portalRoot, "card", "manage.html");
const publicScriptPath = resolve(portalRoot, "assets", "card", "card.js");
const manageScriptPath = resolve(portalRoot, "assets", "card", "card-admin.js");
const lockupPath = resolve(portalRoot, "assets", "card", "sugar-salt-lockup.svg");
const contactPhotoPath = resolve(portalRoot, "assets", "card", "kim-younghee-contact-executive-v5.jpg");
const contactLogoPath = resolve(portalRoot, "brand", "logo", "png", "app-icon-512.png");
const ownerManifestPath = resolve(portalRoot, "card", "kim-younghee", "owner.webmanifest");
const parkPagePath = resolve(portalRoot, "card", "park-gyehyeon", "index.html");
const parkManifestPath = resolve(portalRoot, "card", "park-gyehyeon", "owner.webmanifest");
const parkStylePath = resolve(portalRoot, "assets", "card", "park-gyehyeon.css");
const parkHeroPath = resolve(portalRoot, "assets", "card", "park-gyehyeon-executive-hero-v1.jpg");
const parkContactPath = resolve(portalRoot, "assets", "card", "park-gyehyeon-contact-v1.jpg");
const parkLogoPath = resolve(portalRoot, "assets", "card", "gyeongju-girls-information-high-school-logo.png");
const parkQrPath = resolve(portalRoot, "assets", "card", "qr-park-gyehyeon.png");

for (const path of [publicPagePath, managePagePath, publicScriptPath, manageScriptPath, lockupPath, contactPhotoPath, contactLogoPath, ownerManifestPath, parkPagePath, parkManifestPath, parkStylePath, parkHeroPath, parkContactPath, parkLogoPath, parkQrPath]) {
  assert.equal(existsSync(path), true, `missing file: ${path}`);
}

const publicPage = readFileSync(publicPagePath, "utf8");
assert.match(publicPage, /김영희/);
assert.match(publicPage, /유한회사 설탕과소금 홈페이지/);
assert.match(publicPage, /대표 <span aria-hidden="true">·<\/span> 이사/);
assert.match(publicPage, /특성화고 교육지원 시스템/);
assert.match(publicPage, /공직시험 연구소/);
assert.match(publicPage, /디지털 프로젝트 스튜디오/);
assert.match(publicPage, /data-save-contact/);
assert.match(publicPage, /data-open-exchange/);
assert.match(publicPage, /data-show-qr/);
assert.match(publicPage, /data-install-card/);
assert.match(publicPage, /data-install-dialog/);
assert.match(publicPage, /owner\.webmanifest/);
assert.match(publicPage, /rel="apple-touch-icon"/);
assert.match(publicPage, /data-show-qr hidden/);
assert.match(publicPage, /data-qr-dialog/);
assert.match(publicPage, /카카오톡·문자로 보내기/);
assert.match(publicPage, /개인정보 수집·이용에 동의합니다/);
assert.match(publicPage, /교환일로부터 3년/);
const identityBlock = publicPage.match(/<section class="identity">([\s\S]*?)<\/section>/)?.[1] || "";
assert.doesNotMatch(identityBlock, /mode-label|class="company"/);
assert.match(identityBlock, /name-wordmark/);
assert.match(readFileSync(lockupPath, "utf8"), /유한회사 설탕과소금/);

const publicScript = readFileSync(publicScriptPath, "utf8");
assert.match(publicScript, /BEGIN:VCARD/);
assert.match(publicScript, /\/api\/card\/exchange/);
assert.match(publicScript, /source/);
assert.match(publicScript, /mode/);
assert.match(publicScript, /new URL\(window\.location\.href\)/);
assert.match(publicScript, /QR_VARIANTS/);
assert.match(publicScript, /buildOfficialUrl/);
assert.match(publicScript, /PHOTO;ENCODING=b;TYPE=JPEG/);
assert.match(publicScript, /LOGO;VALUE=uri/);
assert.doesNotMatch(publicScript, /LOGO;ENCODING=b/);
assert.match(publicScript, /foldVcardLine/);
assert.match(publicScript, /kim-younghee-contact-executive-v5\.jpg/);
assert.match(publicScript, /new Blob\(\[await buildVcard\(\)\], \{ type: "text\/vcard" \}\)/);
assert.doesNotMatch(publicScript, /new Blob\(\["\\ufeff"/);
assert.match(publicScript, /kim-younghee-gyo6\.vcf/);
assert.match(publicScript, /URL\.revokeObjectURL\(url\), 60000/);
assert.match(publicScript, /OWNER_STORAGE_KEY/);
assert.match(publicScript, /source === "owner"/);
assert.match(publicScript, /searchParams\.set\("src", "owner"\)/);
assert.match(publicScript, /dataset\.cardView = isOwnerView \? "owner" : "visitor"/);
assert.match(publicScript, /beforeinstallprompt/);
assert.match(publicScript, /display-mode: standalone/);
assert.ok(readFileSync(contactPhotoPath).byteLength < 100_000, "contact photo must stay lightweight");
assert.ok(readFileSync(contactLogoPath).byteLength < 100_000, "contact logo must stay lightweight");
const ownerManifest = JSON.parse(readFileSync(ownerManifestPath, "utf8"));
assert.equal(ownerManifest.id, "/card/kim-younghee/owner-card");
assert.equal(ownerManifest.start_url, "/card/kim-younghee/?src=owner");
assert.equal(ownerManifest.display, "standalone");
assert.deepEqual(ownerManifest.icons.map((icon) => icon.sizes), ["192x192", "512x512"]);
assert.equal(ownerManifest.shortcuts.length, 4);
for (const mode of ["general", "vocational", "exam", "studio"]) {
  assert.match(publicPage, new RegExp(`data-qr-mode="${mode}"`));
  assert.match(publicScript, new RegExp(`${mode}: \\{`));
}

const parkPage = readFileSync(parkPagePath, "utf8");
assert.match(parkPage, /박계현/);
assert.match(parkPage, /경주여자정보고등학교/);
assert.match(parkPage, /도제교육부장/);
assert.match(parkPage, /산학일체형 도제교육/);
assert.match(parkPage, /기업연계 현장교육/);
assert.match(parkPage, /학생 진로·취업 성장 지원/);
assert.match(parkPage, /data-save-contact/);
assert.match(parkPage, /data-show-qr hidden/);
assert.match(parkPage, /data-install-card hidden/);
assert.match(parkPage, /window\.CARD_PROFILE/);
assert.match(parkPage, /park-gyehyeon-contact-v1\.jpg/);
assert.match(parkPage, /qr-park-gyehyeon\.png/);
assert.doesNotMatch(parkPage, /data-open-exchange/);
assert.ok(readFileSync(parkContactPath).byteLength < 100_000, "Park contact photo must stay lightweight");
const parkManifest = JSON.parse(readFileSync(parkManifestPath, "utf8"));
assert.equal(parkManifest.id, "/card/park-gyehyeon/owner-profile");
assert.equal(parkManifest.start_url, "/card/park-gyehyeon/?src=owner");
assert.equal(parkManifest.display, "standalone");
assert.deepEqual(parkManifest.icons.map((icon) => icon.sizes), ["640x640"]);
assert.equal(readFileSync(parkQrPath).subarray(1, 4).toString("ascii"), "PNG");
assert.equal(readFileSync(parkQrPath).readUInt32BE(16), 720);
assert.equal(readFileSync(parkQrPath).readUInt32BE(20), 720);

const managePage = readFileSync(managePagePath, "utf8");
const manageScript = readFileSync(manageScriptPath, "utf8");
assert.match(managePage, /kim-younghee\/\?src=owner/);
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

for (const [htmlPath, html] of [[publicPagePath, publicPage], [parkPagePath, parkPage], [managePagePath, managePage]]) {
  const references = [...html.matchAll(/(?:src|href)="([^"#?]+)"/g)].map((match) => match[1]);
  for (const reference of references) {
    if (/^(?:https?:|mailto:|tel:)/.test(reference) || reference === "./" || reference.endsWith("/")) continue;
    const localPath = resolve(dirname(htmlPath), reference);
    assert.equal(existsSync(localPath), true, `broken local reference: ${reference} in ${htmlPath}`);
  }
}

console.log("verify-digital-card: ok");
