#!/usr/bin/env bash
# Load the synthetic Parquet tables into BigQuery (replaces existing tables).
# Usage: scripts/load_bigquery.sh [PROJECT_ID] [DATASET] [LOCATION]
set -euo pipefail

PROJECT="${1:-project-757fd40b-4ebb-4c43-aeb}"
DATASET="${2:-tpc}"
LOCATION="${3:-asia-southeast2}"
DIR="$(cd "$(dirname "$0")/.." && pwd)/data/synthetic"

bq --project_id="$PROJECT" --location="$LOCATION" mk -f --dataset \
  --description "Territory Performance Copilot - synthetic data (fictional)" "$PROJECT:$DATASET"

for f in "$DIR"/*.parquet; do
  table="$(basename "$f" .parquet)"
  echo "loading $table"
  bq --project_id="$PROJECT" --location="$LOCATION" load --replace --source_format=PARQUET \
    "$DATASET.$table" "$f"
done
