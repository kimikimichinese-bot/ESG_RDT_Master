import process from "node:process";
import readline from "node:readline/promises";
import { randomUUID } from "node:crypto";
import {
  STORAGE_SECRET_FILE_ENV,
  buildRedirectUri,
  createCliError,
  maskSecret,
  openBrowser,
  parseArgs,
  pickValue,
  readTenantStoragePrefill,
  updateLocalSecretFile,
  waitForOAuthCallback,
} from "./onedrive-auth.mjs";

const DEFAULT_SCOPE = "https://www.googleapis.com/auth/drive https://www.googleapis.com/auth/userinfo.email";
const DEFAULT_PORT = 8789;

const toCleanString = (value) => (typeof value === "string" ? value.trim() : "");

export const buildGoogleAuthorizationUrl = ({ clientId, redirectUri, state }) => {
  if (!toCleanString(clientId) || !toCleanString(redirectUri) || !toCleanString(state)) {
    throw createCliError("gdrive_oauth_input_missing", "clientId, redirectUri, and state are required.");
  }
  const params = new URLSearchParams();
  params.set("client_id", toCleanString(clientId));
  params.set("redirect_uri", redirectUri);
  params.set("response_type", "code");
  params.set("scope", DEFAULT_SCOPE);
  params.set("access_type", "offline");
  params.set("include_granted_scopes", "true");
  params.set("prompt", "consent");
  params.set("state", state);
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
};

export const exchangeGoogleAuthorizationCode = async ({ clientId, clientSecret, redirectUri, code }) => {
  const params = new URLSearchParams();
  params.set("client_id", toCleanString(clientId));
  params.set("client_secret", toCleanString(clientSecret));
  params.set("code", toCleanString(code));
  params.set("grant_type", "authorization_code");
  params.set("redirect_uri", redirectUri);

  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: params.toString(),
    cache: "no-store",
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw createCliError(
      "gdrive_oauth_token_exchange_failed",
      payload?.error_description || payload?.error || `Google token exchange failed with HTTP ${response.status}.`,
    );
  }
  const refreshToken = toCleanString(payload?.refresh_token);
  if (!refreshToken) {
    throw createCliError(
      "gdrive_refresh_token_missing",
      "Google did not return a refresh token. Verify consent screen and prompt=consent.",
    );
  }
  return {
    refreshToken,
    accessToken: toCleanString(payload?.access_token) || "",
    tokenType: toCleanString(payload?.token_type) || "Bearer",
    expiresAt:
      Number.isFinite(Number(payload?.expires_in)) && Number(payload.expires_in) > 0
        ? new Date(Date.now() + Number(payload.expires_in) * 1000).toISOString()
        : null,
    scope: toCleanString(payload?.scope) || DEFAULT_SCOPE,
  };
};

export const fetchGoogleDriveSummary = async ({ accessToken, driveId, rootFolderId }) => {
  const headers = {
    Authorization: `Bearer ${accessToken}`,
  };
  const aboutResponse = await fetch("https://www.googleapis.com/drive/v3/about?fields=user", {
    headers,
    cache: "no-store",
  });
  const about = aboutResponse.ok ? await aboutResponse.json() : null;

  let drive = null;
  if (toCleanString(driveId)) {
    const driveResponse = await fetch(
      `https://www.googleapis.com/drive/v3/drives/${encodeURIComponent(driveId)}?fields=id,name`,
      {
        headers,
        cache: "no-store",
      },
    );
    drive = driveResponse.ok ? await driveResponse.json() : null;
  }

  let rootFolder = null;
  if (toCleanString(rootFolderId)) {
    const folderResponse = await fetch(
      `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(rootFolderId)}?supportsAllDrives=true&fields=id,name,driveId,webViewLink`,
      {
        headers,
        cache: "no-store",
      },
    );
    rootFolder = folderResponse.ok ? await folderResponse.json() : null;
  }

  return {
    accountEmail: about?.user?.emailAddress || null,
    driveId: drive?.id || toCleanString(driveId) || rootFolder?.driveId || null,
    driveName: drive?.name || null,
    rootFolderId: rootFolder?.id || toCleanString(rootFolderId) || null,
    rootFolderName: rootFolder?.name || null,
  };
};

