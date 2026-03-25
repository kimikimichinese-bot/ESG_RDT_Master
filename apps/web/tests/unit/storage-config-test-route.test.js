import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const ORIGINAL_ENV = { ...process.env };
const ORIGINAL_FETCH = global.fetch;
const tmpDirs = [];

const writeSecretFile = async (payload) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "storage-config-test-route-"));
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

afterEach(async () => {
  process.env = { ...ORIGINAL_ENV };
  global.fetch = ORIGINAL_FETCH;
  vi.restoreAllMocks();
  vi.resetModules();
  vi.unmock("../../app/api/v1/_lib/enterprise-api.js");
  vi.unmock("../../app/api/v1/_lib/storage-config.js");
  while (tmpDirs.length > 0) {
    const dir = tmpDirs.pop();
    await fs.rm(dir, { recursive: true, force: true });
  }
});

describe("storage-config test route", () => {
  it("runs a live OneDrive connection check when onedrive is selected", async () => {
    process.env.STORAGE_SECRET_FILE = await writeSecretFile({
      "kv://tenant/tenant-a/storage/onedrive/default": {
        clientId: "client-id",
        clientSecret: "client-secret",
      },
    });

    global.fetch = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ access_token: "graph-token", token_type: "Bearer", expires_in: 3600 }))
      .mockResolvedValueOnce(jsonResponse({ id: "drive-123", name: "Finance Drive" }))
      .mockResolvedValueOnce(jsonResponse({ id: "root-123", name: "Evidence Root", folder: {} }));

    vi.doMock("../../app/api/v1/_lib/enterprise-api.js", () => ({
      requireTenantContext: vi.fn(async () => ({
        context: {
          sql: vi.fn(),
          isSuperadmin: false,
          user: { id: "user-a" },
          membership: { role: "TenantAdmin" },
        },
      })),
    }));
    vi.doMock("../../app/api/v1/_lib/storage-config.js", async () => {
      const actual = await vi.importActual("../../app/api/v1/_lib/storage-config.js");
      return {
        ...actual,
        getTenantStorageConfigBundle: vi.fn(async () => ({
          config: null,
          companyOverrides: [],
          summary: null,
        })),
      };
    });

    const { POST } = await import("../../app/api/v1/tenants/[id]/storage-config/test/route.js");
    const response = await POST(
      new Request("http://localhost/api/v1/tenants/tenant-a/storage-config/test", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          mode: "connection",
          config: {
            storageMode: "customer_managed",
            primaryBackend: "onedrive",
            repositoryDisplayName: "OneDrive vault",
            authMode: "client_credentials",
            externalTenantId: "external-tenant-id",
            driveId: "drive-123",
            rootFolderId: "root-123",
            previewSupported: true,
            allowPlatformUpload: true,
            allowReferenceOnlyMode: false,
            downloadAccessMode: "proxy_stream",
            previewMode: "platform_viewer",
            backupProfile: "no_backup",
            backupFrequency: "daily",
            backupVerificationMode: "none",
            folderStrategy: "tenant_company_year",
            filenameStrategy: "timestamp_original",
            enforceChecksum: true,
            duplicatePolicy: "warn_on_same_hash",
            versioningMode: "auto_version_on_replace",
            migrationMode: "new_uploads_only",
            legacyAccessFallback: true,
            migrationStatus: "not_started",
            secretReference: "kv://tenant/tenant-a/storage/onedrive/default",
          },
        }),
      }),
      { params: { id: "tenant-a" } },
    );

    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.healthStatus).toBe("healthy");
    expect(Array.isArray(body.checks)).toBe(true);
    expect(body.checks.some((item) => item.key === "drive_access" && item.status === "ok")).toBe(true);
    expect(body.checks.some((item) => item.key === "root_folder_access" && item.status === "ok")).toBe(true);
  });

  it("runs a live Dropbox connection check when dropbox is selected", async () => {
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
      .mockResolvedValueOnce(jsonResponse({ account_id: "dbid:123", email: "admin@example.com" }))
      .mockResolvedValueOnce(jsonResponse({ id: "id:root", path_display: "/Evidence", name: "Evidence" }));

    vi.doMock("../../app/api/v1/_lib/enterprise-api.js", () => ({
      requireTenantContext: vi.fn(async () => ({
        context: {
          sql: vi.fn(),
          isSuperadmin: false,
          user: { id: "user-a" },
          membership: { role: "TenantAdmin" },
        },
      })),
    }));
    vi.doMock("../../app/api/v1/_lib/storage-config.js", async () => {
      const actual = await vi.importActual("../../app/api/v1/_lib/storage-config.js");
      return {
        ...actual,
        getTenantStorageConfigBundle: vi.fn(async () => ({
          config: null,
          companyOverrides: [],
          summary: null,
        })),
      };
    });

    const { POST } = await import("../../app/api/v1/tenants/[id]/storage-config/test/route.js");
    const response = await POST(
      new Request("http://localhost/api/v1/tenants/tenant-a/storage-config/test", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          mode: "connection",
          config: {
            storageMode: "customer_managed",
            primaryBackend: "dropbox",
            repositoryDisplayName: "Dropbox vault",
            authMode: "oauth_delegated",
            rootFolderPath: "/Evidence",
            previewSupported: true,
            allowPlatformUpload: true,
            allowReferenceOnlyMode: false,
            downloadAccessMode: "proxy_stream",
            previewMode: "platform_viewer",
            backupProfile: "no_backup",
            backupFrequency: "daily",
            backupVerificationMode: "none",
            folderStrategy: "tenant_company_year",
            filenameStrategy: "timestamp_original",
            enforceChecksum: true,
            duplicatePolicy: "warn_on_same_hash",
            versioningMode: "auto_version_on_replace",
            migrationMode: "new_uploads_only",
            legacyAccessFallback: true,
            migrationStatus: "not_started",
            secretReference: "kv://tenant/tenant-a/storage/dropbox/default",
          },
        }),
      }),
      { params: { id: "tenant-a" } },
    );

    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.healthStatus).toBe("healthy");
    expect(body.checks.some((item) => item.key === "account_access" && item.status === "ok")).toBe(true);
    expect(body.checks.some((item) => item.key === "root_folder_access" && item.status === "ok")).toBe(true);
  });

  it("runs a live Google Drive connection check when google_drive is selected", async () => {
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
      .mockResolvedValueOnce(jsonResponse({ user: { emailAddress: "admin@example.com" } }))
      .mockResolvedValueOnce(jsonResponse({ id: "folder-123", name: "Evidence Root", driveId: "drive-123" }));

    vi.doMock("../../app/api/v1/_lib/enterprise-api.js", () => ({
      requireTenantContext: vi.fn(async () => ({
        context: {
          sql: vi.fn(),
          isSuperadmin: false,
          user: { id: "user-a" },
          membership: { role: "TenantAdmin" },
        },
      })),
    }));
    vi.doMock("../../app/api/v1/_lib/storage-config.js", async () => {
      const actual = await vi.importActual("../../app/api/v1/_lib/storage-config.js");
      return {
        ...actual,
        getTenantStorageConfigBundle: vi.fn(async () => ({
          config: null,
          companyOverrides: [],
          summary: null,
        })),
      };
    });

    const { POST } = await import("../../app/api/v1/tenants/[id]/storage-config/test/route.js");
    const response = await POST(
      new Request("http://localhost/api/v1/tenants/tenant-a/storage-config/test", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          mode: "connection",
          config: {
            storageMode: "customer_managed",
            primaryBackend: "google_drive",
            repositoryDisplayName: "Google Drive vault",
            authMode: "oauth_delegated",
            driveId: "drive-123",
            rootFolderId: "folder-123",
            previewSupported: true,
            allowPlatformUpload: true,
            allowReferenceOnlyMode: false,
            downloadAccessMode: "proxy_stream",
            previewMode: "platform_viewer",
            backupProfile: "no_backup",
            backupFrequency: "daily",
            backupVerificationMode: "none",
            folderStrategy: "tenant_company_year",
            filenameStrategy: "timestamp_original",
            enforceChecksum: true,
            duplicatePolicy: "warn_on_same_hash",
            versioningMode: "auto_version_on_replace",
            migrationMode: "new_uploads_only",
            legacyAccessFallback: true,
            migrationStatus: "not_started",
            secretReference: "kv://tenant/tenant-a/storage/google_drive/default",
          },
        }),
      }),
      { params: { id: "tenant-a" } },
    );

    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.healthStatus).toBe("healthy");
    expect(body.checks.some((item) => item.key === "account_access" && item.status === "ok")).toBe(true);
    expect(body.checks.some((item) => item.key === "root_folder_access" && item.status === "ok")).toBe(true);
  });
});
