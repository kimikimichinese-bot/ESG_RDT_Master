import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const ORIGINAL_ENV = { ...process.env };
const tmpDirs = [];

const importStorageSecrets = async () => import("../../app/api/v1/_lib/storage-secrets.js");

const writeSecretFile = async (payload) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "storage-secrets-test-"));
  tmpDirs.push(dir);
  const filePath = path.join(dir, "storage-secrets.local.json");
  await fs.writeFile(filePath, payload, "utf-8");
  return filePath;
};

afterEach(async () => {
  process.env = { ...ORIGINAL_ENV };
  vi.restoreAllMocks();
  vi.resetModules();
  while (tmpDirs.length > 0) {
    const dir = tmpDirs.pop();
    await fs.rm(dir, { recursive: true, force: true });
  }
});

describe("storage secret resolver", () => {
  it("resolves a valid secret reference", async () => {
    const filePath = await writeSecretFile(
      JSON.stringify({
        "kv://tenant/tenant-a/storage/onedrive/default": {
          clientId: "client-id",
          clientSecret: "client-secret",
          refreshToken: "refresh-token",
        },
      }),
    );
    process.env.STORAGE_SECRET_FILE = filePath;

    const { resolveStorageSecret } = await importStorageSecrets();
    const payload = await resolveStorageSecret("kv://tenant/tenant-a/storage/onedrive/default");

    expect(payload.clientId).toBe("client-id");
    expect(payload.clientSecret).toBe("client-secret");
  });

  it("fails when env is missing", async () => {
    delete process.env.STORAGE_SECRET_FILE;
    const { loadStorageSecretStore } = await importStorageSecrets();

    await expect(loadStorageSecretStore()).rejects.toMatchObject({
      code: "storage_secret_env_missing",
    });
  });

  it("fails when file is missing", async () => {
    process.env.STORAGE_SECRET_FILE = path.join(os.tmpdir(), "definitely-missing-storage-secret-file.json");
    const { loadStorageSecretStore } = await importStorageSecrets();

    await expect(loadStorageSecretStore()).rejects.toMatchObject({
      code: "storage_secret_file_not_found",
    });
  });

  it("fails when JSON is invalid", async () => {
    const filePath = await writeSecretFile("{not-json");
    process.env.STORAGE_SECRET_FILE = filePath;
    const { loadStorageSecretStore } = await importStorageSecrets();

    await expect(loadStorageSecretStore()).rejects.toMatchObject({
      code: "storage_secret_invalid_json",
    });
  });

  it("fails when reference is not found", async () => {
    const filePath = await writeSecretFile(
      JSON.stringify({
        "kv://tenant/tenant-a/storage/onedrive/default": {
          clientId: "client-id",
        },
      }),
    );
    process.env.STORAGE_SECRET_FILE = filePath;
    const { resolveStorageSecret } = await importStorageSecrets();

    await expect(resolveStorageSecret("kv://tenant/tenant-a/storage/onedrive/secondary")).rejects.toMatchObject({
      code: "storage_secret_reference_not_found",
    });
  });

  it("fails when payload is malformed", async () => {
    const filePath = await writeSecretFile(
      JSON.stringify({
        "kv://tenant/tenant-a/storage/onedrive/default": {},
      }),
    );
    process.env.STORAGE_SECRET_FILE = filePath;
    const { resolveStorageSecret } = await importStorageSecrets();

    await expect(resolveStorageSecret("kv://tenant/tenant-a/storage/onedrive/default")).rejects.toMatchObject({
      code: "storage_secret_payload_empty",
    });
  });
});
