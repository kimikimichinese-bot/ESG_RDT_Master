import { afterEach, describe, expect, it, vi } from "vitest";

const ORIGINAL_FETCH = global.fetch;

afterEach(async () => {
  global.fetch = ORIGINAL_FETCH;
  vi.restoreAllMocks();
  vi.resetModules();
});

describe("Dropbox local auth helper", () => {
  it("builds the Dropbox authorization URL with offline token access", async () => {
    const { buildDropboxAuthorizationUrl } = await import("../../../../scripts/dev/_lib/dropbox-auth.mjs");
    const url = new URL(
      buildDropboxAuthorizationUrl({
        clientId: "dropbox-client-id",
        redirectUri: "http://127.0.0.1:8788/callback",
        state: "expected-state",
      }),
    );

    expect(url.origin).toBe("https://www.dropbox.com");
    expect(url.searchParams.get("token_access_type")).toBe("offline");
    expect(url.searchParams.get("state")).toBe("expected-state");
  });

  it("fails token exchange when Dropbox does not return a refresh token", async () => {
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

    const { exchangeDropboxAuthorizationCode } = await import("../../../../scripts/dev/_lib/dropbox-auth.mjs");
    await expect(
      exchangeDropboxAuthorizationCode({
        clientId: "dropbox-client-id",
        clientSecret: "dropbox-client-secret",
        redirectUri: "http://127.0.0.1:8788/callback",
        code: "auth-code",
      }),
    ).rejects.toMatchObject({
      code: "dropbox_refresh_token_missing",
    });
  });
});

describe("Google Drive local auth helper", () => {
  it("builds the Google Drive authorization URL with offline access", async () => {
    const { buildGoogleAuthorizationUrl } = await import("../../../../scripts/dev/_lib/google-drive-auth.mjs");
    const url = new URL(
      buildGoogleAuthorizationUrl({
        clientId: "google-client-id",
        redirectUri: "http://127.0.0.1:8789/callback",
        state: "expected-state",
      }),
    );

    expect(url.origin).toBe("https://accounts.google.com");
    expect(url.searchParams.get("access_type")).toBe("offline");
    expect(url.searchParams.get("prompt")).toBe("consent");
    expect(url.searchParams.get("state")).toBe("expected-state");
  });

  it("fails token exchange when Google does not return a refresh token", async () => {
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

    const { exchangeGoogleAuthorizationCode } = await import("../../../../scripts/dev/_lib/google-drive-auth.mjs");
    await expect(
      exchangeGoogleAuthorizationCode({
        clientId: "google-client-id",
        clientSecret: "google-client-secret",
        redirectUri: "http://127.0.0.1:8789/callback",
        code: "auth-code",
      }),
    ).rejects.toMatchObject({
      code: "gdrive_refresh_token_missing",
    });
  });
});
