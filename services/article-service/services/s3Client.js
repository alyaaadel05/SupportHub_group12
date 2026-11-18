
const { S3Client } = require("@aws-sdk/client-s3");

const useFloci = Boolean(process.env.AWS_ENDPOINT_URL);

const s3 = new S3Client({
  region: process.env.AWS_REGION || "us-east-1",

  ...(useFloci
    ? {
        endpoint: process.env.AWS_ENDPOINT_URL,
        forcePathStyle: true
      }
    : {}),

  // Credentials come from environment variables.
  // Never hardcode secret keys in source code.
});

module.exports = s3;
