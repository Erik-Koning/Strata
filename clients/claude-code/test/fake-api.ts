// A stand-in for the Strata API, on a real port: it records every request, counts how often each event id is
// delivered, and can be told to fail, hang or go away. The plugin is tested against this, never a real server.
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import type { MemoryEvent, MemoryHit } from "@strata/contracts";

export const TOKEN = "am_test_token_for_the_fake_api_0000";

export interface Recorded {
  method: string;
  path: string;
  body: unknown;
  client: string | undefined;
}

export interface FakeApi {
  readonly url: string;
  readonly port: number;
  requests: Recorded[];
  // How many times each event id arrived, and the event as it first arrived.
  deliveries: Map<string, number>;
  events: Map<string, MemoryEvent>;
  frozen: MemoryHit[];
  recalled: MemoryHit[];
  // "up" answers; "fail" answers 500 to everything; "hang" never answers.
  mode: "up" | "fail" | "hang";
  close(): Promise<void>;
}

// A port nothing is listening on, for an API that's down (and can come up on it later).
export async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const { port } = server.address() as AddressInfo;
  await new Promise<void>((done) => server.close(() => done()));
  return port;
}

async function readBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  const text = Buffer.concat(chunks).toString("utf8");
  return text ? JSON.parse(text) : null;
}

export async function startFakeApi(port = 0): Promise<FakeApi> {
  const hanging = new Set<ServerResponse>();
  const api: FakeApi = {
    url: "",
    port: 0,
    requests: [],
    deliveries: new Map(),
    events: new Map(),
    frozen: [],
    recalled: [],
    mode: "up",
    close: async () => undefined,
  };
  const send = (res: ServerResponse, status: number, body: unknown): void => {
    res.writeHead(status, { "content-type": "application/json" });
    res.end(JSON.stringify(body));
  };
  const server: Server = createServer((req, res) => {
    void (async () => {
      const url = new URL(req.url ?? "/", "http://fake");
      const body = await readBody(req);
      api.requests.push({
        method: req.method ?? "",
        path: url.pathname,
        body,
        client: req.headers["x-memory-client"] as string,
      });
      if (api.mode === "hang") {
        hanging.add(res);
        return;
      }
      if (api.mode === "fail") return send(res, 500, { error: { code: "down", message: "down for the test" } });
      if (req.headers.authorization !== `Bearer ${TOKEN}`)
        return send(res, 401, { error: { code: "unauthorized", message: "no" } });
      switch (`${req.method} ${url.pathname}`) {
        case "POST /api/memory/events": {
          const batch = (body as { batch: MemoryEvent[] }).batch;
          if (batch.some((e) => e.payload?.poison === true))
            return send(res, 400, { error: { code: "invalid", message: "a poisoned event" } });
          let duplicates = 0;
          for (const event of batch) {
            const seen = api.deliveries.get(event.id) ?? 0;
            if (seen) duplicates++;
            else api.events.set(event.id, event);
            api.deliveries.set(event.id, seen + 1);
          }
          return send(res, 202, { accepted: batch.length - duplicates, duplicates });
        }
        case "GET /api/memory/frozen":
          return send(res, 200, { memories: api.frozen });
        case "POST /api/memory/recall":
          return send(res, 200, { memories: api.recalled });
        case "POST /api/memory/compress":
          return send(res, 200, { summary: "A summary." });
        case "POST /api/memory/save": {
          const { text, kind } = body as { text: string; kind?: string };
          return send(res, 201, { memory: { _id: "6750a00000000000000000ff", kind: kind ?? "fact", text } });
        }
        case "POST /api/memory/forget": {
          const { ids, dryRun } = body as { ids?: string[]; dryRun?: boolean };
          return send(res, 200, {
            dryRun: Boolean(dryRun),
            ids: ids ?? [],
            memories: ids?.length ?? 1,
            summaries: 2,
            events: 3,
          });
        }
        default:
          return send(res, 404, { error: { code: "not_found", message: "no such route" } });
      }
    })();
  });
  await new Promise<void>((done) => server.listen(port, "127.0.0.1", done));
  const actual = (server.address() as AddressInfo).port;
  Object.assign(api, {
    url: `http://127.0.0.1:${actual}`,
    port: actual,
    close: () =>
      new Promise<void>((done) => {
        for (const res of hanging) res.destroy();
        server.closeAllConnections();
        server.close(() => done());
      }),
  });
  return api;
}

// How many event ids arrived more than once (should always be 0).
export const duplicates = (api: FakeApi): number => [...api.deliveries.values()].filter((n) => n > 1).length;
