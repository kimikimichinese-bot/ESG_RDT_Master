import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const ORIGINAL_ENV = { ...process.env };
const ORIGINAL_FETCH = global.fetch;
const tmpDirs = [];

const writeSecretFile = async (payload) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "storage-onedrive-test-"));
  tmpDirs.push(dir);
  const filePath = path.join(dir, "storage-secrets.local.json");
  await fs.writeFile(filePath, JSON.stringify(payload, null, 2), "utf-8");
  return filePath;
};

const jsonResponse = (payload, status = 200) =>
  new Response(JSON.stringify(payload), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
    },
  });

const textResponse = (payload, status = 200, contentType = "text/plain; charset=utf-8") =>
  new Response(payload, {
    status,
    headers: {
      "content-type": contentType,
    },
  });

const oneDriveConfig = {
  authMode: "client_credentials",
  externalTenantId: "external-tenant-id",
  driveId: "drive-123",
  rootFolderId: "root-folder-id",
  rootFolderPath: "",
  secretReference: "kv://tenant/tenant-a/storage/onedrive/default",
  folderStrategy: "custom",
  customFolderPattern: "",
  filenameStrategy: "original_filename",
};

afterEach(async () => {
  process.env = { ...ORIGINAL_ENV };
  global.fetch = ORIGINAL_FETCH;
  vi.restoreAllMocks();
  vi.resetModules();
  while (tmpDirs.length > 0) {
    const dir = tmpDirs.pop();
    await fs.rm(dir, { recursive: true, force: true });
  }
});

describe("OneDrive storage adapter", () => {
  it("uploads evidence and returns storage metadata", async () => {
    process.env.STORAGE_SECRET_FILE = await writeSecretFile({
      "kv://tenant/tenant-a/storage/onedrive/default": {
        clientId: "client-id",
        clientSecret: "client-secret",
      },
    });

    global.fetch = vi.fn(async (url) => {
      const target = String(url || "");
      if (target.includes("/oauth2/v2.0/token")) {
        return jsonResponse({ access_token: "graph-token", token_type: "Bearer", expires_in: 3600 });
      }
      if (target.includes("/items/root-folder-id?")) {
        return jsonResponse({ id: "root-folder-id", name: "Root", folder: {} });
      }
      if (target.includes("/items/root-folder-id:/") && !target.includes(":/content")) {
        return jsonResponse({ id: "folder-123", name: "default", folder: {} });
      }
      if (target.includes(":/content")) {
        return jsonResponse({
          id: "file-123",
          webUrl: "https://contoso.sharepoint.com/file-123",
          parentReference: {
            driveId: "drive-123",
            id: "root-folder-id",
          },
        });
      }
      throw new Error(`Unexpected fetch call: ${target}`);
    });

    const { uploadOneDriveEvidence } = await import("../../app/api/v1/_lib/storage-onedrive.js");
    const result = await uploadOneDriveEvidence({
      config: oneDriveConfig,
      tenantId: "tenant-a",
      filename: "evidence.pdf",
      contentType: "application/pdf",
      fileBuffer: Buffer.from("pdf-content"),
      metadata: {
        siteId: "site-a",
        docType: "policy",
      },
    });

    expect(result.externalFileId).toBe("file-123");
    expect(result.externalDriveId).toBe("drive-123");
    expect(result.storageKey).toContain("evidence");
    expect(global.fetch).toHaveBeenCalledTimes(4);
  });

  it("streams OneDrive evidence through the server-side proxy", async () => {
    process.env.STORAGE_SECRET_FILE = await writeSecretFile({
      "kv://tenant/tenant-a/storage/onedrive/default": {
        clientId: "client-id",
        clientSecret: "client-secret",
      },
    });

    global.fetch = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ access_token: "graph-token", token_type: "Bearer", expires_in: 3600 }))
      .mockResolvedValueOnce(textResponse("pdf-binary", 200, "application/pdf"));

    const { streamOneDriveEvidence } = await import("../../app/api/v1/_lib/storage-onedrive.js");
    const response = await streamOneDriveEvidence({
      config: oneDriveConfig,
      evidence: {
        externalFileId: "file-123",
        filename: "evidence.pdf",
        contentType: "application/pdf",
      },
      disposition: "inline",
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/pdf");
    await expect(response.text()).resolves.toBe("pdf-binary");
  });
});
