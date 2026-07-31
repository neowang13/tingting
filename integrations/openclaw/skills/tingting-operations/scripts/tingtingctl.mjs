#!/usr/bin/env node
import { constants, realpathSync } from "node:fs";
import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { chmod, mkdtemp, open, realpath, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { basename, extname, isAbsolute, join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { TingTingApiClient } from "./api-client.mjs";
import { validateWithSchema } from "./json-schema.mjs";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const maximumPdfBytes = 10 * 1024 * 1024;
const maximumPdfAgeMs = 15 * 60 * 1000;
const maximumPdfFutureSkewMs = 2 * 60 * 1000;
const maximumOcrPages = 12;
const ocrTimeoutMs = 60_000;

const commands = new Map([
  ["health", { method: "GET", path: () => "/health" }],
  ["documents inspect-tenant", { input: true, local: true }],
  ["documents update-tenant", { id: true, mutation: true, documentMutation: true }],
  ["rentals list", { method: "GET", path: () => "/rentals", query: true }],
  ["rentals get", { method: "GET", path: ({ id }) => `/rentals/${id}`, id: true }],
  ["rentals create-draft", { method: "POST", path: () => "/rentals", input: true, mutation: true }],
  ["rentals update-draft", { method: "PATCH", path: ({ id }) => `/rentals/${id}`, id: true, input: true, mutation: true }],
  ["rentals preview-status", { method: "POST", path: ({ id }) => `/rentals/${id}/status-previews`, id: true, input: true, mutation: true }],
  ["tenants search", { method: "GET", path: () => "/tenants", query: true }],
  ["tenants get", { method: "GET", path: ({ id }) => `/tenants/${id}`, id: true }],
  ["tenants upload", { method: "POST", path: () => "/tenants", input: true, mutation: true }],
  ["tenants onboard", { method: "POST", path: () => "/tenant-onboardings", input: true, mutation: true }],
  ["tenants update", { method: "PATCH", path: ({ id }) => `/tenants/${id}`, id: true, input: true, mutation: true }],
  ["tenants preview-permission", { method: "POST", path: ({ id }) => `/tenants/${id}/permission-previews`, id: true, input: true, mutation: true }],
  ["payments match-tenant", { method: "POST", path: () => "/tenants/payment-match", input: true }],
  ["payments upload-receipt", { input: true, mutation: true, receiptMutation: true }],
  ["payments get", { tenantId: true, input: true }],
  ["payments mark-collected", { tenantId: true, input: true, mutation: true }],
  ["agent-notifications claim", { method: "POST", path: () => "/agent-notifications/claim" }],
  ["agent-notifications ack", { method: "POST", path: ({ id }) => `/agent-notifications/${id}/ack`, id: true, mutation: true }],
  ["imports get", { method: "GET", path: ({ id }) => `/tenant-imports/${id}`, id: true }],
  ["imports rows", { method: "GET", path: ({ id }) => `/tenant-imports/${id}/rows`, id: true, query: true }],
  ["imports preview-commit", { method: "POST", path: ({ id }) => `/tenant-imports/${id}/commit-previews`, id: true, input: true, mutation: true }],
  ["schedules get", { method: "GET", path: ({ tenantId }) => `/tenants/${tenantId}/schedule`, tenantId: true }],
  ["confirmations execute", { method: "POST", path: ({ id }) => `/confirmations/${id}/execute`, id: true, input: true, mutation: true }],
  ["jobs get", { method: "GET", path: ({ id }) => `/jobs/${id}`, id: true }]
]);

const schemaUrls = {
  "rentals list": new URL("../schemas/rental-list-query.schema.json", import.meta.url),
  "rentals create-draft": new URL("../schemas/rental-draft.schema.json", import.meta.url),
  "rentals update-draft": new URL("../schemas/rental-update.schema.json", import.meta.url),
  "rentals upload-media": new URL("../schemas/media-upload.schema.json", import.meta.url),
  "rentals preview-status": new URL("../schemas/rental-status-preview.schema.json", import.meta.url),
  "tenants search": new URL("../schemas/tenant-search-query.schema.json", import.meta.url),
  "tenants upload": new URL("../schemas/tenant-upload.schema.json", import.meta.url),
  "tenants onboard": new URL("../schemas/tenant-onboarding.schema.json", import.meta.url),
  "tenants update": new URL("../schemas/tenant-update.schema.json", import.meta.url),
  "tenants preview-permission": new URL("../schemas/permission-preview.schema.json", import.meta.url),
  "payments match-tenant": new URL("../schemas/payment-match.schema.json", import.meta.url),
  "payments upload-receipt": new URL("../schemas/payment-receipt.schema.json", import.meta.url),
  "payments get": new URL("../schemas/payment-get.schema.json", import.meta.url),
  "payments mark-collected": new URL("../schemas/payment-collected.schema.json", import.meta.url),
  "imports create": new URL("../schemas/tenant-import-request.schema.json", import.meta.url),
  "imports rows": new URL("../schemas/import-row-query.schema.json", import.meta.url),
  "imports preview-commit": new URL("../schemas/import-commit-preview.schema.json", import.meta.url),
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
    if (flag === "--help") {
      options.help = true;
      continue;
    }
    if (!flag.startsWith("--")) {
      if (command?.id && !options.id && uuidPattern.test(flag)) {
        options.id = flag;
        continue;
      }
      if (command?.tenantId && !options.tenantId && uuidPattern.test(flag)) {
        options.tenantId = flag;
        continue;
      }
      if (
        ["documents inspect-tenant", "documents update-tenant"].includes(
          commandKey
        ) &&
        !options.mediaRef &&
        /^media:\/\/inbound\/[A-Za-z0-9][A-Za-z0-9._-]{0,254}\.pdf$/u.test(flag)
      ) {
        options.mediaRef = flag;
        continue;
      }
      throw new Error(`Unsupported argument: ${flag}`);
    }
    if (![
      "--id",
      "--tenant-id",
      "--operation-id",
      "--input",
      "--media-path",
      "--media-ref"
    ].includes(flag)) {
      throw new Error(`Unsupported argument: ${flag}`);
    }
    const value = parts.shift();
    if (!value || value.startsWith("--")) throw new Error(`${flag} requires a value.`);
    const key = flag === "--tenant-id"
      ? "tenantId"
      : flag === "--operation-id"
        ? "operationId"
        : flag === "--media-path" || flag === "--media-ref"
          ? "mediaRef"
        : flag.slice(2);
    options[key] = value;
  }
  return { commandKey, command, options };
}

function commandHelp(commandKey) {
  const usage = {
    "documents inspect-tenant": [
      "tingtingctl documents inspect-tenant --media-path media://inbound/<managed-name>.pdf",
      "tingtingctl documents inspect-tenant --input <request.json>"
    ],
    "documents update-tenant": [
      "tingtingctl documents update-tenant --id <tenant-uuid> --operation-id <uuid> --media-path media://inbound/<managed-name>.pdf",
      "tingtingctl documents update-tenant --id <tenant-uuid> --operation-id <uuid> --input <request.json>"
    ],
    "tenants get": [
      "tingtingctl tenants get --id <tenant-uuid>",
      "tingtingctl tenants get <tenant-uuid>"
    ],
    "tenants update": [
      "tingtingctl tenants update --id <tenant-uuid> --operation-id <uuid> --input <request.json>"
    ]
  };
  return {
    success: true,
    data: {
      command: commandKey,
      usage: usage[commandKey] ?? [
        `See SKILL.md for the ${commandKey} command syntax.`
      ]
    }
  };
}

function assertUuid(value, label) {
  if (!value || !uuidPattern.test(value)) throw new Error(`${label} must be a UUID.`);
}

function inputRoot(environment = process.env) {
  if (!environment.TINGTING_INPUT_DIRECTORY) {
    const error = new Error("TINGTING_INPUT_DIRECTORY is required.");
    error.code = "INPUT_DIRECTORY_REQUIRED";
    throw error;
  }
  return resolve(environment.TINGTING_INPUT_DIRECTORY);
}

async function allowedInputPath(value, environment = process.env) {
  if (value === "-") throw new Error("Standard input is not supported. Use a file inside TINGTING_INPUT_DIRECTORY.");
  const configuredRoot = inputRoot(environment);
  const root = await realpath(configuredRoot);
  const candidate = await realpath(resolve(configuredRoot, value));
  const fromRoot = relative(root, candidate);
  if (fromRoot.startsWith("..") || isAbsolute(fromRoot)) {
    throw new Error("Input path is outside TINGTING_INPUT_DIRECTORY.");
  }
  return candidate;
}

async function readAllowedFile(value, environment = process.env, maximumBytes = 1024 * 1024) {
  const path = await allowedInputPath(value, environment);
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const file = await handle.stat();
    if (!file.isFile()) throw new Error("Input path must be a regular file.");
    if (file.size < 1 || file.size > maximumBytes) {
      throw new Error(`Input file must be between 1 and ${maximumBytes} bytes.`);
    }
    return { path, bytes: await handle.readFile() };
  } finally {
    await handle.close();
  }
}

async function readJsonInput(value, environment = process.env) {
  if (!value) throw new Error("--input is required.");
  const { bytes } = await readAllowedFile(value, environment);
  const text = bytes.toString("utf8");
  const parsed = JSON.parse(text);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("Input JSON must be an object.");
  return parsed;
}

function documentError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function documentMediaBasename(input) {
  const keys = Object.keys(input);
  if (
    keys.length !== 1 ||
    keys[0] !== "mediaRef" ||
    typeof input.mediaRef !== "string"
  ) {
    throw documentError(
      "DOCUMENT_INPUT_INVALID",
      'Document input must contain only a string "mediaRef".'
    );
  }
  const mediaRef = input.mediaRef;
  if (
    mediaRef.includes("%") ||
    mediaRef.includes("\0") ||
    /[\u0000-\u001f\u007f]/u.test(mediaRef)
  ) {
    throw documentError("DOCUMENT_MEDIA_REF_INVALID", "The media reference is not allowed.");
  }
  const match = /^media:\/\/inbound\/([^/\\]+)$/u.exec(mediaRef);
  const fileName = match?.[1];
  if (
    !fileName ||
    fileName.includes("..") ||
    fileName.includes("?") ||
    fileName.includes("#") ||
    basename(fileName) !== fileName ||
    isAbsolute(fileName) ||
    extname(fileName).toLocaleLowerCase("en-CA") !== ".pdf"
  ) {
    throw documentError(
      "DOCUMENT_MEDIA_REF_INVALID",
      "The media reference must name one inbound PDF."
    );
  }
  return fileName;
}

