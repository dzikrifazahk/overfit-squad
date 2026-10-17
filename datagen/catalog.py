"""Static catalogs: roles (job descriptions), KPI definitions / driver tree, KPI ownership."""

import pandas as pd

ROLES = [
    # role_id, title, org_level, grade, summary, responsibilities
    ("CSO", "Chief Sales Officer", "national", "BP-I",
     "Owns national revenue and subscriber targets and the territory operating model.",
     ["Set the annual national revenue target and cascade it to Areas",
      "Run the monthly national performance review",
      "Approve territory realignment and growth programs"]),
    ("HQ_PLAN", "Head of Sales Planning & Performance", "national", "BP-II",
     "Owns target setting, the KPI framework and territory potential models.",
     ["Cascade targets from national to cluster using territory potential",
      "Maintain the KPI dictionary and scorecard weights",
      "Publish monthly performance packs"]),
    ("HQ_CHANNEL", "Head of Channel Management", "national", "BP-II",
     "Owns the outlet and partner channel strategy (NusaPOS, distributors).",
     ["Define outlet activation and productivity programs",
      "Manage national distributor partner agreements"]),
    ("HQ_HR", "Head of People Partner (Sales)", "national", "BP-II",
     "Owns people processes for the sales organisation: performance cycle, staffing and coaching.",
     ["Run the performance management cycle in line with the PKB",
      "Approve staffing plans and backfill priorities",
      "Govern the use of people analytics and AI in HR decisions"]),
    ("AVP", "Area Vice President", "area", "BP-II",
     "Accountable for revenue of all provinces in the Area.",
     ["Review Region performance weekly", "Escalation point for Regional General Managers",
      "Allocate Area budget for growth programs"]),
    ("AREA_PLAN", "Area Sales Planning Manager", "area", "BP-III",
     "Supports the AVP with target cascade, forecasting and performance analytics for the Area.",
     ["Prepare Area forecasts and gap analyses", "Propose target re-allocation between Regions"]),
    ("AREA_HRBP", "Area HR Business Partner", "area", "BP-III",
     "HR partner for the Area leadership team.",
     ["Coordinate staffing and backfill across Regions", "Run calibration sessions for the Area"]),
    ("RGM", "Regional General Manager", "region", "BP-II",
     "Accountable for total revenue, subscriber growth and team health of all branches in the Region.",
     ["Own Region revenue vs target and the monthly business review",
      "Approve action plans escalated by Branch Managers",
      "Coach Branch Managers and sponsor backfill for critical vacancies",
      "Coordinate with Network Operations on outages that affect revenue"]),
    ("RSM", "Regional Sales Manager", "region", "BP-III",
     "Runs consumer sales execution across the Region's branches.",
     ["Track prepaid and data revenue drivers per branch", "Lead sales programs and promotions"]),
    ("RCM", "Regional Channel Manager", "region", "BP-III",
     "Owns outlet coverage, activation and partner performance in the Region.",
     ["Manage distributor partners' performance", "Track active outlets and recharge availability"]),
    ("RB2B", "Regional B2B Manager", "region", "BP-III",
     "Owns enterprise and SME revenue in the Region.",
     ["Manage the B2B pipeline", "Lead B2B Account Managers in branches"]),
    ("RHRBP", "Regional HR Business Partner", "region", "BP-IV",
     "HR partner for the Region: staffing, performance cycle, coaching support.",
     ["Process backfill requests", "Support managers with coaching and development plans",
      "Ensure performance processes follow the PKB and SP procedure"]),
    ("RNOM", "Regional Network Operations Manager", "region", "BP-III",
     "Owns network availability and incident recovery in the Region (dotted line to sales).",
     ["Restore site outages within SLA", "Report outages that affect revenue to the RGM",
      "Prioritise capacity upgrades in high-potential areas"]),
    ("BM", "Branch Manager", "branch", "BP-III",
     "Accountable for revenue, subscribers and channel health of one province (branch).",
     ["Own branch revenue vs target", "Lead Cluster Sales Managers", "Approve cluster action plans",
      "Escalate network or partner issues to the Region"]),
    ("BSM", "Branch Sales Manager", "branch", "BP-IV",
     "Runs consumer sales programs across clusters in the branch.",
     ["Drive prepaid, data and home broadband sales", "Track ARPU and churn by cluster"]),
    ("BCM", "Branch Channel Manager", "branch", "BP-IV",
     "Owns outlet activation and partner execution in the branch.",
     ["Manage distributor partners in the branch", "Track active outlets and voucher stock"]),
    ("B2B_AM", "B2B Account Manager", "branch", "BP-IV",
     "Manages enterprise, government and SME accounts in the branch.",
     ["Grow B2B revenue", "Handle key account escalations"]),
    ("BMO", "Branch Marketing Officer", "branch", "BP-V",
     "Runs local marketing, pricing execution and retention campaigns.",
     ["Execute area-based pricing", "Run churn-retention campaigns", "Track ARPU and postpaid sales"]),
    ("BSA", "Branch Sales Operations Analyst", "branch", "BP-V",
     "Prepares branch performance reports and data for reviews.",
     ["Maintain branch dashboards", "Prepare weekly performance packs"]),
    ("CSM", "Cluster Sales Manager", "cluster", "BP-IV",
     "Accountable for revenue vs target of one cluster (1-3 kabupaten/kota) and leads the cluster sales team.",
     ["Own cluster revenue, net adds and active outlets",
      "Lead Sales Supervisors and Channel Officers; coach new joiners",
      "Coordinate the partner sales force (canvassers) through the distributor",
      "Propose and execute weekly action plans; escalate blockers to the Branch Manager"]),
    ("SS", "Sales Supervisor", "cluster", "BP-V",
     "Responsible for revenue and subscriber growth in assigned kecamatan.",
     ["Plan and supervise partner canvasser routes in assigned kecamatan",
      "Drive outlet activation and recharge sell-through",
      "Track net adds and churn; report issues to the Cluster Sales Manager"]),
    ("CO", "Channel Officer", "cluster", "BP-V",
     "Responsible for outlet activation, NusaPOS adoption and voucher/recharge stock availability in the cluster.",
     ["Activate and re-activate outlets", "Monitor recharge stock and resolve stock-outs with the distributor",
      "Onboard outlets to NusaPOS"]),
]

