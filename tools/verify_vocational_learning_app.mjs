import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const root = process.cwd();
const failures = [];
const checks = [];
const remoteAppUrl = "https://neojoin1-cyber.github.io/gyo6-jobskill/";
const minimumRemoteVersion = "4.0.2";
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

checks.push({ label: "emergency fallback bundle contains 175 files", ok: bundleFiles.length === 175 });
checks.push({ label: "emergency fallback contains 51 MP3 files", ok: audioFiles.length === 51 });
if (bundleFiles.length !== 175) failures.push("bundle file count: " + bundleFiles.length);
if (audioFiles.length !== 51) failures.push("MP3 count: " + audioFiles.length);

for (const file of [
  "apps/sugar-salt/assets/index-ECreyGAB.js",
  "apps/sugar-salt/assets/index-CwxqAxyO.css",
  "apps/sugar-salt/images/campus/skill-campus-map.png",
]) {
  const ok = fs.existsSync(path.join(root, file));
  checks.push({ label: file + " exists", ok });
  if (!ok) failures.push("missing " + file);
}

for (const obsoleteFile of [
  "apps/sugar-salt/assets/index-BKl2WvT-.js",
  "apps/sugar-salt/assets/trial-responsive.css",
]) {
  const ok = !fs.existsSync(path.join(root, obsoleteFile));
  checks.push({ label: obsoleteFile + " was removed", ok });
  if (!ok) failures.push("obsolete bundle file remains " + obsoleteFile);
}

for (const file of ["vocational.html", "learning-app.html", "assets/site.css", "apps/sugar-salt/index.html", "apps/sugar-salt/sw.js"]) {
  const ok = fs.existsSync(path.join(root, file));
  checks.push({ label: file + " exists", ok });
  if (!ok) failures.push("missing " + file);
}

requireText("vocational.html", "설탕과소금앱", "app-led hero");
requireText("vocational.html", "취업 우수반의 실전", "advanced employment track");
requireText("vocational.html", "앱만 건네지 않습니다", "teacher tool narrative");
requireText("vocational.html", "learning-app.html#trial-accounts", "trial deep link");
requireText("vocational.html", "직업공통능력 인증평가", "MOE job common competency");
requireText("vocational.html", "NCS 직업공통능력평가", "NCS common competency");
requireText("vocational.html", "고졸 채용 면접·자소서 스킬", "high school interview and cover letter skills");
requireText("vocational.html", "고졸 채용 인성평가 훈련", "high school recruitment personality assessment training");
requireText("vocational.html", "인증평가 준비가 막막할 때", "teacher certification pain point");
requireText("vocational.html", "우수 취업처 필기를 제대로 준비하려면", "teacher advanced employment pain point");
requireText("vocational.html", "면접과 자소서를 실전처럼 훈련하려면", "teacher interview and cover letter pain point");
requireText("vocational.html", "인성평가가 힘든 학생을 돕고 싶다면", "teacher personality assessment pain point");
requireText("vocational.html", "vh-product-statement", "restrained app statement");
requireText("vocational.html", "vocational-app-student-catalog.png", "readable student catalog capture");
requireText("vocational.html", "vocational-app-teacher-dashboard.png", "readable teacher dashboard capture");
requireText("vocational.html", "교사 운영 대시보드", "teacher dashboard caption");
requireText("vocational.html", "학생 교재 목록", "student catalog caption");

for (const role of ["student", "teacher"]) requireText("learning-app.html", `data-trial="${role}"`, `${role} one-click trial`);
requireText("learning-app.html", "학생 체험 시작", "student trial label");
requireText("learning-app.html", "교사 체험 시작", "teacher trial label");
requireText("learning-app.html", "?trial=${role}&trial_nonce=${Date.now()}", "isolated role trial URL");
requireText("learning-app.html", "계정 입력 없이 15분간 체험할 수 있습니다.", "15 minute no-account guide");
requireText("learning-app.html", "체험 내용은 저장되지 않으며 실제 학교 데이터와 분리됩니다.", "no-save isolation guide");
requireText("learning-app.html", "정규 수업과 학습 기록 저장은 학교 계정에서 이용합니다.", "school account guide");
forbidText("learning-app.html", "demo.student@sugarsalt.kr");
forbidText("learning-app.html", "demo.teacher@sugarsalt.kr");
forbidText("learning-app.html", "demo.admin@sugarsalt.kr");
forbidText("learning-app.html", "sugarsalt2026");
forbidText("learning-app.html", "아이디+비밀번호 복사");
requireText("learning-app.html", "trial-workspace", "one-screen trial workspace");
requireText("learning-app.html", "trial-launcher", "two-button trial launcher");
requireText("learning-app.html", "trial-app-panel", "inline live app panel");
requireText("learning-app.html", `src="${remoteAppUrl}"`, "approved remote app iframe");
requireText("learning-app.html", `href="${remoteAppUrl}"`, "approved remote app direct link");
{
  const html = read("learning-app.html");
  const appFirst = html.indexOf('class="trial-app-panel"') < html.indexOf('class="trial-console"');
  checks.push({ label: "live app appears before account guidance", ok: appFirst });
  if (!appFirst) failures.push("learning-app.html: live app must precede account guidance");
}
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

const versionAtLeast = (actual, minimum) => {
  const left = String(actual).split(".").map(Number);
  const right = String(minimum).split(".").map(Number);
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const difference = (left[index] || 0) - (right[index] || 0);
    if (difference !== 0) return difference > 0;
  }
  return true;
};

try {
  const response = await fetch(`${remoteAppUrl}version.json`, {
    headers: { "Cache-Control": "no-cache" },
  });
  const release = response.ok ? await response.json() : {};
  const validRelease = response.ok
    && versionAtLeast(release.version, minimumRemoteVersion)
    && release.supabaseResponseCache === false;
  checks.push({ label: `remote app ${minimumRemoteVersion}+ is approved and auth response cache is disabled`, ok: validRelease });
  if (!validRelease) failures.push(`remote release invalid: HTTP ${response.status}, version ${release.version || "unknown"}`);
} catch (error) {
  checks.push({ label: "remote app release metadata is reachable", ok: false });
  failures.push(`remote release check failed: ${error.message}`);
}

for (const check of checks) console.log((check.ok ? "PASS" : "FAIL") + " " + check.label);
console.log("SUMMARY checks=" + checks.length + " failed=" + failures.length);
if (failures.length) {
  failures.forEach((failure) => console.error("- " + failure));
  process.exitCode = 1;
}
