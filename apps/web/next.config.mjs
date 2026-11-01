/** @type {import('next').NextConfig} */
export default {
  reactStrictMode: true,
  // The Docker image runs Next's self-contained server; local dev and `next start` don't need it.
  ...(process.env.NEXT_OUTPUT === 'standalone' ? { output: 'standalone' } : {}),
};
