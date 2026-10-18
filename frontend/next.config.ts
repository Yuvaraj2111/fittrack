import type { NextConfig } from "next";

// The browser always talks to this site's own /api/v1 path; Next.js forwards it to
// the FastAPI service. Same origin means the login cookie works without CORS or
// cookie-domain setup, on Vercel's default *.vercel.app domains too.
//   Local:  API_ORIGIN defaults to http://localhost:8000
//   Vercel: set API_ORIGIN to the API project's URL, e.g. https://fittrack-api.vercel.app
const apiOrigin = (process.env.API_ORIGIN ?? (process.env.VERCEL ? "" : "http://localhost:8000")).replace(/\/+$/, "");

if (process.env.VERCEL && !apiOrigin) {
  throw new Error("API_ORIGIN is not set. Add it in Vercel → Project → Settings → Environment Variables (e.g. https://fittrack-api.vercel.app), then redeploy.");
}

const nextConfig: NextConfig = {
  output: process.env.VERCEL ? undefined : "standalone", // standalone is for the Docker image only
  async rewrites() {
    return [{ source: "/api/v1/:path*", destination: `${apiOrigin}/api/v1/:path*` }];
  },
};

export default nextConfig;
