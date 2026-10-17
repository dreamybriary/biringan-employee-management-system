// Biringan Employee Management System - frontend logic
// Talks to the Flask API in app.py (/api/dashboard, /api/employees, ...)

const state = { page: 1, perPage: 10, search: "", status: "" };

async function api(url, options = {}) {
    const res = await fetch(url, {
        headers: { "Content-Type": "application/json" },
        ...options,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || "Request failed (" + res.status + ")");
    return data;
}

function setText(id, value) {
    const el = document.getElementById(id);
    if (el) el.textContent = value;
}

// ---------------------------------------------------------------- Dashboard
async function loadDashboard() {
    try {
        const d = await api("/api/dashboard");
        setText("total-employees", d.total_employees);
        setText("active-employees", d.active_employees);
        setText("total-departments", d.total_departments);
        setText("total-positions", d.total_positions);
        setText("pending-leaves", d.pending_leaves);

        const list = document.getElementById("activity-list");
        list.innerHTML = "";
        if (!d.recent_activity.length) {
            const li = document.createElement("li");
            li.className = "empty";
            li.textContent = "No recent activity yet.";
            list.appendChild(li);
            return;
        }
        d.recent_activity.forEach((a) => {
            const li = document.createElement("li");
            const when = new Date(a.created_at).toLocaleString();
            li.textContent = a.message + " - " + when;
            list.appendChild(li);
        });
    } catch (err) {
        console.error(err);
        alert("Dashboard error: " + err.message);
    }
}

// ---------------------------------------------------------------- Employees
async function loadEmployees() {
    const params = new URLSearchParams({
        page: state.page,
        per_page: state.perPage,
    });
    if (state.search) params.set("search", state.search);
    if (state.status) params.set("status", state.status);

    try {
        const d = await api("/api/employees?" + params.toString());
        renderEmployees(d.items);
        state.page = d.page;
        setText("page-info", "Page " + d.page + " of " + d.pages);
        document.getElementById("prev-page").disabled = d.page <= 1;
        document.getElementById("next-page").disabled = d.page >= d.pages;
    } catch (err) {
        console.error(err);
        alert("Could not load employees: " + err.message);
    }
}

function renderEmployees(items) {
    const tbody = document.querySelector("#employees-table tbody");
    tbody.innerHTML = "";

    if (!items.length) {
        const tr = document.createElement("tr");
        const td = document.createElement("td");
        td.colSpan = 9;
        td.textContent = "No employees found.";
        tr.appendChild(td);
        tbody.appendChild(tr);
        return;
    }

    items.forEach((e) => {
        const tr = document.createElement("tr");
        [e.id, e.employee_code || "-", e.name, e.department, e.position, e.email, e.phone || "-", e.status].forEach((v) => {
            const td = document.createElement("td");
            td.textContent = v;
            tr.appendChild(td);
        });

        const actions = document.createElement("td");
        actions.className = "actions";

        const edit = document.createElement("button");
        edit.className = "btn btn-secondary";
        edit.textContent = "Edit";
        edit.addEventListener("click", () => editEmployee(e.id));
        actions.appendChild(edit);

        const del = document.createElement("button");
        del.className = "btn btn-danger";
        del.textContent = "Delete";
        del.addEventListener("click", () => deleteEmployee(e.id, e.name));
        actions.appendChild(del);
        tr.appendChild(actions);

        tbody.appendChild(tr);
    });
}

async function deleteEmployee(id, name) {
    if (!confirm("Delete " + name + "?")) return;
    try {
        await api("/api/employees/" + id, { method: "DELETE" });
        await Promise.all([loadEmployees(), loadDashboard()]);
    } catch (err) {
        alert(err.message);
    }
}

// ---------------------------------------------------------------- Events
document.addEventListener("DOMContentLoaded", () => {
    loadDashboard();
    loadEmployees();

    const searchInput = document.getElementById("search-input");
    const runSearch = () => {
        state.search = searchInput.value.trim();
        state.page = 1;
        loadEmployees();
    };
    document.getElementById("search-btn").addEventListener("click", runSearch);
    searchInput.addEventListener("keydown", (ev) => {
        if (ev.key === "Enter") runSearch();
    });

    document.getElementById("prev-page").addEventListener("click", () => {
        if (state.page > 1) {
            state.page -= 1;
            loadEmployees();
        }
    });
    document.getElementById("next-page").addEventListener("click", () => {
        state.page += 1;
        loadEmployees();
    });

    // Simple status filter: Active, On Leave, Resigned, Terminated (blank = all)
    document.getElementById("filter-employees").addEventListener("click", () => {
        const choice = prompt(
            "Filter by status (Active, On Leave, Resigned, Terminated). Leave blank for all:",
            state.status
        );
        if (choice === null) return;
        state.status = choice.trim();
        state.page = 1;
        loadEmployees();
    });

    
    document.querySelectorAll(".sidebar nav li").forEach((li) => {
        li.addEventListener("click", () => {
            document.querySelectorAll(".sidebar nav li").forEach((x) => x.classList.remove("active"));
            li.classList.add("active");

            document.querySelectorAll(".main-content .page").forEach((p) => p.classList.remove("active"));
            const page = document.getElementById("page-" + li.dataset.section);
            if (page) page.classList.add("active");
            document.querySelector(".main-content").scrollTop = 0;
        });
    });
});

// ---------------------------------------------------------------- Shared helpers
let toastTimer;
function toast(message, type = "success") {
    const el = document.getElementById("toast");
    el.textContent = message;
    el.className = "toast toast-" + type;
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.hidden = true; }, 3500);
}

