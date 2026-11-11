import os
import sys
import uuid

from flask import (
    Blueprint, abort, jsonify, request, session,
    render_template, send_from_directory,
)
from werkzeug.utils import secure_filename

from auth import role_required
from db import db, fetch_all, fetch_one
from utils import ApiError, json_body




HOME = {"admin": "/admin", "hr": "/hr", "owner": "/owner", "employee": "/employee"}



chat_bp = Blueprint("chat", __name__)

ALL_ROLES = ("admin", "hr", "owner", "employee")
PAGE_SIZE = 50

# Chat files are stored outside the public static directory. Only authorized
# conversation members can retrieve them through the download endpoint.
_backend_storage_root = (
    os.path.dirname(sys.executable)
    if getattr(sys, "_MEIPASS", None)
    else os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
)
CHAT_UPLOAD_ROOT = os.path.abspath(os.environ.get(
    "CHAT_UPLOAD_FOLDER",
    os.path.join(_backend_storage_root, "uploads", "chat_attachments"),
))
MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024
MAX_ATTACHMENTS_PER_MESSAGE = 5
ALLOWED_ATTACHMENTS = {
    "jpg": ("image/jpeg", True),
    "jpeg": ("image/jpeg", True),
    "png": ("image/png", True),
    "gif": ("image/gif", True),
    "webp": ("image/webp", True),
    "pdf": ("application/pdf", False),
    "doc": ("application/msword", False),
    "docx": ("application/vnd.openxmlformats-officedocument.wordprocessingml.document", False),
    "xls": ("application/vnd.ms-excel", False),
    "xlsx": ("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", False),
    "ppt": ("application/vnd.ms-powerpoint", False),
    "pptx": ("application/vnd.openxmlformats-officedocument.presentationml.presentation", False),
    "csv": ("text/csv", False),
    "txt": ("text/plain", False),
}


def _attachment_json(row):
    attachment_id = row["attachment_id"]
    return {
        "attachment_id": attachment_id,
        "file_name": row["file_name"],
        "mime_type": row["mime_type"],
        "file_size": row["file_size"],
        "is_image": row["mime_type"].startswith("image/"),
        "view_url": "/api/chat/attachments/%d/view" % attachment_id,
        "download_url": "/api/chat/attachments/%d/download" % attachment_id,
    }


def _attachments_by_message(rows):
    """Fetch attachment metadata in one query and group it by message ID."""
    if not rows:
        return {}
    ids = [r["message_id"] for r in rows]
    placeholders = ",".join(["%s"] * len(ids))
    found = fetch_all(
        "SELECT attachment_id, message_id, file_name, mime_type, file_size "
        "FROM chat_attachment WHERE message_id IN (%s) ORDER BY attachment_id" % placeholders,
        tuple(ids),
    )
    grouped = {}
    for item in found:
        grouped.setdefault(item["message_id"], []).append(_attachment_json(item))
    return grouped


# Fixed SQL pieces (no user input in them) used to describe a person.
PERSON_COLUMNS = "a.account_id, a.employee_code, a.account_role AS role, a.profile_picture, e.first_name, e.last_name"
PERSON_FROM = "FROM account a LEFT JOIN employees e ON e.employee_id = a.employee_id"
ACTIVE = "(a.employee_id IS NULL OR e.stat IN ('Active', 'On Leave'))"


# ---------- helpers (the socket code in Step 4 will reuse these) ----------

def person(row):
    """Shape a row into {account_id, name, code, display_name} -> 'First Last (012345)'."""
    name = " ".join(p for p in (row.get("first_name"), row.get("last_name")) if p) or "System Admin"
    code = (row.get("employee_code") or "").split("-")[-1]   # 'biri-012345' -> '012345'
    picture = row.get("profile_picture")
    return {
        "account_id": row["account_id"],
        # Same URL the portals use; served to signed-in users only. None -> UI shows initials.
        "avatar_url": "/profile-pictures/" + os.path.basename(picture) if picture else None,
        "name": name,
        "code": code,
        "role": row.get("role"),
        "display_name": "%s (%s)" % (name, code) if code else name,
    }


