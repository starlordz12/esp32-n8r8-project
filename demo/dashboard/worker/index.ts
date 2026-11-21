/** Cloudflare Worker entry point for the vinext-starter template. */
import { handleImageOptimization, DEFAULT_DEVICE_SIZES, DEFAULT_IMAGE_SIZES } from "vinext/server/image-optimization";
import handler from "vinext/server/app-router-entry";
import { fetchRuViewSnapshot } from "../lib/ruview-adapter";

interface Env {
  ASSETS: {
    fetch(request: Request): Promise<Response>;
  };
  RUVIEW_BASE_URL?: string;
  RUVIEW_API_TOKEN?: string;
  IMAGES: {
    input(stream: ReadableStream): {
      transform(options: Record<string, unknown>): {
        output(options: { format: string; quality: number }): Promise<{ response(): Response }>;
      };
    };
  };
}

interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
}

// Image security config. SVG sources with .svg extension auto-skip the
// optimization endpoint on the client side (served directly, no proxy).
// To route SVGs through the optimizer (with security headers), set
// dangerouslyAllowSVG: true in next.config.js and uncomment below:
// const imageConfig: ImageConfig = { dangerouslyAllowSVG: true };

const worker = {
  async fetch(request: Request, env: Env | undefined, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/api/ruview/snapshot") {
      const snapshot = await fetchRuViewSnapshot({
        baseUrl: env?.RUVIEW_BASE_URL ?? process.env.RUVIEW_BASE_URL,
        apiToken: env?.RUVIEW_API_TOKEN ?? process.env.RUVIEW_API_TOKEN,
      });
      return Response.json(snapshot, {
        headers: {
          "cache-control": "no-store",
          "x-content-type-options": "nosniff",
        },
      });
    }

    if (url.pathname === "/_vinext/image") {
      if (!env?.ASSETS || !env.IMAGES) {
        return Response.json(
          { error: "Image optimization is unavailable in this runtime." },
          { status: 503 },
        );
      }
      const allowedWidths = [...DEFAULT_DEVICE_SIZES, ...DEFAULT_IMAGE_SIZES];
      return handleImageOptimization(request, {
        fetchAsset: (path) => env.ASSETS.fetch(new Request(new URL(path, request.url))),
        transformImage: async (body, { width, format, quality }) => {
          const result = await env.IMAGES.input(body).transform(width > 0 ? { width } : {}).output({ format, quality });
          return result.response();
        },
      }, allowedWidths);
    }

    return handler.fetch(request, env, ctx);
  },
};

export default worker;
