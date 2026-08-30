import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const root = process.cwd();
const failures = [];
const checks = [];
const minimumLocalVersion = "4.8.4";
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
const check = (label, ok, failure = label) => {
  checks.push({ label, ok });
  if (!ok) failures.push(failure);
};

const versionAtLeast = (actual, minimum) => {
  const left = String(actual).split(".").map(Number);
  const right = String(minimum).split(".").map(Number);
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const difference = (left[index] || 0) - (right[index] || 0);
    if (difference !== 0) return difference > 0;
  }
  return true;
};

const bundleRoot = path.join(root, "apps", "sugar-salt");
const bundleFiles = fs.readdirSync(bundleRoot, { recursive: true, withFileTypes: true })
  .filter((entry) => entry.isFile())
  .map((entry) => path.join(entry.parentPath ?? entry.path, entry.name));
const audioFiles = bundleFiles.filter((file) => file.toLowerCase().endsWith(".mp3"));
check("release bundle contains 183 files", bundleFiles.length === 183, "bundle file count: " + bundleFiles.length);
check("release bundle contains 51 MP3 files", audioFiles.length === 51, "MP3 count: " + audioFiles.length);

for (const file of ["vocational.html", "learning-app.html", "assets/site.css", "apps/sugar-salt/index.html", "apps/sugar-salt/manifest.json", "apps/sugar-salt/version.json", "apps/sugar-salt/registerSW.js", "apps/sugar-salt/sw.js"]) {
  check(file + " exists", fs.existsSync(path.join(root, file)), "missing " + file);
}