function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, (c) => (
        { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
    ));
}

const formOptions = { departments: [], positions: [] };

async function loadFormOptions() {
    const o = await api("/api/accounts/options");
    formOptions.departments = o.departments;
    formOptions.positions = o.positions;
}

function fillDepartmentSelect(select) {
    select.innerHTML = formOptions.departments
        .map((d) => `<option value="${d.id}">${escapeHtml(d.name)}</option>`)
        .join("");
}

function fillPositionSelect(deptSelect, posSelect, selectedId) {
    const deptId = Number(deptSelect.value);
    posSelect.innerHTML = formOptions.positions
        .filter((p) => p.department_id === deptId)
        .map((p) => `<option value="${p.id}">${escapeHtml(p.title)}</option>`)
        .join("");
    if (selectedId) posSelect.value = selectedId;
}

const byId = (id) => document.getElementById(id);

function updateAccountRoleFields() {
    const isAdmin = byId("acc-role").value === "admin";
    byId("acc-department-field").hidden = isAdmin;
    byId("acc-position-field").hidden = isAdmin;
}
// ---------------------------------------------------------------- Add Account
async function openAccountModal() {
    fillPositionSelect(byId("acc-department"), byId("acc-position"));
    updateAccountRoleFields();  
    
    try {
        await loadFormOptions();
    } catch (err) {
        toast(err.message, "error");
        return;
    }

    byId("account-form").reset();
    byId("account-error").hidden = true;
    fillDepartmentSelect(byId("acc-department"));
    fillPositionSelect(byId("acc-department"), byId("acc-position"));

    byId("acc-birthday").max = new Date().toISOString().slice(0, 10);
    byId("account-modal").hidden = false;
    byId("acc-first").focus();
}

function closeAccountModal() {
    byId("account-modal").hidden = true;
}

// ---------------------------------------------------------------- Edit Employee
async function editEmployee(id) {
    let emp;
    try {
        await loadFormOptions();
        emp = await api("/api/accounts/employees/" + id);
    } catch (err) {
        toast(err.message, "error");
        return;
    }

    byId("employee-error").hidden = true;
    byId("emp-id").value = emp.id;
    byId("emp-first").value = emp.first_name || "";
    byId("emp-middle").value = emp.middle_name || "";
    byId("emp-last").value = emp.last_name || "";
    byId("emp-suffix").value = emp.suffix || "None";
    byId("emp-sex").value = emp.sex || "";
    byId("emp-birthday").value = emp.birthday || "";
    byId("emp-birthday").max = new Date().toISOString().slice(0, 10);
    byId("emp-email").value = emp.email || "";
    byId("emp-phone").value = emp.phone || "";
    byId("emp-salary").value = emp.salary === "" || emp.salary == null ? "" : emp.salary;
    byId("emp-status").value = emp.status || "Active";

    fillDepartmentSelect(byId("emp-department"));
    byId("emp-department").value = emp.department_id;
    fillPositionSelect(byId("emp-department"), byId("emp-position"), emp.position_id);

    byId("employee-modal").hidden = false;
    byId("emp-first").focus();
}

