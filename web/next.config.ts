import type { NextConfig } from 'next';
import path from 'path';

const nextConfig: NextConfig = {
  // Static export: Amplify Hosting serves the `out/` folder as a plain static site
  // (the Amplify app uses the WEB platform), and every page talks to the API from the browser.
  output: 'export',
  // Emit /case/index.html etc., which static hosting serves at /case/.
  trailingSlash: true,
  images: { unoptimized: true },
  reactStrictMode: true,
  // npm workspaces hoist dependencies to the repo root.
  turbopack: { root: path.join(__dirname, '..') },
};

export default nextConfig;
