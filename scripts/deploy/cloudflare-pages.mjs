import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const OUTPUT_DIR = resolve(".vercel/output/static");
const WRANGLER_CONFIG_PATH = resolve("wrangler.json");
const WRANGLER_EXAMPLE_PATH = resolve("wrangler.example.json");
const TEMP_WRANGLER_CONFIG_PATH = resolve(".wrangler.pages.generated.json");

const PROJECT_NAME =
  process.env.PROJECT_NAME ||
  process.env.CF_PAGES_PROJECT_NAME ||
  process.env.CLOUDFLARE_PAGES_PROJECT_NAME ||
  "moemail";

const BRANCH =
  process.env.CF_PAGES_BRANCH ||
  process.env.BRANCH ||
  process.env.VERCEL_GIT_COMMIT_REF ||
  process.env.GITHUB_REF_NAME ||
  "main";

const DATABASE_ID = process.env.DATABASE_ID;
const KV_NAMESPACE_ID = process.env.KV_NAMESPACE_ID;

const run = (command, args) => {
  console.log(`$ ${[command, ...args].join(" ")}`);

  const result = spawnSync(command, args, {
    stdio: "inherit",
    shell: false,
  });

  if (result.status !== 0) {
    throw new Error(`${command} exited with code ${result.status ?? "unknown"}`);
  }
};

const readJson = (filePath) =>
  JSON.parse(readFileSync(filePath, "utf-8"));

const hasPlaceholder = (value, placeholder) =>
  typeof value === "string" && value.includes(`\${${placeholder}}`);

const ensurePagesOutput = () => {
  if (existsSync(OUTPUT_DIR)) {
    return;
  }

  console.log(
    "⚠️ Cloudflare Pages output not found. Running next-on-pages build first..."
  );
  run("pnpm", ["run", "build:pages"]);
};

const createDeployConfig = () => {
  const configSource = existsSync(WRANGLER_CONFIG_PATH)
    ? { path: WRANGLER_CONFIG_PATH, isExample: false }
    : existsSync(WRANGLER_EXAMPLE_PATH)
      ? { path: WRANGLER_EXAMPLE_PATH, isExample: true }
      : null;

  if (!configSource) {
    console.log(
      "⚠️ No wrangler.json or wrangler.example.json found. Deploying with project name only."
    );
    return {
      configPath: null,
      projectName: PROJECT_NAME,
    };
  }

  const config = readJson(configSource.path);
  config.pages_build_output_dir = ".vercel/output/static";
  config.name = process.env.PROJECT_NAME || config.name || PROJECT_NAME;

  if (Array.isArray(config.d1_databases)) {
    config.d1_databases = config.d1_databases.filter((database) => {
      if (!hasPlaceholder(database.database_id, "DATABASE_ID")) {
        return true;
      }

      if (DATABASE_ID) {
        database.database_id = DATABASE_ID;
        return true;
      }

      if (configSource.isExample) {
        console.log(
          "⚠️ DATABASE_ID is not set. Skipping D1 binding from generated Pages config."
        );
        return false;
      }

      throw new Error(
        "wrangler.json still contains ${DATABASE_ID}. Set DATABASE_ID or replace the placeholder in wrangler.json."
      );
    });
  }

  if (Array.isArray(config.kv_namespaces)) {
    config.kv_namespaces = config.kv_namespaces.filter((namespace) => {
      if (!hasPlaceholder(namespace.id, "KV_NAMESPACE_ID")) {
        return true;
      }

      if (KV_NAMESPACE_ID) {
        namespace.id = KV_NAMESPACE_ID;
        return true;
      }

      if (configSource.isExample) {
        console.log(
          "⚠️ KV_NAMESPACE_ID is not set. Skipping KV binding from generated Pages config."
        );
        return false;
      }

      throw new Error(
        "wrangler.json still contains ${KV_NAMESPACE_ID}. Set KV_NAMESPACE_ID or replace the placeholder in wrangler.json."
      );
    });
  }

  writeFileSync(TEMP_WRANGLER_CONFIG_PATH, `${JSON.stringify(config, null, 2)}\n`);
  return {
    configPath: TEMP_WRANGLER_CONFIG_PATH,
    projectName: config.name,
  };
};

const deployPages = () => {
  ensurePagesOutput();

  let generatedConfigPath = null;

  try {
    const { configPath, projectName } = createDeployConfig();
    generatedConfigPath = configPath;

    const args = ["exec", "wrangler"];

    if (generatedConfigPath) {
      args.push("--config", generatedConfigPath);
    }

    args.push(
      "pages",
      "deploy",
      OUTPUT_DIR,
      "--project-name",
      projectName,
      "--branch",
      BRANCH
    );

    run("pnpm", args);
  } finally {
    if (generatedConfigPath && existsSync(generatedConfigPath)) {
      rmSync(generatedConfigPath);
    }
  }
};

deployPages();