KPIS = [
    # kpi_id, name, unit, direction, parent, relation, sales_controllable, description
    ("REV_TOTAL", "Total revenue", "IDR", "higher", None, "root", True,
     "Sum of all revenue streams for the territory."),
    ("REV_DATA", "Prepaid data revenue", "IDR", "higher", "REV_TOTAL", "component", True,
     "Prepaid data package revenue; driven by active subscribers, ARPU, outlet sell-through and network."),
    ("REV_VOICE_SMS", "Legacy voice & SMS revenue", "IDR", "higher", "REV_TOTAL", "component", True,
     "Prepaid voice and SMS revenue; structurally declining (~25%/yr)."),
    ("REV_DIGITAL", "Digital services revenue", "IDR", "higher", "REV_TOTAL", "component", True,
     "Digital/VAS revenue (games, video, financial services)."),
    ("REV_POSTPAID", "Postpaid revenue", "IDR", "higher", "REV_TOTAL", "component", True,
     "Consumer postpaid subscription revenue."),
    ("REV_HOME_BB", "Home broadband revenue", "IDR", "higher", "REV_TOTAL", "component", True,
     "Fixed home broadband (fiber) revenue."),
    ("REV_B2B", "B2B revenue", "IDR", "higher", "REV_TOTAL", "component", True,
     "Enterprise, government and SME revenue."),
    ("SUBS_ACTIVE", "Active subscribers", "subscribers", "higher", "REV_DATA", "driver", True,
     "Mobile subscribers active in the period."),
    ("NET_ADD", "Net subscriber adds", "subscribers", "higher", "SUBS_ACTIVE", "driver", True,
     "New subscribers minus churned subscribers."),
    ("CHURN_RATE", "Monthly churn rate", "%", "lower", "SUBS_ACTIVE", "driver", True,
     "Churned subscribers / active subscribers."),
    ("ARPU", "Mobile ARPU", "IDR/subscriber", "higher", "REV_DATA", "driver", True,
     "Mobile revenue / active subscribers."),
    ("OUTLET_ACTIVE", "Active NusaPOS outlets", "outlets", "higher", "REV_DATA", "driver", True,
     "Registered outlets with at least one recharge/package sale in the period."),
    ("RECHARGE_AVAIL", "Recharge stock availability", "%", "higher", "OUTLET_ACTIVE", "driver", True,
     "Share of outlet-days with voucher/recharge stock available."),
    ("NETWORK_AVAIL", "Network availability", "%", "higher", "REV_DATA", "driver", False,
     "Site availability; outages are NOT controllable by the sales team."),
    ("AKHLAK", "AKHLAK behaviour score", "score 0-3", "higher", None, "behaviour", True,
     "Average of the six AKHLAK core values (Amanah, Kompeten, Harmonis, Loyal, Adaptif, Kolaboratif)."),
]

