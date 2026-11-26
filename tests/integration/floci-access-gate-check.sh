#!/usr/bin/env bash
# SupportHub Group 12 - verify the Vercel -> remote Floci access pattern in the
# ISOLATED stack: a client running the real Search image on a network WITHOUT a
# route to Floci reaches DynamoDB / S3 / CloudWatch only through an access gate
# that requires the Cloudflare Access service-token headers (test stand-in for
# Cloudflare Tunnel + Access). Throwaway random token per run; nothing printed.
#   bash tests/integration/floci-access-gate-check.sh
set -uo pipefail
export MSYS_NO_PATHCONV=1
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"; cd "$ROOT" || exit 2
NET=supporthub-gate-sim-net; GATE=supporthub-gate-sim; IMG=supporthub-int-search:local
KEYS=infra/floci/.generated/isolated/search.aws.env
ROOTW="$( (pwd -W 2>/dev/null) || pwd)"
docker port supporthub-iso-floci 4566 | grep -q 4567 || { echo "isolated Floci not found"; exit 2; }
PASS=0; FAIL=0
res() { if [ "$1" = ok ]; then PASS=$((PASS+1)); echo "PASS | $2"; else FAIL=$((FAIL+1)); echo "FAIL | $2"; fi; }
ID="$(openssl rand -hex 16).access"; SECRET="$(openssl rand -hex 32)"
cleanup() { docker rm -f "$GATE" >/dev/null 2>&1; docker network rm "$NET" >/dev/null 2>&1; }
trap cleanup EXIT
cleanup
docker network create --internal "$NET" >/dev/null && res ok "client network $NET created (--internal: no route to Floci or the internet)"
timeout 30 docker run -d --name "$GATE" --network supporthub-iso-net -e EXPECT_ID="$ID" -e EXPECT_SECRET="$SECRET" \
  -v "$ROOTW/infra/floci/remote/access-gate-sim.js:/gate.js:ro" node:22-alpine node /gate.js >/dev/null
docker network connect --alias floci-gate "$NET" "$GATE" && res ok "gate attached to supporthub-iso-net (Floci side) and $NET (client side)"
sleep 2

PROBE='(async()=>{const {dynamo,cloudwatch,s3}=require("/app/services/awsClients");
const {ScanCommand}=require("@aws-sdk/lib-dynamodb");const {PutMetricDataCommand}=require("@aws-sdk/client-cloudwatch");const {ListObjectsV2Command}=require("@aws-sdk/client-s3");
const ops=[["dynamodb:Scan counters",()=>dynamo.send(new ScanCommand({TableName:"supporthub-search-counters",Limit:1}))],
["s3:ListObjectsV2 exports/",()=>s3.send(new ListObjectsV2Command({Bucket:"supporthub-search-analytics-exports",Prefix:"exports/",MaxKeys:1}))],
["cloudwatch:PutMetricData",()=>cloudwatch.send(new PutMetricDataCommand({Namespace:"SupportHub/Search",MetricData:[{MetricName:"GateProbe",Value:1}]}))]];
for(const [n,f] of ops){try{const r=await f();console.log("OP",n,"OK",r.$metadata.httpStatusCode)}catch(e){console.log("OP",n,"ERR",e.$metadata?.httpStatusCode||"",e.name)}}})()'
run_client() { # label extra-docker-args...
  local label="$1"; shift
  timeout 120 docker run --rm --network "$NET" --env-file "$KEYS" -e AWS_REGION=us-east-1 -e AWS_ENDPOINT_URL=http://floci-gate:8080 \
    -e S3_EXPORT_BUCKET=supporthub-search-analytics-exports "$@" --entrypoint node "$IMG" -e "$PROBE" 2>&1 | grep '^OP' | sed "s/^/  [$label] /"
}
echo "== with the service-token headers (FLOCI_ACCESS_CLIENT_ID/SECRET set)"
out="$(run_client token -e FLOCI_ACCESS_CLIENT_ID="$ID" -e FLOCI_ACCESS_CLIENT_SECRET="$SECRET")"; echo "$out"
[ "$(echo "$out" | grep -c ' OK 200')" = 3 ] && res ok "DynamoDB, S3 and CloudWatch calls succeed through the gate with the token (Search IAM key)" || res bad "calls with token"
echo "== without the headers"
out="$(run_client none)"; echo "$out"
[ "$(echo "$out" | grep -c 'ERR 403')" = 3 ] && res ok "all three calls rejected with 403 at the gate without the token" || res bad "calls without token not rejected"
echo "== wrong secret"
out="$(run_client wrong -e FLOCI_ACCESS_CLIENT_ID="$ID" -e FLOCI_ACCESS_CLIENT_SECRET="$(openssl rand -hex 32)")"; echo "$out"
[ "$(echo "$out" | grep -c 'ERR 403')" = 3 ] && res ok "wrong service-token secret rejected (403)" || res bad "wrong secret accepted"
echo "== direct access to Floci from the client network"
d="$(timeout 60 docker run --rm --network "$NET" --entrypoint node "$IMG" -e 'fetch("http://floci:4566/_floci/health",{signal:AbortSignal.timeout(5000)}).then(r=>console.log("REACHED",r.status)).catch(e=>console.log("UNREACHABLE",e.cause?.code||e.name))' 2>&1 | tail -1)"
echo "  $d"; echo "$d" | grep -q UNREACHABLE && res ok "Floci itself is not reachable from the client network (only the gate is)" || res bad "Floci directly reachable"
echo "== gate decisions"; docker logs "$GATE" 2>&1 | grep -E "^(ALLOW|DENY)" | sort | uniq -c | sed 's/^/  /'
echo "Total: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
