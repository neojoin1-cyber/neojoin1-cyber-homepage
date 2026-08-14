import { execFileSync } from "node:child_process";
import process from "node:process";

const REQUIRED_PROJECT = Object.freeze({
  ref: "lpxbfggwptsmxdxvnwhy",
  organizationId: "txibanlbpfhhootyxxqt",
  organizationName: "imyong-service",
  plan: "Pro",
  minimumCompute: "Micro",
});

function fail(message) {
  console.error(`FAIL review.production-infrastructure - ${message}`);
  process.exit(1);
}

let result;
try {
  const executable = process.platform === "win32" ? (process.env.ComSpec || "cmd.exe") : "supabase";
  const args = process.platform === "win32"
    ? ["/d", "/s", "/c", "supabase projects list --output-format json"]
    : ["projects", "list", "--output-format", "json"];
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

console.log(
  `PASS review.production-infrastructure - ${REQUIRED_PROJECT.organizationName} ${REQUIRED_PROJECT.plan} 조직 · ` +
  `${project.name} · ${project.status}`,
);
console.log(
  `REQUIRED review.production-compute - Supabase Infrastructure에서 ${REQUIRED_PROJECT.minimumCompute} 이상을 확인해야 합니다.`,
);