KPI_OWNERS = [
    # kpi_id, org_level, role_id, raci
    ("REV_TOTAL", "national", "CSO", "A"), ("REV_TOTAL", "area", "AVP", "A"),
    ("REV_TOTAL", "region", "RGM", "A"), ("REV_TOTAL", "branch", "BM", "A"),
    ("REV_TOTAL", "cluster", "CSM", "A"), ("REV_TOTAL", "district", "SS", "R"),
    ("REV_DATA", "region", "RSM", "A"), ("REV_DATA", "branch", "BSM", "A"),
    ("REV_DATA", "cluster", "CSM", "A"), ("REV_DATA", "district", "SS", "R"),
    ("REV_VOICE_SMS", "branch", "BSM", "A"), ("REV_VOICE_SMS", "district", "SS", "R"),
    ("REV_DIGITAL", "branch", "BMO", "R"), ("REV_DIGITAL", "branch", "BSM", "A"),
    ("REV_POSTPAID", "branch", "BMO", "R"), ("REV_POSTPAID", "branch", "BSM", "A"),
    ("REV_HOME_BB", "branch", "BSM", "A"), ("REV_HOME_BB", "cluster", "CSM", "R"),
    ("REV_B2B", "region", "RB2B", "A"), ("REV_B2B", "branch", "B2B_AM", "R"),
    ("SUBS_ACTIVE", "cluster", "CSM", "A"), ("SUBS_ACTIVE", "district", "SS", "R"),
    ("NET_ADD", "cluster", "CSM", "A"), ("NET_ADD", "district", "SS", "R"),
    ("CHURN_RATE", "branch", "BMO", "R"), ("CHURN_RATE", "cluster", "CSM", "A"),
    ("ARPU", "branch", "BMO", "R"), ("ARPU", "branch", "BSM", "A"),
    ("OUTLET_ACTIVE", "region", "RCM", "A"), ("OUTLET_ACTIVE", "branch", "BCM", "A"),
    ("OUTLET_ACTIVE", "cluster", "CSM", "A"), ("OUTLET_ACTIVE", "cluster", "CO", "R"),
    ("RECHARGE_AVAIL", "branch", "BCM", "A"), ("RECHARGE_AVAIL", "cluster", "CO", "R"),
    ("NETWORK_AVAIL", "region", "RNOM", "A"),
]

# Scorecard weights per line role (assumption, aligned with outcome-focused KPIs + AKHLAK).
SCORECARDS = {
    "SS": [("REV_TOTAL", 40), ("NET_ADD", 20), ("OUTLET_ACTIVE", 15), ("RECHARGE_AVAIL", 10), ("AKHLAK", 15)],
    "CO": [("OUTLET_ACTIVE", 40), ("RECHARGE_AVAIL", 30), ("REV_DATA", 15), ("AKHLAK", 15)],
    "CSM": [("REV_TOTAL", 40), ("NET_ADD", 20), ("OUTLET_ACTIVE", 15), ("RECHARGE_AVAIL", 10), ("AKHLAK", 15)],
    "BM": [("REV_TOTAL", 50), ("REV_HOME_BB", 15), ("NET_ADD", 10), ("OUTLET_ACTIVE", 10), ("AKHLAK", 15)],
    "RGM": [("REV_TOTAL", 60), ("REV_B2B", 10), ("NET_ADD", 15), ("AKHLAK", 15)],
}


def role_table() -> pd.DataFrame:
    rows = []
    owned = pd.DataFrame(KPI_OWNERS, columns=["kpi_id", "org_level", "role_id", "raci"])
    for role_id, title, level, grade, summary, resp in ROLES:
        kpis = owned[owned["role_id"] == role_id]
        kpi_txt = ", ".join(f"{k} ({r})" for k, r in zip(kpis["kpi_id"], kpis["raci"])) or "none"
        jd = (f"{title} ({level} level, grade {grade}). {summary}\n"
              "Key responsibilities:\n" + "\n".join(f"- {r}" for r in resp)
              + f"\nKPI ownership (A=accountable, R=responsible): {kpi_txt}.")
        rows.append({"role_id": role_id, "title": title, "org_level": level, "grade": grade,
                     "summary": summary, "responsibilities": "; ".join(resp),
                     "owned_kpis": kpi_txt, "job_description": jd})
    return pd.DataFrame(rows)


def kpi_tables() -> tuple[pd.DataFrame, pd.DataFrame, pd.DataFrame]:
    kpi = pd.DataFrame(KPIS, columns=["kpi_id", "name", "unit", "direction", "parent_kpi_id",
                                      "relation", "sales_controllable", "description"])
    owner = pd.DataFrame(KPI_OWNERS, columns=["kpi_id", "org_level", "role_id", "raci"])
    weights = [(role, k, w) for role, items in SCORECARDS.items() for k, w in items]
    scorecard = pd.DataFrame(weights, columns=["role_id", "kpi_id", "weight_pct"])
    return kpi, owner, scorecard
