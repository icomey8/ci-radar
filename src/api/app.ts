import { DrizzleQueryError } from "drizzle-orm";
import { Hono } from "hono";
import type { ErrorBody, RepoDto } from "./dto.js";

/** Where the API's data comes from: Postgres in `pnpm api`, an in-memory fake in tests. */
export interface RankingSource {
  /** The seeded user's watched repos, in any order. */
  listRepos(): Promise<RepoDto[]>;
}

function errorBody(code: string, message: string): ErrorBody {
  return { error: { code, message } };
}

/**
 * The most useful message an error carries. Drizzle wraps driver errors in a
 * "Failed query: …" error, and pg's connection-refused AggregateError has an
 * empty message, so both defer to what's inside them.
 */
function messageOf(error: unknown): string {
  if (error instanceof DrizzleQueryError && error.cause) return messageOf(error.cause);
  if (error instanceof AggregateError && !error.message) {
    const [first] = error.errors;
    if (first !== undefined) return messageOf(first);
  }
  if (error instanceof Error && error.message) return error.message;
  return "Internal error.";
}

function byOwnerThenName(a: RepoDto, b: RepoDto): number {
  return a.owner.localeCompare(b.owner) || a.name.localeCompare(b.name);
}

export function createApp(source: RankingSource) {
  const app = new Hono();

  app.get("/repos", async (c) => {
    const repos = await source.listRepos();
    return c.json({ repos: repos.toSorted(byOwnerThenName) });
  });

  app.notFound((c) =>
    c.json(errorBody("not_found", `No route for ${c.req.method} ${c.req.path}.`), 404),
  );

  app.onError((error, c) => {
    console.error(error);
    return c.json(errorBody("internal", messageOf(error)), 500);
  });

  return app;
}
