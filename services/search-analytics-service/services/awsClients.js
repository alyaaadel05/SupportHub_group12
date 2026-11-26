// AWS SDK clients for the Search & Analytics service.
// Locally they talk to Floci (AWS_ENDPOINT_URL=http://localhost:4566);
// on real AWS the endpoint is left empty. Region, endpoint and credentials
// come only from environment variables - nothing is hard-coded.
const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const { DynamoDBDocumentClient } = require("@aws-sdk/lib-dynamodb");
const { CloudWatchClient } = require("@aws-sdk/client-cloudwatch");
const { S3Client } = require("@aws-sdk/client-s3");

function baseConfig() {
  const config = { region: process.env.AWS_REGION || "us-east-1", maxAttempts: 2 };
  if (process.env.AWS_ENDPOINT_URL) config.endpoint = process.env.AWS_ENDPOINT_URL;
  return config;
}

const { withFlociAccess } = require("../config/flociAccess");

const dynamo = DynamoDBDocumentClient.from(withFlociAccess(new DynamoDBClient(baseConfig())));
const cloudwatch = withFlociAccess(new CloudWatchClient(baseConfig()));
// Fail fast when the export storage is unreachable (for example a deployment
// that cannot reach a local Floci), well inside the 10 s proxy/serverless budget.
const s3 = withFlociAccess(new S3Client({
  ...baseConfig(),
  forcePathStyle: true,
  requestHandler: { connectionTimeout: 3000, requestTimeout: 8000 }
}));

module.exports = { dynamo, cloudwatch, s3 };