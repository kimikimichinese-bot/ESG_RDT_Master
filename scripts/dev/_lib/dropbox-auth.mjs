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

const DEFAULT_SCOPE = "files.content.write files.content.read account_info.read";
const DEFAULT_PORT = 8788;

const toCleanString = (value) => (typeof value === "string" ? value.trim() : "");

export const buildDropboxAuthorizationUrl = ({ clientId, redirectUri, state }) => {
  if (!toCleanString(clientId) || !toCleanString(redirectUri) || !toCleanString(state)) {
    throw createCliError("dropbox_oauth_input_missing", "clientId, redirectUri, and state are required.");
  }
  const params = new URLSearchParams();
  params.set("client_id", toCleanString(clientId));
  params.set("response_type", "code");
  params.set("token_access_type", "offline");
  params.set("redirect_uri", redirectUri);
  params.set("state", state);
  return `https://www.dropbox.com/oauth2/authorize?${params.toString()}`;
};

export const exchangeDropboxAuthorizationCode = async ({ clientId, clientSecret, redirectUri, code }) => {
  const params = new URLSearchParams();
  params.set("code", toCleanString(code));
  params.set("grant_type", "authorization_code");
  params.set("client_id", toCleanString(clientId));
  params.set("client_secret", toCleanString(clientSecret));
  params.set("redirect_uri", redirectUri);

  const response = await fetch("https://api.dropbox.com/oauth2/token", {
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
      "dropbox_oauth_token_exchange_failed",
      payload?.error_description || payload?.error_summary || `Dropbox token exchange failed with HTTP ${response.status}.`,
    );
  }
  const refreshToken = toCleanString(payload?.refresh_token);
  if (!refreshToken) {
    throw createCliError("dropbox_refresh_token_missing", "Dropbox did not return a refresh token.");
  }
  return {
    refreshToken,
    accessToken: toCleanString(payload?.access_token) || "",
    tokenType: "Bearer",
    expiresAt:
      Number.isFinite(Number(payload?.expires_in)) && Number(payload.expires_in) > 0
        ? new Date(Date.now() + Number(payload.expires_in) * 1000).toISOString()
        : null,
    scope: DEFAULT_SCOPE,
  };
};

export const fetchDropboxSummary = async ({ accessToken, rootFolderPath }) => {
  const headers = {
    Authorization: `Bearer ${accessToken}`,
    "Content-Type": "application/json",
  };
  const accountResponse = await fetch("https://api.dropboxapi.com/2/users/get_current_account", {
    method: "POST",
    headers,
    body: "null",
    cache: "no-store",
  });
  const account = accountResponse.ok ? await accountResponse.json() : null;

  let rootFolder = null;
  const normalizedRoot = toCleanString(rootFolderPath);
  if (normalizedRoot) {
    const metadataResponse = await fetch("https://api.dropboxapi.com/2/files/get_metadata", {
      method: "POST",
      headers,
      body: JSON.stringify({
        path: normalizedRoot,
      }),
      cache: "no-store",
    });
    rootFolder = metadataResponse.ok ? await metadataResponse.json() : null;
  }

  return {
    accountId: account?.account_id || null,
    accountEmail: account?.email || null,
    accountName: account?.name?.display_name || null,
    rootFolderPath: rootFolder?.path_display || normalizedRoot || null,
    rootFolderId: rootFolder?.id || null,
  };
};

export const runDropboxLocalAuth = async ({
  argv = process.argv.slice(2),
  stdin = process.stdin,
  stdout = process.stdout,
} = {}) => {
  if (!toCleanString(process.env[STORAGE_SECRET_FILE_ENV])) {
    throw createCliError("storage_secret_env_missing", `${STORAGE_SECRET_FILE_ENV} must be set before running this helper.`);
  }

  const cli = parseArgs(argv);
  const prefill = await readTenantStoragePrefill({ tenantId: cli.tenantId, provider: "dropbox" });
  const rl = readline.createInterface({ input: stdin, output: stdout });

  try {
    const tenantId = await pickValue(rl, "Tenant ID", cli.tenantId, prefill?.tenantId || "");
    const secretReference = await pickValue(
      rl,
      "Secret reference",
      cli.secretReference,
      prefill?.secretReference || (tenantId ? `kv://tenant/${tenantId}/storage/dropbox/default` : ""),
    );
    const clientId = await pickValue(rl, "Dropbox app key / client ID", cli.clientId, "");
    const clientSecret = await pickValue(rl, "Dropbox app secret / client secret", cli.clientSecret, "", { secret: true });
    const rootFolderPath = await pickValue(rl, "Root folder path (optional)", cli.rootFolderPath, prefill?.rootFolderPath || "");
    const port = cli.port || DEFAULT_PORT;
    const timeoutMs = cli.timeoutMs;

    if (!tenantId || !secretReference || !clientId || !clientSecret) {
      throw createCliError("dropbox_oauth_input_missing", "tenantId, secretReference, clientId, and clientSecret are required.");
    }

    const state = randomUUID();
    const redirectUri = buildRedirectUri({ port });
    const authUrl = buildDropboxAuthorizationUrl({ clientId, redirectUri, state });

    stdout.write(`\nDropbox local OAuth helper\n`);
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

    stdout.write(`\nOpening Dropbox login in the default browser...\n`);
    if (!cli.noOpen) {
      await openBrowser(authUrl);
    }
    stdout.write(`If the browser does not open, use this URL manually:\n${authUrl}\n\n`);

    const callback = await callbackPromise;
    const tokens = await exchangeDropboxAuthorizationCode({
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
      ? await fetchDropboxSummary({
          accessToken: tokens.accessToken,
          rootFolderPath,
        }).catch(() => null)
      : null;

    stdout.write(`Success\n`);
    stdout.write(`- Secret reference updated: ${saved.secretReference}\n`);
    stdout.write(`- Local secret file: ${saved.filePath}\n`);
    stdout.write(`- Tenant ID: ${tenantId}\n`);
    stdout.write(`- Refresh token stored: ${maskSecret(tokens.refreshToken)}\n`);
    if (summary?.accountEmail || summary?.accountId) {
      stdout.write(`- Dropbox account: ${summary?.accountEmail || summary?.accountId}\n`);
    }
    if (summary?.rootFolderPath) {
      stdout.write(`- Root folder: ${summary.rootFolderPath}\n`);
    }
    stdout.write(`\nNext step:\n`);
    stdout.write(`- vai in /app/settings/storage-backup\n`);
    stdout.write(`- verifica backend dropbox\n`);
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
