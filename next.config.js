/** @type {import("next").NextConfig} */
const nextConfig = {
  experimental: { serverComponentsExternalPackages: [] },
  api: { bodyParser: { sizeLimit: "10mb" } }
}
module.exports = nextConfig
