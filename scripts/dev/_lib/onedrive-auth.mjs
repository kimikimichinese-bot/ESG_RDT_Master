import http from "node:http";
import readline from "node:readline/promises";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import process from "node:process";
import { saveStorageSecretEntry, STORAGE_SECRET_FILE_ENV } from "../../../apps/web/app/api/v1/_lib/storage-secrets.js";

const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_PORT = 8787;
const DEFAULT_TIMEOUT_MS = 180_000;
const DEFAULT_SCOPES = ["offline_access", "Files.ReadWrite.All", "User.Read"];

const toCleanString = (value) => (typeof value === "string" ? value.trim() : "");

const createCliError = (code, message, details = {}) => {
  const error = new Error(message);
  error.code = code;
  error.details = details;
  return error;
};

export const maskSecret = (value) => {
  const normalized = toCleanString(value);
  if (!normalized) {
    return "";
  }
  if (normalized.length <= 8) {
    return `${normalized.slice(0, 2)}***${normalized.slice(-2)}`;
  }
  return `${normalized.slice(0, 4)}***${normalized.slice(-4)}`;
};

export const parseArgs = (argv = []) => {
  const result = {
    tenantId: "",
    secretReference: "",
    clientId: "",
    clientSecret: "",
    externalTenantId: "",
    driveId: "",
    rootFolderId: "",
    rootFolderPath: "",
    port: DEFAULT_PORT,
    timeoutMs: DEFAULT_TIMEOUT_MS,
    scope: DEFAULT_SCOPES.join(" "),
    noOpen: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const current = argv[index];
    if (!current.startsWith("--")) {
      continue;
    }
    const key = current.slice(2);
    const nextValue = argv[index + 1];
    if (key === "no-open") {
      result.noOpen = true;
      continue;
    }
    if (nextValue == null || nextValue.startsWith("--")) {
      continue;
    }
    if (key === "tenant-id") {
      result.tenantId = nextValue;
    } else if (key === "secret-reference") {
      result.secretReference = nextValue;
    } else if (key === "client-id") {
      result.clientId = nextValue;
    } else if (key === "client-secret") {
      result.clientSecret = nextValue;
    } else if (key === "external-tenant-id") {
      result.externalTenantId = nextValue;
    } else if (key === "drive-id") {
      result.driveId = nextValue;
    } else if (key === "root-folder-id") {
      result.rootFolderId = nextValue;
    } else if (key === "root-folder-path") {
      result.rootFolderPath = nextValue;
    } else if (key === "port") {
      result.port = Number.parseInt(nextValue, 10) || DEFAULT_PORT;
    } else if (key === "timeout-sec") {
      result.timeoutMs = Math.max(1, Number.parseInt(nextValue, 10) || DEFAULT_TIMEOUT_MS / 1000) * 1000;
    } else if (key === "scope") {
      result.scope = nextValue;
    }
    index += 1;
  }

  if (!result.secretReference && result.tenantId) {
    result.secretReference = `kv://tenant/${result.tenantId}/storage/onedrive/default`;
  }

  return result;
};

export const buildRedirectUri = ({ host = DEFAULT_HOST, port = DEFAULT_PORT } = {}) => `http://${host}:${port}/callback`;

export const buildMicrosoftAuthorizationUrl = ({
  clientId,
  externalTenantId,
  redirectUri,
  state,
  scope = DEFAULT_SCOPES.join(" "),
}) => {
  const normalizedClientId = toCleanString(clientId);
  const normalizedTenantId = toCleanString(externalTenantId);
  if (!normalizedClientId || !normalizedTenantId || !redirectUri || !state) {
    throw createCliError("onedrive_oauth_input_missing", "clientId, externalTenantId, redirectUri, and state are required.");
  }

  const params = new URLSearchParams();
  params.set("client_id", normalizedClientId);
  params.set("response_type", "code");
  params.set("redirect_uri", redirectUri);
  params.set("response_mode", "query");
  params.set("scope", scope);
  params.set("state", state);
  params.set("prompt", "select_account");
  return `https://login.microsoftonline.com/${encodeURIComponent(normalizedTenantId)}/oauth2/v2.0/authorize?${params.toString()}`;
};