const appIndex = read("apps/sugar-salt/index.html");
const appReferences = [...appIndex.matchAll(/(?:src|href)="(\/apps\/sugar-salt\/[^"?#]+)"/g)].map((match) => match[1]);
for (const reference of appReferences) {
  const file = reference.replace(/^\/apps\/sugar-salt\//, "apps/sugar-salt/");
  check(file + " exists", fs.existsSync(path.join(root, file)), "missing app reference " + reference);
}
const entryReference = appReferences.find((reference) => /\/assets\/index-[^/]+\.js$/.test(reference));
const cssReference = appReferences.find((reference) => /\/assets\/index-[^/]+\.css$/.test(reference));
check("app index declares a hashed JavaScript entry", Boolean(entryReference));
check("app index declares a hashed stylesheet", Boolean(cssReference));
if (entryReference) {
  const entryText = read(entryReference.replace(/^\/apps\/sugar-salt\//, "apps/sugar-salt/"));
  check("app entry handles entry=member", /entry.{0,24}member/.test(entryText), "member entry handling missing from app entry");
}

const manifest = JSON.parse(read("apps/sugar-salt/manifest.json"));
const release = JSON.parse(read("apps/sugar-salt/version.json"));
check("manifest launches the member entry", manifest.start_url === "./?entry=member", "manifest start_url: " + manifest.start_url);
check("local app " + minimumLocalVersion + "+ is installed", versionAtLeast(release.version, minimumLocalVersion), "local app version: " + release.version);
check("auth response cache is disabled", release.supabaseResponseCache === false);

requireText("vocational.html", "설탕과소금앱", "app-led hero");
requireText("vocational.html", "앱만 건네지 않습니다", "teacher tool narrative");
requireText("vocational.html", "href=\"https://gyo6.kr/learning-app.html#trial-accounts\"", "trial entrance URL");
requireText("vocational.html", "href=\"https://gyo6.kr/apps/sugar-salt/?entry=member\"", "member entrance URL");
requireText("vocational.html", "회원가입 없이 학생·교사 기능 살펴보기", "trial entrance description");
requireText("vocational.html", "로그인하여 학습 기록·학급 지도·기기 간 동기화 사용", "member entrance description");
requireText("vocational.html", "직업공통능력 인증평가", "MOE job common competency");
requireText("vocational.html", "NCS 직업공통능력평가", "NCS common competency");
requireText("vocational.html", "고졸 채용 필기시험", "high school recruitment written exam");
requireText("vocational.html", "면접·자기소개서 실전 작성", "interview and cover letter practice");
requireText("vocational.html", "고졸 채용 인성평가 훈련", "high school recruitment personality assessment training");
requireText("vocational.html", "인증평가 준비가 막막할 때", "teacher certification pain point");
requireText("vocational.html", "우수 취업처 필기를 제대로 준비하려면", "teacher advanced employment pain point");
requireText("vocational.html", "면접과 자소서를 실전처럼 준비하려면", "teacher interview and cover letter pain point");
requireText("vocational.html", "인성평가가 힘든 학생을 돕고 싶다면", "teacher personality assessment pain point");
requireText("vocational.html", "vh-product-statement", "restrained app statement");
requireText("vocational.html", "vocational-app-student-catalog.png", "readable student catalog capture");
requireText("vocational.html", "vocational-app-teacher-dashboard.png", "readable teacher dashboard capture");
requireText("vocational.html", "다학급 운영 대시보드", "teacher dashboard caption");
requireText("vocational.html", "학생 취업 준비 캠퍼스", "student campus caption");
{
  const html = read("vocational.html");
  check("entry dock is inside the app gallery", html.includes('<div class="vh-product-gallery"') && html.indexOf('class="vh-product-gallery"') < html.indexOf('class="vh-entry-grid"') && !html.includes("vh-gallery-cta"));
  for (const href of ["https://gyo6.kr/learning-app.html#trial-accounts", "https://gyo6.kr/apps/sugar-salt/?entry=member"]) {
    const marker = "href=\"" + href + "\"";
    const hrefIndex = html.indexOf(marker);
    const anchorStart = html.lastIndexOf("<a", hrefIndex);
    const anchorEnd = html.indexOf(">", hrefIndex);
    const anchor = hrefIndex >= 0 && anchorStart >= 0 && anchorEnd >= 0 ? html.slice(anchorStart, anchorEnd + 1) : "";
    check(href + " uses same-window navigation", Boolean(anchor) && !/\btarget=/.test(anchor));
  }
}

for (const role of ["student", "teacher"]) requireText("learning-app.html", "data-trial=\"" + role + "\"", role + " one-click trial");
requireText("learning-app.html", "학생 체험 시작", "student trial label");
requireText("learning-app.html", "교사 체험 시작", "teacher trial label");
requireText("learning-app.html", "?trial=$" + "{role}&trial_nonce=$" + "{Date.now()}", "isolated role trial URL");
requireText("learning-app.html", "제작·검수 기간에는 시간 제한 없이 체험할 수 있습니다.", "unlimited review guide");
requireText("learning-app.html", "체험 내용은 저장되지 않으며 실제 학교 데이터와 분리됩니다.", "no-save isolation guide");
requireText("learning-app.html", "정규 수업과 학습 기록 저장·기기 동기화는 학교 계정에서 이용합니다.", "school account guide");
requireText("learning-app.html", "src=\"apps/sugar-salt/\"", "same-origin app iframe");
requireText("learning-app.html", "href=\"apps/sugar-salt/\"", "same-origin app direct link");
forbidText("learning-app.html", "demo.student@sugarsalt.kr");
forbidText("learning-app.html", "demo.teacher@sugarsalt.kr");
forbidText("learning-app.html", "demo.admin@sugarsalt.kr");
forbidText("learning-app.html", "sugarsalt2026");
forbidText("learning-app.html", "아이디+비밀번호 복사");
requireText("learning-app.html", "trial-workspace", "one-screen trial workspace");
requireText("learning-app.html", "trial-launcher", "two-button trial launcher");
requireText("learning-app.html", "trial-app-panel", "inline live app panel");
{
  const html = read("learning-app.html");
  const appFirst = html.indexOf("class=\"trial-app-panel\"") < html.indexOf("class=\"trial-console\"");
  check("live app appears before trial guidance", appFirst, "learning-app.html: live app must precede trial guidance");
}
forbidText("vocational.html", "무료 체험");
forbidText("vocational.html", "무료 가입");
forbidText("learning-app.html", "무료 체험");
forbidText("learning-app.html", "무료 가입");
forbidText("learning-app.html", "Google Play");

for (const file of ["vocational.html", "learning-app.html"]) {
  const html = read(file);
  for (const match of html.matchAll(/(?:src|href)="([^"#?]+)"/g)) {
    const reference = match[1];
    if (/^(?:https?:|mailto:|tel:)/.test(reference) || reference.endsWith(".html")) continue;
    const resolved = path.resolve(path.dirname(path.join(root, file)), reference);
    if (!fs.existsSync(resolved)) failures.push(file + ": missing local reference " + reference);
  }
}

for (const result of checks) console.log((result.ok ? "PASS" : "FAIL") + " " + result.label);
console.log("SUMMARY checks=" + checks.length + " failed=" + failures.length);
if (failures.length) {
  failures.forEach((failure) => console.error("- " + failure));
  process.exitCode = 1;
}
