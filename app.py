"""
RPS Call QA — Streamlit entrypoint.

Run:  streamlit run app.py
"""

from __future__ import annotations

import sys
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

import pandas as pd
import plotly.express as px
import streamlit as st

from src.auth import is_admin, logout, require_login
from src.config import get_settings
from src import firestore_db as db
from src.pipeline import enqueue_bytes
from src.qa_rules import get_active_ruleset, seed_firestore
from src.call_topics import (
    default_topicset,
    get_active_topicset,
    load_topics_from_file,
    seed_firestore as seed_call_topics,
)

st.set_page_config(
    page_title="RPS Call QA",
    page_icon="📞",
    layout="wide",
    initial_sidebar_state="expanded",
)

st.markdown(
    """
    <style>
      :root {
        --rps-ink: #1a2b3c;
        --rps-accent: #0d6e6e;
        --rps-wash: #e8f2f2;
        --rps-fail: #8b3a3a;
        --rps-pass: #1f6b4a;
        --rps-patient: #eef3f7;
        --rps-agent: #d8eeee;
      }
      .block-container { padding-top: 1.5rem; }
      h1, h2, h3 { color: var(--rps-ink); letter-spacing: -0.02em; }
      div[data-testid="stMetric"] {
        background: var(--rps-wash);
        border: 1px solid #c5d9d9;
        border-radius: 8px;
        padding: 0.75rem 1rem;
      }
      .rps-badge {
        display: inline-block;
        padding: 0.2rem 0.55rem;
        border-radius: 999px;
        font-size: 0.8rem;
        font-weight: 600;
        margin: 0.15rem 0.25rem 0.15rem 0;
      }
      .rps-pass { background: #d8f0e4; color: var(--rps-pass); }
      .rps-fail { background: #f3dede; color: var(--rps-fail); }
      .rps-autofail {
        background: #f3dede; color: var(--rps-fail);
        border: 1px solid #d9a0a0; font-weight: 700;
      }
      .bubble-row { display: flex; margin: 0.45rem 0; }
      .bubble-row.patient { justify-content: flex-start; }
      .bubble-row.agent { justify-content: flex-end; }
      .bubble-row.system { justify-content: center; }
      .bubble {
        max-width: 72%;
        padding: 0.65rem 0.85rem;
        border-radius: 14px;
        line-height: 1.35;
      }
      .bubble.patient { background: var(--rps-patient); border: 1px solid #d5dee8; }
      .bubble.agent { background: var(--rps-agent); border: 1px solid #b7d6d6; }
      .bubble.system {
        background: #f4f4f4; border: 1px dashed #ccc; color: #555; max-width: 90%;
        font-size: 0.9rem;
      }
      .bubble .meta {
        font-size: 0.75rem; color: #5a6a7a; margin-bottom: 0.25rem; font-weight: 600;
      }
      .bubble.highlight {
        box-shadow: 0 0 0 2px #0d6e6e;
      }
      .rps-jump {
        font-size: 0.85rem;
        margin-left: 0.35rem;
        color: #0d6e6e;
        text-decoration: underline;
      }
    </style>
    """,
    unsafe_allow_html=True,
)


def _fmt_duration(seconds: int | float | None) -> str:
    s = int(seconds or 0)
    m, sec = divmod(s, 60)
    h, m = divmod(m, 60)
    if h:
        return f"{h}h {m}m {sec}s"
    return f"{m}m {sec}s"


def _failed_rule_tags(call: dict) -> str:
    results = call.get("rule_results") or []
    fails = [r.get("label") or r.get("rule_id") for r in results if not r.get("passed")]
    return ", ".join(fails) if fails else ""


def _ensure_rules_seeded() -> None:
    settings = get_settings()
    if not settings.firestore_configured:
        return
    try:
        existing = db.get_qa_rules_current()
        if not existing:
            seed_firestore(force=False)
    except Exception:
        pass


