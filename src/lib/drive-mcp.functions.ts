import { createServerFn } from "@tanstack/react-start";

/**
 * Google Drive MCP boundary. The app never pretends an MCP server exists:
 * this probe performs a real Streamable-HTTP handshake and reports what it
 * actually found. Sync never depends on it.
 */
export const probeDriveMcp = createServerFn({ method: "POST" })
  .inputValidator((data: { endpoint: string; token?: string }) => data)
  .handler(async ({ data }) => {
    const endpoint = data.endpoint.trim();
    if (!endpoint) return { status: "not_configured" as const, detail: "No MCP endpoint set.", tools: [] };
    if (!/^https?:\/\//.test(endpoint)) {
      return { status: "unavailable" as const, detail: "Endpoint must start with http(s)://", tools: [] };
    }
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json, text/event-stream",
          ...(data.token ? { Authorization: `Bearer ${data.token}` } : {}),
        },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }),
      });
      const body = await response.text();
      if (!response.ok) {
        return {
          status: "unavailable" as const,
          detail: `MCP server responded ${response.status}: ${body.slice(0, 200)}`,
          tools: [],
        };
      }
      const jsonPart = body.startsWith("data:")
        ? (body.split("\n").find((line) => line.startsWith("data:"))?.slice(5).trim() ?? "{}")
        : body;
      let tools: string[] = [];
      try {
        const parsed = JSON.parse(jsonPart) as { result?: { tools?: { name?: string }[] } };
        tools = (parsed.result?.tools ?? [])
          .map((tool) => tool.name)
          .filter((name): name is string => Boolean(name));
      } catch {
        return { status: "unavailable" as const, detail: "MCP response was not valid JSON.", tools: [] };
      }
      return {
        status: "configured" as const,
        detail: `Connected. ${tools.length} tool${tools.length === 1 ? "" : "s"} exposed.`,
        tools,
      };
    } catch (error) {
      return {
        status: "unavailable" as const,
        detail: error instanceof Error ? error.message : "MCP endpoint unreachable.",
        tools: [],
      };
    }
  });