function mediaRoot(environment = process.env) {
  if (!environment.TINGTING_MEDIA_DIRECTORY) {
    throw documentError(
      "MEDIA_DIRECTORY_REQUIRED",
      "TINGTING_MEDIA_DIRECTORY is required."
    );
  }
  return resolve(environment.TINGTING_MEDIA_DIRECTORY);
}

async function readBoundedHandle(handle, maximumBytes) {
  const output = Buffer.allocUnsafe(maximumBytes + 1);
  let offset = 0;
  while (offset < output.length) {
    const { bytesRead } = await handle.read(
      output,
      offset,
      output.length - offset,
      offset
    );
    if (bytesRead === 0) break;
    offset += bytesRead;
  }
  if (offset > maximumBytes) {
    throw documentError(
      "DOCUMENT_SIZE_INVALID",
      `The inbound PDF must be no larger than ${maximumBytes} bytes.`
    );
  }
  return output.subarray(0, offset);
}

async function readInboundPdf(fileName, environment, nowMs) {
  let root;
  try {
    root = await realpath(mediaRoot(environment));
  } catch (error) {
    if (error?.code === "MEDIA_DIRECTORY_REQUIRED") throw error;
    throw documentError(
      "DOCUMENT_SOURCE_INVALID",
      "The inbound media directory is unavailable."
    );
  }
  const candidate = resolve(root, fileName);
  const fromRoot = relative(root, candidate);
  if (fromRoot.startsWith("..") || isAbsolute(fromRoot)) {
    throw documentError(
      "DOCUMENT_MEDIA_REF_INVALID",
      "The media reference is outside the inbound directory."
    );
  }

  let handle;
  try {
    handle = await open(
      candidate,
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK
    );
  } catch {
    throw documentError(
      "DOCUMENT_SOURCE_INVALID",
      "The inbound PDF must be a non-symlink regular file."
    );
  }

  try {
    const before = await handle.stat();
    if (!before.isFile()) {
      throw documentError(
        "DOCUMENT_SOURCE_INVALID",
        "The inbound PDF must be a non-symlink regular file."
      );
    }
    if (before.size < 1 || before.size > maximumPdfBytes) {
      throw documentError(
        "DOCUMENT_SIZE_INVALID",
        `The inbound PDF must be between 1 and ${maximumPdfBytes} bytes.`
      );
    }
    if (
      nowMs - before.mtimeMs > maximumPdfAgeMs ||
      before.mtimeMs - nowMs > maximumPdfFutureSkewMs
    ) {
      throw documentError(
        "DOCUMENT_NOT_FRESH",
        "The inbound PDF is outside the accepted freshness window."
      );
    }

    const bytes = await readBoundedHandle(handle, maximumPdfBytes);
    const after = await handle.stat();
    if (
      after.size !== before.size ||
      after.mtimeMs !== before.mtimeMs ||
      bytes.length !== before.size
    ) {
      throw documentError(
        "DOCUMENT_SOURCE_CHANGED",
        "The inbound PDF changed while it was being inspected."
      );
    }
    if (bytes.length < 5 || bytes.subarray(0, 5).toString("ascii") !== "%PDF-") {
      throw documentError(
        "DOCUMENT_MAGIC_INVALID",
        "The inbound file is not a PDF."
      );
    }
    return { bytes, digest: sha256(bytes) };
  } catch (error) {
    if (error?.code?.startsWith?.("DOCUMENT_")) throw error;
    throw documentError(
      "DOCUMENT_SOURCE_INVALID",
      "The inbound PDF could not be read safely."
    );
  } finally {
    await handle.close().catch(() => {});
  }
}

function paymentMediaBasename(mediaRef) {
  if (typeof mediaRef !== "string" || mediaRef.includes("%") || mediaRef.includes("\0")) {
    throw documentError("RECEIPT_MEDIA_REF_INVALID", "A managed receipt attachment is required.");
  }
  const match = /^media:\/\/inbound\/([^/\\]+)$/u.exec(mediaRef);
  const fileName = match?.[1];
  const extension = fileName ? extname(fileName).toLocaleLowerCase("en-CA") : "";
  if (
    !fileName
    || fileName.includes("..")
    || basename(fileName) !== fileName
    || ![".pdf", ".jpg", ".jpeg", ".png", ".webp"].includes(extension)
  ) {
    throw documentError(
      "RECEIPT_MEDIA_REF_INVALID",
      "The receipt must be a managed inbound PDF, JPG, PNG, or WEBP attachment."
    );
  }
  return fileName;
}

async function readInboundReceipt(mediaRef, environment, nowMs = Date.now()) {
  const fileName = paymentMediaBasename(mediaRef);
  let root;
  try {
    root = await realpath(mediaRoot(environment));
  } catch {
    throw documentError(
      "RECEIPT_SOURCE_INVALID",
      "The managed receipt directory is unavailable."
    );
  }
  const candidate = resolve(root, fileName);
  const fromRoot = relative(root, candidate);
  if (fromRoot.startsWith("..") || isAbsolute(fromRoot)) {
    throw documentError("RECEIPT_MEDIA_REF_INVALID", "The receipt is outside the managed attachment directory.");
  }
  let handle;
  try {
    handle = await open(
      candidate,
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK
    );
  } catch {
    throw documentError(
      "RECEIPT_SOURCE_INVALID",
      "The receipt must be a non-symlink regular managed attachment."
    );
  }
  try {
    const before = await handle.stat();
    if (!before.isFile() || before.size < 1 || before.size > maximumPdfBytes) {
      throw documentError("RECEIPT_SIZE_INVALID", "The receipt must be a regular file no larger than 10 MB.");
    }
    if (
      nowMs - before.mtimeMs > maximumPdfAgeMs
      || before.mtimeMs - nowMs > maximumPdfFutureSkewMs
    ) {
      throw documentError("RECEIPT_NOT_FRESH", "The receipt is not from the current managed message.");
    }
    const bytes = await readBoundedHandle(handle, maximumPdfBytes);
    const after = await handle.stat();
    if (
      before.size !== after.size
      || before.mtimeMs !== after.mtimeMs
      || bytes.length !== before.size
    ) {
      throw documentError("RECEIPT_SOURCE_CHANGED", "The receipt changed while it was being read.");
    }
    const mimeType = {
      ".pdf": "application/pdf",
      ".jpg": "image/jpeg",
      ".jpeg": "image/jpeg",
      ".png": "image/png",
      ".webp": "image/webp"
    }[extname(fileName).toLocaleLowerCase("en-CA")];
    return { fileName, bytes, mimeType };
  } catch (error) {
    if (error?.code?.startsWith?.("RECEIPT_")) throw error;
    throw documentError(
      "RECEIPT_SOURCE_INVALID",
      "The managed receipt could not be read safely."
    );
  } finally {
    await handle.close();
  }
}

const swiftOcrWorkerSource = String.raw`import AppKit
import Darwin
import Foundation
import PDFKit
import Vision

struct OCRPage: Codable {
    let page: Int
    let text: String
    let observations: [OCRObservation]
}

struct OCRObservation: Codable {
    let text: String
    let confidence: Float
    let x: Double
    let y: Double
    let width: Double
    let height: Double
}

struct OCROutput: Codable {
    let pageCount: Int
    let pages: [OCRPage]
}

func fail(_ status: Int32) -> Never {
    exit(status)
}

guard CommandLine.arguments.count == 3 else {
    fail(2)
}

let inputURL = URL(fileURLWithPath: CommandLine.arguments[1])
let outputURL = URL(fileURLWithPath: CommandLine.arguments[2])
guard
    let document = PDFDocument(url: inputURL),
    !document.isEncrypted,
    !document.isLocked
else {
    fail(3)
}

let pageCount = document.pageCount
guard pageCount > 0 && pageCount <= 12 else {
    fail(4)
}

let maximumPagePixels = 2_000_000.0
let maximumTotalPixels = 24_000_000
let maximumDimension = 4096.0
var totalPixels = 0
var renderedPages: [NSBitmapImageRep] = []

for pageIndex in 0..<pageCount {
    guard let page = document.page(at: pageIndex) else {
        fail(5)
    }
    let bounds = page.bounds(for: .mediaBox)
    let width = Double(bounds.width)
    let height = Double(bounds.height)
    guard
        width.isFinite,
        height.isFinite,
        width > 0,
        height > 0
    else {
        fail(6)
    }

    let scale = min(
        2.0,
        sqrt(maximumPagePixels / (width * height)),
        maximumDimension / width,
        maximumDimension / height
    )
    guard scale.isFinite && scale > 0 else {
        fail(7)
    }
    let pixelWidth = max(1, Int(floor(width * scale)))
    let pixelHeight = max(1, Int(floor(height * scale)))
    let pagePixels = pixelWidth * pixelHeight
    guard
        pagePixels <= Int(maximumPagePixels),
        totalPixels <= maximumTotalPixels - pagePixels
    else {
        fail(8)
    }
    totalPixels += pagePixels

    guard
        let bitmap = NSBitmapImageRep(
            bitmapDataPlanes: nil,
            pixelsWide: pixelWidth,
            pixelsHigh: pixelHeight,
            bitsPerSample: 8,
            samplesPerPixel: 4,
            hasAlpha: true,
            isPlanar: false,
            colorSpaceName: .deviceRGB,
            bytesPerRow: 0,
            bitsPerPixel: 0
        ),
        let graphics = NSGraphicsContext(bitmapImageRep: bitmap)
    else {
        fail(9)
    }

    NSGraphicsContext.saveGraphicsState()
    NSGraphicsContext.current = graphics
    graphics.cgContext.setFillColor(NSColor.white.cgColor)
    graphics.cgContext.fill(
        CGRect(x: 0, y: 0, width: pixelWidth, height: pixelHeight)
    )
    graphics.cgContext.scaleBy(x: scale, y: scale)
    page.draw(with: .mediaBox, to: graphics.cgContext)
    NSGraphicsContext.restoreGraphicsState()

    guard bitmap.cgImage != nil else {
        fail(10)
    }
    renderedPages.append(bitmap)
}

let queue = OperationQueue()
queue.maxConcurrentOperationCount = 3
let resultLock = NSLock()
var recognizedText = Array(repeating: "", count: pageCount)
var recognizedObservations = Array(
    repeating: [OCRObservation](),
    count: pageCount
)
var recognitionFailed = false

for pageIndex in 0..<pageCount {
    queue.addOperation {
        guard let image = renderedPages[pageIndex].cgImage else {
            resultLock.lock()
            recognitionFailed = true
            resultLock.unlock()
            return
        }
        let request = VNRecognizeTextRequest()
        request.recognitionLevel = .accurate
        request.usesLanguageCorrection = true
        request.recognitionLanguages = ["en-CA", "en-US"]
        do {
            try VNImageRequestHandler(cgImage: image, options: [:]).perform([request])
        } catch {
            resultLock.lock()
            recognitionFailed = true
            resultLock.unlock()
            return
        }
        let observations = (request.results ?? []).sorted { left, right in
            let verticalDifference = abs(left.boundingBox.maxY - right.boundingBox.maxY)
            if verticalDifference > 0.015 {
                return left.boundingBox.maxY > right.boundingBox.maxY
            }
            return left.boundingBox.minX < right.boundingBox.minX
        }
        let recognized = observations.compactMap { observation -> OCRObservation? in
            guard let candidate = observation.topCandidates(1).first else {
                return nil
            }
            let box = observation.boundingBox
            return OCRObservation(
                text: candidate.string,
                confidence: candidate.confidence,
                x: Double(box.minX),
                y: Double(box.minY),
                width: Double(box.width),
                height: Double(box.height)
            )
        }
        let text = recognized.map(\.text).joined(separator: "\n")
        resultLock.lock()
        recognizedText[pageIndex] = text
        recognizedObservations[pageIndex] = recognized
        resultLock.unlock()
    }
}
queue.waitUntilAllOperationsAreFinished()
guard !recognitionFailed else {
    fail(11)
}

var pages: [OCRPage] = []
for pageIndex in 0..<pageCount {
    pages.append(
        OCRPage(
            page: pageIndex + 1,
            text: recognizedText[pageIndex],
            observations: recognizedObservations[pageIndex]
        )
    )
}

do {
    let encoded = try JSONEncoder().encode(
        OCROutput(pageCount: pageCount, pages: pages)
    )
    try encoded.write(to: outputURL, options: [.atomic])
} catch {
    fail(12)
}
`;

