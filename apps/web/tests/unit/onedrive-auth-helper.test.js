import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const ORIGINAL_ENV = { ...process.env };
const ORIGINAL_FETCH = global.fetch;
const tmpDirs = [];

const writeSecretFile = async (payload) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "onedrive-auth-helper-"));
  tmpDirs.push(dir);
  const filePath = path.join(dir, "storage-secrets.local.json");
  await fs.writeFile(filePath, JSON.stringify(payload, null, 2), "utf-8");
  return filePath;
};

afterEach(async () => {
  process.env = { ...ORIGINAL_ENV };
  global.fetch = ORIGINAL_FETCH;
  vi.restoreAllMocks();
  vi.resetModules();
  vi.unmock("node:http");
  while (tmpDirs.length > 0) {
    const dir = tmpDirs.pop();
    await fs.rm(dir, { recursive: true, force: true });
  }
});

describe("OneDrive local auth helper", () => {
  it("updates only the targeted secret reference in the local JSON file", async () => {
    process.env.STORAGE_SECRET_FILE = await writeSecretFile({
      "kv://tenant/tenant-a/storage/onedrive/default": {
        clientId: "old-client-id",
      },
      "kv://tenant/tenant-b/storage/onedrive/default": {
        clientId: "other-client-id",
      },
    });

    const { updateLocalSecretFile } = await import("../../../../scripts/dev/_lib/onedrive-auth.mjs");
    await updateLocalSecretFile({
      secretReference: "kv://tenant/tenant-a/storage/onedrive/default",
      clientId: "client-id",
      clientSecret: "client-secret",
      refreshToken: "refresh-token",
      accessToken: "access-token",
      tokenType: "Bearer",
      expiresAt: "2026-12-31T23:59:59.000Z",
      scope: "offline_access Files.ReadWrite.All User.Read",
    });

    const updated = JSON.parse(await fs.readFile(process.env.STORAGE_SECRET_FILE, "utf-8"));
    expect(updated["kv://tenant/tenant-a/storage/onedrive/default"].refreshToken).toBe("refresh-token");
    expect(updated["kv://tenant/tenant-b/storage/onedrive/default"].clientId).toBe("other-client-id");
  });

  it("receives the localhost callback and validates state", async () => {
    const writeHead = vi.fn();
    const end = vi.fn();
    vi.doMock("node:http", () => {
      let handler = null;
      return {
        default: {
          createServer(callback) {
            handler = callback;
            return {
              once: vi.fn(),
              listen: vi.fn(() => {
                setTimeout(() => {
                  handler(
                    {
                      method: "GET",
                      url: "/callback?code=auth-code&state=expected-state",
                    },
                    { writeHead, end },
                  );
                }, 0);
              }),
              close: vi.fn((cb) => cb?.()),
            };
          },
        },
        createServer(callback) {
          handler = callback;
          return {
            once: vi.fn(),
            listen: vi.fn(() => {
              setTimeout(() => {
                handler(
                  {
                    method: "GET",
                    url: "/callback?code=auth-code&state=expected-state",
                  },
                  { writeHead, end },
                );
              }, 0);
            }),
            close: vi.fn((cb) => cb?.()),
          };
        },
      };
    });
    const { waitForOAuthCallback } = await import("../../../../scripts/dev/_lib/onedrive-auth.mjs");
    const callbackPromise = waitForOAuthCallback({
      expectedState: "expected-state",
      port: 8787,
      timeoutMs: 5000,
    });
    await expect(callbackPromise).resolves.toMatchObject({
      code: "auth-code",
      state: "expected-state",
    });
    expect(writeHead).toHaveBeenCalledWith(200, { "Content-Type": "text/html; charset=utf-8" });
  });

  it("fails when the callback times out", async () => {
    vi.doMock("node:http", () => ({
      default: {
        createServer() {
          return {
            once: vi.fn(),
            listen: vi.fn(),
            close: vi.fn((cb) => cb?.()),
          };
        },
      },
      createServer() {
        return {
          once: vi.fn(),
          listen: vi.fn(),
          close: vi.fn((cb) => cb?.()),
        };
      },
    }));
    const { waitForOAuthCallback } = await import("../../../../scripts/dev/_lib/onedrive-auth.mjs");
    await expect(
      waitForOAuthCallback({
        expectedState: "expected-state",
        port: 8787,
        timeoutMs: 50,
      }),
    ).rejects.toMatchObject({
      code: "onedrive_oauth_timeout",
    });
  });

  it("fails clearly when the local callback port is already in use", async () => {
    vi.doMock("node:http", () => ({
      default: {
        createServer() {
          let errorHandler = null;
          return {
            once: vi.fn((event, callback) => {
              if (event === "error") {
                errorHandler = callback;
              }
            }),
            listen: vi.fn(() => {
              errorHandler?.(Object.assign(new Error("listen EADDRINUSE"), { code: "EADDRINUSE" }));
            }),
            close: vi.fn((cb) => cb?.()),
          };
        },
      },
      createServer() {
        let errorHandler = null;
        return {
          once: vi.fn((event, callback) => {
            if (event === "error") {
              errorHandler = callback;
            }
          }),
          listen: vi.fn(() => {
            errorHandler?.(Object.assign(new Error("listen EADDRINUSE"), { code: "EADDRINUSE" }));
          }),
          close: vi.fn((cb) => cb?.()),
        };
      },
    }));
    const { waitForOAuthCallback } = await import("../../../../scripts/dev/_lib/onedrive-auth.mjs");
    await expect(
      waitForOAuthCallback({
        expectedState: "expected-state",
        port: 8787,
        timeoutMs: 5000,
      }),
    ).rejects.toMatchObject({
      code: "onedrive_oauth_port_in_use",
    });
  });

  it("fails token exchange when Microsoft does not return a refresh token", async () => {
    global.fetch = vi.fn(async () =>
      new Response(
        JSON.stringify({
          access_token: "access-token",
          token_type: "Bearer",
          expires_in: 3600,
        }),
        {
          status: 200,
          headers: { "content-type": "application/json; charset=utf-8" },
        },
      ),
    );

    const { exchangeAuthorizationCode } = await import("../../../../scripts/dev/_lib/onedrive-auth.mjs");
    await expect(
      exchangeAuthorizationCode({
        clientId: "client-id",
        clientSecret: "client-secret",
        externalTenantId: "external-tenant-id",
        redirectUri: "http://127.0.0.1:8787/callback",
        code: "auth-code",
      }),
    ).rejects.toMatchObject({
      code: "onedrive_refresh_token_missing",
    });
  });
});
