require("dotenv").config({ path: ".env.local" });

const {
  SQSClient,
  ListQueuesCommand
} = require("@aws-sdk/client-sqs");

const {
  SNSClient,
  ListTopicsCommand
} = require("@aws-sdk/client-sns");

const {
  LambdaClient,
  ListFunctionsCommand
} = require("@aws-sdk/client-lambda");

const region = process.env.AWS_REGION || "us-east-1";

const sqs = new SQSClient({
  region,
  endpoint: process.env.SQS_ENDPOINT_URL,
  maxAttempts: 1
});

const sns = new SNSClient({
  region,
  endpoint: process.env.SNS_ENDPOINT_URL,
  maxAttempts: 1
});

const lambda = new LambdaClient({
  region,
  endpoint:
    process.env.LAMBDA_ENDPOINT_URL ||
    process.env.SNS_ENDPOINT_URL ||
    process.env.SQS_ENDPOINT_URL,
  maxAttempts: 1
});

async function check(name, action) {
  try {
    await action();
  } catch (error) {
    console.error(`FAIL: ${name} — ${error.name}: ${error.message}`);
    process.exitCode = 1;
  }
}

async function main() {
  console.log("==================================");
  console.log(" SupportHub AWS Read-only Checks");
  console.log("==================================");

  await check("Demo SQS queue", async () => {
    const result = await sqs.send(
      new ListQueuesCommand({
        QueueNamePrefix: "supporthub-article-events-demo"
      })
    );

    const found = (result.QueueUrls || []).some(url =>
      url.endsWith("/supporthub-article-events-demo")
    );

    if (!found) throw new Error("Demo queue was not found");

    console.log("PASS: Demo SQS queue exists");
  });

  await check("Publication SNS topic", async () => {
    const result = await sns.send(new ListTopicsCommand({}));

    const expected =
      process.env.EDITORIAL_PUBLICATION_TOPIC_ARN;

    if (!expected) {
      throw new Error("Publication topic ARN is not configured");
    }

    const found = (result.Topics || []).some(
      topic => topic.TopicArn === expected
    );

    if (!found) throw new Error("Publication topic was not found");

    console.log("PASS: Publication SNS topic exists");
  });

  await check("Publication-outcome Lambda", async () => {
    const result = await lambda.send(
      new ListFunctionsCommand({})
    );

    const found = (result.Functions || []).some(
      fn => fn.FunctionName ===
        "supporthub-editorial-publication-outcome"
    );

    if (!found) throw new Error("Publication Lambda was not found");

    console.log("PASS: Publication-outcome Lambda exists");
  });

  await Promise.all([
    sqs.destroy(),
    sns.destroy(),
    lambda.destroy()
  ]);

  console.log("==================================");

  if (process.exitCode) {
    console.log("One or more AWS checks failed.");
  } else {
    console.log("All AWS resource checks passed.");
  }
}

main().catch(error => {
  console.error("AWS verification failed:", error.message);
  process.exitCode = 1;
});