def _iso(value):
    return value.isoformat() if value else None


def message_json(row, attachments=None):
    return {
        "message_id": row["message_id"],
        "conversation_id": row["conversation_id"],
        "content": row["content"] or "",
        "created_at": _iso(row["created_at"]),
        "sender": person(row),
        "attachments": attachments or [],
    }


def conversation_for(conv_id, me):
    """Return the conversation if this account may use it, otherwise raise."""
    conv = fetch_one(
        "SELECT conversation_id, type, name FROM chat_conversation WHERE conversation_id = %s",
        (conv_id,),
    )
    if not conv:
        raise ApiError("Conversation not found.", 404)
    if conv["type"] == "direct" and not fetch_one(
        "SELECT 1 AS ok FROM chat_member WHERE conversation_id = %s AND account_id = %s",
        (conv_id, me),
    ):
        raise ApiError("You are not part of this conversation.", 403)
    return conv


def _join_group(cur, me):
    """Everyone belongs to the company group. The member row is created the first time
    someone opens chat, starting at 'nothing unread'."""
    cur.execute("SELECT conversation_id FROM chat_conversation WHERE type = 'group' LIMIT 1")
    group = cur.fetchone()
    if group:
        gid = group["conversation_id"]
        cur.execute(
            "INSERT IGNORE INTO chat_member (conversation_id, account_id, last_read_message_id) "
            "SELECT %s, %s, COALESCE(MAX(message_id), 0) FROM chat_message WHERE conversation_id = %s",
            (gid, me, gid),
        )


# ---------- endpoints ----------

@chat_bp.get("/api/chat/me")
@role_required(*ALL_ROLES)
def chat_me():
    row = fetch_one("SELECT %s %s WHERE a.account_id = %%s" % (PERSON_COLUMNS, PERSON_FROM),
                    (session["account_id"],))
    if not row:
        raise ApiError("Account not found.", 404)
    return jsonify(person(row))


@chat_bp.get("/api/chat/people")
@role_required(*ALL_ROLES)
def chat_people():
    """Co-workers you can start a direct message with (optional ?q= search by name or code)."""
    q = (request.args.get("q") or "").strip()
    sql = "SELECT %s %s WHERE %s AND a.account_id <> %%s" % (PERSON_COLUMNS, PERSON_FROM, ACTIVE)
    params = [session["account_id"]]
    if q:
        sql += " AND (CONCAT_WS(' ', e.first_name, e.last_name) LIKE %s OR a.employee_code LIKE %s)"
        params += ["%" + q + "%", "%" + q + "%"]
    sql += " ORDER BY e.first_name, e.last_name LIMIT 100"
    return jsonify([person(r) for r in fetch_all(sql, tuple(params))])


@chat_bp.get("/api/chat/conversations")
@role_required(*ALL_ROLES)
def chat_conversations():
    me = session["account_id"]
    items = []
    with db() as (_, cur):
        _join_group(cur, me)
        cur.execute(
            "SELECT c.conversation_id, c.type, c.name, m.last_read_message_id "
            "FROM chat_member m JOIN chat_conversation c ON c.conversation_id = m.conversation_id "
            "WHERE m.account_id = %s",
            (me,),
        )
        for r in cur.fetchall():
            cid = r["conversation_id"]
            cur.execute(
                "SELECT COUNT(*) AS n FROM chat_message "
                "WHERE conversation_id = %s AND message_id > %s AND sender_account_id <> %s",
                (cid, r["last_read_message_id"], me),
            )
            unread = cur.fetchone()["n"]
            cur.execute(
                "SELECT message_id, content, created_at FROM chat_message "
                "WHERE conversation_id = %s ORDER BY message_id DESC LIMIT 1",
                (cid,),
            )
            last = cur.fetchone()

            title, other = r["name"] or "Company Chat", None
            if r["type"] == "direct":
                cur.execute(
                    "SELECT %s FROM chat_member cm "
                    "JOIN account a ON a.account_id = cm.account_id "
                    "LEFT JOIN employees e ON e.employee_id = a.employee_id "
                    "WHERE cm.conversation_id = %%s AND cm.account_id <> %%s" % PERSON_COLUMNS,
                    (cid, me),
                )
                row = cur.fetchone()
                if row:
                    other = person(row)
                    title = other["display_name"]

            items.append({
                "conversation_id": cid,
                "type": r["type"],
                "title": title,
                "other": other,
                "unread": unread,
                "last_message_id": last["message_id"] if last else 0,
                "last_message": ((last["content"] or "")[:80] or "📎 Attachment") if last else None,
                "last_at": _iso(last["created_at"]) if last else None,
            })
    # group chat first, then the most recently active direct messages
    items.sort(key=lambda i: (i["type"] != "group", -i["last_message_id"]))
    return jsonify(items)


