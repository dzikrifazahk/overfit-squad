"""Global parameters for the synthetic dataset.

Everything here is fictional. Values marked "calibrated" are anchored to public
figures cited in reports/Use case AI telko HR proaktif EN.md; everything else is
an assumption chosen to make the demo story work.
"""

from datetime import date

SEED = 20261017

COMPANY = "PT Nusantara Seluler"
EMAIL_DOMAIN = "nusantaraseluler.example"

# Data runs through yesterday; "today" in the demo is 2026-10-17.
AS_OF = date(2026, 10, 16)
MONTHS = [date(2025 + (m // 12), m % 12 + 1, 1) for m in range(9, 22)]  # 2025-10 .. 2026-10
MTD_DAYS = AS_OF.day  # October 2026 is month-to-date
FY2026_START_INDEX = 3  # MONTHS[3] == 2026-01-01

DEMO_PROVINCE = "32"  # Jawa Barat: full detail (outlets, daily per desa, personas)
DAILY_DESA_START = date(2026, 7, 1)
DAILY_CLUSTER_START = date(2026, 1, 1)
HR_SCORE_MONTHS = MONTHS[-7:]  # 2026-04 .. 2026-10 (MTD)

# Month-of-year revenue seasonality (Lebaran 2026 falls around 20 March).
SEASONALITY = {1: 0.98, 2: 0.99, 3: 1.06, 4: 1.02, 5: 1.00, 6: 1.01,
               7: 1.02, 8: 1.01, 9: 1.00, 10: 1.00, 11: 0.99, 12: 1.03}

# Monthly trend per revenue stream (calibrated direction: legacy voice/SMS
# shrinking ~25%/yr, data growing, fixed-broadband ARPU eroding).
STREAM_TREND = {"data": 0.008, "voice_sms": -0.022, "digital": 0.005,
                "postpaid": 0.002, "home_bb": -0.004, "b2b": 0.003}

# Org hierarchy: 4 Areas -> 12 Regions -> 1 Branch per province -> Clusters.
AREAS = {
    "A1": "Area 1 Sumatera",
    "A2": "Area 2 Jabotabek Jabar",
    "A3": "Area 3 Jawa Bali Nusra",
    "A4": "Area 4 Kalimantan Sulawesi Maluku Papua",
}
REGIONS = [  # (region_id, name, area_id, province codes)
    ("R01", "Region Sumbagut", "A1", ["11", "12"]),
    ("R02", "Region Sumbagteng", "A1", ["13", "14", "21"]),
    ("R03", "Region Sumbagsel", "A1", ["15", "16", "17", "18", "19"]),
    ("R04", "Region Jabotabek", "A2", ["31", "36"]),
    ("R05", "Region Jawa Barat", "A2", ["32"]),
    ("R06", "Region Jawa Tengah DIY", "A3", ["33", "34"]),
    ("R07", "Region Jawa Timur", "A3", ["35"]),
    ("R08", "Region Bali Nusra", "A3", ["51", "52", "53"]),
    ("R09", "Region Kalimantan", "A4", ["61", "62", "63", "64", "65"]),
    ("R10", "Region Sulawesi Utara Tengah", "A4", ["71", "72", "75"]),
    ("R11", "Region Sulawesi Selatan Tenggara Barat", "A4", ["73", "74", "76"]),
    ("R12", "Region Maluku Papua", "A4", ["81", "82", "91", "92", "93", "94", "95", "96"]),
]

JAVA_PROVINCES = {"31", "32", "33", "34", "35", "36"}
THREE_T_PROVINCES = {"53", "81", "82", "91", "92", "93", "94", "95", "96"}

# Relative purchasing power by province (assumption, loosely PDRB-per-capita shaped).
INCOME_FACTOR = {
    "31": 2.0, "64": 1.6, "21": 1.5, "14": 1.3, "36": 1.15, "32": 1.0, "35": 1.05,
    "33": 0.9, "34": 0.95, "51": 1.2, "12": 1.0, "13": 0.95, "16": 1.0, "73": 1.0,
    "71": 1.0, "61": 0.9, "62": 0.95, "63": 1.0, "65": 1.2,
}
DEFAULT_INCOME_FACTOR = 0.85

# Planted story: these branches got a top-down "growth push" target that ignores
# territory potential, so they look red on raw attainment but not on adjusted.
INFLATED_TARGET_BRANCHES = {"53": 1.12, "82": 1.12, "65": 1.12, "96": 1.12}

# West Java clusters that carry the demo story (other regencies are auto-grouped).
DEMO_CLUSTERS = {
    "Garut": ["32.05"],
    "Tasikmalaya": ["32.06", "32.78"],
    "Cianjur": ["32.03"],
    "Sukabumi": ["32.02", "32.72"],
    "Bekasi": ["32.16", "32.75"],
}
# Privacy-gate demo: a cluster whose internal team has only 4 people.
SMALL_TEAM_PROVINCE = "95"  # Papua Pegunungan
