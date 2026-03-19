import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const BASE_URL = "http://translation-hub.darkuniverse.work/api/v1";

const API_KEY = process.env.TRANSLATION_API_KEY ?? "";

async function apiRequest(
  path: string,
  options: { method?: string; body?: unknown } = {}
): Promise<unknown> {
  const { method = "GET", body } = options;

  const headers: Record<string, string> = {
    "X-API-Key": API_KEY,
    "Content-Type": "application/json",
  };

  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  if (res.status === 503) {
    const retryAfter = res.headers.get("Retry-After");
    return { error: "Service temporarily unavailable (CPU guard)", retryAfter };
  }

  if (!res.ok) {
    const text = await res.text();
    return { error: `HTTP ${res.status}`, detail: text };
  }

  return res.json();
}

function buildQuery(params: Record<string, unknown>): string {
  const entries = Object.entries(params).filter(
    ([, v]) => v !== undefined && v !== null && v !== ""
  );
  if (entries.length === 0) return "";
  return "?" + new URLSearchParams(entries.map(([k, v]) => [k, String(v)])).toString();
}

const localeEnum = z
  .enum(["frFR", "deDE", "esES", "ruRU", "esMX", "zhCN"])
  .optional()
  .describe("Target locale");

const server = new McpServer({
  name: "translation-hub",
  version: "1.0.0",
});

// --- List tables ---
server.tool(
  "list_tables",
  "List available translation source tables",
  {
    limit: z
      .number()
      .min(1)
      .max(500)
      .optional()
      .describe("Max results (default 200, max 500)"),
  },
  async ({ limit }) => {
    const query = buildQuery({ limit });
    const data = await apiRequest(`/translations/tables${query}`);
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  }
);

// --- Search translations ---
server.tool(
  "search_translations",
  "Search translations by text query (min 2 chars)",
  {
    q: z.string().min(2).describe("Search query (min 2 chars)"),
    locale: localeEnum,
    table: z.string().optional().describe("Source table filter"),
    accepted_only: z
      .boolean()
      .optional()
      .describe("Only accepted translations (default true)"),
    limit: z
      .number()
      .min(1)
      .max(200)
      .optional()
      .describe("Max results (default 50, max 200)"),
  },
  async ({ q, locale, table, accepted_only, limit }) => {
    const query = buildQuery({ q, locale, table, accepted_only, limit });
    const data = await apiRequest(`/translations/search${query}`);
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  }
);

// --- Get untranslated ---
server.tool(
  "get_untranslated",
  "Get untranslated entries for a locale",
  {
    locale: localeEnum,
    table: z.string().optional().describe("Source table filter"),
    limit: z
      .number()
      .min(1)
      .max(1000)
      .optional()
      .describe("Max results (default 500, max 1000)"),
    offset: z
      .number()
      .min(0)
      .max(5000000)
      .optional()
      .describe("Pagination offset (default 0)"),
  },
  async ({ locale, table, limit, offset }) => {
    const query = buildQuery({ locale, table, limit, offset });
    const data = await apiRequest(`/translations/untranslated${query}`);
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  }
);

// --- Get translation context ---
server.tool(
  "get_context",
  "Get context for a specific translation entry",
  {
    translation_id: z.number().describe("Translation ID"),
    locale: localeEnum,
  },
  async ({ translation_id, locale }) => {
    const query = buildQuery({ locale });
    const data = await apiRequest(
      `/translations/${translation_id}/context${query}`
    );
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  }
);

// --- List submissions ---
server.tool(
  "list_submissions",
  "List your submission history",
  {
    status: z
      .enum(["all", "pending", "accepted", "rejected"])
      .optional()
      .describe("Filter by status"),
    locale: localeEnum,
    limit: z.number().min(1).max(100).optional().describe("Max results (default 100)"),
    offset: z.number().min(0).optional().describe("Pagination offset"),
  },
  async ({ status, locale, limit, offset }) => {
    const query = buildQuery({ status, locale, limit, offset });
    const data = await apiRequest(`/account/submissions${query}`);
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  }
);

// --- Create submission ---
server.tool(
  "create_submission",
  "Submit a translation for review",
  {
    translation_id: z.number().describe("ID of the translation entry"),
    locale: z
      .enum(["frFR", "deDE", "esES", "ruRU", "esMX", "zhCN"])
      .describe("Target locale"),
    value: z.string().describe("Translated text"),
    submission_comment: z
      .string()
      .optional()
      .describe("Optional note about the translation"),
  },
  async ({ translation_id, locale, value, submission_comment }) => {
    const data = await apiRequest("/account/submissions", {
      method: "POST",
      body: { translation_id, locale, value, submission_comment },
    });
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  }
);

// --- Edit submission ---
server.tool(
  "edit_submission",
  "Edit one of your pending submissions",
  {
    change_id: z.number().describe("Submission change ID"),
    value: z.string().describe("Updated translated text"),
    submission_comment: z
      .string()
      .optional()
      .describe("Optional update note"),
  },
  async ({ change_id, value, submission_comment }) => {
    const data = await apiRequest(`/account/submissions/${change_id}`, {
      method: "PATCH",
      body: { value, submission_comment },
    });
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  }
);

// --- Start server ---
async function main() {
  if (!API_KEY) {
    console.error("TRANSLATION_API_KEY environment variable is required");
    process.exit(1);
  }

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
