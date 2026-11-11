from flask import session
from flask_socketio import SocketIO, emit, join_room

from db import db
from routes.chat import ALL_ROLES, PERSON_COLUMNS, conversation_for, message_json, _join_group
from utils import ApiError

socketio = SocketIO(async_mode="threading")
MAX_LEN = 2000


@socketio.on("connect")
def on_connect():
    """Only signed-in accounts may connect. Identity comes from the Flask session cookie."""
    try:
        me = int(session.get("account_id"))
    except (TypeError, ValueError):
        return False                      # reject missing or malformed identities
    if me <= 0 or session.get("role") not in ALL_ROLES:
        return False
    join_room("company")                  # everyone hears the company-wide group chat
    join_room("acct:%d" % me)             # personal room: all of this account's devices


@socketio.on("send_message")
def on_send_message(data):
    # Re-check the role for every event; do not rely solely on the initial handshake.
    try:
        me = int(session.get("account_id"))
    except (TypeError, ValueError):
        return {"ok": False, "error": "Not signed in."}
    if me <= 0 or session.get("role") not in ALL_ROLES:
        return {"ok": False, "error": "Not authorized."}
    data = data if isinstance(data, dict) else {}

    try:
        conv_id = int(data.get("conversation_id"))
    except (TypeError, ValueError):
        return {"ok": False, "error": "Invalid conversation."}
    text = data.get("content")
    text = text.strip() if isinstance(text, str) else ""
    if not text:
        return {"ok": False, "error": "Message is empty."}
    if len(text) > MAX_LEN:
        return {"ok": False, "error": "Message is too long (max %d characters)." % MAX_LEN}

    try:
        conv = conversation_for(conv_id, me)     # also checks you belong to a direct chat
    except ApiError as e:
        return {"ok": False, "error": e.message}

    members = []
    with db() as (_, cur):
        if conv["type"] == "group":
            _join_group(cur, me)
        cur.execute(
            "INSERT INTO chat_message (conversation_id, sender_account_id, content) VALUES (%s, %s, %s)",
            (conv_id, me, text),
        )
        message_id = cur.lastrowid
        cur.execute(
            "SELECT msg.message_id, msg.conversation_id, msg.content, msg.created_at, " + PERSON_COLUMNS +
            " FROM chat_message msg JOIN account a ON a.account_id = msg.sender_account_id"
            " LEFT JOIN employees e ON e.employee_id = a.employee_id"
            " WHERE msg.message_id = %s",
            (message_id,),
        )
        row = cur.fetchone()
        if conv["type"] == "direct":
            cur.execute("SELECT account_id FROM chat_member WHERE conversation_id = %s", (conv_id,))
            members = [r["account_id"] for r in cur.fetchall()]

    payload = message_json(row)
    if conv["type"] == "group":
        emit("new_message", payload, to="company")
    else:
        for account_id in members:                # works even if the other person was already online
            emit("new_message", payload, to="acct:%d" % account_id)
    return {"ok": True}