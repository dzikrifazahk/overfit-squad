-- Semantic layer for the Territory Performance Copilot (dataset `tpc`).
-- raw_pct  = actual / target
-- adj_pct  = (actual + non-controllable loss) / expected-from-potential
-- Gap vs target splits into: target above potential, non-controllable loss, controllable remainder.

CREATE OR REPLACE VIEW tpc.v_fact AS
SELECT
  a.period, a.is_mtd, a.days_covered, a.desa_kode, a.district_kode, a.regency_kode, a.province_kode,
  a.cluster_id, a.branch_id, b.parent_org_unit_id AS region_id,
  a.rev_total, t.rev_total_target, t.rev_total_expected, a.rev_shock_loss_est,
  a.rev_data, a.rev_voice_sms, a.rev_digital, a.rev_postpaid, a.rev_home_bb, a.rev_b2b,
  a.subs_active, a.new_subs, a.churned_subs, a.registered_outlets, a.active_outlets,
  a.network_availability_pct, t.net_add_target, t.active_outlets_target
FROM tpc.revenue_monthly a
JOIN tpc.revenue_target_monthly t USING (period, desa_kode, cluster_id, branch_id)
JOIN tpc.org_unit b ON b.org_unit_id = a.branch_id;

-- Attainment for every geography level (province, regency, district) and org level (cluster, branch, region, national).
CREATE OR REPLACE VIEW tpc.v_attainment AS
WITH levels AS (
  SELECT period, 'province' AS level, province_kode AS id, * EXCEPT(period) FROM tpc.v_fact
  UNION ALL SELECT period, 'regency', regency_kode, * EXCEPT(period) FROM tpc.v_fact
  UNION ALL SELECT period, 'district', district_kode, * EXCEPT(period) FROM tpc.v_fact
  UNION ALL SELECT period, 'cluster', cluster_id, * EXCEPT(period) FROM tpc.v_fact
  UNION ALL SELECT period, 'branch', branch_id, * EXCEPT(period) FROM tpc.v_fact
  UNION ALL SELECT period, 'region', region_id, * EXCEPT(period) FROM tpc.v_fact
  UNION ALL SELECT period, 'national', 'ID', * EXCEPT(period) FROM tpc.v_fact
),
agg AS (
  SELECT period, level, id,
    SUM(rev_total) AS rev_total, SUM(rev_total_target) AS rev_target, SUM(rev_total_expected) AS rev_expected,
    SUM(rev_shock_loss_est) AS shock_loss
  FROM levels GROUP BY period, level, id
)
SELECT agg.*,
  COALESCE(g.name, o.name, 'Indonesia') AS name,
  ROUND(100 * rev_total / rev_target, 1) AS raw_pct,
  ROUND(100 * (rev_total + shock_loss) / rev_expected, 1) AS adj_pct,
  rev_target - rev_total AS gap_total,
  GREATEST(rev_target - rev_expected, 0) AS gap_target_above_potential,
  shock_loss AS gap_non_controllable,
  rev_expected - rev_total - shock_loss AS gap_controllable
FROM agg
LEFT JOIN tpc.geo_region g ON g.geo_kode = agg.id AND agg.level IN ('province', 'regency', 'district')
LEFT JOIN tpc.org_unit o ON o.org_unit_id = agg.id AND agg.level IN ('cluster', 'branch', 'region');

-- Monthly drivers per cluster (partner sales force and stock come from their own tables).
CREATE OR REPLACE VIEW tpc.v_cluster_drivers AS
WITH f AS (
  SELECT period, cluster_id, ANY_VALUE(days_covered) AS days,
    SUM(active_outlets) AS active_outlets, SUM(registered_outlets) AS registered_outlets,
    SUM(subs_active) AS subs, SUM(new_subs) AS new_subs, SUM(churned_subs) AS churned,
    SUM(rev_data + rev_voice_sms + rev_digital + rev_postpaid) AS mobile_rev,
    SUM(network_availability_pct * rev_total) / NULLIF(SUM(rev_total), 0) AS network_avail_pct
  FROM tpc.v_fact GROUP BY period, cluster_id
)
SELECT f.period, f.cluster_id,
  ROUND(100 * active_outlets / NULLIF(registered_outlets, 0), 1) AS outlet_active_pct,
  s.recharge_availability_pct AS stock_pct,
  p.effective_call_rate AS ecr,
  ROUND((new_subs - churned) / subs * 1000 * 30.4 / days, 1) AS net_adds_per_1k,
  ROUND(100 * churned / subs * 30.4 / days, 2) AS churn_pct,
  ROUND(mobile_rev / subs * 30.4 / days) AS arpu,
  ROUND(network_avail_pct, 2) AS network_avail_pct,
  p.headcount_eom AS partner_sf_headcount, p.pct_tenure_lt_12m AS partner_sf_pct_new