function ocrChildEnvironment(temporaryDirectory) {
  return {
    PATH: "/usr/bin:/bin",
    HOME: temporaryDirectory,
    TMPDIR: temporaryDirectory,
    LANG: "en_US.UTF-8",
    LC_ALL: "en_US.UTF-8",
    CLANG_MODULE_CACHE_PATH: join(temporaryDirectory, "clang-cache"),
    SWIFT_MODULECACHE_PATH: join(temporaryDirectory, "swift-cache")
  };
}

function sandboxString(value) {
  return value.replaceAll("\\", "\\\\").replaceAll('"', '\\"');
}

function swiftSandboxProfile(temporaryDirectory) {
  const privateDirectory = sandboxString(temporaryDirectory);
  const userHome = sandboxString(realpathSync(homedir()));
  return `(version 1)
(allow default)
(deny network*)
(deny file-read* (subpath "${userHome}"))
(deny file-write* (subpath "${userHome}"))
(allow file-read* (subpath "${privateDirectory}"))
(allow file-write* (subpath "${privateDirectory}"))
`;
}

async function waitForSwiftWorker({
  workerPath,
  inputPath,
  outputPath,
  sandboxProfilePath,
  temporaryDirectory,
  environment,
  timeoutMs
}) {
  await new Promise((resolveWorker, rejectWorker) => {
    const child = spawn(
      "/usr/bin/sandbox-exec",
      [
        "-f",
        sandboxProfilePath,
        "/usr/bin/swift",
        workerPath,
        inputPath,
        outputPath
      ],
      {
        cwd: temporaryDirectory,
        env: environment,
        stdio: ["ignore", "pipe", "pipe"]
      }
    );
    let timedOut = false;
    let excessiveOutput = false;
    let outputBytes = 0;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, timeoutMs);
    timer.unref?.();

    const countOutput = (chunk) => {
      outputBytes += chunk.length;
      if (outputBytes > 16 * 1024) {
        excessiveOutput = true;
        child.kill("SIGKILL");
      }
    };
    child.stdout.on("data", countOutput);
    child.stderr.on("data", countOutput);
    child.once("error", () => {
      clearTimeout(timer);
      rejectWorker(
        documentError("DOCUMENT_OCR_UNAVAILABLE", "Local PDF OCR is unavailable.")
      );
    });
    child.once("close", (code) => {
      clearTimeout(timer);
      if (timedOut) {
        rejectWorker(
          documentError("DOCUMENT_OCR_TIMEOUT", "Local PDF OCR timed out.")
        );
        return;
      }
      if (excessiveOutput || code !== 0) {
        rejectWorker(
          documentError("DOCUMENT_OCR_FAILED", "Local PDF OCR failed.")
        );
        return;
      }
      resolveWorker();
    });
  });
}

function validatedOcrOutput(rawOutput) {
  if (
    !rawOutput ||
    typeof rawOutput !== "object" ||
    !Number.isInteger(rawOutput.pageCount) ||
    rawOutput.pageCount < 1 ||
    rawOutput.pageCount > maximumOcrPages ||
    !Array.isArray(rawOutput.pages) ||
    rawOutput.pages.length !== rawOutput.pageCount
  ) {
    throw documentError(
      "DOCUMENT_OCR_OUTPUT_INVALID",
      "Local PDF OCR produced an invalid result."
    );
  }
  const seenPages = new Set();
  let totalCharacters = 0;
  let totalObservations = 0;
  const pages = rawOutput.pages.map((item) => {
    if (
      !item ||
      typeof item !== "object" ||
      !Number.isInteger(item.page) ||
      item.page < 1 ||
      item.page > rawOutput.pageCount ||
      seenPages.has(item.page) ||
      typeof item.text !== "string" ||
      item.text.length > 250_000
    ) {
      throw documentError(
        "DOCUMENT_OCR_OUTPUT_INVALID",
        "Local PDF OCR produced an invalid result."
      );
    }
    seenPages.add(item.page);
    totalCharacters += item.text.length;
    if (totalCharacters > 1_000_000) {
      throw documentError(
        "DOCUMENT_OCR_OUTPUT_INVALID",
        "Local PDF OCR produced an invalid result."
      );
    }
    const observations = item.observations === undefined
      ? []
      : item.observations;
    if (!Array.isArray(observations) || observations.length > 5_000) {
      throw documentError(
        "DOCUMENT_OCR_OUTPUT_INVALID",
        "Local PDF OCR produced an invalid result."
      );
    }
    totalObservations += observations.length;
    if (totalObservations > 20_000) {
      throw documentError(
        "DOCUMENT_OCR_OUTPUT_INVALID",
        "Local PDF OCR produced an invalid result."
      );
    }
    const validatedObservations = observations.map((observation) => {
      const coordinates = [
        observation?.x,
        observation?.y,
        observation?.width,
        observation?.height
      ];
      if (
        !observation ||
        typeof observation !== "object" ||
        typeof observation.text !== "string" ||
        observation.text.length > 500 ||
        typeof observation.confidence !== "number" ||
        !Number.isFinite(observation.confidence) ||
        observation.confidence < 0 ||
        observation.confidence > 1 ||
        coordinates.some((value) =>
          typeof value !== "number" ||
          !Number.isFinite(value) ||
          value < 0 ||
          value > 1
        ) ||
        observation.x + observation.width > 1.001 ||
        observation.y + observation.height > 1.001
      ) {
        throw documentError(
          "DOCUMENT_OCR_OUTPUT_INVALID",
          "Local PDF OCR produced an invalid result."
        );
      }
      return {
        text: observation.text,
        confidence: observation.confidence,
        x: observation.x,
        y: observation.y,
        width: observation.width,
        height: observation.height
      };
    });
    return {
      page: item.page,
      text: item.text,
      observations: validatedObservations
    };
  });
  return { pageCount: rawOutput.pageCount, pages };
}

async function runSwiftPdfOcr({
  inputPath,
  temporaryDirectory,
  environment,
  timeoutMs
}) {
  const workerPath = join(temporaryDirectory, "pdf-ocr.swift");
  const outputPath = join(temporaryDirectory, "ocr-pages.json");
  const sandboxProfilePath = join(temporaryDirectory, "pdf-ocr.sb");
  await writeFile(workerPath, swiftOcrWorkerSource, {
    encoding: "utf8",
    flag: "wx",
    mode: 0o600
  });
  await writeFile(
    sandboxProfilePath,
    swiftSandboxProfile(temporaryDirectory),
    { encoding: "utf8", flag: "wx", mode: 0o600 }
  );
  await waitForSwiftWorker({
    workerPath,
    inputPath,
    outputPath,
    sandboxProfilePath,
    temporaryDirectory,
    environment,
    timeoutMs
  });

  let handle;
  try {
    handle = await open(outputPath, constants.O_RDONLY | constants.O_NOFOLLOW);
    const file = await handle.stat();
    if (!file.isFile() || file.size < 1 || file.size > 2 * 1024 * 1024) {
      throw documentError(
        "DOCUMENT_OCR_OUTPUT_INVALID",
        "Local PDF OCR produced an invalid result."
      );
    }
    const rawOutput = JSON.parse((await handle.readFile()).toString("utf8"));
    return validatedOcrOutput(rawOutput);
  } catch (error) {
    if (error?.code?.startsWith?.("DOCUMENT_")) throw error;
    throw documentError(
      "DOCUMENT_OCR_OUTPUT_INVALID",
      "Local PDF OCR produced an invalid result."
    );
  } finally {
    await handle?.close().catch(() => {});
  }
}

function normalizedOcrLine(value) {
  return value
    .normalize("NFKC")
    .replace(/[\t\f\v]+/gu, " ")
    .replace(/ {2,}/gu, " ")
    .trim();
}