def sidebar_nav(user: dict) -> str:
    settings = get_settings()
    with st.sidebar:
        st.markdown("### RPS Call QA")
        st.caption(f"{user.get('name')} · {user.get('role')}")
        st.caption(user.get("email"))

        if is_admin(user):
            pages = [
                "Dashboard",
                "Upload & process",
                "Call review",
                "Feedback hub",
                "Coaching",
                "QA Rules",
                "Call topics",
                "Team setup",
            ]
        else:
            pages = ["My scores", "My calls", "My coaching"]

        choice = st.radio("Navigate", pages, label_visibility="collapsed")
        st.divider()
        st.caption("Config status")
        st.write(
            f"OAuth: {'✅' if settings.oauth_configured else '⚠️'} · "
            f"Firestore: {'✅' if settings.firestore_configured else '⚠️'} · "
            f"Bedrock: {'✅' if settings.ai_configured else '⚠️'} · "
            f"VBC: {'✅' if settings.vbc_configured else '⚠️'}"
        )
        if st.button("Sign out"):
            logout()
        return choice


def page_dashboard(user: dict) -> None:
    st.title("Call QA Dashboard")
    st.caption("Talk time, quality, empathy, and rule failures across the team.")

    agent_filter = None
    if is_admin(user):
        agents = []
        try:
            agents = db.list_users(role="Agent") if get_settings().firestore_configured else []
        except Exception as exc:  # noqa: BLE001
            st.warning(f"Could not load agents: {exc}")
        names = ["All agents"] + [
            f"{a.get('name')} <{a.get('email')}>" for a in agents
        ]
        pick = st.selectbox("Agent", names)
        if pick != "All agents":
            agent_filter = pick.split("<")[-1].rstrip(">")

    try:
        calls = db.list_calls(agent_email=agent_filter, limit=200, status="complete")
        metrics = db.list_metrics(agent_email=agent_filter, limit=52)
    except Exception as exc:  # noqa: BLE001
        st.error(f"Firestore read failed: {exc}")
        return

    if not calls:
        st.info("No completed calls yet. Upload or sync recordings to get started.")
        return

    total_talk = sum(int(c.get("duration_seconds") or 0) for c in calls)
    avg_emp = sum(float(c.get("ai_empathy_score") or 0) for c in calls) / len(calls)
    avg_qual = sum(float(c.get("quality_score") or 0) for c in calls) / len(calls)
    fcr_rate = sum(1 for c in calls if c.get("fcr")) / len(calls)
    avg_xfer = sum(int(c.get("transfer_count") or 0) for c in calls) / len(calls)
    auto_fail_rate = sum(1 for c in calls if c.get("auto_failed")) / len(calls)

    c1, c2, c3, c4, c5, c6 = st.columns(6)
    c1.metric("Calls", len(calls))
    c2.metric("Talk time", _fmt_duration(total_talk))
    c3.metric("Avg empathy", f"{avg_emp:.1f}/10")
    c4.metric("Avg quality", f"{avg_qual:.1f}/10")
    c5.metric("FCR rate", f"{fcr_rate:.0%}")
    c6.metric("Auto-fail rate", f"{auto_fail_rate:.0%}")
    st.caption(f"Average transfers per call: {avg_xfer:.2f}")

    # Top failed rules
    fail_counter: Counter[str] = Counter()
    for c in calls:
        for r in c.get("rule_results") or []:
            if not r.get("passed"):
                fail_counter[r.get("label") or r.get("rule_id") or "unknown"] += 1
    if fail_counter:
        fail_df = pd.DataFrame(
            [{"Rule": k, "Failures": v} for k, v in fail_counter.most_common(12)]
        )
        fig_fail = px.bar(
            fail_df,
            x="Rule",
            y="Failures",
            title="Top failed rules",
            color_discrete_sequence=["#0d6e6e"],
        )
        fig_fail.update_layout(xaxis_tickangle=-30)
        st.plotly_chart(fig_fail, use_container_width=True)

    rows = []
    for c in calls:
        rows.append(
            {
                "Date": c.get("call_date"),
                "Agent": c.get("agent_name"),
                "Topic": c.get("topic"),
                "Duration": _fmt_duration(c.get("duration_seconds")),
                "Quality": c.get("quality_score"),
                "Empathy": c.get("ai_empathy_score"),
                "Transfers": c.get("transfer_count"),
                "FCR": "Yes" if c.get("fcr") else "No",
                "Auto-fail": "Yes" if c.get("auto_failed") else "No",
                "Failed rules": _failed_rule_tags(c),
                "id": c.get("id"),
            }
        )
    df = pd.DataFrame(rows)
    st.subheader("Recent calls")
    st.dataframe(df.drop(columns=["id"]), use_container_width=True, hide_index=True)

    if metrics:
        mdf = pd.DataFrame(metrics)
        if "week_start" in mdf.columns and "avg_quality_score" in mdf.columns:
            fig = px.line(
                mdf.sort_values("week_start"),
                x="week_start",
                y=["avg_quality_score", "avg_empathy_score"],
                markers=True,
                title="Weekly quality & empathy",
                color_discrete_sequence=["#0d6e6e", "#1a2b3c"],
            )
            st.plotly_chart(fig, use_container_width=True)