const renderHtml = (title, message) => `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>${title}</title>
    <style>
      body { font-family: -apple-system, BlinkMacSystemFont, sans-serif; margin: 40px; color: #102a43; }
      .card { max-width: 640px; padding: 24px; border: 1px solid #d9e2ec; border-radius: 12px; background: #f8fbff; }
      h1 { margin-top: 0; }
    </style>
  </head>
  <body>
    <div class="card">
      <h1>${title}</h1>
      <p>${message}</p>
      <p>You can return to the terminal.</p>
    </div>
  </body>
</html>`;

export const waitForOAuthCallback = async ({
  expectedState,
  host = DEFAULT_HOST,
  port = DEFAULT_PORT,
  timeoutMs = DEFAULT_TIMEOUT_MS,
} = {}) =>
  new Promise((resolve, reject) => {
    let settled = false;
    let timeoutHandle = null;
    let server = null;

    const finalize = async (callback) => {
      if (settled) {
        return;
      }
      settled = true;
      if (timeoutHandle) {
        clearTimeout(timeoutHandle);
      }
      if (server) {
        await new Promise((closeResolve) => server.close(() => closeResolve()));
      }
      callback();
    };

    server = http.createServer((request, response) => {
      const requestUrl = new URL(request.url || "/", `http://${host}:${port}`);
      if (request.method !== "GET" || requestUrl.pathname !== "/callback") {
        response.writeHead(404, { "Content-Type": "text/html; charset=utf-8" });
        response.end(renderHtml("Not Found", "This local OAuth callback only accepts GET /callback."));
        return;
      }

      const callbackState = toCleanString(requestUrl.searchParams.get("state"));
      const authCode = toCleanString(requestUrl.searchParams.get("code"));
      const oauthError = toCleanString(requestUrl.searchParams.get("error"));
      const oauthErrorDescription = toCleanString(requestUrl.searchParams.get("error_description"));

      if (oauthError) {
        response.writeHead(400, { "Content-Type": "text/html; charset=utf-8" });
        response.end(renderHtml("Microsoft Login Failed", oauthErrorDescription || oauthError));
        void finalize(() => reject(createCliError("onedrive_oauth_callback_error", oauthErrorDescription || oauthError)));
        return;
      }

      if (!callbackState || callbackState !== expectedState) {
        response.writeHead(400, { "Content-Type": "text/html; charset=utf-8" });
        response.end(renderHtml("State Validation Failed", "The OAuth callback state did not match the expected request."));
        void finalize(() => reject(createCliError("onedrive_oauth_state_mismatch", "OAuth state validation failed.")));
        return;
      }

      if (!authCode) {
        response.writeHead(400, { "Content-Type": "text/html; charset=utf-8" });
        response.end(renderHtml("Authorization Code Missing", "Microsoft did not return an authorization code."));
        void finalize(() => reject(createCliError("onedrive_oauth_code_missing", "Authorization code was missing in the callback.")));
        return;
      }

      response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      response.end(renderHtml("Microsoft Login Completed", "Authorization succeeded. The terminal will finish the token exchange."));
      void finalize(() =>
        resolve({
          code: authCode,
          state: callbackState,
        }),
      );
    });

    server.once("error", (error) => {
      const code = error?.code === "EADDRINUSE" ? "onedrive_oauth_port_in_use" : "onedrive_oauth_server_error";
      void finalize(() => reject(createCliError(code, error?.message || "Failed to start the local OAuth callback server.")));
    });

    timeoutHandle = setTimeout(() => {
      void finalize(() => reject(createCliError("onedrive_oauth_timeout", "Timed out waiting for the Microsoft OAuth callback.")));
    }, timeoutMs);

    server.listen(port, host);
  });