function ocrLines(pages) {
  return pages.flatMap(({ page, text, observations }) => {
    if (Array.isArray(observations) && observations.length > 0) {
      return observations
        .map((observation) => ({
          page,
          line: normalizedOcrLine(observation.text).slice(0, 500),
          confidence: observation.confidence,
          x: observation.x,
          y: observation.y,
          width: observation.width,
          height: observation.height,
          centerX: observation.x + observation.width / 2,
          centerY: observation.y + observation.height / 2
        }))
        .filter(({ line }) => Boolean(line));
    }
    return text
      .split(/\r?\n/gu)
      .map(normalizedOcrLine)
      .filter(Boolean)
      .map((line) => ({ page, line: line.slice(0, 500) }));
  });
}

function cleanedCandidateValue(value, maximumLength) {
  const cleaned = normalizedOcrLine(value)
    .replace(/^[\s:;,#|_\-–—]+/u, "")
    .replace(/[\s|_]+$/u, "")
    .trim();
  return cleaned.length > 0 && cleaned.length <= maximumLength ? cleaned : null;
}

function validPersonName(value) {
  return (
    value.length >= 3 &&
    value.length <= 120 &&
    /^[\p{L}\p{M}][\p{L}\p{M}\s.'’\-]+$/u.test(value) &&
    !/\b(?:agreement|address|landlord|signature|tenant|date|email|phone)\b/iu.test(value)
  );
}

function validPropertyLabel(value) {
  return (
    value.length >= 3 &&
    value.length <= 160 &&
    /[\p{L}\d]/u.test(value) &&
    !/^(?:address|rental unit|property|premises)$/iu.test(value) &&
    !/\b(?:https?:\/\/|www\.|email|signature)\b/iu.test(value)
  );
}

function validUnit(value) {
  return (
    /^[\p{L}\d][\p{L}\d .\-]{0,59}$/u.test(value) &&
    !/\b(?:number|street|city|province|postal|code|name)\b/iu.test(value)
  );
}

function isLikelyFormLabel(value) {
  return /^(?:tenant|landlord|address|unit|suite|apartment|email|phone|date|signature|legal name|name of|last name|first(?: and middle)? name|middle name|street|city|province|postal|daytime|fax)\b/iu.test(value);
}

function labelCandidates(lines, patterns, {
  normalize = (value) => value,
  validate,
  directConfidence = 0.95,
  followingConfidence = 0.88
}) {
  const candidates = [];
  for (let index = 0; index < lines.length; index += 1) {
    const entry = lines[index];
    for (const pattern of patterns) {
      const match = pattern.exec(entry.line);
      if (!match) continue;
      const direct = cleanedCandidateValue(match[1] ?? "", 200);
      const following = lines[index + 1]?.page === entry.page
        ? cleanedCandidateValue(lines[index + 1].line, 200)
        : null;
      const rawValue = direct || (
        following && !isLikelyFormLabel(following) ? following : null
      );
      if (!rawValue) break;
      const value = normalize(rawValue);
      if (value && validate(value)) {
        candidates.push({
          value,
          page: entry.page,
          confidence: direct ? directConfidence : followingConfidence
        });
      }
      break;
    }
  }
  return candidates;
}

function uniqueCandidates(candidates) {
  const byValue = new Map();
  for (const candidate of candidates) {
    const key = String(candidate.value).toLocaleLowerCase("en-CA");
    const current = byValue.get(key);
    if (
      !current ||
      candidate.confidence > current.confidence ||
      (
        candidate.confidence === current.confidence &&
        candidate.page < current.page
      )
    ) {
      byValue.set(key, candidate);
    }
  }
  return [...byValue.values()];
}

function selectCandidate(field, candidates, warnings) {
  const unique = uniqueCandidates(candidates);
  if (unique.length === 1) return unique[0];
  if (unique.length > 1) warnings.push(`multiple_${field}_candidates`);
  return null;
}

function normalizedEmail(value) {
  const match = /[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9.-]+\.[A-Z]{2,63}/iu.exec(value);
  return match?.[0].toLocaleLowerCase("en-CA") ?? null;
}

function validEmail(value) {
  return /^[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?(?:\.[A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?)+$/iu.test(value);
}

function normalizedPhone(value) {
  const trimmed = value.trim();
  const digits = trimmed.replace(/\D/gu, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  if (trimmed.startsWith("+") && digits.length >= 8 && digits.length <= 15) {
    return `+${digits}`;
  }
  return null;
}

function validPhone(value) {
  return /^\+[1-9]\d{7,14}$/u.test(value);
}

function maskedEmail(value) {
  const separator = value.lastIndexOf("@");
  if (separator < 1) return "•••";
  const local = value.slice(0, separator);
  const domain = value.slice(separator + 1);
  const visible = local.slice(0, Math.min(2, local.length));
  return `${visible}•••@${domain}`;
}

function maskedPhone(value) {
  const digits = value.replace(/\D/gu, "");
  return digits.length >= 4 ? `•••-•••-${digits.slice(-4)}` : "•••";
}

function publicCandidate(candidate, transform = (value) => value) {
  if (!candidate) return null;
  return {
    value: transform(candidate.value),
    page: candidate.page,
    confidence: candidate.confidence
  };
}

function maskedContactDisclosure(overrides = {}) {
  return {
    mode: "masked_preview",
    displayedValuesArePartial: true,
    sourceValuesRetainedInFull: true,
    previewMarker: "•••",
    instruction:
      "Fields ending in Masked are partial privacy previews, not the full PDF values. Say that the complete values were read; never describe a masked preview as the PDF's complete email or phone.",
    ...overrides
  };
}

function validIsoDateParts(year, month, day) {
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

function normalizedDate(value) {
  const iso = /\b(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})\b/u.exec(value);
  if (iso) {
    const [, yearText, monthText, dayText] = iso;
    const year = Number(yearText);
    const month = Number(monthText);
    const day = Number(dayText);
    if (validIsoDateParts(year, month, day)) {
      return `${yearText.padStart(4, "0")}-${monthText.padStart(2, "0")}-${dayText.padStart(2, "0")}`;
    }
  }

  const numeric = /\b(\d{1,2})[/.](\d{1,2})[/.](\d{4})\b/u.exec(value);
  if (numeric) {
    const [, monthText, dayText, yearText] = numeric;
    const year = Number(yearText);
    const month = Number(monthText);
    const day = Number(dayText);
    if (validIsoDateParts(year, month, day)) {
      return `${yearText}-${monthText.padStart(2, "0")}-${dayText.padStart(2, "0")}`;
    }
  }

  const named = /\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2})(?:st|nd|rd|th)?(?:,)?\s+(\d{4})\b/iu.exec(value);
  const monthNames = [
    "january", "february", "march", "april", "may", "june",
    "july", "august", "september", "october", "november", "december"
  ];
  const dayFirstNamed = /\b(\d{1,2})(?:st|nd|rd|th)?\s+(January|February|March|April|May|June|July|August|September|October|November|December)(?:,)?\s+(\d{4})\b/iu.exec(value);
  const dateParts = named
    ? { year: Number(named[3]), monthName: named[1], day: Number(named[2]) }
    : dayFirstNamed
      ? {
          year: Number(dayFirstNamed[3]),
          monthName: dayFirstNamed[2],
          day: Number(dayFirstNamed[1])
        }
      : null;
  if (!dateParts) return null;
  const year = dateParts.year;
  const month = monthNames.indexOf(dateParts.monthName.toLocaleLowerCase("en-CA")) + 1;
  const day = dateParts.day;
  if (!validIsoDateParts(year, month, day)) return null;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function normalizedLeaseType(value) {
  if (/\bmonth[\s-]*to[\s-]*month\b/iu.test(value)) return "month_to_month";
  if (/\bfixed[\s-]*term\b/iu.test(value)) return "fixed_term";
  return null;
}

function validLeaseType(value) {
  return value === "month_to_month" || value === "fixed_term";
}

function normalizedRentDueDay(value) {
  const match = /\b([1-9]|[12]\d|3[01])(?:st|nd|rd|th)?\b/iu.exec(value);
  return match ? Number(match[1]) : null;
}

function validRentDueDay(value) {
  return Number.isInteger(value) && value >= 1 && value <= 31;
}

function rtbRentDueDayCandidates(lines) {
  const candidates = [];
  for (let index = 0; index < lines.length; index += 1) {
    const marker = lines[index];
    if (
      !/\bdue\s+date\b.*\b(?:1st|2nd|3rd)\b.*\b31st\b/iu.test(marker.line)
    ) {
      continue;
    }

    const nearby = [];
    for (
      let followingIndex = index;
      followingIndex < Math.min(lines.length, index + 10);
      followingIndex += 1
    ) {
      const entry = lines[followingIndex];
      if (entry.page !== marker.page) break;
      nearby.push(entry);
    }

    const filledAfterPrompt =
      /\b31st\s*\)\s*([1-9]|[12]\d|3[01])(?:st|nd|rd|th)?\b/iu.exec(
        marker.line
      );
    if (
      filledAfterPrompt &&
      /\bday\s+of\s+each\b/iu.test(
        nearby.slice(1, 5).map(({ line }) => line).join(" ")
      )
    ) {
      candidates.push({
        value: Number(filledAfterPrompt[1]),
        page: marker.page,
        confidence: Math.min(0.98, marker.confidence ?? 0.94)
      });
    }

    for (let nearbyIndex = 0; nearbyIndex < nearby.length; nearbyIndex += 1) {
      const entry = nearby[nearbyIndex];
      const combined = /\b([1-9]|[12]\d|3[01])(?:st|nd|rd|th)?\s+day\s+of\s+each\b/iu.exec(
        entry.line
      );
      if (combined) {
        candidates.push({
          value: Number(combined[1]),
          page: entry.page,
          confidence: Math.min(0.98, entry.confidence ?? 0.94)
        });
        continue;
      }

      const ordinal = /^([1-9]|[12]\d|3[01])(?:st|nd|rd|th)?$/iu.exec(
        entry.line
      );
      if (!ordinal) continue;
      const followingText = nearby
        .slice(nearbyIndex + 1, nearbyIndex + 5)
        .map(({ line }) => line)
        .join(" ");
      if (!/\bday\s+of\s+each\b/iu.test(followingText)) continue;
      candidates.push({
        value: Number(ordinal[1]),
        page: entry.page,
        confidence: Math.min(0.98, entry.confidence ?? 0.94)
      });
    }
  }
  return uniqueCandidates(candidates);
}

function globallyMatchedCandidates(lines, expression, normalize, validate, confidence) {
  const candidates = [];
  for (const { page, line } of lines) {
    for (const match of line.matchAll(expression)) {
      const value = normalize(match[0]);
      if (value && validate(value)) {
        candidates.push({ value, page, confidence });
      }
    }
  }
  return candidates;
}

function spatialRows(lines) {
  const rows = [];
  const positioned = lines
    .filter(({ centerY, centerX, height }) =>
      Number.isFinite(centerY) &&
      Number.isFinite(centerX) &&
      Number.isFinite(height)
    )
    .sort((left, right) =>
      right.centerY - left.centerY || left.centerX - right.centerX
    );
  for (const entry of positioned) {
    const row = rows.find((candidate) =>
      Math.abs(candidate.centerY - entry.centerY) <= Math.max(
        0.008,
        Math.max(candidate.maximumHeight, entry.height) * 0.7
      )
    );
    if (row) {
      row.entries.push(entry);
      row.centerY = row.entries.reduce(
        (total, item) => total + item.centerY,
        0
      ) / row.entries.length;
      row.maximumHeight = Math.max(row.maximumHeight, entry.height);
    } else {
      rows.push({
        centerY: entry.centerY,
        maximumHeight: entry.height,
        entries: [entry]
      });
    }
  }
  return rows
    .map((row) => ({
      ...row,
      entries: row.entries.sort((left, right) => left.centerX - right.centerX)
    }))
    .sort((left, right) => right.centerY - left.centerY);
}

function rtbStructuredTenantCandidates(lines) {
  const tenants = [];
  const pages = [...new Set(lines.map(({ page }) => page))];
  for (const page of pages) {
    const positioned = lines.filter(
      (entry) => entry.page === page && Number.isFinite(entry.centerY)
    );
    const marker = positioned.find(({ line }) =>
      /(?:^|\band\s+the\s+)tenant\s*\(\s*s\s*\)\s*:/iu.test(line)
    );
    if (!marker) continue;
    const addressMarker = positioned.find(({ line, centerY }) =>
      centerY < marker.centerY &&
      /address\s+of\s+place\s+being\s+rented\s+to\s+tenant/iu.test(line)
    );
    const lowerBoundary = addressMarker?.centerY ?? 0;
    const sectionRows = spatialRows(
      positioned.filter(
        ({ centerY }) =>
          centerY < marker.centerY - 0.005 &&
          centerY > lowerBoundary + 0.005
      )
    );

    const nameRows = sectionRows.flatMap((row) => {
      const possibleNames = row.entries
        .map((entry) => ({
          entry,
          value: cleanedCandidateValue(entry.line, 60)
        }))
        .filter(({ value }) =>
          value &&
          value.split(/\s+/u).length <= 5 &&
          validPersonName(value) &&
          !isLikelyFormLabel(value) &&
          !/^(?:last|first|middle|other|optional)$/iu.test(value)
        );
      const lastName = possibleNames.find(
        ({ entry }) => entry.centerX < 0.5
      );
      const givenNames = possibleNames.find(
        ({ entry }) => entry.centerX >= 0.5
      );
      if (!lastName || !givenNames) return [];
      const value = `${givenNames.value} ${lastName.value}`;
      if (!validPersonName(value)) return [];
      return [{
        centerY: row.centerY,
        fullName: {
          value,
          page,
          confidence: Math.min(
            0.98,
            Math.max(
              0.85,
              Math.min(
                lastName.entry.confidence ?? 0.9,
                givenNames.entry.confidence ?? 0.9
              )
            )
          )
        }
      }];
    });
    if (nameRows.length < 1 || nameRows.length > 4) continue;

    const lowestNameY = Math.min(...nameRows.map(({ centerY }) => centerY));
    const contactRows = sectionRows.flatMap((row) => {
      if (row.centerY >= lowestNameY - 0.005) return [];
      const leftText = row.entries
        .filter(({ x }) => x < 0.3)
        .map(({ line }) => line)
        .join(" ");
      const rightText = row.entries
        .filter(({ x }) => x >= 0.28)
        .map(({ line }) => line)
        .join(" ");
      const phoneE164 = normalizedPhone(leftText);
      const email = normalizedEmail(rightText);
      const validPhoneE164 = phoneE164 && validPhone(phoneE164)
        ? phoneE164
        : null;
      const validEmailAddress = email && validEmail(email) ? email : null;
      if (!validPhoneE164 && !validEmailAddress) {
        return [];
      }
      const confidence = Math.min(
        0.98,
        Math.max(
          0.85,
          Math.min(
            ...row.entries.map(({ confidence: value }) => value ?? 0.9)
          )
        )
      );
      return [{
        centerY: row.centerY,
        email: validEmailAddress
          ? { value: validEmailAddress, page, confidence }
          : null,
        phoneE164: validPhoneE164
          ? { value: validPhoneE164, page, confidence }
          : null
      }];
    });
    if (
      contactRows.length !== nameRows.length ||
      contactRows.length < 1 ||
      contactRows.length > 4
    ) {
      continue;
    }

    for (let index = 0; index < nameRows.length; index += 1) {
      const nameRow = nameRows[index];
      const contactRow = contactRows[index];
      tenants.push({
        fullName: nameRow.fullName,
        email: contactRow.email,
        phoneE164: contactRow.phoneE164,
        page,
        rowIndex: index + 1,
        association: "bc_rtb_row_order",
        confidence: Math.min(
          nameRow.fullName.confidence,
          ...[
            contactRow.email?.confidence,
            contactRow.phoneE164?.confidence
          ].filter(Number.isFinite)
        )
      });
    }
  }
  return tenants;
}

function rtbTenantNameCandidates(lines) {
  const candidates = [];
  for (let index = 0; index < lines.length; index += 1) {
    const marker = lines[index];
    if (!/(?:^|\band\s+the\s+)tenant\s*\(\s*s\s*\)\s*:/iu.test(marker.line)) {
      continue;
    }
    const nameParts = [];
    for (
      let followingIndex = index + 1;
      followingIndex < Math.min(lines.length, index + 24);
      followingIndex += 1
    ) {
      const entry = lines[followingIndex];
      if (entry.page !== marker.page) break;
      if (
        /address\s+of\s+place\s+being\s+rented|(?:e-?mail|phone|telephone|mobile|cell)/iu.test(entry.line)
      ) {
        break;
      }
      if (
        /^(?:last\s+name|first(?:\s+and\s+middle)?\s+name|name|initials?)\b/iu.test(entry.line) ||
        isLikelyFormLabel(entry.line)
      ) {
        continue;
      }
      const part = cleanedCandidateValue(entry.line, 60);
      if (
        part &&
        validPersonName(part) &&
        part.split(/\s+/u).length === 1
      ) {
        nameParts.push(part);
      }
    }
    for (let partIndex = 0; partIndex + 1 < nameParts.length; partIndex += 2) {
      const lastName = nameParts[partIndex];
      const givenNames = nameParts[partIndex + 1];
      const value = `${givenNames} ${lastName}`;
      if (validPersonName(value)) {
        candidates.push({
          value,
          page: marker.page,
          confidence: 0.93
        });
      }
    }
  }
  return uniqueCandidates(candidates);
}

function rtbRentalCandidates(lines) {
  const property = [];
  const unit = [];
  for (let index = 0; index < lines.length; index += 1) {
    const marker = lines[index];
    if (!/address\s+of\s+place\s+being\s+rented\s+to\s+tenant/iu.test(marker.line)) {
      continue;
    }
    const values = [];
    for (
      let followingIndex = index + 1;
      followingIndex < Math.min(lines.length, index + 16);
      followingIndex += 1
    ) {
      const entry = lines[followingIndex];
      if (entry.page !== marker.page) break;
      if (/address\s+for\s+service/iu.test(entry.line)) break;
      if (/^unit\s+number\b/iu.test(entry.line)) break;
      if (
        /^(?:street\s+number|city|province|postal\s+code)\b/iu.test(entry.line)
      ) {
        continue;
      }
      const value = cleanedCandidateValue(entry.line, 160);
      if (value) values.push({ value, page: entry.page });
    }
    const addressIndex = values.findIndex(({ value }) =>
      /^\d{2,6}\s+[\p{L}\d][\p{L}\d .,'’#/\-]{2,}$/u.test(value)
    );
    if (addressIndex < 0) continue;
    const address = values[addressIndex];
    if (validPropertyLabel(address.value)) {
      property.push({
        value: address.value,
        page: address.page,
        confidence: 0.96
      });
    }
    const possibleUnit = values[addressIndex - 1]?.value;
    if (
      possibleUnit &&
      possibleUnit.length <= 20 &&
      /^[\p{L}\d][\p{L}\d\-]{0,19}$/u.test(possibleUnit) &&
      validUnit(possibleUnit)
    ) {
      unit.push({
        value: possibleUnit,
        page: marker.page,
        confidence: 0.95
      });
    }
  }
  return {
    property: uniqueCandidates(property),
    unit: uniqueCandidates(unit)
  };
}

function tenantCandidatesFromOcr(ocrOutput) {
  const lines = ocrLines(ocrOutput.pages);
  const warnings = [];
  const structuredTenantCandidates = rtbStructuredTenantCandidates(lines);
  const rtbNames = rtbTenantNameCandidates(lines);
  const rtbRental = rtbRentalCandidates(lines);
  const fullNameCandidates = uniqueCandidates([
    ...labelCandidates(
      lines,
      [
        /^(?:tenant(?:'s)?\s+(?:full|legal)\s+name|legal\s+name\s+of\s+(?:the\s+)?tenant|name\s+of\s+(?:the\s+)?tenant)\s*(?:[:#\-]\s*)?(.*)$/iu,
        /^(?:tenant\s+name)\s*(?:[:#\-]\s*)?(.*)$/iu
      ],
      { validate: validPersonName }
    ),
    ...rtbNames,
    ...structuredTenantCandidates.map(({ fullName }) => fullName)
  ]);
  const fullName = selectCandidate(
    "full_name",
    fullNameCandidates,
    warnings
  );
  const propertyLabel = selectCandidate(
    "property",
    [
      ...labelCandidates(
        lines,
        [
          /^(?:address\s+of\s+(?:the\s+)?rental\s+unit|rental\s+unit\s+address|rental\s+address|property\s+(?:name|address)|premises\s+address)\s*(?:[:#\-]\s*)?(.*)$/iu
        ],
        { validate: validPropertyLabel }
      ),
      ...rtbRental.property
    ],
    warnings
  );
  const unitLabelCandidates = [
    ...labelCandidates(
      lines,
      [
        /^(?:unit|suite|apartment|apt)(?:\s+(?:number|no\.?))?\s*(?:[:#\-]\s*)?(.*)$/iu
      ],
      { validate: validUnit, directConfidence: 0.94, followingConfidence: 0.86 }
    ),
    ...rtbRental.unit
  ];
  if (unitLabelCandidates.length === 0 && propertyLabel) {
    const embeddedUnit = /(?:\bunit|\bsuite|\bapt\.?|#)\s*([\p{L}\d][\p{L}\d\-]{0,19})\b/iu.exec(propertyLabel.value);
    if (embeddedUnit && validUnit(embeddedUnit[1])) {
      unitLabelCandidates.push({
        value: embeddedUnit[1],
        page: propertyLabel.page,
        confidence: 0.82
      });
    }
  }
  const unitLabel = selectCandidate("unit", unitLabelCandidates, warnings);

  let emailCandidates = [
    ...labelCandidates(
      lines,
      [
        /^(?:(?:tenant(?:'s)?)\s+)?(?:email|e-mail)(?:\s+address)?\s*(?:[:#\-]\s*)?(.*)$/iu
      ],
      {
        normalize: normalizedEmail,
        validate: validEmail,
        directConfidence: 0.96,
        followingConfidence: 0.88
      }
    ),
    ...structuredTenantCandidates.map(({ email }) => email).filter(Boolean)
  ];
  if (emailCandidates.length === 0) {
    emailCandidates = globallyMatchedCandidates(
      lines,
      /[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9.-]+\.[A-Z]{2,63}/giu,
      normalizedEmail,
      validEmail,
      0.7
    );
  }
  const email = selectCandidate("email", emailCandidates, warnings);

  let phoneCandidates = [
    ...labelCandidates(
      lines,
      [
        /^(?:(?:tenant(?:'s)?)\s+)?(?:phone|telephone|mobile|cell)(?:\s+(?:number|no\.?))?\s*(?:[:#\-]\s*)?(.*)$/iu
      ],
      {
        normalize: normalizedPhone,
        validate: validPhone,
        directConfidence: 0.95,
        followingConfidence: 0.87
      }
    ),
    ...structuredTenantCandidates
      .map(({ phoneE164: candidate }) => candidate)
      .filter(Boolean)
  ];
  if (phoneCandidates.length === 0) {
    phoneCandidates = globallyMatchedCandidates(
      lines,
      /(?:\+?1[\s().-]*)?(?:\d[\s().-]*){10}\b/gu,
      normalizedPhone,
      validPhone,
      0.68
    );
  }
  const phoneE164 = selectCandidate("phone", phoneCandidates, warnings);

  const leaseStartDate = selectCandidate(
    "lease_start_date",
    labelCandidates(
      lines,
      [
        /^(?:move[\s-]?in\s+date|lease\s+start\s+date|tenancy\s+(?:start\s+date|begins)|start\s+of\s+tenancy)\s*(?:[:#\-]\s*)?(.*)$/iu
      ],
      {
        normalize: normalizedDate,
        validate: (value) => value !== null,
        directConfidence: 0.95,
        followingConfidence: 0.86
      }
    ),
    warnings
  );

  const leaseType = selectCandidate(
    "lease_type",
    labelCandidates(
      lines,
      [
        /^(?:lease|tenancy)\s+type\s*(?:[:#\-]\s*)?(.*)$/iu,
        /^(?:☒|■|✅|\[[xX]\]|[xX])\s*(?:A\))?\s*(.*month[\s-]*to[\s-]*month.*)$/iu,
        /^(?:☒|■|✅|\[[xX]\]|[xX])\s*(?:C\))?\s*(.*fixed[\s-]*term.*)$/iu
      ],
      {
        normalize: normalizedLeaseType,
        validate: validLeaseType,
        directConfidence: 0.97,
        followingConfidence: 0.85
      }
    ),
    warnings
  );

  const leaseEndDate = selectCandidate(
    "lease_end_date",
    labelCandidates(
      lines,
      [
        /^(?:lease|tenancy|fixed[\s-]*term)\s+end(?:ing)?\s+(?:date|on)\s*(?:[:#\-]\s*)?(.*)$/iu,
        /^(?:☒|■|✅|\[[xX]\]|[xX])\s*C\)\s*.*fixed[\s-]*term\s+ending\s+on\s*(.*)$/iu
      ],
      {
        normalize: normalizedDate,
        validate: (value) => value !== null,
        directConfidence: 0.97,
        followingConfidence: 0.85
      }
    ),
    warnings
  );

  const rentDueDay = selectCandidate(
    "rent_due_day",
    [
      ...labelCandidates(
        lines,
        [
          /^(?:(?:monthly\s+)?rent|payment)(?:\s+payment)?\s+(?:due\s+(?:date|day)|is\s+due)(?:\s+on)?\s*(?:[:#\-]\s*)?(.*)$/iu
        ],
        {
          normalize: normalizedRentDueDay,
          validate: validRentDueDay,
          directConfidence: 0.96,
          followingConfidence: 0.88
        }
      ),
      ...rtbRentDueDayCandidates(lines)
    ],
    warnings
  );

  const tenant = {
    fullName,
    fullNameCandidates,
    structuredTenantCandidates,
    propertyLabel,
    unitLabel,
    email,
    phoneE164,
    leaseType,
    leaseStartDate,
    leaseEndDate,
    rentDueDay
  };
  if (!fullName) warnings.push("missing_full_name");
  if (!propertyLabel) warnings.push("missing_property");
  if (!leaseType) warnings.push("missing_lease_type");
  if (!leaseStartDate) warnings.push("missing_lease_start_date");
  if (leaseType?.value === "fixed_term" && !leaseEndDate) {
    warnings.push("missing_lease_end_date");
  }
  if (fullName && fullName.confidence < 0.85) warnings.push("low_confidence_full_name");
  if (propertyLabel && propertyLabel.confidence < 0.85) warnings.push("low_confidence_property");
  const blankPageCount = ocrOutput.pages.filter(({ text }) => !text.trim()).length;
  if (blankPageCount > 0) warnings.push("one_or_more_blank_pages");

  const status = (
    fullName &&
    propertyLabel &&
    leaseType &&
    leaseStartDate &&
    (leaseType.value !== "fixed_term" || leaseEndDate) &&
    fullName.confidence >= 0.85 &&
    propertyLabel.confidence >= 0.85
  ) ? "ready" : "review_required";
  return { status, tenant, warnings: [...new Set(warnings)].sort() };
}

async function writeTenantCandidate(tenant, documentDigest, environment) {
  let root;
  try {
    root = await realpath(inputRoot(environment));
  } catch (error) {
    if (error?.code === "INPUT_DIRECTORY_REQUIRED") throw error;
    throw documentError(
      "CANDIDATE_DIRECTORY_INVALID",
      "The tenant candidate directory is unavailable."
    );
  }
  const candidateFile = `tenant-candidate-${randomUUID()}.json`;
  const candidatePath = join(root, candidateFile);
  const candidate = {
    sourceSystem: "openclaw",
    externalReference: documentDigest,
    fullName: tenant.fullName?.value ?? null,
    ...(tenant.fullNameCandidates.length > 1
      ? {
          fullNameCandidates: tenant.fullNameCandidates.map((candidate) => ({
            value: candidate.value,
            page: candidate.page,
            confidence: candidate.confidence
          }))
        }
      : {}),
    ...(tenant.structuredTenantCandidates.length > 0
      ? {
          tenantCandidates: tenant.structuredTenantCandidates.map(
            (candidate) => ({
              fullName: candidate.fullName.value,
              email: candidate.email?.value ?? null,
              phoneE164: candidate.phoneE164?.value ?? null,
              page: candidate.page,
              rowIndex: candidate.rowIndex,
              association: candidate.association,
              confidence: candidate.confidence
            })
          )
        }
      : {}),
    propertyLabel: tenant.propertyLabel?.value ?? null,
    unitLabel: tenant.unitLabel?.value ?? null,
    leaseType: tenant.leaseType?.value ?? null,
    leaseStartDate: tenant.leaseStartDate?.value ?? null,
    leaseEndDate: tenant.leaseEndDate?.value ?? null,
    rentDueDay: tenant.rentDueDay?.value ?? null,
    email: tenant.email?.value ?? null,
    phoneE164: tenant.phoneE164?.value ?? null
  };

  let handle;
  try {
    handle = await open(
      candidatePath,
      constants.O_WRONLY |
        constants.O_CREAT |
        constants.O_EXCL |
        constants.O_NOFOLLOW,
      0o600
    );
    await handle.writeFile(`${JSON.stringify(candidate, null, 2)}\n`, "utf8");
    await handle.chmod(0o600);
    await handle.sync();
  } catch {
    throw documentError(
      "CANDIDATE_WRITE_FAILED",
      "The tenant candidate could not be written."
    );
  } finally {
    await handle?.close().catch(() => {});
  }
  return candidateFile;
}

async function extractTenantDocument(options, environment, dependencies) {
  const optionKeys = Object.keys(options);
  if (
    optionKeys.length !== 1 ||
    !["input", "mediaRef"].includes(optionKeys[0])
  ) {
    throw documentError(
      "DOCUMENT_ARGUMENT_INVALID",
      "Use exactly one of --media-path or --input for documents inspect-tenant."
    );
  }
  if (
    options.mediaRef &&
    !/^media:\/\/inbound\/[A-Za-z0-9][A-Za-z0-9._-]{0,254}\.pdf$/u.test(
      options.mediaRef
    )
  ) {
    throw documentError(
      "DOCUMENT_MEDIA_REF_INVALID",
      "Direct media references require a shell-safe managed PDF basename; use --input for any other managed name."
    );
  }
  const input = options.mediaRef
    ? { mediaRef: options.mediaRef }
    : await readJsonInput(options.input, environment);
  const fileName = documentMediaBasename(input);
  const nowMs = typeof dependencies.now === "function"
    ? dependencies.now()
    : Date.now();
  if (!Number.isFinite(nowMs)) {
    throw documentError("DOCUMENT_CLOCK_INVALID", "The local clock is unavailable.");
  }
  const { bytes, digest } = await readInboundPdf(
    fileName,
    environment,
    nowMs
  );

  const temporaryDirectory = await mkdtemp(
    join(tmpdir(), "tingting-pdf-ocr-")
  );
  let ocrOutput;
  try {
    await chmod(temporaryDirectory, 0o700);
    const privatePdfPath = join(temporaryDirectory, "source.pdf");
    await writeFile(privatePdfPath, bytes, {
      flag: "wx",
      mode: 0o600
    });
    const runner = dependencies.runPdfOcr ?? runSwiftPdfOcr;
    ocrOutput = validatedOcrOutput(await runner({
      inputPath: privatePdfPath,
      temporaryDirectory,
      environment: ocrChildEnvironment(temporaryDirectory),
      timeoutMs: ocrTimeoutMs
    }));
  } catch (error) {
    if (error?.code?.startsWith?.("DOCUMENT_")) throw error;
    throw documentError("DOCUMENT_OCR_FAILED", "Local PDF OCR failed.");
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }

  const pageCount = ocrOutput.pageCount;
  const extraction = tenantCandidatesFromOcr(ocrOutput);
  ocrOutput = null;
  return { pageCount, digest, extraction };
}

async function inspectTenantDocument(options, environment, dependencies) {
  const { pageCount, digest, extraction } = await extractTenantDocument(
    options,
    environment,
    dependencies
  );
  const candidateFile = await writeTenantCandidate(
    extraction.tenant,
    digest,
    environment
  );
  return {
    status: extraction.status,
    pageCount,
    documentDigest: digest,
    candidateFile,
    contactDisclosure: maskedContactDisclosure(),
    tenant: {
      fullName: publicCandidate(extraction.tenant.fullName),
      fullNameCandidates: extraction.tenant.fullNameCandidates.map(
        (candidate) => publicCandidate(candidate)
      ),
      tenantCandidates: extraction.tenant.structuredTenantCandidates.map(
        (candidate) => ({
          fullName: publicCandidate(candidate.fullName),
          emailMasked: publicCandidate(candidate.email, maskedEmail),
          phoneMasked: publicCandidate(candidate.phoneE164, maskedPhone),
          page: candidate.page,
          rowIndex: candidate.rowIndex,
          association: candidate.association,
          confidence: candidate.confidence
        })
      ),
      propertyLabel: publicCandidate(extraction.tenant.propertyLabel),
      unitLabel: publicCandidate(extraction.tenant.unitLabel),
      leaseType: publicCandidate(extraction.tenant.leaseType),
      leaseStartDate: publicCandidate(extraction.tenant.leaseStartDate),
      leaseEndDate: publicCandidate(extraction.tenant.leaseEndDate),
      rentDueDay: publicCandidate(extraction.tenant.rentDueDay),
      emailMasked: publicCandidate(extraction.tenant.email, maskedEmail),
      phoneMasked: publicCandidate(extraction.tenant.phoneE164, maskedPhone)
    },
    warnings: extraction.warnings
  };
}

function normalizedDocumentIdentity(value) {
  return typeof value === "string"
    ? value
        .normalize("NFKC")
        .toLocaleLowerCase("en-CA")
        .replace(/[^\p{L}\p{N}]+/gu, "")
    : "";
}

function documentTenantError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function compatibleDocumentProperty(documentProperty, tenantProperty) {
  const documentValue = normalizedDocumentIdentity(documentProperty);
  const tenantValue = normalizedDocumentIdentity(tenantProperty);
  return (
    documentValue.length >= 6 &&
    tenantValue.length >= 6 &&
    (
      documentValue.includes(tenantValue) ||
      tenantValue.includes(documentValue)
    )
  );
}

async function updateTenantFromDocument(
  options,
  environment,
  dependencies
) {
  assertUuid(options.id, "--id");
  assertUuid(options.operationId, "--operation-id");
  const optionKeys = Object.keys(options).sort();
  const expectedKeys = options.mediaRef
    ? ["id", "mediaRef", "operationId"]
    : ["id", "input", "operationId"];
  if (
    optionKeys.length !== expectedKeys.length ||
    optionKeys.some((key, index) => key !== expectedKeys.sort()[index])
  ) {
    throw documentTenantError(
      "DOCUMENT_ARGUMENT_INVALID",
      "Use a tenant ID, operation ID, and exactly one current PDF input."
    );
  }

  const { pageCount, digest, extraction } = await extractTenantDocument(
    options.mediaRef
      ? { mediaRef: options.mediaRef }
      : { input: options.input },
    environment,
    dependencies
  );
  const client = dependencies.client ?? new TingTingApiClient({
    baseUrl: environment.TINGTING_API_BASE_URL,
    token: environment.TINGTING_AUTOMATION_TOKEN
  });
  const current = await client.request({
    method: "GET",
    path: `/tenants/${options.id}`
  });
  const tenant = current?.data?.tenant ?? current?.data;
  if (
    !tenant ||
    typeof tenant !== "object" ||
    tenant.id !== options.id ||
    typeof tenant.fullName !== "string" ||
    typeof tenant.updatedAt !== "string"
  ) {
    throw documentTenantError(
      "TENANT_RESPONSE_INVALID",
      "The target tenant could not be verified."
    );
  }

  const targetName = normalizedDocumentIdentity(tenant.fullName);
  const matches = extraction.tenant.structuredTenantCandidates.filter(
    (candidate) =>
      candidate.association === "bc_rtb_row_order" &&
      normalizedDocumentIdentity(candidate.fullName.value) === targetName
  );
  if (matches.length !== 1) {
    throw documentTenantError(
      "DOCUMENT_TENANT_MATCH_REQUIRED",
      "The current PDF does not contain exactly one row-matched target tenant."
    );
  }
  const match = matches[0];
  if (match.confidence < 0.85) {
    throw documentTenantError(
      "DOCUMENT_CONTACT_CONFIDENCE_LOW",
      "The target tenant contact row requires review."
    );
  }
  const extractedUnit = extraction.tenant.unitLabel?.value;
  if (
    extractedUnit &&
    tenant.unitLabel &&
    normalizedDocumentIdentity(extractedUnit) !==
      normalizedDocumentIdentity(tenant.unitLabel)
  ) {
    throw documentTenantError(
      "DOCUMENT_TENANT_PROPERTY_MISMATCH",
      "The PDF unit does not match the target tenant."
    );
  }
  const extractedProperty = extraction.tenant.propertyLabel?.value;
  if (
    extractedProperty &&
    tenant.propertyLabel &&
    !compatibleDocumentProperty(extractedProperty, tenant.propertyLabel)
  ) {
    throw documentTenantError(
      "DOCUMENT_TENANT_PROPERTY_MISMATCH",
      "The PDF property does not match the target tenant."
    );
  }

  const changes = {};
  if (match.email?.value) changes.email = match.email.value;
  if (match.phoneE164?.value) changes.phoneE164 = match.phoneE164.value;
  if (Object.keys(changes).length === 0) {
    throw documentTenantError(
      "DOCUMENT_CONTACT_MISSING",
      "The matched tenant row has no usable email or phone."
    );
  }
  const updated = await client.request({
    method: "PATCH",
    path: `/tenants/${options.id}`,
    body: {
      changes,
      expectedVersion: tenant.updatedAt
    },
    mutation: true,
    idempotencyKey: options.operationId
  });
  return {
    success: true,
    data: {
      action: "updated_from_document",
      contactDisclosure: maskedContactDisclosure({
        mode: "masked_write_confirmation",
        sourceValuesAppliedInFull: true,
        instruction:
          "The complete PDF contact values were applied. Fields ending in Masked are partial confirmation previews only; do not report them as the values written."
      }),
      tenant: {
        id: options.id,
        fullName: tenant.fullName,
        propertyLabel: tenant.propertyLabel ?? null,
        unitLabel: tenant.unitLabel ?? null,
        emailMasked: match.email
          ? maskedEmail(match.email.value)
          : null,
        phoneMasked: match.phoneE164
          ? maskedPhone(match.phoneE164.value)
          : null
      },
      matchedRow: {
        page: match.page,
        rowIndex: match.rowIndex,
        association: match.association,
        confidence: match.confidence
      },
      documentDigest: digest,
      pageCount,
      changedChannels: [
        ...(match.email ? ["email"] : []),
        ...(match.phoneE164 ? ["sms"] : [])
      ],
      permissionStatus: "unconfirmed"
    },
    requestId: updated?.requestId
  };
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

function normalizedText(value) {
  return typeof value === "string" ? value.trim().toLocaleLowerCase("en-CA") : "";
}

export function tenantUploadPayload(input) {
  const email = typeof input.email === "string" && input.email.trim()
    ? input.email.trim().toLocaleLowerCase("en-CA")
    : null;
  const phoneE164 = typeof input.phoneE164 === "string" && input.phoneE164.trim()
    ? input.phoneE164.trim()
    : null;
  const preferredChannels = input.preferredChannels ?? [
    ...(email ? ["email"] : []),
    ...(phoneE164 ? ["sms"] : [])
  ];
  if (preferredChannels.includes("email") && !email) {
    const error = new Error("preferredChannels includes email but no email address was supplied.");
    error.code = "LOCAL_VALIDATION_ERROR";
    throw error;
  }
  if (preferredChannels.includes("sms") && !phoneE164) {
    const error = new Error("preferredChannels includes sms but no E.164 phone number was supplied.");
    error.code = "LOCAL_VALIDATION_ERROR";
    throw error;
  }
  const leaseType = input.leaseType;
  const leaseStartDate = input.leaseStartDate ?? input.moveInDate ?? null;
  const leaseEndDate = input.leaseEndDate ?? null;
  if (!validLeaseType(leaseType)) {
    const error = new Error("Choose fixed term or month to month before creating the tenant.");
    error.code = "LOCAL_VALIDATION_ERROR";
    throw error;
  }
  if (!leaseStartDate) {
    const error = new Error("Lease start date is required before creating the tenant.");
    error.code = "LOCAL_VALIDATION_ERROR";
    throw error;
  }
  if (leaseType === "fixed_term" && !leaseEndDate) {
    const error = new Error("Fixed-term tenants require a lease end date.");
    error.code = "LOCAL_VALIDATION_ERROR";
    throw error;
  }
  if (leaseType === "month_to_month" && leaseEndDate) {
    const error = new Error("Month-to-month tenants cannot have a lease end date.");
    error.code = "LOCAL_VALIDATION_ERROR";
    throw error;
  }
  return {
    sourceSystem: input.sourceSystem?.trim() || "openclaw",
    externalReference: input.externalReference?.trim() || null,
    fullName: input.fullName.trim(),
    propertyLabel: input.propertyLabel.trim(),
    unitLabel: input.unitLabel?.trim() || null,
    leaseType,
    leaseStartDate,
    leaseEndDate,
    rentDueDay: input.rentDueDay ?? 1,
    email,
    phoneE164,
    preferredChannels,
    emailContactStatus: "unconfirmed",
    smsContactStatus: "unconfirmed",
    timezone: input.timezone?.trim() || "America/Vancouver",
    internalNotes: input.internalNotes?.trim() || null,
    isActive: input.isActive ?? true
  };
}

function exactTenantIdentityMatch(tenant, input) {
  return normalizedText(tenant.fullName) === normalizedText(input.fullName) &&
    normalizedText(tenant.propertyLabel) === normalizedText(input.propertyLabel) &&
    normalizedText(tenant.unitLabel) === normalizedText(input.unitLabel);
}

async function uploadTenant(client, rawInput, operationId) {
  const payload = tenantUploadPayload(rawInput);
  return createTenantAfterPreflight(client, payload, operationId, {
    path: "/tenants",
    body: payload,
    action: "created"
  });
}

async function createTenantAfterPreflight(
  client,
  payload,
  operationId,
  { path, body, action }
) {
  const query = payload.externalReference
    ? { q: payload.externalReference, limit: 100 }
    : { q: payload.fullName, limit: 100 };
  const items = [];
  let cursor;
  let search;
  for (let page = 0; page < 10; page += 1) {
    search = await client.request({
      method: "GET",
      path: `/tenants${queryString({ ...query, cursor })}`
    });
    if (Array.isArray(search?.data?.items)) items.push(...search.data.items);
    cursor = search?.data?.nextCursor;
    if (!cursor) break;
  }
  if (cursor) {
    const error = new Error("Tenant duplicate preflight exceeded 1,000 matches. Narrow the request before creating.");
    error.code = "TENANT_SEARCH_TRUNCATED";
    throw error;
  }
  const externalMatch = payload.externalReference
    ? items.find((tenant) =>
        tenant.sourceSystem === payload.sourceSystem &&
        tenant.externalReference === payload.externalReference
      )
    : null;
  if (externalMatch) {
    return {
      success: true,
      data: {
        action: "existing",
        created: false,
        reason: "external_reference_match",
        tenant: externalMatch
      },
      requestId: search.requestId
    };
  }
  const identityMatch = items.find((tenant) => exactTenantIdentityMatch(tenant, payload));
  if (identityMatch) {
    const error = new Error("A tenant with the same name, property, and unit already exists. Review it before updating.");
    error.code = "TENANT_REVIEW_REQUIRED";
    error.tenantId = identityMatch.id;
    throw error;
  }
  const created = await client.request({
    method: "POST",
    path,
    body,
    mutation: true,
    idempotencyKey: operationId
  });
  return {
    ...created,
    data: {
      action,
      created: true,
      ...(created.data?.tenant
        ? created.data
        : { tenant: created.data })
    }
  };
}

async function onboardTenant(client, rawInput, operationId) {
  const payload = tenantUploadPayload(rawInput);
  if (!payload.email) {
    const error = new Error("PDF tenant onboarding requires an email address.");
    error.code = "LOCAL_VALIDATION_ERROR";
    throw error;
  }
  return createTenantAfterPreflight(client, payload, operationId, {
    path: "/tenant-onboardings",
    body: {
      tenant: payload,
      ownerConfirmation: rawInput.ownerConfirmation
    },
    action: "onboarded"
  });
}

function sha256(bytes) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

async function multipartCommand(client, commandKey, options, environment) {
  const input = await readJsonInput(options.input, environment);
  if (schemaUrls[commandKey]) await validateWithSchema(schemaUrls[commandKey], input);
  if (typeof input.file !== "string") throw new Error("Input JSON must contain a file path.");
  const maximumBytes = commandKey === "rentals upload-media" ? 8 * 1024 * 1024 : 10 * 1024 * 1024;
  const { path: filePath, bytes } = await readAllowedFile(input.file, environment, maximumBytes);
  const extension = extname(filePath).toLowerCase();
  const allowedExtensions = commandKey === "rentals upload-media"
    ? new Set([".jpg", ".jpeg", ".png", ".webp", ".avif"])
    : new Set([".csv", ".xlsx"]);
  if (!allowedExtensions.has(extension)) {
    throw new Error(`Unsupported ${commandKey === "rentals upload-media" ? "media" : "tenant import"} file extension.`);
  }
  const form = new FormData();
  form.set("file", new Blob([bytes]), filePath.split("/").at(-1));
  if (commandKey === "rentals upload-media") {
    if (typeof input.altText !== "string" || !input.altText.trim()) throw new Error("altText is required.");
    form.set("altText", input.altText.trim());
    const digest = sha256(bytes);
    if (input.sourceDigest && input.sourceDigest !== digest) {
      throw new Error("sourceDigest does not match the selected media file.");
    }
    form.set("sourceDigest", digest);
    return client.request({
      method: "POST",
      path: "/media",
      form,
      mutation: true,
      idempotencyKey: options.operationId
    });
  }
  if (!["create_only", "create_or_update"].includes(input.mode)) throw new Error("mode is invalid.");
  if (typeof input.sourceSystem !== "string" || !input.sourceSystem.trim()) throw new Error("sourceSystem is required.");
  form.set("mode", input.mode);
  form.set("sourceSystem", input.sourceSystem.trim());
  return client.request({
    method: "POST",
    path: "/tenant-imports",
    form,
    mutation: true,
    idempotencyKey: options.operationId
  });
}

export async function run(argv, environment = process.env, dependencies = {}) {
  const { commandKey, command, options } = parseArgv(argv);
  if (options.help) {
    if (Object.keys(options).length !== 1) {
      throw new Error("--help cannot be combined with other arguments.");
    }
    return commandHelp(commandKey);
  }
  if (commandKey === "documents inspect-tenant") {
    return inspectTenantDocument(options, environment, dependencies);
  }
  if (commandKey === "documents update-tenant") {
    return updateTenantFromDocument(options, environment, dependencies);
  }
  const client = dependencies.client ?? new TingTingApiClient({
    baseUrl: environment.TINGTING_API_BASE_URL,
    token: environment.TINGTING_AUTOMATION_TOKEN
  });
  const mutation = Boolean(command?.mutation || ["rentals upload-media", "imports create"].includes(commandKey));
  if (mutation) assertUuid(options.operationId, "--operation-id");
  if (!mutation && options.operationId) throw new Error("--operation-id is only valid for mutations.");
  if (["rentals upload-media", "imports create"].includes(commandKey)) {
    return multipartCommand(client, commandKey, options, environment);
  }
  if (commandKey === "payments upload-receipt") {
    const input = await readJsonInput(options.input, environment);
    await validateWithSchema(schemaUrls[commandKey], input);
    const receipt = await readInboundReceipt(input.mediaRef, environment);
    const form = new FormData();
    form.set("tenantId", input.tenantId);
    form.set("period", input.period);
    form.set(
      "file",
      new Blob([receipt.bytes], { type: receipt.mimeType }),
      receipt.fileName
    );
    return client.request({
      method: "POST",
      path: "/payment-receipts",
      form,
      mutation: true,
      idempotencyKey: options.operationId
    });
  }
  if (command.id) assertUuid(options.id, "--id");
  if (command.tenantId) assertUuid(options.tenantId, "--tenant-id");
  const input = command.input || command.query
    ? await readJsonInput(options.input, environment)
    : undefined;
  if (schemaUrls[commandKey]) await validateWithSchema(schemaUrls[commandKey], input);
  if (commandKey === "tenants upload") return uploadTenant(client, input, options.operationId);
  if (commandKey === "tenants onboard") return onboardTenant(client, input, options.operationId);
  if (commandKey === "payments get") {
    return client.request({
      method: "GET",
      path: `/tenants/${options.tenantId}/rent-payments?period=${encodeURIComponent(input.period)}`
    });
  }
  if (commandKey === "payments mark-collected") {
    const { period, ...body } = input;
    return client.request({
      method: "PUT",
      path: `/tenants/${options.tenantId}/rent-payments/${period}/collected`,
      body,
      mutation: true,
      idempotencyKey: options.operationId
    });
  }
  let path = command.path(options);
  if (command.query) path += queryString(input);
  return client.request({
    method: command.method,
    path,
    body: command.input
      ? input
      : commandKey.startsWith("agent-notifications ")
        ? {}
        : undefined,
    mutation,
    idempotencyKey: options.operationId
  });
}

const isMain = process.argv[1] &&
  import.meta.url === pathToFileURL(realpathSync(resolve(process.argv[1]))).href;
if (isMain) {
  run(process.argv.slice(2))
    .then((result) => process.stdout.write(`${JSON.stringify(result)}\n`))
    .catch((error) => {
      process.stderr.write(`${JSON.stringify({
        success: false,
        error: {
          code: error?.code ?? "TINGTINGCTL_ERROR",
          message: error instanceof Error ? error.message : "The command failed.",
          tenantId: error?.tenantId,
          validationIssues: error?.validationIssues
        },
        requestId: error?.requestId
      })}\n`);
      process.exitCode = 1;
    });
}