def page_upload(user: dict) -> None:
    st.title("Batch upload & process")
    st.caption(
        "Upload MP3/WAV recordings. Files queue for Amazon Transcribe + Bedrock QA."
    )
    settings = get_settings()
    if not settings.ai_configured:
        st.warning(
            "AI pipeline needs `S3_BUCKET` + `BEDROCK_MODEL_ID` (and AWS credentials "
            "with Transcribe + Bedrock access)."
        )
    if not settings.firestore_configured:
        st.warning(
            "Firestore is not configured — analyses will write local `.qa.json` "
            "sidecars under `uploads/` until FIREBASE_SERVICE_ACCOUNT is set."
        )

    files = st.file_uploader(
        "Call recordings",
        type=["mp3", "wav", "m4a", "ogg", "webm"],
        accept_multiple_files=True,
    )
    if files and st.button("Queue for QA analysis", type="primary"):
        queued = []
        for f in files:
            call_id = enqueue_bytes(
                data=f.getvalue(),
                original_filename=f.name,
                source="upload",
            )
            queued.append((f.name, call_id))
        st.success(f"Queued {len(queued)} file(s) for background processing.")
        st.dataframe(
            pd.DataFrame(queued, columns=["File", "Call ID"]),
            hide_index=True,
            use_container_width=True,
        )

    st.divider()
    st.subheader("Pull from Vonage Business Communications")
    st.caption(
        f"VBC API keys: {'✅ configured' if settings.vbc_configured else '⚠️ set VBC_*'}"
    )
    col1, col2, col3 = st.columns(3)
    with col1:
        days_back = st.number_input("Days back", min_value=1, max_value=90, value=7)
    with col2:
        max_recs = st.number_input("Max recordings", min_value=1, max_value=500, value=50)
    with col3:
        extension = st.text_input("Extension filter (optional)", value="")

    b1, b2 = st.columns(2)
    with b1:
        if st.button("Test Vonage connection"):
            try:
                from src.vonage_sync import test_connection

                st.success("Connected")
                st.json(test_connection())
            except Exception as exc:  # noqa: BLE001
                st.error(str(exc))
    with b2:
        if st.button("Sync recordings → QA queue", type="primary"):
            if not settings.vbc_configured:
                st.error("Configure VBC_* credentials in `.env` first.")
            else:
                with st.spinner("Listing / downloading from Vonage…"):
                    try:
                        from src.vonage_sync import sync_company_recordings

                        summary = sync_company_recordings(
                            days_back=int(days_back),
                            max_recordings=int(max_recs),
                            extension=extension.strip() or None,
                        )
                        st.success(
                            f"Listed {summary['listed']} · queued {summary['queued']} · "
                            f"skipped {summary['skipped_existing']}"
                        )
                        if summary["errors"]:
                            st.warning(f"{len(summary['errors'])} error(s)")
                            st.json(summary["errors"][:10])
                    except Exception as exc:  # noqa: BLE001
                        st.error(str(exc))

    if settings.firestore_configured:
        st.subheader("Processing queue")
        try:
            pending = db.list_calls(limit=50, status="pending")
            processing = db.list_calls(limit=50, status="processing")
            errors = db.list_calls(limit=20, status="error")
            st.write(
                f"Pending: **{len(pending)}** · Processing: **{len(processing)}** · "
                f"Errors: **{len(errors)}**"
            )
        except Exception as exc:  # noqa: BLE001
            st.warning(str(exc))


