from flask import Blueprint

employee_bp = Blueprint("employee", __name__)

# Nothing to move here from app.py. Planned routes for the employee role:
#   GET  /api/me            -> own profile (use session["user_id"])
#   POST /api/me/leaves     -> file own leave (employee_id from session, NOT the request body)
#   GET  /api/me/payroll    -> own payroll records only