export const exchangeAuthorizationCode = async ({
  clientId,
  clientSecret,
  externalTenantId,
  redirectUri,
  code,
  scope = DEFAULT_SCOPES.join(" "),
}) => {
  const params = new URLSearchParams();
  params.set("client_id", toCleanString(clientId));
  params.set("client_secret", toCleanString(clientSecret));
  params.set("grant_type", "authorization_code");
  params.set("code", toCleanString(code));
  params.set("redirect_uri", redirectUri);
  params.set("scope", scope);

  const response = await fetch(
    `https://login.microsoftonline.com/${encodeURIComponent(toCleanString(externalTenantId))}/oauth2/v2.0/token`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: params.toString(),
      cache: "no-store",
    },
  );

  let payload = null;
  try {
    payload = await response.json();
  } catch (_error) {
    payload = null;
  }

  if (!response.ok) {
    throw createCliError(
      "onedrive_oauth_token_exchange_failed",
      payload?.error_description || payload?.error || `Microsoft token exchange failed with HTTP ${response.status}.`,
    );
  }

  const refreshToken = toCleanString(payload?.refresh_token);
  if (!refreshToken) {
    throw createCliError(
      "onedrive_refresh_token_missing",
      "Microsoft did not return a refresh_token. Verify delegated consent and offline_access scope.",
    );
  }

  const expiresAt =
    Number.isFinite(Number(payload?.expires_in)) && Number(payload.expires_in) > 0
      ? new Date(Date.now() + Number(payload.expires_in) * 1000).toISOString()
      : null;

  return {
    refreshToken,
    accessToken: toCleanString(payload?.access_token) || "",
    tokenType: toCleanString(payload?.token_type) || "Bearer",
    expiresAt,
    scope: toCleanString(payload?.scope) || scope,
  };
};

export const fetchGraphSummary = async ({ accessToken, driveId, rootFolderId, rootFolderPath }) => {
  const headers = {
    Authorization: `Bearer ${accessToken}`,
  };

  const driveResponse = await fetch(
    driveId
      ? `https://graph.microsoft.com/v1.0/drives/${encodeURIComponent(driveId)}?$select=id,name,driveType,webUrl`
      : "https://graph.microsoft.com/v1.0/me/drive?$select=id,name,driveType,webUrl",
    { headers, cache: "no-store" },
  );
  const drive = driveResponse.ok ? await driveResponse.json() : null;

  let rootFolder = null;
  if (drive?.id && toCleanString(rootFolderId)) {
    const response = await fetch(
      `https://graph.microsoft.com/v1.0/drives/${encodeURIComponent(drive.id)}/items/${encodeURIComponent(rootFolderId)}?$select=id,name,webUrl`,
      { headers, cache: "no-store" },
    );
    rootFolder = response.ok ? await response.json() : null;
  } else if (drive?.id && toCleanString(rootFolderPath)) {
    const response = await fetch(
      `https://graph.microsoft.com/v1.0/drives/${encodeURIComponent(drive.id)}/root:/${rootFolderPath
        .split("/")
        .map((segment) => encodeURIComponent(segment))
        .join("/")}?$select=id,name,webUrl`,
      { headers, cache: "no-store" },
    );
    rootFolder = response.ok ? await response.json() : null;
  }

  return {
    driveId: drive?.id || toCleanString(driveId) || null,
    driveName: drive?.name || null,
    driveType: drive?.driveType || null,
    driveWebUrl: drive?.webUrl || null,
    rootFolderId: rootFolder?.id || toCleanString(rootFolderId) || null,
    rootFolderName: rootFolder?.name || null,
    rootFolderWebUrl: rootFolder?.webUrl || null,
  };
};

export const updateLocalSecretFile = async ({
  secretReference,
  clientId,
  clientSecret,
  refreshToken,
  accessToken,
  tokenType,
  expiresAt,
  scope,
}) =>
  saveStorageSecretEntry(secretReference, {
    clientId: toCleanString(clientId),
    clientSecret: toCleanString(clientSecret),
    refreshToken: toCleanString(refreshToken),
    accessToken: toCleanString(accessToken) || undefined,
    tokenType: toCleanString(tokenType) || undefined,
    expiresAt: toCleanString(expiresAt) || undefined,
    scope: toCleanString(scope) || undefined,
  });