def _render_sms_transcript(transcript: list[dict], *, highlight_turn: int | None = None) -> None:
    if not transcript:
        st.caption("No transcript stored.")
        return
    html_parts = ['<div class="transcript" id="transcript-top">']
    for i, turn in enumerate(transcript):
        speaker = turn.get("speaker") or "Unknown"
        css = "patient"
        if speaker == "Agent":
            css = "agent"
        elif speaker == "System":
            css = "system"
        if highlight_turn is not None and i == highlight_turn:
            css = f"{css} highlight"
        ts = turn.get("timestamp") or ""
        meta = f"{speaker}" + (f" · {ts}" if ts else "")
        text = (turn.get("text") or "").replace("<", "&lt;").replace(">", "&gt;")
        html_parts.append(
            f'<div class="bubble-row {css}" id="turn-{i}">'
            f'<div class="bubble {css}">'
            f'<div class="meta">{meta}</div>{text}</div></div>'
        )
    html_parts.append("</div>")
    st.markdown("\n".join(html_parts), unsafe_allow_html=True)


def _render_rule_checklist(call: dict) -> None:
    results = call.get("rule_results") or []
    if not results:
        st.info(
            "No per-rule results on this call yet. Use **Re-analyze with current rules** "
            "to score against the active rubric (skips Transcribe)."
        )
        return
    if call.get("auto_failed"):
        fails = ", ".join(call.get("auto_fail_rules") or [])
        st.markdown(
            f'<span class="rps-badge rps-autofail">AUTO-FAIL · {fails}</span>',
            unsafe_allow_html=True,
        )
    for r in results:
        passed = bool(r.get("passed"))
        cls = "rps-pass" if passed else "rps-fail"
        mark = "PASS" if passed else "FAIL"
        label = r.get("label") or r.get("rule_id")
        score = r.get("score_1_to_10")
        score_bit = f" · {score}/10" if score is not None else ""
        turn_index = r.get("evidence_turn_index")
        ts = r.get("evidence_timestamp") or ""
        jump = ""
        if turn_index is not None:
            jump = (
                f' <a class="rps-jump" href="#turn-{int(turn_index)}">'
                f'Jump to moment{" · " + ts if ts else ""}</a>'
            )
        elif ts:
            jump = f' <span class="rps-jump">@{ts}</span>'
        st.markdown(
            f'<span class="rps-badge {cls}">{mark}</span> '
            f"**{label}**{score_bit} · _{r.get('category') or ''}_"
            f"{jump}",
            unsafe_allow_html=True,
        )
        with st.expander("Evidence / notes", expanded=not passed):
            st.write(r.get("evidence") or "—")
            if r.get("notes"):
                st.caption(r.get("notes"))
            if turn_index is not None:
                st.markdown(
                    f'[Jump to transcript moment](#turn-{int(turn_index)})',
                )


