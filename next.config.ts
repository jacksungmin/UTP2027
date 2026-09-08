import type { NextConfig } from 'next';

// Set only for the GitHub Pages build, since that serves the site from
// https://jacksungmin.github.io/UTP2027/ (a subpath) rather than a domain
// root. Local dev and any future root-domain deployment leave this unset.
const basePath = process.env.NEXT_PUBLIC_BASE_PATH || undefined;

const nextConfig: NextConfig = {
  basePath,
};

export default nextConfig;
