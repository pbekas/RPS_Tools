"""
RPS Call QA — Streamlit entrypoint.

Run:  streamlit run app.py
"""

from __future__ import annotations

import sys
from pathlib import Path

# Ensure project root is on path when launched via `streamlit run app.py`
ROOT = Path(__file__).resolve().parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

import pandas as pd
import plotly.express as px
import streamlit as st

from src.auth import get_current_user, is_admin, logout, require_login
from src.config import get_settings
from src import firestore_db as db
from src.pipeline import enqueue_bytes

st.set_page_config(
    page_title="RPS Call QA",
    page_icon="📞",
    layout="wide",
    initial_sidebar_state="expanded",
)

# Soft medical-office styling (not purple/cream AI defaults)
st.markdown(
    """
    <style>
      :root {
        --rps-ink: #1a2b3c;
        --rps-accent: #0d6e6e;
        --rps-wash: #e8f2f2;
      }
      .block-container { padding-top: 1.5rem; }
      h1, h2, h3 { color: var(--rps-ink); letter-spacing: -0.02em; }
      div[data-testid="stMetric"] {
        background: var(--rps-wash);
        border: 1px solid #c5d9d9;
        border-radius: 8px;
        padding: 0.75rem 1rem;
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
    st.caption("High-level view of talk time, quality, and empathy across the team.")

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
        st.info("Add FIREBASE_SERVICE_ACCOUNT to `.env` to enable the dashboard.")
        return

    if not calls:
        st.info("No completed calls yet. Upload recordings to get started.")
        return

    total_talk = sum(int(c.get("duration_seconds") or 0) for c in calls)
    avg_emp = sum(float(c.get("ai_empathy_score") or 0) for c in calls) / len(calls)
    avg_qual = sum(float(c.get("quality_score") or 0) for c in calls) / len(calls)
    fcr_rate = sum(1 for c in calls if c.get("fcr")) / len(calls)
    avg_xfer = sum(int(c.get("transfer_count") or 0) for c in calls) / len(calls)

    c1, c2, c3, c4, c5 = st.columns(5)
    c1.metric("Calls", len(calls))
    c2.metric("Talk time", _fmt_duration(total_talk))
    c3.metric("Avg empathy", f"{avg_emp:.1f}/10")
    c4.metric("Avg quality", f"{avg_qual:.1f}/10")
    c5.metric("FCR rate", f"{fcr_rate:.0%}")

    st.caption(f"Average transfers per call: {avg_xfer:.2f}")

    rows = []
    for c in calls:
        rows.append(
            {
                "Date": c.get("call_date"),
                "Agent": c.get("agent_name"),
                "Topic": c.get("topic"),
                "Duration": _fmt_duration(c.get("duration_seconds")),
                "Empathy": c.get("ai_empathy_score"),
                "Quality": c.get("quality_score"),
                "Transfers": c.get("transfer_count"),
                "FCR": "Yes" if c.get("fcr") else "No",
                "Name stated": "Yes" if c.get("ai_name_stated") else "No",
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

        if "agent_name" in mdf.columns and "total_talk_time_seconds" in mdf.columns:
            talk_df = (
                mdf.groupby("agent_name", as_index=False)["total_talk_time_seconds"]
                .sum()
                .sort_values("total_talk_time_seconds", ascending=False)
            )
            talk_df["Talk minutes"] = talk_df["total_talk_time_seconds"] / 60
            fig2 = px.bar(
                talk_df,
                x="agent_name",
                y="Talk minutes",
                title="Talk time by agent (from weekly metrics)",
                color_discrete_sequence=["#0d6e6e"],
            )
            st.plotly_chart(fig2, use_container_width=True)


def page_upload(user: dict) -> None:
    st.title("Batch upload & process")
    st.caption(
        "Upload MP3/WAV recordings. Files queue for Amazon Transcribe + Bedrock QA."
    )
    settings = get_settings()
    if not settings.ai_configured:
        st.warning(
            "AI pipeline needs `S3_BUCKET` + `BEDROCK_MODEL_ID` (and AWS credentials "
            "with Transcribe + Bedrock access). Enable the Claude model in the Bedrock console."
        )    if not settings.firestore_configured:
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
    st.markdown(
        "Uses the **VBC Call Recording API** "
        "([docs](https://developer.vonage.com/en/vonage-business-cloud/call-recording/overview)). "
        "Create an app and subscribe to Call Recording at "
        "[apimanager.uc.vonage.com](https://apimanager.uc.vonage.com)."
    )
    st.caption(
        f"VBC API keys: {'✅ configured' if settings.vbc_configured else '⚠️ set VBC_CLIENT_ID / VBC_CLIENT_SECRET'}"
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

                result = test_connection()
                st.success("Connected to VBC Call Recording API")
                st.json(result)
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
                            f"skipped existing {summary['skipped_existing']}"
                        )
                        if summary["errors"]:
                            st.warning(f"{len(summary['errors'])} error(s)")
                            st.json(summary["errors"][:10])
                        if summary["call_ids"]:
                            st.write("Queued call IDs:", summary["call_ids"])
                    except Exception as exc:  # noqa: BLE001
                        st.error(str(exc))

    st.divider()
    st.subheader("Optional: inbound webhook")
    st.markdown(
        f"""
For event-driven ingest (in addition to pull sync), point Vonage callbacks at:

`POST {settings.app_url.replace('8501', str(settings.webhook_port))}/webhooks/vonage/recording`

```bash
uvicorn webhook:app --host 0.0.0.0 --port {settings.webhook_port}
```
"""
    )

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
            if errors:
                with st.expander("Recent errors"):
                    for e in errors:
                        st.write(
                            f"`{e.get('id')}` · {e.get('original_filename')} — "
                            f"{e.get('error_message')}"
                        )
        except Exception as exc:  # noqa: BLE001
            st.warning(str(exc))


def page_call_review(user: dict, *, force_agent_email: str | None = None) -> None:
    st.title("Call review")
    st.caption("Summary, chat-style transcript, audio playback, and manager feedback.")

    agent_email = force_agent_email
    if is_admin(user) and force_agent_email is None:
        try:
            agents = db.list_users(role="Agent") if get_settings().firestore_configured else []
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

    m1, m2, m3, m4, m5 = st.columns(5)
    m1.metric("Duration", _fmt_duration(call.get("duration_seconds")))
    m2.metric("Empathy", f"{call.get('ai_empathy_score')}/10")
    m3.metric("Quality", f"{call.get('quality_score')}/10")
    m4.metric("Transfers", call.get("transfer_count") or 0)
    m5.metric("FCR", "Yes" if call.get("fcr") else "No")

    st.markdown(f"**Topic:** {call.get('topic')}")
    st.markdown(f"**Agent:** {call.get('agent_name')}")
    st.markdown(
        f"**Name stated on call:** "
        f"{'Yes' if call.get('ai_name_stated') else 'No'}"
    )
    if call.get("time_to_answer_seconds") is not None:
        st.markdown(f"**Time to answer:** {call.get('time_to_answer_seconds')}s")

    st.subheader("AI summary")
    st.write(call.get("ai_summary") or "—")

    st.subheader("Listen")
    recording = call.get("recording_url") or ""
    local_guess = ROOT / "uploads"
    audio_played = False
    if recording.startswith("http"):
        st.audio(recording)
        audio_played = True
    elif recording:
        path = Path(recording)
        if path.exists():
            st.audio(str(path))
            audio_played = True
    if not audio_played and call.get("original_filename"):
        matches = list(local_guess.glob(f"{selected_id}_*"))
        if matches:
            st.audio(str(matches[0]))
            audio_played = True
    if not audio_played:
        st.caption("No playable recording URL available for this call yet.")

    st.subheader("Transcript")
    transcript = call.get("transcript") or []
    if not transcript:
        st.caption("No transcript stored.")
    for turn in transcript:
        speaker = turn.get("speaker") or "Unknown"
        role = "user" if speaker == "Patient" else "assistant"
        with st.chat_message(role):
            ts = turn.get("timestamp") or ""
            label = f"**{speaker}**"
            if ts:
                label += f" · `{ts}`"
            st.markdown(label)
            st.write(turn.get("text") or "")

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
    else:
        if call.get("manager_feedback"):
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
    st.caption("Rolling improvement guidance generated from call summaries + manager notes.")

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
    pick = st.selectbox("Agent", emails, format_func=lambda e: next(
        (f"{a.get('name')} <{e}>" for a in agents if a.get("email") == e), e
    ))
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
        a, b, c = st.columns(3)
        a.metric("Calls", len(calls))
        b.metric("Avg quality", f"{avg_q:.1f}")
        c.metric("Talk time", _fmt_duration(talk))
        st.metric("Avg empathy", f"{avg_emp:.1f}")
    if metrics:
        st.dataframe(pd.DataFrame(metrics), use_container_width=True, hide_index=True)


def main() -> None:
    user = require_login()
    if not user:
        return

    # Refresh role from Firestore when available
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
    elif page == "Team setup":
        page_team_setup(user)
    elif page == "My scores":
        page_my_scores(user)
    elif page == "My calls":
        page_call_review(user, force_agent_email=user["email"])
    elif page == "My coaching":
        page_coaching(user, self_only=True)


main()
