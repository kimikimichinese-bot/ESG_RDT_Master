import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis;

const getPrismaClient = () => {
  const databaseUrl = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is not configured");
  }
  if (!globalForPrisma.__esgRdtMasterPrisma) {
    globalForPrisma.__esgRdtMasterPrisma = new PrismaClient({
      datasources: {
        db: {
          url: databaseUrl,
        },
      },
    });
  }
  return globalForPrisma.__esgRdtMasterPrisma;
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
    const prisma = getPrismaClient();
    await prisma.$queryRaw`SELECT 1`;
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