@chat_bp.post("/api/chat/direct")
@role_required(*ALL_ROLES)
def chat_open_direct():
    """Open (or create) the one-to-one conversation with another account."""
    me, data = session["account_id"], json_body()
    try:
        other = int(data.get("account_id"))
    except (TypeError, ValueError):
        raise ApiError("Choose a co-worker to message.")
    if other == me:
        raise ApiError("You can't message yourself.")

    target = fetch_one(
        "SELECT %s %s WHERE a.account_id = %%s AND %s" % (PERSON_COLUMNS, PERSON_FROM, ACTIVE),
        (other,),
    )
    if not target:
        raise ApiError("That co-worker was not found.", 404)

    key = "%d_%d" % (min(me, other), max(me, other))   # same key no matter who starts the chat
    with db() as (_, cur):
        # Insert-or-ignore makes simultaneous requests for the same employee pair safe.
        # The UNIQUE direct_key index decides which request creates the row.
        cur.execute(
            "INSERT IGNORE INTO chat_conversation (type, direct_key) VALUES ('direct', %s)",
            (key,),
        )
        cur.execute(
            "SELECT conversation_id FROM chat_conversation WHERE direct_key = %s FOR UPDATE",
            (key,),
        )
        row = cur.fetchone()
        if not row:
            # This should only happen if the schema is missing its unique/direct-key support.
            raise ApiError("Could not open the conversation. Please try again.", 500)
        cid = row["conversation_id"]

        # Also repairs a partially-created conversation if either membership row is absent.
        cur.executemany(
            "INSERT IGNORE INTO chat_member (conversation_id, account_id) VALUES (%s, %s)",
            [(cid, me), (cid, other)],
        )
    return jsonify(conversation_id=cid, title=person(target)["display_name"])


@chat_bp.get("/api/chat/conversations/<int:conv_id>/messages")
@role_required(*ALL_ROLES)
def chat_messages(conv_id):
    """Newest 50 messages (oldest first). Pass ?before=<message_id> to load older ones."""
    conversation_for(conv_id, session["account_id"])
    try:
        limit = min(max(int(request.args.get("limit", PAGE_SIZE)), 1), 100)
        before = int(request.args.get("before", 0))
    except (TypeError, ValueError):
        raise ApiError("Invalid paging values.")

    sql = (
        "SELECT msg.message_id, msg.conversation_id, msg.content, msg.created_at, " + PERSON_COLUMNS +
        " FROM chat_message msg JOIN account a ON a.account_id = msg.sender_account_id"
        " LEFT JOIN employees e ON e.employee_id = a.employee_id"
        " WHERE msg.conversation_id = %s"
    )
    params = [conv_id]
    if before:
        sql += " AND msg.message_id < %s"
        params.append(before)
    sql += " ORDER BY msg.message_id DESC LIMIT %s"
    params.append(limit)

    rows = list(reversed(fetch_all(sql, tuple(params))))
    attachments = _attachments_by_message(rows)
    return jsonify(
        messages=[
            message_json(r, attachments.get(r["message_id"], []))
            for r in rows
        ],
        has_more=len(rows) == limit,
    )


