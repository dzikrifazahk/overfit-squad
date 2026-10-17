# ruff: noqa
# Copyright 2026 Google LLC
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     https://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.

import re

from google.adk.agents import Agent
from google.adk.agents.callback_context import CallbackContext
from google.adk.apps import App
from google.adk.models import Gemini
from google.adk.models.llm_request import LlmRequest
from google.adk.models.llm_response import LlmResponse
from google.genai import types

from app.prompt import INSTRUCTION
from app.tools.actions import draft_action_plan
from app.tools.docs import search_policy_docs
from app.tools.people import team_scorecard_summary, team_snapshot
from app.tools.territory import explain_gap, find_peers, find_region, get_attainment, resolve_owner, set_map_view


MODEL = "gemini-3.8-flash"

# Deterministic guardrail (POL-01): requests to rank individuals or recommend sanctions never reach the model.
# Rankings of territories/clusters are fine; only rankings/sanctions aimed at people are blocked (English + Indonesian).
_PEOPLE = r"(employees?|staff|people|persons?|salesm[ae]n|supervisors?|managers?|canvassers?|sales ?force|karyawan|pegawai|orang)"
_RANK = r"(rank(ing|ed)?|peringkat|worst|terburuk|paling (jelek|buruk)|bottom|lowest[- ]performing|underperform\w*)"
_SANCTION = r"(pecat|phk|\bfire\b|terminate|dismiss|lay ?off|warning letter|surat peringatan|\bsp ?[123]\b|flight.?risk|resign(ation)? risk|risiko resign)"
BLOCKED = re.compile(rf"({_RANK}.{{0,40}}{_PEOPLE}|{_PEOPLE}.{{0,40}}{_RANK}|{_SANCTION})", re.IGNORECASE)
REFUSAL = (
    "I can't rank individuals, recommend warning letters or termination, or produce per-person flight-risk scores. "
    "Under policy POL-01, AI only drafts coaching material; decisions stay with managers and HR.\n\n"
    "What I can do instead:\n"
    "• Show the performance × capacity map per team (not per person)\n"
    "• List the teams that need backfill vs coaching\n"
    "• Draft coaching notes for the team you lead"
)


async def init_state(callback_context: CallbackContext) -> None:
    state = callback_context.state
    state.setdefault("persona_label", "unknown user")
    state.setdefault("selection_label", "Indonesia (national view)")


async def guardrail(callback_context: CallbackContext, llm_request: LlmRequest) -> LlmResponse | None:
    last = llm_request.contents[-1] if llm_request.contents else None
    if not last or last.role != "user":
        return None
    text = " ".join(p.text for p in (last.parts or []) if p.text)
    if text and BLOCKED.search(text):
        callback_context.state["guardrail"] = "refused"
        return LlmResponse(content=types.Content(role="model", parts=[types.Part(text=REFUSAL)]))
    callback_context.state["guardrail"] = None
    return None


root_agent = Agent(
    # Keep in sync with agents-cli-manifest.yaml: agents-cli derives this name
    # from the project `name:` recorded there, and telemetry reports it as
    # gen_ai.agent.name. Renaming the agent only here makes the two disagree,
    # and anything selecting traces by name stops finding this agent's.
    name="territory_copilot",
    model=Gemini(
        model=MODEL,
        retry_options=types.HttpRetryOptions(attempts=3),
    ),
    description="Explains territory revenue gaps, owners, team capacity and drafts action plans for a fictional Indonesian telco.",
    instruction=INSTRUCTION,
    generate_content_config=types.GenerateContentConfig(
        temperature=0.2,
        # Tools do the reasoning-heavy work (SQL, classification); low thinking keeps chat latency demo-friendly.
        thinking_config=types.ThinkingConfig(thinking_level=types.ThinkingLevel.LOW),
    ),
    tools=[
        find_region, get_attainment, explain_gap, resolve_owner, find_peers,
        team_snapshot, team_scorecard_summary, search_policy_docs, draft_action_plan, set_map_view,
    ],
    before_agent_callback=init_state,
    before_model_callback=guardrail,
)

app = App(
    root_agent=root_agent,
    name="app",
)
