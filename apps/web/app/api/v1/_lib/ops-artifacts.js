import fs from "node:fs/promises";
import path from "node:path";

const PUBLIC_CANDIDATES = [
  path.resolve(process.cwd(), "apps/web/public"),
  path.resolve(process.cwd(), "public"),
];

const resolvePublicPath = (filename) => PUBLIC_CANDIDATES.map((base) => path.join(base, filename));

const ensureParentDir = async (filePath) => {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
};

const parseJson = (raw) => {
  if (!raw || typeof raw !== "string") {
    return null;
  }
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch (_error) {
    return null;
  }
};

export const readArtifact = async (filename) => {
  for (const candidate of resolvePublicPath(filename)) {
    try {
      const raw = await fs.readFile(candidate, "utf-8");
      const parsed = parseJson(raw);
      if (parsed) {
        return parsed;
      }
    } catch (_error) {
      // ignore missing artifact
    }
  }
  return null;
};

export const writeArtifact = async (filename, payload) => {
  const target = resolvePublicPath(filename)[0];
  await ensureParentDir(target);
  await fs.writeFile(target, JSON.stringify(payload, null, 2), "utf-8");
  return target;
};

export const appendHistoryArtifact = async (filename, entry, limit = 20) => {
  const existing = await readArtifact(filename);
  const items = Array.isArray(existing?.items) ? existing.items : [];
  const nextItems = [entry, ...items].slice(0, limit);
  const payload = {
    updatedAt: new Date().toISOString(),
    count: nextItems.length,
    items: nextItems,
  };
  await writeArtifact(filename, payload);
  return payload;
};