@chat_bp.post("/api/chat/conversations/<int:conv_id>/read")
@role_required(*ALL_ROLES)
def chat_mark_read(conv_id):
    me = session["account_id"]
    conversation_for(conv_id, me)
    with db() as (_, cur):
        cur.execute("SELECT COALESCE(MAX(message_id), 0) AS last FROM chat_message WHERE conversation_id = %s",
                    (conv_id,))
        last = cur.fetchone()["last"]
        cur.execute(
            "INSERT INTO chat_member (conversation_id, account_id, last_read_message_id) VALUES (%s, %s, %s) "
            "ON DUPLICATE KEY UPDATE last_read_message_id = GREATEST(last_read_message_id, VALUES(last_read_message_id))",
            (conv_id, me, last),
        )
    return jsonify(ok=True)

def _validate_attachment(file):
    original = (file.filename or "").replace("\\\\", "/").rsplit("/", 1)[-1]
    safe_name = secure_filename(original)
    if not safe_name or "." not in safe_name:
        raise ApiError("Choose a file with a supported extension.")
    ext = safe_name.rsplit(".", 1)[-1].lower()
    spec = ALLOWED_ATTACHMENTS.get(ext)
    if not spec:
        raise ApiError("Unsupported file type. Allowed: images, PDF, Word, Excel, CSV and TXT.")
    data = file.read(MAX_ATTACHMENT_BYTES + 1)
    if not data:
        raise ApiError("The file %s is empty." % safe_name)
    if len(data) > MAX_ATTACHMENT_BYTES:
        raise ApiError("%s exceeds the 10 MB per-file limit." % safe_name)

    mime_type, is_image = spec
    # Basic signature checks prevent common extension-only spoofing.
    signatures = {
        "jpg": data.startswith(b"\xff\xd8\xff"),
        "jpeg": data.startswith(b"\xff\xd8\xff"),
        "png": data.startswith(b"\x89PNG\r\n\x1a\n"),
        "gif": data.startswith((b"GIF87a", b"GIF89a")),
        "webp": len(data) >= 12 and data[:4] == b"RIFF" and data[8:12] == b"WEBP",
        "pdf": data.startswith(b"%PDF-"),
        "doc": data.startswith(bytes.fromhex("D0CF11E0A1B11AE1")),
        "docx": data.startswith(b"PK\x03\x04"),
        "xls": data.startswith(bytes.fromhex("D0CF11E0A1B11AE1")),
        "xlsx": data.startswith(b"PK\x03\x04"),
        "ppt": data.startswith(bytes.fromhex("D0CF11E0A1B11AE1")),
        "pptx": data.startswith(b"PK\x03\x04"),
    }
    if ext in signatures and not signatures[ext]:
        raise ApiError("%s does not appear to be a valid %s file." % (safe_name, ext.upper()))
    return safe_name, ext, mime_type, data