export const runGoogleDriveLocalAuth = async ({
  argv = process.argv.slice(2),
  stdin = process.stdin,
  stdout = process.stdout,
} = {}) => {
  if (!toCleanString(process.env[STORAGE_SECRET_FILE_ENV])) {
    throw createCliError("storage_secret_env_missing", `${STORAGE_SECRET_FILE_ENV} must be set before running this helper.`);
  }

  const cli = parseArgs(argv);
  const prefill = await readTenantStoragePrefill({ tenantId: cli.tenantId, provider: "google_drive" });
  const rl = readline.createInterface({ input: stdin, output: stdout });

  try {
    const tenantId = await pickValue(rl, "Tenant ID", cli.tenantId, prefill?.tenantId || "");
    const secretReference = await pickValue(
      rl,
      "Secret reference",
      cli.secretReference,
      prefill?.secretReference || (tenantId ? `kv://tenant/${tenantId}/storage/google_drive/default` : ""),
    );
    const clientId = await pickValue(rl, "Google client ID", cli.clientId, "");
    const clientSecret = await pickValue(rl, "Google client secret", cli.clientSecret, "", { secret: true });
    const driveId = await pickValue(rl, "Shared drive ID (optional)", cli.driveId, prefill?.driveId || "");
    const rootFolderId = await pickValue(rl, "Root folder ID (optional)", cli.rootFolderId, prefill?.rootFolderId || "");
    const port = cli.port || DEFAULT_PORT;
    const timeoutMs = cli.timeoutMs;

    if (!tenantId || !secretReference || !clientId || !clientSecret) {
      throw createCliError("gdrive_oauth_input_missing", "tenantId, secretReference, clientId, and clientSecret are required.");
    }

    const state = randomUUID();
    const redirectUri = buildRedirectUri({ port });
    const authUrl = buildGoogleAuthorizationUrl({ clientId, redirectUri, state });

    stdout.write(`\nGoogle Drive local OAuth helper\n`);
    stdout.write(`- Tenant: ${tenantId}\n`);
    stdout.write(`- Secret reference: ${secretReference}\n`);
    stdout.write(`- Secret file: ${process.env[STORAGE_SECRET_FILE_ENV]}\n`);
    stdout.write(`- Redirect URI: ${redirectUri}\n`);
    stdout.write(`- Scope: ${DEFAULT_SCOPE}\n`);

    const callbackPromise = waitForOAuthCallback({
      expectedState: state,
      port,
      timeoutMs,
    });

    stdout.write(`\nOpening Google login in the default browser...\n`);
    if (!cli.noOpen) {
      await openBrowser(authUrl);
    }
    stdout.write(`If the browser does not open, use this URL manually:\n${authUrl}\n\n`);

    const callback = await callbackPromise;
    const tokens = await exchangeGoogleAuthorizationCode({
      clientId,
      clientSecret,
      redirectUri,
      code: callback.code,
    });
    const saved = await updateLocalSecretFile({
      secretReference,
      clientId,
      clientSecret,
      refreshToken: tokens.refreshToken,
      accessToken: tokens.accessToken,
      tokenType: tokens.tokenType,
      expiresAt: tokens.expiresAt,
      scope: tokens.scope,
    });
    const summary = tokens.accessToken
      ? await fetchGoogleDriveSummary({
          accessToken: tokens.accessToken,
          driveId,
          rootFolderId,
        }).catch(() => null)
      : null;

    stdout.write(`Success\n`);
    stdout.write(`- Secret reference updated: ${saved.secretReference}\n`);
    stdout.write(`- Local secret file: ${saved.filePath}\n`);
    stdout.write(`- Tenant ID: ${tenantId}\n`);
    stdout.write(`- Refresh token stored: ${maskSecret(tokens.refreshToken)}\n`);
    if (summary?.accountEmail) {
      stdout.write(`- Google account: ${summary.accountEmail}\n`);
    }
    if (summary?.driveId) {
      stdout.write(`- Drive: ${summary.driveName || summary.driveId}\n`);
    }
    if (summary?.rootFolderId) {
      stdout.write(`- Root folder: ${summary.rootFolderName || summary.rootFolderId}\n`);
    }
    stdout.write(`\nNext step:\n`);
    stdout.write(`- vai in /app/settings/storage-backup\n`);
    stdout.write(`- verifica backend google_drive\n`);
    stdout.write(`- lancia Test connection\n`);
    stdout.write(`- lancia Test preview\n`);
    stdout.write(`- lancia Test upload\n`);

    return {
      tenantId,
      secretReference: saved.secretReference,
      filePath: saved.filePath,
      summary,
    };
  } finally {
    rl.close();
  }
};