def page_call_review(user: dict, *, force_agent_email: str | None = None) -> None:
    st.title("Call review")
    st.caption("Rule checklist, SMS-style transcript, audio, and manager feedback.")

    agent_email = force_agent_email
    if is_admin(user) and force_agent_email is None:
        try:
            agents = (
                db.list_users(role="Agent") if get_settings().firestore_configured else []
            )
        except Exception:
            agents = []
        options = ["All agents"] + [
            f"{a.get('name')} <{a.get('email')}>" for a in agents
        ]
        pick = st.selectbox("Filter by agent", options, key="review_agent")
        if pick != "All agents":
            agent_email = pick.split("<")[-1].rstrip(">")

    try:
        calls = db.list_calls(
            agent_email=agent_email or (None if is_admin(user) else user["email"]),
            limit=100,
            status="complete",
        )
    except Exception as exc:  # noqa: BLE001
        st.error(f"Could not load calls: {exc}")
        return

    if not calls:
        st.info("No completed calls to review.")
        return

    labels = {
        c["id"]: (
            f"{c.get('call_date')} · {c.get('agent_name')} · {c.get('topic')} · "
            f"Q{c.get('quality_score')}/E{c.get('ai_empathy_score')}"
            + (" · AUTO-FAIL" if c.get("auto_failed") else "")
        )
        for c in calls
        if c.get("id")
    }
    selected_id = st.selectbox(
        "Select a call",
        list(labels.keys()),
        format_func=lambda i: labels[i],
    )
    call = next(c for c in calls if c.get("id") == selected_id)

    left, right = st.columns([1.1, 1])
    with left:
        m1, m2, m3, m4, m5 = st.columns(5)
        m1.metric("Duration", _fmt_duration(call.get("duration_seconds")))
        m2.metric("Empathy", f"{call.get('ai_empathy_score')}/10")
        m3.metric("Quality", f"{call.get('quality_score')}/10")
        m4.metric("Transfers", call.get("transfer_count") or 0)
        m5.metric("FCR", "Yes" if call.get("fcr") else "No")

        st.markdown(
            f"**Agent:** {call.get('agent_name')}  \n"
            f"**Topic:** {call.get('topic')}  \n"
            f"**Ruleset:** {call.get('ruleset_version') or '—'}  \n"
            f"**Name stated:** {'Yes' if call.get('ai_name_stated') else 'No'}"
        )
        if call.get("time_to_answer_seconds") is not None:
            st.markdown(f"**Time to answer:** {call.get('time_to_answer_seconds')}s")

        st.subheader("AI summary")
        st.write(call.get("ai_summary") or "—")

        st.subheader("Listen")
        recording = call.get("recording_url") or ""
        audio_played = False
        if recording.startswith("http"):
            st.audio(recording)
            audio_played = True
        elif recording and Path(recording).exists():
            st.audio(recording)
            audio_played = True
        if not audio_played:
            matches = list((ROOT / "uploads").glob(f"{selected_id}_*"))
            if matches:
                st.audio(str(matches[0]))
                audio_played = True
        if not audio_played:
            st.caption("No playable recording URL available for this call yet.")

        st.subheader("Audit checklist")
        _render_rule_checklist(call)

        if is_admin(user):
            if st.button("Re-analyze with current rules", help="Uses stored transcript; skips Transcribe"):
                transcript = call.get("transcript") or []
                if not transcript:
                    st.error("No transcript on this call to re-score.")
                else:
                    with st.spinner("Scoring with Bedrock against current rules…"):
                        try:
                            from src.bedrock_analyst import analyze_transcript

                            scored = analyze_transcript(
                                transcript,
                                duration_seconds=call.get("duration_seconds"),
                                original_filename=call.get("original_filename"),
                                transfer_count_hint=call.get("transfer_count"),
                            )
                            # Keep existing transcript if model returns empty
                            if not scored.get("transcript"):
                                scored["transcript"] = transcript
                            db.update_call(
                                selected_id,
                                {
                                    k: v
                                    for k, v in scored.items()
                                    if k != "recording_storage_uri"
                                },
                            )
                            st.success("Re-scored and saved.")
                            st.rerun()
                        except Exception as exc:  # noqa: BLE001
                            st.error(str(exc))

    with right:
        st.subheader("Transcript")
        _render_sms_transcript(call.get("transcript") or [])

    if is_admin(user):
        st.subheader("Manager review")
        notes = st.text_area(
            "Review notes (private working notes)",
            value=call.get("manager_notes") or "",
            height=100,
        )
        feedback = st.text_area(
            "Manual feedback (shared with coaching + feedback hub)",
            value=call.get("manager_feedback") or "",
            height=140,
        )
        if st.button("Save review", type="primary"):
            try:
                db.save_manager_review(
                    selected_id,
                    manager_feedback=feedback,
                    manager_notes=notes,
                    reviewer_email=user["email"],
                    reviewer_name=user.get("name") or user["email"],
                )
                st.success("Saved manager review and feedback hub entry.")
                st.rerun()
            except Exception as exc:  # noqa: BLE001
                st.error(f"Save failed: {exc}")
    elif call.get("manager_feedback"):
        st.subheader("Manager feedback")
        st.info(call.get("manager_feedback"))