export const readTenantStoragePrefill = async ({
  tenantId,
  provider = "onedrive",
  databaseUrl = process.env.DATABASE_URL,
} = {}) => {
  if (!toCleanString(tenantId) || !toCleanString(databaseUrl)) {
    return null;
  }

  let Client = null;
  try {
    ({ Client } = await import("pg"));
  } catch (_error) {
    return null;
  }

  const client = new Client({ connectionString: databaseUrl });
  try {
    await client.connect();
    const result = await client
      .query(
        `
          SELECT
            tenant_id,
            secret_reference,
            auth_mode,
            external_tenant_id,
            drive_id,
            root_folder_id,
            root_folder_path,
            repository_display_name,
            is_active
          FROM tenant_storage_config
          WHERE tenant_id = $1
            AND scope_level = 'tenant'
            AND company_id IS NULL
            AND primary_backend = $2
          ORDER BY is_active DESC, updated_at DESC
          LIMIT 1
        `,
        [tenantId, provider],
      )
      .catch(() => null);
    if (!result) {
      return null;
    }
    const row = result.rows?.[0];
    if (!row) {
      return null;
    }
    return {
      tenantId: row.tenant_id,
      secretReference: row.secret_reference || "",
      authMode: row.auth_mode || "",
      externalTenantId: row.external_tenant_id || "",
      driveId: row.drive_id || "",
      rootFolderId: row.root_folder_id || "",
      rootFolderPath: row.root_folder_path || "",
      repositoryDisplayName: row.repository_display_name || "",
      isActive: Boolean(row.is_active),
    };
  } finally {
    await client.end().catch(() => null);
  }
};

const ask = async (rl, label, fallback = "", { secret = false } = {}) => {
  const suffix = fallback ? ` [${secret ? maskSecret(fallback) : fallback}]` : "";
  const value = await rl.question(`${label}${suffix}: `);
  return toCleanString(value) || fallback;
};

const pickValue = async (rl, label, directValue, fallback = "", options = {}) => {
  const direct = toCleanString(directValue);
  if (direct) {
    return direct;
  }
  const preset = toCleanString(fallback);
  if (preset) {
    return preset;
  }
  return ask(rl, label, "", options);
};

export const openBrowser = async (url) => {
  const platform = process.platform;
  const command =
    platform === "darwin" ? ["open", url] : platform === "win32" ? ["cmd", "/c", "start", "", url] : ["xdg-open", url];
  await new Promise((resolve) => {
    const child = spawn(command[0], command.slice(1), {
      stdio: "ignore",
      detached: true,
    });
    child.on("error", () => resolve());
    child.unref();
    resolve();
  });
};

