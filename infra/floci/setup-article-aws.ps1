
# SupportHub Group 12
# Article Service - Floci AWS Setup
# Owner: Alyaa
# Local AWS emulator only

$ErrorActionPreference = "Stop"

$endpoint = "http://localhost:4566"
$region = "us-east-1"

# Floci local test credentials
$env:AWS_ACCESS_KEY_ID = "test"
$env:AWS_SECRET_ACCESS_KEY = "test"
$env:AWS_DEFAULT_REGION = $region

function Run-Aws {
    & aws --endpoint-url=$endpoint --region $region @args --no-cli-pager

    if ($LASTEXITCODE -ne 0) {
        throw "AWS command failed."
    }
}

Write-Host "Starting SupportHub Article AWS setup..."

# ==========================================
# 1. S3 - ARTICLE VERSION BACKUPS
# ==========================================

$bucket = "supporthub-article-backups"

& aws --endpoint-url=$endpoint --region $region `
    s3api head-bucket --bucket $bucket 2>$null

if ($LASTEXITCODE -ne 0) {
    Run-Aws s3api create-bucket --bucket $bucket
    Write-Host "S3 bucket created: $bucket"
} else {
    Write-Host "S3 bucket already exists: $bucket"
}

# ==========================================
# 2. SQS - ARTICLE EVENTS
# ==========================================

$queue = "supporthub-article-events"

Run-Aws sqs create-queue --queue-name $queue

Write-Host "SQS queue ready: $queue"

# ==========================================
# 3. SECRETS MANAGER
# ==========================================

$secretName = "supporthub/article/runtime-config"

$secretValue = '{"feature":"article-backup","enabled":true}'

$existingSecret = & aws --endpoint-url=$endpoint `
    --region $region secretsmanager describe-secret `
    --secret-id $secretName `
    --query Name --output text 2>$null

if ($LASTEXITCODE -ne 0) {
    Run-Aws secretsmanager create-secret `
        --name $secretName `
        --secret-string $secretValue

    Write-Host "Secret created: $secretName"
} else {
    Write-Host "Secret already exists: $secretName"
}

Write-Host ""
Write-Host "Article AWS resources created or verified!"
Write-Host "S3: $bucket"
Write-Host "SQS: $queue"
Write-Host "Secrets Manager: $secretName"
Write-Host ""

# ==========================================
# 4. IAM - ARTICLE SERVICE PERMISSIONS
# ==========================================

$iamUser = "supporthub-article-service"
$iamDir = Join-Path $PSScriptRoot "..\iam"

# Create IAM user only when missing
& aws --endpoint-url=$endpoint --region $region `
    iam get-user --user-name $iamUser `
    --output json --no-cli-pager 2>$null | Out-Null

if ($LASTEXITCODE -ne 0) {
    Run-Aws iam create-user --user-name $iamUser
}

# Configure restricted S3 policy
Run-Aws iam put-user-policy `
    --user-name $iamUser `
    --policy-name "SupportHubArticleS3Policy" `
    --policy-document "file://$((Join-Path $iamDir 'article-s3-policy.json'))"

# Configure restricted SQS policy
Run-Aws iam put-user-policy `
    --user-name $iamUser `
    --policy-name "SupportHubArticleSQSPublisher" `
    --policy-document "file://$((Join-Path $iamDir 'article-sqs-policy.json'))"

# Configure Secrets Manager managed policy
$policyName = "SupportHubArticleSecretsPolicy"
$policyArn = "arn:aws:iam::000000000000:policy/$policyName"

& aws --endpoint-url=$endpoint --region $region `
    iam get-policy --policy-arn $policyArn `
    --output json --no-cli-pager 2>$null | Out-Null

if ($LASTEXITCODE -ne 0) {
    Run-Aws iam create-policy `
        --policy-name $policyName `
        --policy-document "file://$((Join-Path $iamDir 'article-secrets-policy.json'))"
}

$attached = & aws --endpoint-url=$endpoint --region $region `
    iam list-attached-user-policies `
    --user-name $iamUser `
    --query "AttachedPolicies[].PolicyArn" `
    --output text --no-cli-pager

if ($attached -notmatch [regex]::Escape($policyArn)) {
    Run-Aws iam attach-user-policy `
        --user-name $iamUser `
        --policy-arn $policyArn
}

Write-Host "IAM Article Service permissions ready!"

Write-Host "IAM: Article Service permissions configured!"