def page_feedback_hub(user: dict) -> None:
    st.title("Feedback hub")
    st.caption("All manager feedback in one place.")
    agent_email = None if is_admin(user) else user["email"]
    if is_admin(user):
        try:
            agents = db.list_users(role="Agent")
        except Exception:
            agents = []
        options = ["All agents"] + [
            f"{a.get('name')} <{a.get('email')}>" for a in agents
        ]
        pick = st.selectbox("Agent", options, key="fb_agent")
        if pick != "All agents":
            agent_email = pick.split("<")[-1].rstrip(">")
    try:
        items = db.list_feedback(agent_email=agent_email, limit=150)
    except Exception as exc:  # noqa: BLE001
        st.error(str(exc))
        return
    if not items:
        st.info("No feedback yet.")
        return
    for item in items:
        with st.container(border=True):
            st.markdown(
                f"**{item.get('agent_name')}** · "
                f"{item.get('created_at')} · "
                f"by {item.get('author_name')}"
            )
            if item.get("topic"):
                st.caption(f"Topic: {item.get('topic')} · Call `{item.get('call_id')}`")
            st.write(item.get("text"))


def page_coaching(user: dict, *, self_only: bool = False) -> None:
    st.title("AI coaching")
    st.caption("Rolling improvement guidance from call summaries + manager notes.")

    from src.metrics import run_weekly_coaching_all_agents, run_weekly_coaching_for_agent

    if self_only or not is_admin(user):
        st.subheader("Your coaching report")
        try:
            u = db.get_user(user["email"]) if get_settings().firestore_configured else None
        except Exception:
            u = None
        text = (u or {}).get("rolling_ai_feedback") or user.get("rolling_ai_feedback") or ""
        if text:
            st.markdown(text)
        else:
            st.info("No coaching report yet. Admins can generate weekly coaching.")
        return

    try:
        agents = db.list_users(role="Agent")
    except Exception as exc:  # noqa: BLE001
        st.error(str(exc))
        return

    emails = [a.get("email") for a in agents if a.get("email")]
    pick = st.selectbox(
        "Agent",
        emails,
        format_func=lambda e: next(
            (f"{a.get('name')} <{e}>" for a in agents if a.get("email") == e), e
        ),
    )
    selected = next((a for a in agents if a.get("email") == pick), None)
    if selected and selected.get("rolling_ai_feedback"):
        st.markdown(selected["rolling_ai_feedback"])
        if selected.get("last_coaching_at"):
            st.caption(f"Last updated: {selected['last_coaching_at']}")
    else:
        st.info("No rolling feedback stored for this agent yet.")

    col_a, col_b = st.columns(2)
    with col_a:
        if st.button("Generate coaching for selected agent", type="primary"):
            with st.spinner("Asking Bedrock for a coaching report…"):
                try:
                    report = run_weekly_coaching_for_agent(pick)
                    st.success("Saved to user record.")
                    st.markdown(report)
                except Exception as exc:  # noqa: BLE001
                    st.error(str(exc))
    with col_b:
        if st.button("Run weekly coaching for all agents"):
            with st.spinner("Generating reports…"):
                try:
                    results = run_weekly_coaching_all_agents()
                    st.json(results)
                except Exception as exc:  # noqa: BLE001
                    st.error(str(exc))


def page_qa_rules(user: dict) -> None:
    st.title("QA Rules")
    st.caption(
        "Active phone audit rubric. Edit Firestore `qa_rules/current` (or re-seed from "
        "`docs/qa_rules_v1.json`) to add rules later without redeploying."
    )
    rs = get_active_ruleset()
    st.markdown(
        f"**{rs.get('name')}** · version `{rs.get('version')}`  \n"
        f"{rs.get('description')}"
    )
    meta1, meta2, meta3, meta4 = st.columns(4)
    meta1.metric("Empathy pass ≥", rs.get("empathy_pass_threshold"))
    meta2.metric("Transfer soft limit", rs.get("transfer_soft_limit"))
    meta3.metric("Transfer auto-fail ≥", rs.get("transfer_auto_fail_at"))
    meta4.metric("Auto-fail quality cap", rs.get("auto_fail_quality_cap"))

    rows = []
    for r in rs.get("rules") or []:
        rows.append(
            {
                "ID": r.get("id"),
                "Label": r.get("label"),
                "Category": r.get("category"),
                "Weight": r.get("weight"),
                "Auto-fail": "Yes" if r.get("auto_fail") else "No",
                "Pass criteria": r.get("pass_criteria"),
            }
        )
    st.dataframe(pd.DataFrame(rows), use_container_width=True, hide_index=True)

    if is_admin(user) and get_settings().firestore_configured:
        if st.button("Re-seed rules from docs/qa_rules_v1.json", type="secondary"):
            try:
                from src.qa_rules import default_ruleset

                path = seed_firestore(force=True)
                default_ruleset.cache_clear()
                st.success(f"Seeded {path}")
                st.rerun()
            except Exception as exc:  # noqa: BLE001
                st.error(str(exc))


