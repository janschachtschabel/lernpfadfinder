const path = require('path');

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Fix: ignore C:\Users\jan\pnpm-lock.yaml – this project's root is here.
  outputFileTracingRoot: path.join(__dirname),
};
module.exports = nextConfig;