export const runOneDriveLocalAuth = async ({
  argv = process.argv.slice(2),
  stdin = process.stdin,
  stdout = process.stdout,
} = {}) => {
  if (!toCleanString(process.env[STORAGE_SECRET_FILE_ENV])) {
    throw createCliError("storage_secret_env_missing", `${STORAGE_SECRET_FILE_ENV} must be set before running this helper.`);
  }

  const cli = parseArgs(argv);
  const prefill = await readTenantStoragePrefill({ tenantId: cli.tenantId });
  const rl = readline.createInterface({ input: stdin, output: stdout });

  try {
    const tenantId = await pickValue(rl, "Tenant ID", cli.tenantId, prefill?.tenantId || "");
    const secretReference = await pickValue(
      rl,
      "Secret reference",
      cli.secretReference,
      prefill?.secretReference || (tenantId ? `kv://tenant/${tenantId}/storage/onedrive/default` : ""),
    );
    const clientId = await pickValue(rl, "Microsoft client ID", cli.clientId, "");
    const clientSecret = await pickValue(rl, "Microsoft client secret", cli.clientSecret, "", { secret: true });
    const externalTenantId = await pickValue(rl, "Microsoft tenant ID", cli.externalTenantId, prefill?.externalTenantId || "");
    const driveId = await pickValue(rl, "Drive ID (optional)", cli.driveId, prefill?.driveId || "");
    const rootFolderId = await pickValue(rl, "Root folder ID (optional)", cli.rootFolderId, prefill?.rootFolderId || "");
    const rootFolderPath = await pickValue(rl, "Root folder path (optional)", cli.rootFolderPath, prefill?.rootFolderPath || "");

    if (!tenantId || !secretReference || !clientId || !clientSecret || !externalTenantId) {
      throw createCliError(
        "onedrive_oauth_input_missing",
        "tenantId, secretReference, clientId, clientSecret, and externalTenantId are required.",
      );
    }

    const state = randomUUID();
    const redirectUri = buildRedirectUri({ port: cli.port, host: DEFAULT_HOST });
    const authUrl = buildMicrosoftAuthorizationUrl({
      clientId,
      externalTenantId,
      redirectUri,
      state,
      scope: cli.scope,
    });

    stdout.write(`\nOneDrive local OAuth helper\n`);
    stdout.write(`- Tenant: ${tenantId}\n`);
    stdout.write(`- Secret reference: ${secretReference}\n`);
    stdout.write(`- Secret file: ${process.env[STORAGE_SECRET_FILE_ENV]}\n`);
    stdout.write(`- Redirect URI: ${redirectUri}\n`);
    stdout.write(`- Scope: ${cli.scope}\n`);

    const callbackPromise = waitForOAuthCallback({
      expectedState: state,
      port: cli.port,
      host: DEFAULT_HOST,
      timeoutMs: cli.timeoutMs,
    });

    stdout.write(`\nOpening Microsoft login in the default browser...\n`);
    if (!cli.noOpen) {
      await openBrowser(authUrl);
    }
    stdout.write(`If the browser does not open, use this URL manually:\n${authUrl}\n\n`);

    const callback = await callbackPromise;
    const tokens = await exchangeAuthorizationCode({
      clientId,
      clientSecret,
      externalTenantId,
      redirectUri,
      code: callback.code,
      scope: cli.scope,
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
    const graph = tokens.accessToken
      ? await fetchGraphSummary({
          accessToken: tokens.accessToken,
          driveId,
          rootFolderId,
          rootFolderPath,
        }).catch(() => null)
      : null;

    stdout.write(`Success\n`);
    stdout.write(`- Secret reference updated: ${saved.secretReference}\n`);
    stdout.write(`- Local secret file: ${saved.filePath}\n`);
    stdout.write(`- Tenant ID: ${tenantId}\n`);
    stdout.write(`- Refresh token stored: ${maskSecret(tokens.refreshToken)}\n`);
    if (graph?.driveId) {
      stdout.write(`- Drive: ${graph.driveName || graph.driveId} (${graph.driveId})\n`);
    }
    if (graph?.rootFolderId || rootFolderId || rootFolderPath) {
      stdout.write(`- Root folder: ${graph?.rootFolderName || rootFolderId || rootFolderPath}\n`);
    }
    if (prefill) {
      stdout.write(`- Existing tenant OneDrive config found: ${prefill.repositoryDisplayName || "configured"}\n`);
    }
    stdout.write(`\nNext step:\n`);
    stdout.write(`- vai in /app/settings/storage-backup\n`);
    stdout.write(`- verifica backend onedrive\n`);
    stdout.write(`- lancia Test connection\n`);
    stdout.write(`- lancia Test preview\n`);
    stdout.write(`- lancia Test upload\n`);

    return {
      tenantId,
      secretReference: saved.secretReference,
      filePath: saved.filePath,
      graph,
    };
  } finally {
    rl.close();
  }
};

export { DEFAULT_HOST, DEFAULT_PORT, DEFAULT_SCOPES, DEFAULT_TIMEOUT_MS, STORAGE_SECRET_FILE_ENV, createCliError, pickValue };