def page_call_topics(user: dict) -> None:
    st.title("Call topics")
    st.caption(
        "Configurable topic catalog for AI classification. Each topic needs a stable **id**, "
        "a display **label**, and **details** so the model can tell what the call is about. "
        "Stored in Firestore `call_topics/current` (fallback: `docs/call_topics_v1.json`)."
    )
    ts = get_active_topicset()
    st.markdown(
        f"**{ts.get('name')}** · version `{ts.get('version')}`  \n"
        f"{ts.get('description')}"
    )

    topics = list(ts.get("all_topics") or ts.get("topics") or [])
    rows = [
        {
            "ID": t.get("id"),
            "Label": t.get("label"),
            "Details": t.get("description") or t.get("details") or "",
            "Active": "Yes" if t.get("active", True) else "No",
        }
        for t in topics
    ]
    st.dataframe(pd.DataFrame(rows), use_container_width=True, hide_index=True)

    if not is_admin(user) or not get_settings().firestore_configured:
        return

    st.subheader("Edit catalog")
    st.caption("Add or update a topic, then save. Inactive topics are hidden from the AI.")

    with st.form("topic_edit"):
        col_a, col_b = st.columns(2)
        topic_id = col_a.text_input(
            "ID (stable slug)",
            placeholder="e.g. prior_auth",
            help="Lowercase letters, numbers, underscores. Used by the AI as topic.",
        ).strip()
        label = col_b.text_input("Label", placeholder="e.g. Prior authorization").strip()
        details = st.text_area(
            "Details for the AI",
            placeholder="Describe when a call should be classified as this topic…",
            height=100,
        ).strip()
        active = st.checkbox("Active", value=True)
        submitted = st.form_submit_button("Add / update topic", type="primary")

    if submitted:
        if not topic_id or not label:
            st.error("ID and Label are required.")
        elif not topic_id.replace("_", "").isalnum() or topic_id != topic_id.lower():
            st.error("ID must be lowercase alphanumeric (underscores allowed).")
        else:
            existing = {str(t.get("id")): dict(t) for t in topics}
            existing[topic_id] = {
                "id": topic_id,
                "label": label,
                "description": details,
                "active": active,
            }
            payload = {
                "version": ts.get("version") or "v1",
                "name": ts.get("name") or "Call Topics",
                "description": ts.get("description") or "",
                "topics": list(existing.values()),
            }
            try:
                path = db.save_call_topics(payload)
                default_topicset.cache_clear()
                st.success(f"Saved {path}")
                st.rerun()
            except Exception as exc:  # noqa: BLE001
                st.error(str(exc))

    c1, c2 = st.columns(2)
    with c1:
        if st.button("Re-seed from docs/call_topics_v1.json", type="secondary"):
            try:
                path = seed_call_topics(load_topics_from_file(), force=True)
                default_topicset.cache_clear()
                st.success(f"Seeded {path}")
                st.rerun()
            except Exception as exc:  # noqa: BLE001
                st.error(str(exc))
    with c2:
        deactivate_id = st.selectbox(
            "Deactivate topic",
            options=[""] + [str(t.get("id")) for t in topics if t.get("active", True)],
        )
        if deactivate_id and st.button("Deactivate selected"):
            updated = []
            for t in topics:
                row = dict(t)
                if row.get("id") == deactivate_id:
                    row["active"] = False
                updated.append(row)
            payload = {
                "version": ts.get("version") or "v1",
                "name": ts.get("name") or "Call Topics",
                "description": ts.get("description") or "",
                "topics": updated,
            }
            try:
                db.save_call_topics(payload)
                default_topicset.cache_clear()
                st.success(f"Deactivated {deactivate_id}")
                st.rerun()
            except Exception as exc:  # noqa: BLE001
                st.error(str(exc))


