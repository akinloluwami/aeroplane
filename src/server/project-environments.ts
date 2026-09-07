import { asc, eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { createUniqueSlug } from "../shared/slug.js";
import { db, nowIso } from "./db.js";
import { projectEnvironments, type ProjectEnvironment } from "./schema.js";

const defaultEnvironmentNames = ["Production", "Development"] as const;

export function getProjectEnvironments(projectId: string) {
  return db
    .select()
    .from(projectEnvironments)
    .where(eq(projectEnvironments.projectId, projectId))
    .orderBy(asc(projectEnvironments.createdAt))
    .all()
    .sort((left, right) => Number(right.isDefault) - Number(left.isDefault));
}

export function getProjectEnvironment(projectId: string, environmentId: string) {
  return getProjectEnvironments(projectId).find((environment) => environment.id === environmentId) ?? null;
}

export function getDefaultProjectEnvironment(projectId: string) {
  const environments = getProjectEnvironments(projectId);
  return environments.find((environment) => environment.isDefault) ?? environments[0] ?? null;
}

export function createDefaultProjectEnvironments(projectId: string, timestamp = nowIso()) {
  const existing = getProjectEnvironments(projectId);
  const bySlug = new Map(existing.map((environment) => [environment.slug, environment]));

  for (const name of defaultEnvironmentNames) {
    const slug = name.toLowerCase();
    if (bySlug.has(slug)) continue;

    const environment: ProjectEnvironment = {
      id: nanoid(10),
      projectId,
      name,
      slug,
      isDefault: slug === "production",
      createdAt: timestamp,
      updatedAt: timestamp
    };
    db.insert(projectEnvironments).values(environment).run();
    bySlug.set(slug, environment);
  }

  const production = bySlug.get("production");
  if (!production) throw new Error("Could not create the production environment");

  for (const environment of bySlug.values()) {
    const isDefault = environment.id === production.id;
    if (environment.isDefault === isDefault) continue;
    db.update(projectEnvironments)
      .set({ isDefault, updatedAt: timestamp })
      .where(eq(projectEnvironments.id, environment.id))
      .run();
  }

  return {
    environments: getProjectEnvironments(projectId),
    defaultEnvironment: { ...production, isDefault: true }
  };
}

export function createProjectEnvironment(projectId: string, name: string) {
  const timestamp = nowIso();
  const slugs = new Set(getProjectEnvironments(projectId).map((environment) => environment.slug));
  const environment: ProjectEnvironment = {
    id: nanoid(10),
    projectId,
    name,
    slug: createUniqueSlug(name, slugs),
    isDefault: false,
    createdAt: timestamp,
    updatedAt: timestamp
  };
  db.insert(projectEnvironments).values(environment).run();
  return environment;
}