function closeEmployeeModal() {
    byId("employee-modal").hidden = true;
}

// ---------------------------------------------------------------- Wiring
document.addEventListener("DOMContentLoaded", () => {
    // Add Account
    byId("add-account-btn").addEventListener("click", openAccountModal);
    byId("acc-department").addEventListener("change", () =>
        fillPositionSelect(byId("acc-department"), byId("acc-position")));
    byId("acc-role").addEventListener("change", updateAccountRoleFields);
    byId("account-close").addEventListener("click", closeAccountModal);
    byId("account-cancel").addEventListener("click", closeAccountModal);
    byId("account-modal").addEventListener("click", (e) => {
        if (e.target.id === "account-modal") closeAccountModal();
    });

    // Edit Employee
    byId("emp-department").addEventListener("change", () =>
        fillPositionSelect(byId("emp-department"), byId("emp-position")));
    byId("employee-close").addEventListener("click", closeEmployeeModal);
    byId("employee-cancel").addEventListener("click", closeEmployeeModal);
    byId("employee-modal").addEventListener("click", (e) => {
        if (e.target.id === "employee-modal") closeEmployeeModal();
    });

    document.addEventListener("keydown", (e) => {
        if (e.key === "Escape") {
            closeAccountModal();
            closeEmployeeModal();
        }
    });

    // Submit: Add Account
    byId("account-form").addEventListener("submit", async (ev) => {
        ev.preventDefault();
        const errBox = byId("account-error");
        const val = (id) => byId(id).value;

        if (val("acc-password") !== val("acc-confirm")) {
            errBox.textContent = "Passwords do not match.";
            errBox.hidden = false;
            return;
        }

        const isAdmin = val("acc-role") === "admin";
        const payload = {
            first_name: val("acc-first"),
            middle_name: val("acc-middle"),
            last_name: val("acc-last"),
            suffix: val("acc-suffix"),
            sex: val("acc-sex"),
            birthday: val("acc-birthday"),
            email: val("acc-email"),
            phone: val("acc-phone"),
            department_id: isAdmin ? null : val("acc-department"),
            position_id: isAdmin ? null : val("acc-position"),
            salary: val("acc-salary"),
            role: val("acc-role"),
            password: val("acc-password"),
        };

        try {
            const created = await api("/api/accounts", {
                method: "POST",
                body: JSON.stringify(payload),
            });
            closeAccountModal();
            alert("Account created for " + created.email + ".\n\nEmployee ID: " + created.employee_code + "\n\nWrite this down. The employee needs it to log in.");
            loadDashboard();
            loadEmployees();
        } catch (err) {
            errBox.textContent = err.message;
            errBox.hidden = false;
        }
    });

    // Submit: Edit Employee
    byId("employee-form").addEventListener("submit", async (ev) => {
        ev.preventDefault();
        const errBox = byId("employee-error");
        const val = (id) => byId(id).value;

        const payload = {
            first_name: val("emp-first"),
            middle_name: val("emp-middle"),
            last_name: val("emp-last"),
            suffix: val("emp-suffix"),
            sex: val("emp-sex"),
            birthday: val("emp-birthday"),
            email: val("emp-email"),
            phone: val("emp-phone"),
            department_id: val("emp-department"),
            position_id: val("emp-position"),
            salary: val("emp-salary"),
            status: val("emp-status"),
        };

        try {
            await api("/api/accounts/employees/" + val("emp-id"), {
                method: "PUT",
                body: JSON.stringify(payload),
            });
            closeEmployeeModal();
            toast("Employee updated.");
            loadDashboard();
            loadEmployees();
        } catch (err) {
            errBox.textContent = err.message;
            errBox.hidden = false;
        }
    });
});