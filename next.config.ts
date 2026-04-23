import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  allowedDevOrigins: ['ec2-15-206-21-233.ap-south-1.compute.amazonaws.com',"linux-ec2"],
 experimental: {
  serverActions:{
  allowedOrigins: ['ec2-15-206-21-233.ap-south-1.compute.amazonaws.com',"linux-ec2"]

  }
}
};

export default nextConfig;
