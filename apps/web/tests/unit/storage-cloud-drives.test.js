import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const ORIGINAL_ENV = { ...process.env };
const ORIGINAL_FETCH = global.fetch;
const tmpDirs = [];

const writeSecretFile = async (payload) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "storage-cloud-drives-test-"));
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

describe("Dropbox storage adapter", () => {
  it("uploads evidence and returns storage metadata", async () => {
    process.env.STORAGE_SECRET_FILE = await writeSecretFile({
      "kv://tenant/tenant-a/storage/dropbox/default": {
        appKey: "dropbox-client-id",
        appSecret: "dropbox-client-secret",
        refreshToken: "dropbox-refresh-token",
      },
    });

    global.fetch = vi.fn(async (url) => {
      const target = String(url || "");
      if (target === "https://api.dropbox.com/oauth2/token") {
        return jsonResponse({ access_token: "dropbox-token", token_type: "Bearer", expires_in: 3600 });
      }
      if (target.endsWith("/files/create_folder_v2")) {
        return jsonResponse({
          metadata: {
            id: "id:folder",
            path_display: "/Biosphere Evidence Test/WINDWARD/2026/GHG Scope 2/Energy Bills",
          },
        });
      }
      if (target.endsWith("/files/upload")) {
        return jsonResponse({
          id: "id:file-123",
          path_display: "/Biosphere Evidence Test/WINDWARD/2026/GHG Scope 2/Energy Bills/evidence.pdf",
        });
      }
      throw new Error(`Unexpected Dropbox fetch call: ${target}`);
    });

    const { uploadDropboxEvidence } = await import("../../app/api/v1/_lib/storage-dropbox.js");
    const result = await uploadDropboxEvidence({
      config: {
        authMode: "oauth_delegated",
        secretReference: "kv://tenant/tenant-a/storage/dropbox/default",
        rootFolderPath: "/Biosphere Evidence Test",
        folderStrategy: "tenant_company_year",
        filenameStrategy: "original_filename",
      },
      tenantId: "tenant-a",
      filename: "evidence.pdf",
      fileBuffer: Buffer.from("pdf-content"),
      metadata: {
        tenantName: "WINDWARD",
        companyName: "Biosphere Evidence Test",
        moduleName: "GHG Scope 2",
        categoryName: "Energy Bills",
        issueDate: "2026-03-24",
      },
    });

    expect(result.externalFileId).toBe("id:file-123");
    expect(result.storageKey).toContain("/Biosphere Evidence Test/WINDWARD/2026/GHG Scope 2/Energy Bills/");
    expect(global.fetch.mock.calls.length).toBeGreaterThanOrEqual(5);
  });

  it("streams Dropbox evidence through the server-side proxy", async () => {
    process.env.STORAGE_SECRET_FILE = await writeSecretFile({
      "kv://tenant/tenant-a/storage/dropbox/default": {
        appKey: "dropbox-client-id",
        appSecret: "dropbox-client-secret",
        refreshToken: "dropbox-refresh-token",
      },
    });

    global.fetch = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ access_token: "dropbox-token", token_type: "Bearer", expires_in: 3600 }))
      .mockResolvedValueOnce(textResponse("dropbox-binary", 200, "application/pdf"));

    const { streamDropboxEvidence } = await import("../../app/api/v1/_lib/storage-dropbox.js");
    const response = await streamDropboxEvidence({
      config: {
        authMode: "oauth_delegated",
        secretReference: "kv://tenant/tenant-a/storage/dropbox/default",
      },
      evidence: {
        externalFileId: "id:file-123",
        filename: "evidence.pdf",
        contentType: "application/pdf",
      },
      disposition: "inline",
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/pdf");
    await expect(response.text()).resolves.toBe("dropbox-binary");
  });
});

describe("Google Drive storage adapter", () => {
  it("uploads evidence and returns storage metadata", async () => {
    process.env.STORAGE_SECRET_FILE = await writeSecretFile({
      "kv://tenant/tenant-a/storage/google_drive/default": {
        clientId: "google-client-id",
        clientSecret: "google-client-secret",
        refreshToken: "google-refresh-token",
      },
    });

    global.fetch = vi.fn(async (url) => {
      const target = String(url || "");
      if (target === "https://oauth2.googleapis.com/token") {
        return jsonResponse({ access_token: "google-token", token_type: "Bearer", expires_in: 3600 });
      }
      if (target.includes("/files/root-folder-id?")) {
        return jsonResponse({ id: "root-folder-id", name: "Evidence Root", driveId: "drive-123" });
      }
      if (target.includes("/drive/v3/files?") && target.includes("mimeType%3D%27application%2Fvnd.google-apps.folder%27")) {
        return jsonResponse({ files: [] });
      }
      if (target.startsWith("https://www.googleapis.com/drive/v3/files?supportsAllDrives=true")) {
        return jsonResponse({ id: "folder-123", name: "tenant-a", driveId: "drive-123" });
      }
      if (target.startsWith("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart")) {
        return jsonResponse({ id: "file-123", driveId: "drive-123", webViewLink: "https://drive.google.com/file/d/file-123/view" });
      }
      throw new Error(`Unexpected Google Drive fetch call: ${target}`);
    });

    const { uploadGoogleDriveEvidence } = await import("../../app/api/v1/_lib/storage-google-drive.js");
    const result = await uploadGoogleDriveEvidence({
      config: {
        authMode: "oauth_delegated",
        secretReference: "kv://tenant/tenant-a/storage/google_drive/default",
        rootFolderId: "root-folder-id",
        driveId: "drive-123",
        folderStrategy: "tenant_company_year",
        filenameStrategy: "original_filename",
      },
      tenantId: "tenant-a",
      filename: "evidence.pdf",
      contentType: "application/pdf",
      fileBuffer: Buffer.from("pdf-content"),
      metadata: {
        tenantName: "WINDWARD",
        companyName: "Biosphere Evidence Test",
        moduleName: "Governance",
        categoryName: "Policies",
        issueDate: "2026-03-24",
      },
    });

    expect(result.externalFileId).toBe("file-123");
    expect(result.externalDriveId).toBe("drive-123");
    expect(result.storageKey).toContain("WINDWARD/Biosphere Evidence Test/2026/Governance/Policies/evidence.pdf");
  });

  it("streams Google Drive evidence through the server-side proxy", async () => {
    process.env.STORAGE_SECRET_FILE = await writeSecretFile({
      "kv://tenant/tenant-a/storage/google_drive/default": {
        clientId: "google-client-id",
        clientSecret: "google-client-secret",
        refreshToken: "google-refresh-token",
      },
    });

    global.fetch = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ access_token: "google-token", token_type: "Bearer", expires_in: 3600 }))
      .mockResolvedValueOnce(textResponse("google-binary", 200, "application/pdf"));

    const { streamGoogleDriveEvidence } = await import("../../app/api/v1/_lib/storage-google-drive.js");
    const response = await streamGoogleDriveEvidence({
      config: {
        authMode: "oauth_delegated",
        secretReference: "kv://tenant/tenant-a/storage/google_drive/default",
      },
      evidence: {
        externalFileId: "file-123",
        filename: "evidence.pdf",
        contentType: "application/pdf",
      },
      disposition: "attachment",
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/pdf");
    await expect(response.text()).resolves.toBe("google-binary");
  });
});
