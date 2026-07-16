import { handleAuthRouteRequest } from "@/lib/auth/next-route-handler";

export async function GET(request: Request) {
  return handleAuthRouteRequest("GET", request);
}

export async function POST(request: Request) {
  return handleAuthRouteRequest("POST", request);
}
