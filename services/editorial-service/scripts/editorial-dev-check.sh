#!/usr/bin/env bash
set -euo pipefail

echo "=================================="
echo " SupportHub Editorial Environment"
echo "=================================="

echo
echo "[1/3] Checking Docker..."
docker info > /dev/null
echo "PASS: Docker is available"

echo
echo "[2/3] Checking Editorial API..."
docker compose ps
curl -fsS http://localhost:3007/api/health
echo
echo "PASS: Editorial API is healthy"

echo
echo "[3/3] Checking Floci container..."
if docker inspect supporthub-floci > /dev/null 2>&1; then
    STATUS=$(docker inspect --format '{{.State.Status}}' supporthub-floci)
    echo "Floci container status: $STATUS"

    if [ "$STATUS" != "running" ]; then
        echo "FAIL: Floci is not running"
        exit 1
    fi

    echo "PASS: Floci container is running"
else
    echo "FAIL: supporthub-floci container was not found"
    exit 1
fi

echo
echo "=================================="
echo " Environment checks completed"
echo "=================================="
