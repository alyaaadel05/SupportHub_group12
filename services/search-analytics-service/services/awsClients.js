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

const dynamo = DynamoDBDocumentClient.from(new DynamoDBClient(baseConfig()));
const cloudwatch = new CloudWatchClient(baseConfig());
const s3 = new S3Client({ ...baseConfig(), forcePathStyle: true });

module.exports = { dynamo, cloudwatch, s3 };