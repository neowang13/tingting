#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { resolve, relative, isAbsolute } from "node:path";
import { pathToFileURL } from "node:url";
import { TingTingApiClient } from "./api-client.mjs";
import { validateWithSchema } from "./json-schema.mjs";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const commands = new Map([
  ["health", { method: "GET", path: () => "/health" }],
  ["rentals list", { method: "GET", path: () => "/rentals", query: true }],
  ["rentals get", { method: "GET", path: ({ id }) => `/rentals/${id}`, id: true }],
  ["rentals create-draft", { method: "POST", path: () => "/rentals", input: true, mutation: true }],
  ["rentals update-draft", { method: "PATCH", path: ({ id }) => `/rentals/${id}`, id: true, input: true, mutation: true }],
  ["rentals preview-status", { method: "POST", path: ({ id }) => `/rentals/${id}/status-previews`, id: true, input: true, mutation: true }],
  ["tenants search", { method: "GET", path: () => "/tenants", query: true }],
  ["tenants get", { method: "GET", path: ({ id }) => `/tenants/${id}`, id: true }],
  ["tenants create", { method: "POST", path: () => "/tenants", input: true, mutation: true }],
  ["tenants update", { method: "PATCH", path: ({ id }) => `/tenants/${id}`, id: true, input: true, mutation: true }],
  ["tenants preview-permission", { method: "POST", path: ({ id }) => `/tenants/${id}/permission-previews`, id: true, input: true, mutation: true }],
  ["imports get", { method: "GET", path: ({ id }) => `/tenant-imports/${id}`, id: true }],
  ["imports rows", { method: "GET", path: ({ id }) => `/tenant-imports/${id}/rows`, id: true, query: true }],
  ["imports preview-commit", { method: "POST", path: ({ id }) => `/tenant-imports/${id}/commit-previews`, id: true, input: true, mutation: true }],
  ["schedules get", { method: "GET", path: ({ tenantId }) => `/tenants/${tenantId}/schedule`, tenantId: true }],
  ["schedules save-disabled", { method: "PUT", path: ({ tenantId }) => `/tenants/${tenantId}/schedule`, tenantId: true, input: true, mutation: true }],
  ["schedules preview-status", { method: "POST", path: ({ tenantId }) => `/tenants/${tenantId}/schedule-status-previews`, tenantId: true, input: true, mutation: true }],
  ["confirmations execute", { method: "POST", path: ({ id }) => `/confirmations/${id}/execute`, id: true, input: true, mutation: true }],
  ["jobs get", { method: "GET", path: ({ id }) => `/jobs/${id}`, id: true }]
]);

const schemaUrls = {
  "rentals create-draft": new URL("../schemas/rental-draft.schema.json", import.meta.url),
  "imports create": new URL("../schemas/tenant-import-request.schema.json", import.meta.url),
  "schedules save-disabled": new URL("../schemas/schedule.schema.json", import.meta.url),
  "confirmations execute": new URL("../schemas/confirmation.schema.json", import.meta.url)
};

function parseArgv(argv) {
  const parts = [...argv];
  const first = parts.shift();
  const second = parts[0] && !parts[0].startsWith("--") ? parts.shift() : null;
  const commandKey = [first, second].filter(Boolean).join(" ");
  const command = commands.get(commandKey);
  if (!command && commandKey !== "rentals upload-media" && commandKey !== "imports create") {
    throw new Error("Unknown command. See SKILL.md for the allowlisted command surface.");
  }
  const options = {};
  while (parts.length > 0) {
    const flag = parts.shift();
    if (!["--id", "--tenant-id", "--input"].includes(flag)) throw new Error(`Unsupported argument: ${flag}`);
    const value = parts.shift();
    if (!value || value.startsWith("--")) throw new Error(`${flag} requires a value.`);
    options[flag === "--tenant-id" ? "tenantId" : flag.slice(2)] = value;
  }
  return { commandKey, command, options };
}

function assertUuid(value, label) {
  if (!value || !uuidPattern.test(value)) throw new Error(`${label} must be a UUID.`);
}

