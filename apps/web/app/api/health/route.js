import { Client } from "pg";

const getDatabaseUrl = () => {
  const databaseUrl = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is not configured");
  }
  return databaseUrl;
};

const buildDbClient = () => {
  const databaseUrl = getDatabaseUrl();
  return new Client({
    connectionString: databaseUrl,
    ssl: /sslmode=require/i.test(databaseUrl)
      ? { rejectUnauthorized: false }
      : false,
  });
};

const checkDatabase = async () => {
  const client = buildDbClient();
  try {
    await client.connect();
    await client.query("SELECT 1");
  } finally {
    await client.end();
  }
};

const getBuildVersion = () =>
  process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 8) ??
  process.env.BUILD_ID ??
  process.env.npm_package_version ??
  "1.0.0";

export async function GET() {
  const payload = {
    status: "ok",
    service: "esg-rdt-master-web",
    timestamp: new Date().toISOString(),
    version: getBuildVersion(),
  };

  try {
    await checkDatabase();
    return Response.json({
      ...payload,
      db: "ok",
      checks: {
        web: "ok",
        db: "ok",
      },
    });
  } catch (error) {
    return Response.json(
      {
        ...payload,
        db: "down",
        checks: {
          web: "ok",
          db: "down",
        },
      },
      { status: 500 }
    );
  }
}
