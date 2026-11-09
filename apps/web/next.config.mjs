/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  output: 'standalone',
  transpilePackages: ['@agentic-rag/chat-utils'],
  env: {
    NEXT_PUBLIC_ACTIVE_MODEL: process.env.AZURE_OPENAI_DEPLOYMENT?.trim() || 'Azure GPT-4.1-mini'
  }
};
export default nextConfig;
