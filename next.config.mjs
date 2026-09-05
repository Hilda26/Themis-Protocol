/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  webpack: (config) => {
    // wagmi/connectors bundles an optional Coinbase "baseAccount" connector
    // (unused here -- we only use `injected`) whose transitive x402 payment
    // deps aren't installed. Stub them out rather than pulling in the whole
    // Coinbase SDK just to satisfy webpack's static resolution.
    config.resolve.alias = {
      ...config.resolve.alias,
      "@x402/evm/upto/client": false,
      "@x402/evm/exact/client": false,
      "@x402/core/client": false,
      "@x402/svm/exact/client": false,
      "@x402/evm": false,
    };
    return config;
  },
};
export default nextConfig;
