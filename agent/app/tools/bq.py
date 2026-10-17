"""Thin BigQuery helper: parameterised queries against the `tpc` semantic views only."""

import datetime as dt
import os
from functools import lru_cache
from typing import Any

from google.cloud import bigquery

DATASET = os.getenv("TPC_DATASET", "tpc")
BQ_LOCATION = os.getenv("TPC_BQ_LOCATION", "asia-southeast2")

# The demo "today" is 2026-10-17; data runs through 2026-10-16 (October is month-to-date).
CURRENT_PERIOD = dt.date(2026, 10, 1)
BASELINE_PERIODS = [dt.date(2026, 6, 1), dt.date(2026, 7, 1), dt.date(2026, 8, 1)]


@lru_cache(maxsize=1)
def client() -> bigquery.Client:
    return bigquery.Client(project=os.environ["GOOGLE_CLOUD_PROJECT"], location=BQ_LOCATION)


def table(name: str) -> str:
    return f"`{os.environ['GOOGLE_CLOUD_PROJECT']}.{DATASET}.{name}`"


def _param(name: str, value: Any) -> bigquery.ScalarQueryParameter | bigquery.ArrayQueryParameter:
    if isinstance(value, list):
        kind = "DATE" if value and isinstance(value[0], dt.date) else "STRING"
        return bigquery.ArrayQueryParameter(name, kind, value)
    kind = ("BOOL" if isinstance(value, bool) else "INT64" if isinstance(value, int)
            else "FLOAT64" if isinstance(value, float) else "DATE" if isinstance(value, dt.date) else "STRING")
    return bigquery.ScalarQueryParameter(name, kind, value)


def query(sql: str, bulk: bool = False, **params: Any) -> list[dict]:
    """Run a parameterised query. bulk=True downloads results through the BigQuery Storage API (much faster
    for tens of thousands of rows)."""
    cfg = bigquery.QueryJobConfig(query_parameters=[_param(k, v) for k, v in params.items()],
                                  maximum_bytes_billed=2_000_000_000)
    result = client().query(sql, job_config=cfg).result()
    if bulk:
        return [_clean(r) for r in result.to_arrow(create_bqstorage_client=True).to_pylist()]
    return [_clean(dict(r)) for r in result]


def _clean(row: dict) -> dict:
    out = {}
    for k, v in row.items():
        if isinstance(v, dt.date):
            v = v.isoformat()
        elif hasattr(v, "__float__") and not isinstance(v, (int, float, bool)):
            v = float(v)
        out[k] = v
    return out
