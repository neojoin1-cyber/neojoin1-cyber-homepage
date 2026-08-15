import { execFileSync } from "node:child_process";
import process from "node:process";

const REQUIRED_PROJECT = Object.freeze({
  ref: "lpxbfggwptsmxdxvnwhy",
  organizationId: "txibanlbpfhhootyxxqt",
  organizationName: "imyong-service",
  plan: "Pro",
  minimumCompute: "Micro",
});
const REQUIRED_EMAIL_SECRETS = Object.freeze([
  "BREVO_API_KEY",
  "REVIEW_EMAIL_ENABLED",
  "REVIEW_EMAIL_FROM",
  "REVIEW_OPERATIONS_EMAIL",
  "REVIEW_ALLOWED_ORIGINS",
  "REVIEW_APP_URL",
]);
const REVIEW_FUNCTION_URL = `https://${REQUIRED_PROJECT.ref}.supabase.co/functions/v1/review-content`;
const REVIEW_ORIGIN = "https://gyo6.kr";

function fail(message) {
  console.error(`FAIL review.production-infrastructure - ${message}`);
  process.exit(1);
}

let result;
try {
  const executable = process.platform === "win32" ? (process.env.ComSpec || "cmd.exe") : "npx";
  const args = process.platform === "win32"
    ? ["/d", "/s", "/c", "npx --yes supabase@latest projects list --output-format json"]
    : ["--yes", "supabase@latest", "projects", "list", "--output-format", "json"];
  const output = execFileSync(executable, args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  result = JSON.parse(output);
} catch (error) {
  fail(`Supabase 운영 프로젝트를 확인할 수 없습니다: ${error.message}`);
}

const projects = Array.isArray(result) ? result : result.projects;
if (!Array.isArray(projects)) fail("Supabase CLI 응답 형식을 확인할 수 없습니다.");

const project = projects.find((item) => item.ref === REQUIRED_PROJECT.ref || item.id === REQUIRED_PROJECT.ref);
if (!project) fail(`운영 프로젝트 ${REQUIRED_PROJECT.ref}가 현재 계정에 연결되어 있지 않습니다.`);
if (project.organization_id !== REQUIRED_PROJECT.organizationId) {
  fail(
    `운영 프로젝트가 유료 ${REQUIRED_PROJECT.organizationName} ${REQUIRED_PROJECT.plan} 조직이 아닌 ` +
    `${project.organization_id || "알 수 없는 조직"}에 연결되어 있습니다. 배포를 중단합니다.`,
  );
}
if (project.status !== "ACTIVE_HEALTHY") {
  fail(`운영 프로젝트 상태가 ${project.status || "UNKNOWN"}입니다. 정상화 전에는 배포하거나 검수를 시작할 수 없습니다.`);
}

let secretRows;
try {
  const executable = process.platform === "win32" ? (process.env.ComSpec || "cmd.exe") : "npx";
  const args = process.platform === "win32"
    ? ["/d", "/s", "/c", `npx --yes supabase@latest secrets list --project-ref ${REQUIRED_PROJECT.ref} --output json`]
    : ["--yes", "supabase@latest", "secrets", "list", "--project-ref", REQUIRED_PROJECT.ref, "--output", "json"];
  secretRows = JSON.parse(execFileSync(executable, args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }));
} catch (error) {
  fail(`운영 인증메일 비밀키 구성을 확인할 수 없습니다: ${error.message}`);
}
const secretNames = new Set((Array.isArray(secretRows) ? secretRows : []).map((item) => item.name));
const missingSecrets = REQUIRED_EMAIL_SECRETS.filter((name) => !secretNames.has(name));
if (missingSecrets.length) fail(`운영 인증메일 필수 비밀키가 누락되었습니다: ${missingSecrets.join(", ")}`);

let publicRouteResponse;
try {
  publicRouteResponse = await fetch(REVIEW_FUNCTION_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: REVIEW_ORIGIN },
    body: JSON.stringify({ action: "deploymentPublicRouteProbe" }),
    signal: AbortSignal.timeout(10_000),
  });
} catch (error) {
  fail(`로그인 전 인증 함수 경로에 연결할 수 없습니다: ${error.message}`);
}
const publicRouteBody = await publicRouteResponse.json().catch(() => ({}));
const publicRouteOrigin = publicRouteResponse.headers.get("access-control-allow-origin");
if (publicRouteResponse.status !== 401 || publicRouteBody.error !== "로그인이 필요합니다." || publicRouteOrigin !== REVIEW_ORIGIN) {
  fail(
    `로그인 전 인증 경로가 함수 내부에 도달하지 않습니다. ` +
    `HTTP ${publicRouteResponse.status}, CORS ${publicRouteOrigin || "없음"}. ` +
    `review-content를 --no-verify-jwt로 다시 배포해야 합니다.`,
  );
}

console.log(
  `PASS review.production-infrastructure - ${REQUIRED_PROJECT.organizationName} ${REQUIRED_PROJECT.plan} 조직 · ` +
  `${project.name} · ${project.status}`,
);
console.log(
  `REQUIRED review.production-compute - Supabase Infrastructure에서 ${REQUIRED_PROJECT.minimumCompute} 이상을 확인해야 합니다.`,
);
console.log(
  `PASS review.production-email-secrets - 운영 인증메일 필수 비밀키 ${REQUIRED_EMAIL_SECRETS.length}개가 모두 설정되어 있습니다.`,
);
console.log(
  "PASS review.production-public-auth-route - 로그인 전 인증번호 요청이 Supabase 게이트웨이에 차단되지 않고 함수 내부 보안검사까지 도달합니다.",
);
