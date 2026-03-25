import fs from "node:fs/promises";
import path from "node:path";

const STORAGE_SECRET_FILE_ENV = "STORAGE_SECRET_FILE";

const createStorageSecretError = (code, message, details = {}) => {
  const error = new Error(message);
  error.code = code;
  error.details = details;
  return error;
};

const ensureNonEmptyString = (value) => (typeof value === "string" ? value.trim() : "");

const resolveStorageSecretFilePath = () => {
  const configured = ensureNonEmptyString(process.env[STORAGE_SECRET_FILE_ENV]);
  if (!configured) {
    throw createStorageSecretError(
      "storage_secret_env_missing",
      `${STORAGE_SECRET_FILE_ENV} is required to resolve storage provider secrets.`,
      { env: STORAGE_SECRET_FILE_ENV },
    );
  }

  return path.isAbsolute(configured) ? configured : path.resolve(process.cwd(), configured);
};

const parseStorePayload = (rawPayload, filePath) => {
  let parsed = null;
  try {
    parsed = JSON.parse(rawPayload);
  } catch (_error) {
    throw createStorageSecretError("storage_secret_invalid_json", "Storage secret file contains invalid JSON.", {
      filePath,
    });
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw createStorageSecretError("storage_secret_invalid_store", "Storage secret file must contain a JSON object.", {
      filePath,
    });
  }

  return parsed;
};

const stringifyStorePayload = (store) => `${JSON.stringify(store, null, 2)}\n`;

const hasNonEmptyLeaf = (value) => {
  if (typeof value === "string") {
    return value.trim().length > 0;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return true;
  }
  if (Array.isArray(value)) {
    return value.some((item) => hasNonEmptyLeaf(item));
  }
  if (value && typeof value === "object") {
    return Object.values(value).some((item) => hasNonEmptyLeaf(item));
  }
  return false;
};

export const validateStorageSecretReference = (secretReference) => {
  const normalized = ensureNonEmptyString(secretReference);
  if (!normalized) {
    throw createStorageSecretError("storage_secret_reference_missing", "secret_reference is required.", {
      secretReference: "",
    });
  }

  if (!/^kv:\/\/[A-Za-z0-9/_\-.:]+$/.test(normalized)) {
    throw createStorageSecretError(
      "storage_secret_reference_invalid",
      "secret_reference must use the kv://<path> format.",
      { secretReference: normalized },
    );
  }

  return normalized;
};

export const loadStorageSecretStore = async () => {
  const filePath = resolveStorageSecretFilePath();
  let rawPayload = "";
  try {
    rawPayload = await fs.readFile(filePath, "utf-8");
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      throw createStorageSecretError("storage_secret_file_not_found", "Storage secret file was not found.", {
        filePath,
      });
    }
    throw createStorageSecretError("storage_secret_file_unreadable", "Storage secret file could not be read.", {
      filePath,
    });
  }

  return {
    filePath,
    store: parseStorePayload(rawPayload, filePath),
  };
};

export const saveStorageSecretEntry = async (secretReference, payload, options = {}) => {
  const normalizedReference = validateStorageSecretReference(secretReference);
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw createStorageSecretError("storage_secret_payload_malformed", "Storage secret entry must be a JSON object.", {
      secretReference: normalizedReference,
    });
  }

  const { filePath, store } = await loadStorageSecretStore();
  const previous = store[normalizedReference];
  const nextEntry =
    options.replace === true
      ? payload
      : {
          ...(previous && typeof previous === "object" && !Array.isArray(previous) ? previous : {}),
          ...payload,
        };

  if (Object.keys(nextEntry).length === 0 || !hasNonEmptyLeaf(nextEntry)) {
    throw createStorageSecretError("storage_secret_payload_empty", "Storage secret entry cannot be empty.", {
      secretReference: normalizedReference,
      filePath,
    });
  }

  store[normalizedReference] = nextEntry;
  await fs.writeFile(filePath, stringifyStorePayload(store), "utf-8");
  return {
    filePath,
    store,
    entry: nextEntry,
    secretReference: normalizedReference,
  };
};

export const resolveStorageSecret = async (secretReference) => {
  const normalizedReference = validateStorageSecretReference(secretReference);
  const { filePath, store } = await loadStorageSecretStore();
  const payload = store[normalizedReference];

  if (payload == null) {
    throw createStorageSecretError("storage_secret_reference_not_found", "secret_reference was not found in the local storage secret file.", {
      secretReference: normalizedReference,
      filePath,
    });
  }

  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw createStorageSecretError("storage_secret_payload_malformed", "Resolved storage secret payload must be a JSON object.", {
      secretReference: normalizedReference,
      filePath,
    });
  }

  if (Object.keys(payload).length === 0 || !hasNonEmptyLeaf(payload)) {
    throw createStorageSecretError("storage_secret_payload_empty", "Resolved storage secret payload is empty.", {
      secretReference: normalizedReference,
      filePath,
    });
  }

  return payload;
};

export const getStorageSecretSummary = async (secretReference) => {
  const normalizedReference = validateStorageSecretReference(secretReference);
  const payload = await resolveStorageSecret(normalizedReference);
  return {
    secretReference: normalizedReference,
    fieldCount: Object.keys(payload).length,
    keys: Object.keys(payload).sort(),
  };
};

export { STORAGE_SECRET_FILE_ENV, createStorageSecretError, resolveStorageSecretFilePath };
