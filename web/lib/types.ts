// Shapes of web/public/data/*.json (built by scripts/build_web_data.py) and of UI state.

export type Att = {
  name: string;
  rev_total: number;
  rev_total_target: number;
  rev_total_expected: number;
  rev_shock_loss_est: number;
  raw: number;
  adj: number;
  gap_total: number;
  gap_target_above_potential: number;
  gap_non_controllable: number;
  gap_controllable: number;
  capacity?: number;
  cluster_id?: string;
  owner?: string | null;
  owner_type?: string | null;
};

export type Person = { employee_id: string; name: string; role: string; role_id: string } | null;

export type Driver = {
  key: string;
  label: string;
  unit: string;
  now: number;
  baseline: number;
  delta_pct: number;
  flag: boolean;
  controllable: boolean;
};

export type Quadrant = "performing_staffed" | "performing_understaffed" | "missing_staffed" | "missing_understaffed";

export type Cluster = {
  id: string;
  name: string;
  branch_id: string;
  province_kode: string;
  regencies: string[];
  raw: number;
  adj: number;
  rev_total: number;
  rev_total_target: number;
  rev_total_expected: number;
  rev_shock_loss_est: number;
  gap_target_above_potential: number;
  gap_non_controllable: number;
  gap_controllable: number;
  capacity: number;
  planned: number;
  filled: number;
  quadrant: Quadrant;
  owner: Person;
  team_size: number;
  team_gate: boolean;
  members: { name: string; role: string; tenure_months: number; employment_type: string }[];
  pct_tenure_lt_12m: number | null;
  vacancies: { role: string; days_open: number; backfill_request_submitted: boolean }[];
  engagement: number | null;
  engagement_suppressed: boolean;
  partner_sf: { headcount: number; pct_tenure_lt_12m: number; effective_call_rate: number };
  events: { event_id: string; type: string; title: string; start: string; end: string; loss: number }[];
  drivers?: Driver[];
  series: { period: string; raw: number; adj: number }[];
  peers: { id: string; name: string; adj: number; raw: number; owner: string | null }[];
};

export type Unit = {
  name: string;
  region_id?: string;
  raw: number;
  adj: number;
  BM?: Person;
  BCM?: Person;
  BSM?: Person;
  RGM?: Person;
  RNOM?: Person;
  RHRBP?: Person;
};

export type PersonaRow = { employee_id: string; full_name: string; role_id: string; org_unit_id: string };

export type InjectEvent = {
  id: string;
  date: string;
  desa_kode: string;
  desa_name: string;
  district_name: string;
  cluster_id: string;
  metric: string;
  change_pct: number;
  lat: number;
  lng: number;
};

export type Metrics = {
  as_of: string;
  period: string;
  national: { raw: number; adj: number };
  provinces: Record<string, Att>;
  regencies: Record<string, Att>;
  districts: Record<string, Att>;
  clusters: Record<string, Cluster>;
  units: Record<string, Unit>;
  personas: PersonaRow[];
  inject: InjectEvent;
};

export type DesaPoint = { kode: string; name: string; lat: number; lng: number; raw: number; adj: number; rev: number };

export type Doc = { id: string; title: string; text: string };

// ---------- UI state ----------

export type Layer = "raw" | "adjusted" | "bivariate";
export type Level = "national" | "province" | "regency" | "desa";
export type Selection = { level: Level; kode: string | null };

export type Tier = "P1" | "P2" | "P3";
export type AlertStatus = "notified" | "acked" | "action_proposed" | "approved" | "escalated" | "resolved";

export type Alert = {
  id: string;
  tier: Tier;
  title: string;
  body: string;
  clusterId: string;
  geoKode: string;
  lat?: number;
  lng?: number;
  recipient: string; // employee_id
  createdAt: string; // ISO
  status: AlertStatus;
  escalatedTo?: string;
  question?: string;
  answer?: string;
};

export type PlanItem = { id: string; text: string; owner: string; due: string; kind: string; needsApprovalFrom?: string };

export type Plan = {
  id: string;
  clusterId: string;
  alertId?: string;
  title: string;
  rationale: string;
  items: PlanItem[];
  approver: string; // employee_id
  status: "pending" | "approved" | "rejected";
  createdAt: string;
};

export type Task = { id: string; planId: string; clusterId: string; text: string; lat: number; lng: number; status: "open" | "done" };

export type PhoneButton = { label: string; action: PhoneAction };
export type PhoneAction =
  | { type: "ACK"; alertId: string }
  | { type: "ANSWER"; alertId: string; answer: "outage" | "not_outage" | "unknown" }
  | { type: "APPROVE_PLAN"; planId: string }
  | { type: "REJECT_PLAN"; planId: string }
  | { type: "NOT_MINE"; alertId: string };

export type PhoneMessage = {
  id: string;
  to: string;
  time: string;
  text: string;
  tier?: Tier | "digest" | "info";
  buttons?: PhoneButton[];
  done?: boolean;
};

export type ChatMessage = { id: string; role: "user" | "agent"; text: string; citations?: string[]; meta?: string; streaming?: boolean; status?: string };

export type AuditEntry = { id: string; time: string; actor: string; action: string; detail: string };

export type MapCommand = { focus?: Selection; layer?: Layer; highlight?: string[] };

export type AgentReply = { source?: "adk" | "mock"; text: string; map?: MapCommand; plan?: Plan; citations?: string[]; refused?: boolean; tools?: string[] };

/** Newline-delimited JSON events sent by /api/chat while the agent works. */
export type StreamEvent =
  | { t: "status"; text: string }
  | { t: "delta"; text: string }
  | { t: "map"; map: NonNullable<AgentReply["map"]> }
  | { t: "done"; reply: AgentReply }
  | { t: "error"; message: string };
