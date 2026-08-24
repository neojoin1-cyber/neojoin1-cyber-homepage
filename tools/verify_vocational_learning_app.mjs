import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const root = process.cwd();
const failures = [];
const checks = [];
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const requireText = (file, value, label = value) => {
  const ok = read(file).includes(value);
  checks.push({ label, ok });
  if (!ok) failures.push(file + ": " + label);
};
const forbidText = (file, value) => {
  const ok = !read(file).includes(value);
  checks.push({ label: file + " excludes \"" + value + "\"", ok });
  if (!ok) failures.push(file + ": forbidden \"" + value + "\"");
};

const bundleRoot = path.join(root, "apps", "sugar-salt");
const bundleFiles = fs.readdirSync(bundleRoot, { recursive: true, withFileTypes: true })
  .filter((entry) => entry.isFile())
  .map((entry) => path.join(entry.parentPath ?? entry.path, entry.name));
const audioFiles = bundleFiles.filter((file) => file.toLowerCase().endsWith(".mp3"));

checks.push({ label: "learning app bundle contains 109 files", ok: bundleFiles.length === 109 });
checks.push({ label: "learning app bundle contains 51 MP3 files", ok: audioFiles.length === 51 });
if (bundleFiles.length !== 109) failures.push("bundle file count: " + bundleFiles.length);
if (audioFiles.length !== 51) failures.push("MP3 count: " + audioFiles.length);

for (const file of ["vocational.html", "learning-app.html", "assets/site.css", "apps/sugar-salt/index.html", "apps/sugar-salt/sw.js"]) {
  const ok = fs.existsSync(path.join(root, file));
  checks.push({ label: file + " exists", ok });
  if (!ok) failures.push("missing " + file);
}

requireText("vocational.html", "필수 취업교육 4영역", "app-led hero");
requireText("vocational.html", "취업 우수반의 실전", "advanced employment track");
requireText("vocational.html", "앱만 건네지 않습니다", "teacher tool narrative");
requireText("vocational.html", "learning-app.html#trial-accounts", "trial deep link");
requireText("vocational.html", "직업공통능력 인증평가", "MOE job common competency");
requireText("vocational.html", "NCS 직업공통능력평가", "NCS common competency");
requireText("vocational.html", "고졸 채용 면접스킬", "high school interview skills");
requireText("vocational.html", "모의 인성평가", "mock personality assessment");
requireText("vocational.html", "vocational-app-student-catalog.png", "student catalog capture");
requireText("vocational.html", "vocational-app-teacher-dashboard.png", "teacher dashboard capture");

for (const account of [
  "demo.student@sugarsalt.kr",
  "demo.teacher@sugarsalt.kr",
  "demo.admin@sugarsalt.kr",
]) requireText("learning-app.html", account, account);
requireText("learning-app.html", "sugarsalt2026", "shared password");
requireText("learning-app.html", "가로 화면", "teacher landscape guide");
requireText("learning-app.html", "듣기 문항에서 사람 음성 재생", "student listening guide");
requireText("learning-app.html", "주기적으로 초기화", "shared record reset caution");
requireText("learning-app.html", "개인정보를 입력하지 마세요", "personal data caution");
requireText("learning-app.html", "아이디+비밀번호 복사", "copy control");
forbidText("vocational.html", "무료 체험");
forbidText("vocational.html", "무료 가입");
forbidText("learning-app.html", "무료 체험");
forbidText("learning-app.html", "무료 가입");
forbidText("learning-app.html", "Google Play");

for (const file of ["vocational.html", "learning-app.html"]) {
  const html = read(file);
  for (const match of html.matchAll(/(?:src|href)="([^"#?]+)"/g)) {
    const ref = match[1];
    if (/^(?:https?:|mailto:|tel:)/.test(ref) || ref.endsWith(".html")) continue;
    const resolved = path.resolve(path.dirname(path.join(root, file)), ref);
    if (!fs.existsSync(resolved)) failures.push(file + ": missing local reference " + ref);
  }
}

for (const check of checks) console.log((check.ok ? "PASS" : "FAIL") + " " + check.label);
console.log("SUMMARY checks=" + checks.length + " failed=" + failures.length);
if (failures.length) {
  failures.forEach((failure) => console.error("- " + failure));
  process.exitCode = 1;
}