FROM f
LEFT JOIN tpc.channel_stock_monthly s USING (period, cluster_id)
LEFT JOIN tpc.partner_sf_monthly p USING (period, cluster_id);

-- Team health per org unit with the privacy gate applied in SQL (n >= 5).
CREATE OR REPLACE VIEW tpc.v_team_health AS
WITH pos AS (SELECT org_unit_id, COUNT(*) AS planned FROM tpc.position GROUP BY org_unit_id),
act AS (
  SELECT org_unit_id, COUNT(*) AS filled,
    COUNTIF(DATE_DIFF(DATE '2026-10-16', hire_date, MONTH) < 12) AS tenure_lt_12m
  FROM tpc.employee WHERE status = 'active' GROUP BY org_unit_id
),
vac AS (
  SELECT org_unit_id, COUNT(*) AS open_vacancies, MAX(days_open) AS max_days_open,
    STRING_AGG(CONCAT(r.title, ' (', CAST(days_open AS STRING), ' days', IF(backfill_request_submitted, ', backfill requested', ', no backfill request yet'), ')'), '; ') AS vacancies
  FROM tpc.vacancy v JOIN tpc.role r USING (role_id) GROUP BY org_unit_id
),
ex AS (
  SELECT org_unit_id, COUNT(*) AS exits_12m FROM tpc.employee
  WHERE status = 'exited' AND exit_date >= DATE '2025-10-17' GROUP BY org_unit_id
)
SELECT o.org_unit_id, o.name, o.level, pos.planned, act.filled,
  ROUND(act.filled / pos.planned, 2) AS capacity,
  act.filled < 5 AS suppressed,
  IF(act.filled < 5, NULL, ROUND(100 * act.tenure_lt_12m / act.filled)) AS pct_tenure_lt_12m,
  IF(act.filled < 5, NULL, ROUND(100 * IFNULL(ex.exits_12m, 0) / act.filled)) AS attrition_12m_pct,
  IF(e.respondents < 5, NULL, e.engagement_score) AS engagement_score,
  IFNULL(vac.open_vacancies, 0) AS open_vacancies, vac.max_days_open, vac.vacancies
FROM tpc.org_unit o
JOIN pos USING (org_unit_id)
LEFT JOIN act USING (org_unit_id)
LEFT JOIN vac USING (org_unit_id)
LEFT JOIN ex USING (org_unit_id)
LEFT JOIN tpc.engagement_survey e USING (org_unit_id);

-- Who holds which KPI for each org unit (roles -> active employees).
CREATE OR REPLACE VIEW tpc.v_kpi_owner AS
SELECT o.org_unit_id, o.level AS org_level, k.kpi_id, d.name AS kpi_name, k.raci, k.role_id, r.title AS role_title,
  e.employee_id, e.full_name
FROM tpc.org_unit o
JOIN tpc.kpi_owner k ON k.org_level = o.level OR (k.org_level = 'district' AND o.level = 'cluster')
JOIN tpc.kpi_definition d USING (kpi_id)
JOIN tpc.role r USING (role_id)
LEFT JOIN tpc.employee e ON e.org_unit_id = o.org_unit_id AND e.role_id = k.role_id AND e.status = 'active';

-- Materialised copies for fast agent start-up (the demo data is static; rerun after reloading data).
CREATE OR REPLACE TABLE tpc.attainment_mat AS SELECT * FROM tpc.v_attainment;
CREATE OR REPLACE TABLE tpc.cluster_drivers_mat AS SELECT * FROM tpc.v_cluster_drivers;
