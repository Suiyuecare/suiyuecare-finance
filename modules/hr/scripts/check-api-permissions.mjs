import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

const root = process.cwd();
const routeFiles = await findRouteFiles(join(root, "src/app/api"));
const allowedGuards = [
  "withApiPermission(",
  "withCronOrApiPermission(",
  "requireCronRequest(",
  "requireApiPermission(",
];

const missing = [];

for (const file of routeFiles) {
  const source = await readFile(join(root, file), "utf8");
  const hasHttpHandler = /export\s+async\s+function\s+(GET|POST|PUT|PATCH|DELETE)\s*\(/.test(source);
  const hasGuard = allowedGuards.some((guard) => source.includes(guard));
  if (hasHttpHandler && !hasGuard) {
    missing.push(file);
  }
}

if (missing.length) {
  console.error("API routes missing permission or cron guard:");
  for (const file of missing) {
    console.error(`- ${file}`);
  }
  process.exit(1);
}

console.log(`API permission scan passed: ${routeFiles.length} route file(s) checked.`);

async function findRouteFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...await findRouteFiles(fullPath));
    } else if (entry.isFile() && entry.name === "route.ts") {
      files.push(fullPath.replace(`${root}/`, ""));
    }
  }

  return files.sort();
}
