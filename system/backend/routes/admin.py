from flask import Blueprint, jsonify, request

from auth import role_required
from db import db, fetch_all, fetch_one, log_activity
from utils import ApiError, clean, to_int, json_body

admin_bp = Blueprint("admin", __name__)


# --------------------------------------------------------------------------
# Dashboard
# --------------------------------------------------------------------------
@admin_bp.get("/api/dashboard")
@role_required("admin")
def dashboard():
    stats = fetch_one(
        """
        SELECT
          (SELECT COUNT(*) FROM employees)                           AS total_employees,
          (SELECT COUNT(*) FROM employees WHERE stat = 'Active')     AS active_employees,
          (SELECT COUNT(*) FROM departments)                         AS total_departments,
          (SELECT COUNT(*) FROM positions)                           AS total_positions,
          (SELECT COUNT(*) FROM leave_requests
             WHERE leave_status = 'Pending')                         AS pending_leaves
        """
    )
    stats["recent_activity"] = fetch_all(
        "SELECT message, created_at FROM activity_log ORDER BY activity_id DESC LIMIT 10"
    )
    return jsonify(stats)


# --------------------------------------------------------------------------
# Departments
# --------------------------------------------------------------------------
@admin_bp.get("/api/departments")
@role_required("admin", "hr")
def list_departments():
    rows = fetch_all(
        """
        SELECT d.department_id AS id, d.dept_name AS name,
               d.head_employee_id,
               CONCAT(h.first_name, ' ', h.last_name) AS head,
               (SELECT COUNT(*) FROM employees e WHERE e.department_id = d.department_id) AS employees,
               (SELECT COUNT(*) FROM positions p WHERE p.department_id = d.department_id) AS positions
        FROM departments d
        LEFT JOIN employees h ON h.employee_id = d.head_employee_id
        ORDER BY d.department_id
        """
    )
    return jsonify(rows)


def build_department(data):
    name = clean(data.get("dept_name") or data.get("name"))
    if not name:
        raise ApiError("Department name is required.")
    head = to_int(data.get("head_employee_id"), "Head", required=False)
    if head is not None and not fetch_one(
        "SELECT 1 AS ok FROM employees WHERE employee_id = %s", (head,)
    ):
        raise ApiError("Selected department head doesn't exist.")
    return name, head


@admin_bp.post("/api/departments")
@role_required("admin")
def create_department():
    name, head = build_department(json_body())
    with db() as (_, cur):
        cur.execute(
            "INSERT INTO departments (dept_name, head_employee_id) VALUES (%s, %s)", (name, head)
        )
        new_id = cur.lastrowid
        log_activity(cur, f"Added department {name}")
    return jsonify(id=new_id, name=name, head_employee_id=head), 201


@admin_bp.put("/api/departments/<int:department_id>")
@role_required("admin")
def update_department(department_id):
    if not fetch_one("SELECT 1 AS ok FROM departments WHERE department_id = %s", (department_id,)):
        raise ApiError("Department not found.", 404)
    name, head = build_department(json_body())
    with db() as (_, cur):
        cur.execute(
            "UPDATE departments SET dept_name = %s, head_employee_id = %s WHERE department_id = %s",
            (name, head, department_id),
        )
        log_activity(cur, f"Updated department {name}")
    return jsonify(id=department_id, name=name, head_employee_id=head)


@admin_bp.delete("/api/departments/<int:department_id>")
@role_required("admin")
def delete_department(department_id):
    dept = fetch_one("SELECT dept_name FROM departments WHERE department_id = %s", (department_id,))
    if not dept:
        raise ApiError("Department not found.", 404)
    with db() as (_, cur):
        cur.execute("DELETE FROM departments WHERE department_id = %s", (department_id,))
        log_activity(cur, f"Deleted department {dept['dept_name']}")
    return jsonify(message="Department deleted.")


# --------------------------------------------------------------------------
# Positions
# --------------------------------------------------------------------------
@admin_bp.get("/api/positions")
@role_required("admin", "hr")
def list_positions():
    sql = """
        SELECT p.position_id AS id, p.title, p.department_id,
               d.dept_name AS department,
               (SELECT COUNT(*) FROM employees e WHERE e.position_id = p.position_id) AS employees
        FROM positions p
        JOIN departments d ON d.department_id = p.department_id
    """
    params = []
    dept = clean(request.args.get("department_id"))
    if dept:
        sql += " WHERE p.department_id = %s"
        params.append(to_int(dept, "department_id"))
    sql += " ORDER BY p.department_id, p.position_id"
    return jsonify(fetch_all(sql, params))


def build_position(data):
    title = clean(data.get("title"))
    if not title:
        raise ApiError("Position title is required.")
    department_id = to_int(data.get("department_id"), "Department")
    if not fetch_one("SELECT 1 AS ok FROM departments WHERE department_id = %s", (department_id,)):
        raise ApiError("Selected department doesn't exist.")
    return title, department_id


@admin_bp.post("/api/positions")
@role_required("admin")
def create_position():
    title, department_id = build_position(json_body())
    with db() as (_, cur):
        cur.execute(
            "INSERT INTO positions (title, department_id) VALUES (%s, %s)", (title, department_id)
        )
        new_id = cur.lastrowid
        log_activity(cur, f"Added position {title}")
    return jsonify(id=new_id, title=title, department_id=department_id), 201


@admin_bp.put("/api/positions/<int:position_id>")
@role_required("admin")
def update_position(position_id):
    if not fetch_one("SELECT 1 AS ok FROM positions WHERE position_id = %s", (position_id,)):
        raise ApiError("Position not found.", 404)
    title, department_id = build_position(json_body())
    with db() as (_, cur):
        cur.execute(
            "UPDATE positions SET title = %s, department_id = %s WHERE position_id = %s",
            (title, department_id, position_id),
        )
        log_activity(cur, f"Updated position {title}")
    return jsonify(id=position_id, title=title, department_id=department_id)


@admin_bp.delete("/api/positions/<int:position_id>")
@role_required("admin")
def delete_position(position_id):
    pos = fetch_one("SELECT title FROM positions WHERE position_id = %s", (position_id,))
    if not pos:
        raise ApiError("Position not found.", 404)
    with db() as (_, cur):
        cur.execute("DELETE FROM positions WHERE position_id = %s", (position_id,))
        log_activity(cur, f"Deleted position {pos['title']}")
    return jsonify(message="Position deleted.")