@chat_bp.post("/api/chat/conversations/<int:conv_id>/attachments")
@role_required(*ALL_ROLES)
def upload_chat_attachments(conv_id):
    me = session["account_id"]
    conv = conversation_for(conv_id, me)

    text = (request.form.get("content") or "").strip()
    if len(text) > 2000:
        raise ApiError("Message is too long (maximum 2000 characters).")

    incoming = request.files.getlist("files")
    if not incoming:
        single = request.files.get("file")
        incoming = [single] if single else []
    incoming = [f for f in incoming if f and f.filename]
    if not incoming:
        raise ApiError("Choose at least one attachment.")
    if len(incoming) > MAX_ATTACHMENTS_PER_MESSAGE:
        raise ApiError("You can attach up to %d files per message." % MAX_ATTACHMENTS_PER_MESSAGE)

    prepared = [_validate_attachment(f) for f in incoming]
    folder = os.path.join(CHAT_UPLOAD_ROOT, str(conv_id))
    os.makedirs(folder, exist_ok=True)
    saved = []
    db_committed = False
    try:
        for original, ext, mime_type, data in prepared:
            stored = uuid.uuid4().hex + "." + ext
            absolute = os.path.join(folder, stored)
            with open(absolute, "xb") as handle:
                handle.write(data)
            saved.append((original, stored, mime_type, len(data), "%d/%s" % (conv_id, stored)))

        with db() as (_, cur):
            if conv["type"] == "group":
                _join_group(cur, me)
            cur.execute(
                "INSERT INTO chat_message (conversation_id, sender_account_id, content) "
                "VALUES (%s, %s, %s)",
                (conv_id, me, text),
            )
            message_id = cur.lastrowid
            for original, stored, mime_type, size, relative_path in saved:
                cur.execute(
                    "INSERT INTO chat_attachment "
                    "(message_id, file_name, file_path, mime_type, file_size) "
                    "VALUES (%s, %s, %s, %s, %s)",
                    (message_id, original, relative_path, mime_type, size),
                )
            cur.execute(
                "SELECT msg.message_id, msg.conversation_id, msg.content, msg.created_at, " + PERSON_COLUMNS +
                " FROM chat_message msg JOIN account a ON a.account_id = msg.sender_account_id"
                " LEFT JOIN employees e ON e.employee_id = a.employee_id"
                " WHERE msg.message_id = %s",
                (message_id,),
            )
            row = cur.fetchone()
            if row is None:
                raise RuntimeError("Could not reload the uploaded message.")
            if conv["type"] == "direct":
                cur.execute("SELECT account_id FROM chat_member WHERE conversation_id = %s", (conv_id,))
                members = [r["account_id"] for r in cur.fetchall()]
            else:
                members = []
        db_committed = True

        attachment_rows = fetch_all(
            "SELECT attachment_id, message_id, file_name, mime_type, file_size "
            "FROM chat_attachment WHERE message_id = %s ORDER BY attachment_id",
            (message_id,),
        )
        payload = message_json(row, [_attachment_json(r) for r in attachment_rows])

        # Import at request time to avoid a module import cycle with chat_socket.py.
        from chat_socket import socketio
        if conv["type"] == "group":
            socketio.emit("new_message", payload, to="company")
        else:
            for account_id in members:
                socketio.emit("new_message", payload, to="acct:%d" % account_id)

        return jsonify(ok=True, message_id=message_id, attachments=payload["attachments"]), 201
    except Exception:
        # Once the database transaction commits, keep the files even if a later
        # notification step fails; the message remains available in history.
        if not db_committed:
            for _, stored, _, _, _ in saved:
                try:
                    os.remove(os.path.join(folder, stored))
                except OSError:
                    pass
        raise


def _send_chat_attachment(attachment_id, as_attachment):
    me = session.get("account_id")
    if not me:
        abort(401)
    row = fetch_one(
        "SELECT a.file_path, a.file_name, a.mime_type, cm.account_id "
        "FROM chat_attachment a "
        "JOIN chat_message msg ON msg.message_id = a.message_id "
        "JOIN chat_member cm ON cm.conversation_id = msg.conversation_id "
        "WHERE a.attachment_id = %s AND cm.account_id = %s",
        (attachment_id, me),
    )
    if not row:
        abort(404)
    return send_from_directory(
        CHAT_UPLOAD_ROOT,
        row["file_path"],
        mimetype=row["mime_type"],
        as_attachment=as_attachment,
        download_name=row["file_name"],
        max_age=0,
    )


@chat_bp.get("/api/chat/attachments/<int:attachment_id>/view")
@role_required(*ALL_ROLES)
def view_chat_attachment(attachment_id):
    # Only raster images are displayed inline; all other files download.
    me = session["account_id"]
    row = fetch_one(
        "SELECT a.mime_type FROM chat_attachment a "
        "JOIN chat_message msg ON msg.message_id = a.message_id "
        "JOIN chat_member cm ON cm.conversation_id = msg.conversation_id "
        "WHERE a.attachment_id = %s AND cm.account_id = %s",
        (attachment_id, me),
    )
    if not row:
        abort(404)
    return _send_chat_attachment(attachment_id, as_attachment=not row["mime_type"].startswith("image/"))


@chat_bp.get("/api/chat/attachments/<int:attachment_id>/download")
@role_required(*ALL_ROLES)
def download_chat_attachment(attachment_id):
    return _send_chat_attachment(attachment_id, as_attachment=True)


@chat_bp.get("/chat")
@role_required(*ALL_ROLES)
def chat_page():
    return render_template("chat.html", home=HOME.get(session.get("role"), "/"), embed=request.args.get("embed") == "1")    