function inputRoot() {
  return resolve(process.env.TINGTING_INPUT_DIRECTORY ?? process.cwd());
}

function allowedInputPath(value) {
  const root = inputRoot();
  const candidate = resolve(root, value);
  const fromRoot = relative(root, candidate);
  if (fromRoot.startsWith("..") || isAbsolute(fromRoot)) throw new Error("Input path is outside TINGTING_INPUT_DIRECTORY.");
  return candidate;
}

async function readJsonInput(value) {
  if (!value) throw new Error("--input is required.");
  const text = value === "-"
    ? await new Promise((resolveInput, reject) => {
        let data = "";
        process.stdin.setEncoding("utf8");
        process.stdin.on("data", (chunk) => { data += chunk; });
        process.stdin.on("end", () => resolveInput(data));
        process.stdin.on("error", reject);
      })
    : await readFile(allowedInputPath(value), "utf8");
  const parsed = JSON.parse(text);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("Input JSON must be an object.");
  return parsed;
}

function queryString(input) {
  const allowed = new Set(["q", "property", "status", "outcome", "limit", "cursor"]);
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(input)) {
    if (!allowed.has(key)) throw new Error(`Unsupported query field: ${key}`);
    if (value !== null && value !== undefined && value !== "") params.set(key, String(value));
  }
  const text = params.toString();
  return text ? `?${text}` : "";
}

async function multipartCommand(client, commandKey, options) {
  const input = await readJsonInput(options.input);
  if (schemaUrls[commandKey]) await validateWithSchema(schemaUrls[commandKey], input);
  if (typeof input.file !== "string") throw new Error("Input JSON must contain a file path.");
  const filePath = allowedInputPath(input.file);
  const bytes = await readFile(filePath);
  const form = new FormData();
  form.set("file", new Blob([bytes]), filePath.split("/").at(-1));
  if (commandKey === "rentals upload-media") {
    if (typeof input.altText !== "string" || !input.altText.trim()) throw new Error("altText is required.");
    form.set("altText", input.altText.trim());
    if (input.sourceDigest) form.set("sourceDigest", String(input.sourceDigest));
    return client.request({ method: "POST", path: "/media", form, mutation: true });
  }
  if (!["create_only", "create_or_update"].includes(input.mode)) throw new Error("mode is invalid.");
  if (typeof input.sourceSystem !== "string" || !input.sourceSystem.trim()) throw new Error("sourceSystem is required.");
  form.set("mode", input.mode);
  form.set("sourceSystem", input.sourceSystem.trim());
  return client.request({ method: "POST", path: "/tenant-imports", form, mutation: true });
}

export async function run(argv, environment = process.env, dependencies = {}) {
  const { commandKey, command, options } = parseArgv(argv);
  const client = dependencies.client ?? new TingTingApiClient({
    baseUrl: environment.TINGTING_API_BASE_URL,
    token: environment.TINGTING_AUTOMATION_TOKEN
  });
  if (["rentals upload-media", "imports create"].includes(commandKey)) {
    return multipartCommand(client, commandKey, options);
  }
  if (command.id) assertUuid(options.id, "--id");
  if (command.tenantId) assertUuid(options.tenantId, "--tenant-id");
  const input = command.input || command.query ? await readJsonInput(options.input) : undefined;
  if (schemaUrls[commandKey]) await validateWithSchema(schemaUrls[commandKey], input);
  let path = command.path(options);
  if (command.query) path += queryString(input);
  return client.request({
    method: command.method,
    path,
    body: command.input ? input : undefined,
    mutation: Boolean(command.mutation)
  });
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (isMain) {
  run(process.argv.slice(2))
    .then((result) => process.stdout.write(`${JSON.stringify(result)}\n`))
    .catch((error) => {
      process.stderr.write(`${JSON.stringify({
        success: false,
        error: {
          code: error?.code ?? "TINGTINGCTL_ERROR",
          message: error instanceof Error ? error.message : "The command failed."
        },
        requestId: error?.requestId
      })}\n`);
      process.exitCode = 1;
    });
}
