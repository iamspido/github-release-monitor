import { getAuthAccessForHeaders } from "@/lib/auth/access";
import { canReadHomeUnauthenticated } from "@/lib/auth/mode";
import { getClientIpFromRequest } from "@/lib/auth/request-context";
import { getAuthenticatedUserId } from "@/lib/auth/session";
import { subscribeToUpdateNotice } from "@/lib/runtime/update-notice-bus";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_STREAMS_PER_CLIENT = 5;
const MAX_UNIDENTIFIED_STREAMS = 50;
const MAX_TOTAL_STREAMS = 100;
const clientStreamCounts = new Map<string, number>();
let totalStreamCount = 0;

async function getClientKey(request: Request): Promise<string> {
  const userId = await getAuthenticatedUserId(request.headers);
  if (userId) return `user:${userId}`;

  const clientIp = getClientIpFromRequest(request);
  return clientIp === "unknown" ? "unidentified" : `ip:${clientIp}`;
}

function acquireStreamSlot(key: string): boolean {
  const currentCount = clientStreamCounts.get(key) ?? 0;
  const clientLimit =
    key === "unidentified" ? MAX_UNIDENTIFIED_STREAMS : MAX_STREAMS_PER_CLIENT;
  if (currentCount >= clientLimit || totalStreamCount >= MAX_TOTAL_STREAMS) {
    return false;
  }

  clientStreamCounts.set(key, currentCount + 1);
  totalStreamCount += 1;
  return true;
}

function releaseStreamSlot(key: string): void {
  const nextCount = (clientStreamCounts.get(key) ?? 1) - 1;
  if (nextCount <= 0) clientStreamCounts.delete(key);
  else clientStreamCounts.set(key, nextCount);
  totalStreamCount = Math.max(totalStreamCount - 1, 0);
}

export async function GET(request: Request) {
  const authAccess = await getAuthAccessForHeaders(request.headers);
  const canReadUpdateNotice =
    authAccess.canMutate ||
    canReadHomeUnauthenticated(authAccess.authenticationMethod);
  if (!canReadUpdateNotice) {
    return new Response(null, { status: 404 });
  }

  const clientKey = await getClientKey(request);
  if (!acquireStreamSlot(clientKey)) {
    return new Response(null, { status: 429 });
  }

  const encoder = new TextEncoder();
  let isClosed = false;
  let unsubscribe: (() => void) | undefined;
  let keepAliveInterval: ReturnType<typeof setInterval> | undefined;

  const close = () => {
    if (isClosed) return;
    isClosed = true;
    if (keepAliveInterval) clearInterval(keepAliveInterval);
    request.signal.removeEventListener("abort", close);
    unsubscribe?.();
    releaseStreamSlot(clientKey);
  };

  const stream = new ReadableStream({
    start(controller) {
      const send = (event: string, data: unknown) => {
        if (isClosed) return;
        try {
          controller.enqueue(
            encoder.encode(
              `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`,
            ),
          );
        } catch {
          close();
        }
      };

      unsubscribe = subscribeToUpdateNotice((notice) => {
        send("update-notice-changed", notice);
      });

      send("connected", { connected: true });
      keepAliveInterval = setInterval(() => {
        send("keep-alive", { timestamp: Date.now() });
      }, 30_000);
      request.signal.addEventListener("abort", close);
    },
    cancel() {
      close();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