def page_team_setup(user: dict) -> None:
    st.title("Team setup")
    st.caption("Create/update Admin and Agent users in Firestore.")
    email = st.text_input("Email")
    name = st.text_input("Display name")
    role = st.selectbox("Role", ["Agent", "Admin"])
    if st.button("Save user", type="primary"):
        domain = get_settings().allowed_email_domain
        if not email.lower().endswith(f"@{domain}"):
            st.error(f"Email must be @{domain}")
        else:
            try:
                saved = db.upsert_user(email=email, name=name, role=role)
                st.success(f"Saved {saved.get('email')} as {saved.get('role')}")
            except Exception as exc:  # noqa: BLE001
                st.error(str(exc))

    st.subheader("Current users")
    try:
        users = db.list_users()
        st.dataframe(pd.DataFrame(users), use_container_width=True, hide_index=True)
    except Exception as exc:  # noqa: BLE001
        st.warning(str(exc))


def page_my_scores(user: dict) -> None:
    st.title("My scores")
    try:
        metrics = db.list_metrics(agent_email=user["email"], limit=26)
        calls = db.list_calls(agent_email=user["email"], limit=100, status="complete")
    except Exception as exc:  # noqa: BLE001
        st.error(str(exc))
        return
    if not calls and not metrics:
        st.info("No scored calls yet.")
        return
    if calls:
        avg_emp = sum(float(c.get("ai_empathy_score") or 0) for c in calls) / len(calls)
        avg_q = sum(float(c.get("quality_score") or 0) for c in calls) / len(calls)
        talk = sum(int(c.get("duration_seconds") or 0) for c in calls)
        auto_fails = sum(1 for c in calls if c.get("auto_failed"))
        a, b, c, d = st.columns(4)
        a.metric("Calls", len(calls))
        b.metric("Avg quality", f"{avg_q:.1f}")
        c.metric("Avg empathy", f"{avg_emp:.1f}")
        d.metric("Auto-fails", auto_fails)
        st.metric("Talk time", _fmt_duration(talk))

        fail_counter: Counter[str] = Counter()
        for call in calls:
            for r in call.get("rule_results") or []:
                if not r.get("passed"):
                    fail_counter[r.get("label") or r.get("rule_id") or "?"] += 1
        if fail_counter:
            st.subheader("Your most common failed rules")
            st.dataframe(
                pd.DataFrame(
                    [{"Rule": k, "Count": v} for k, v in fail_counter.most_common()]
                ),
                hide_index=True,
                use_container_width=True,
            )
    if metrics:
        st.dataframe(pd.DataFrame(metrics), use_container_width=True, hide_index=True)


def main() -> None:
    user = require_login()
    if not user:
        return

    _ensure_rules_seeded()

    if get_settings().firestore_configured:
        try:
            fresh = db.get_user(user["email"])
            if fresh:
                user = {
                    **user,
                    "role": fresh.get("role") or user.get("role"),
                    "name": fresh.get("name") or user.get("name"),
                    "rolling_ai_feedback": fresh.get("rolling_ai_feedback") or "",
                }
                st.session_state["user"] = user
        except Exception:
            pass

    page = sidebar_nav(user)

    if page == "Dashboard":
        page_dashboard(user)
    elif page == "Upload & process":
        page_upload(user)
    elif page == "Call review":
        page_call_review(user)
    elif page == "Feedback hub":
        page_feedback_hub(user)
    elif page == "Coaching":
        page_coaching(user)
    elif page == "QA Rules":
        page_qa_rules(user)
    elif page == "Call topics":
        page_call_topics(user)
    elif page == "Team setup":
        page_team_setup(user)
    elif page == "My scores":
        page_my_scores(user)
    elif page == "My calls":
        page_call_review(user, force_agent_email=user["email"])
    elif page == "My coaching":
        page_coaching(user, self_only=True)


main()
