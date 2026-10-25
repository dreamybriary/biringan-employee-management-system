(function () {
    "use strict";

    var HR_EMAIL = "";   // e.g. "hr@yourcompany.com" – makes "Contact HR" open an email

    var $ = function (id) { return document.getElementById(id); };
    var STATUS_CLASS = {
        "Active": "b-green", "Approved": "b-green", "Checked in": "b-green", "Checked out": "b-blue",
        "On Leave": "b-orange", "Pending": "b-orange", "Not checked in": "b-grey",
        "Resigned": "b-grey", "Terminated": "b-red", "Rejected": "b-red"
    };
    var LONG = { year: "numeric", month: "long", day: "numeric" };
    var SHORT = { year: "numeric", month: "short", day: "numeric" };
    var MONTH = { year: "numeric", month: "long" };
    var state = { summary: null, timer: null };

    /* ---------- helpers ---------- */
    function el(tag, cls, text) {
        var n = document.createElement(tag);
        if (cls) n.className = cls;
        if (text !== undefined) n.textContent = text;
        return n;
    }
    function pad(n) { return (n < 10 ? "0" : "") + n; }
    function todayStr() { var d = new Date(); return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()); }
    function toDate(v) { var d = new Date(v + "T00:00:00"); return isNaN(d) ? null : d; }
    function formatDate(v, o) { if (!v) return "—"; var d = toDate(v); return d ? d.toLocaleDateString(undefined, o) : v; }
    function dateRange(a, b) {
        if (!a) return "—";
        return !b || a === b ? formatDate(a, SHORT) : formatDate(a, SHORT) + " – " + formatDate(b, SHORT);
    }
    function days(a, b) {
        var x = toDate(a), y = toDate(b || a);
        if (!x || !y) return "—";
        var n = Math.round((y - x) / 864e5) + 1;
        return n + (n === 1 ? " day" : " days");
    }
    function money(v) {
        return v === null || v === undefined ? "—" :
            "₱" + Number(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    }
    function fullName(p) { return [p.first_name, p.middle_name, p.last_name, p.suffix].filter(Boolean).join(" "); }
    function greeting() { var h = new Date().getHours(); return h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening"; }
    function mins(t) {
        var m = /(\d{1,2}):(\d{2})\s*(AM|PM)?/i.exec(t || "");
        if (!m) return null;
        var h = +m[1];
        if (m[3]) { h = h % 12; if (/pm/i.test(m[3])) h += 12; }
        return h * 60 + (+m[2]);
    }
    function hm(total) { total = Math.max(0, Math.round(total)); return pad(Math.floor(total / 60)) + ":" + pad(total % 60); }
    function setBadge(node, status) { node.textContent = status || "—"; node.className = "badge " + (STATUS_CLASS[status] || ""); }

    function toast(msg, isError) {
        var t = $("toast");
        t.textContent = msg;
        t.className = "toast" + (isError ? " error" : "");
        t.hidden = false;
        clearTimeout(toast.id);
        toast.id = setTimeout(function () { t.hidden = true; }, 3500);
    }
    function showError(msg) { var b = $("page-error"); b.textContent = msg; b.hidden = false; }

    function request(url, opts) {
        opts = opts || {};
        opts.credentials = "same-origin";
        opts.headers = { "Accept": "application/json" };
        if (opts.body) opts.headers["Content-Type"] = "application/json";
        return fetch(url, opts).then(function (res) {
            if (res.status === 401 || res.status === 403) {
                window.location.href = "/";
                return new Promise(function () {});
            }
            return res.json().catch(function () { return {}; }).then(function (body) {
                if (!res.ok) throw new Error(body.error || body.message || "Something went wrong.");
                return body;
            });
        });
    }
    function post(url, data) { return request(url, { method: "POST", body: JSON.stringify(data || {}) }); }

    /* ---------- navigation ---------- */
    function showPage(name) {
        document.querySelectorAll(".page").forEach(function (p) { p.classList.toggle("active", p.id === "page-" + name); });
        document.querySelectorAll(".sidebar li[data-page]").forEach(function (li) { li.classList.toggle("active", li.dataset.page === name); });
        document.body.classList.remove("nav-open");
        window.scrollTo(0, 0);
    }
    function goTo(id) {
        showPage("dashboard");
        var n = $(id);
        if (n) n.scrollIntoView({ behavior: "smooth", block: "start" });
    }
    document.querySelectorAll(".sidebar li").forEach(function (li) {
        function go() {
            if (li.dataset.page) showPage(li.dataset.page);
            else if (li.dataset.scroll) goTo(li.dataset.scroll);
            else if (li.dataset.soon) toast(li.dataset.soon + " isn't available yet.");
        }
        li.addEventListener("click", go);
        li.addEventListener("keydown", function (e) { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); go(); } });
    });

    $("menu-toggle").addEventListener("click", function () {
        var small = window.matchMedia("(max-width: 900px)").matches;
        var open = document.body.classList.toggle(small ? "nav-open" : "nav-collapsed");
        $("menu-toggle").setAttribute("aria-expanded", String(small ? open : !open));
    });
    $("bell").addEventListener("click", function () { goTo("card-news"); });

    var menu = $("user-menu"), userBtn = $("user-btn");
    function closeMenu() { menu.hidden = true; userBtn.setAttribute("aria-expanded", "false"); }
    userBtn.addEventListener("click", function (e) {
        e.stopPropagation();
        menu.hidden = !menu.hidden;
        userBtn.setAttribute("aria-expanded", String(!menu.hidden));
    });
    menu.querySelector("[data-page]").addEventListener("click", function () { showPage("profile"); closeMenu(); });
    document.addEventListener("click", closeMenu);
    document.addEventListener("keydown", function (e) { if (e.key === "Escape") closeMenu(); });

    document.querySelectorAll("[data-action='help']").forEach(function (b) {
        b.addEventListener("click", function () {
            if (HR_EMAIL) window.location.href = "mailto:" + HR_EMAIL;
            else toast("Contact HR through your department head or an administrator.");
        });
    });

    /* ---------- profile ---------- */
    function addRow(tbody, label, value, badge) {
        var tr = el("tr"), th = el("th", "", label), td = el("td");
        th.scope = "row";
        if (badge) { var b = el("span"); setBadge(b, value); td.appendChild(b); }
        else td.textContent = value || "—";
        tr.appendChild(th); tr.appendChild(td); tbody.appendChild(tr);
    }

    function renderProfile(p) {
        var name = fullName(p), initials = ((p.first_name || "")[0] || "") + ((p.last_name || "")[0] || "");
        $("header-name").textContent = name;
        $("avatar").textContent = $("profile-avatar").textContent = initials.toUpperCase() || "–";
        $("profile-name").textContent = name;
        $("greeting").textContent = greeting() + ", " + p.first_name + "! Here’s your workday at a glance.";
        document.title = name + " | Biri-Go";
        setBadge($("card-status"), p.status);
        $("card-department").textContent = p.department || "Not assigned";
        $("card-position").textContent = p.position || "Not assigned";

        var rows = $("profile-rows");
        rows.textContent = "";
        addRow(rows, "Full name", name);
        addRow(rows, "Employee ID", p.employee_code);
        addRow(rows, "Status", p.status, true);
        addRow(rows, "Department", p.department);
        addRow(rows, "Position", p.position);
        addRow(rows, "Sex", p.sex);
        addRow(rows, "Birthday", formatDate(p.birthday, LONG));
        addRow(rows, "Email", p.email || p.account_email);
        addRow(rows, "Phone", p.phone);
    }

    /* ---------- dashboard pieces ---------- */
    function renderRows(id, rows, cols, empty, toCells) {
        var tbody = $(id);
        tbody.textContent = "";
        if (!rows || !rows.length) {
            var tr = el("tr"), td = el("td", "empty-row", empty);
            td.colSpan = cols; tr.appendChild(td); tbody.appendChild(tr);
            return;
        }
        rows.forEach(function (row) {
            var tr = el("tr");
            toCells(row).forEach(function (c) {
                var td = el("td");
                if (c && typeof c === "object") { var b = el("span"); setBadge(b, c.badge); td.appendChild(b); }
                else td.textContent = c === null || c === undefined || c === "" ? "—" : c;
                tr.appendChild(td);
            });
            tbody.appendChild(tr);
        });
    }

    function renderStats(s) {
        var st = s.stats || {};
        $("st-days").textContent = st.days_present !== undefined ? st.days_present : "—";
        $("st-days-sub").textContent = st.working_days ? "of " + st.working_days + " working days" : "\u00a0";
        $("st-rate").textContent = st.attendance_rate != null ? st.attendance_rate + "%" : "—";
        $("st-rate-sub").textContent = new Date().toLocaleDateString(undefined, MONTH);
        $("st-hours").textContent = st.hours_month !== undefined ? st.hours_month + " h" : "—";
        $("st-hours-sub").textContent = st.days_present ? Math.round(st.hours_month / st.days_present * 10) / 10 + " h daily average" : "\u00a0";

        var bal = s.leave_balances || [], left = bal.reduce(function (n, b) { return n + b.remaining; }, 0);
        $("st-leave").textContent = bal.length ? left + (left === 1 ? " day" : " days") : "—";
        $("card-pending").textContent = String((s.leave_counts && s.leave_counts.Pending) || 0);
    }

    function renderAttendance(s) {
        var rows = s.attendance || [], today = null, target = (s.daily_target || 8) * 60;
        rows.forEach(function (a) { if (a.work_date === todayStr()) today = a; });
        clearInterval(state.timer);

        var btn = $("att-btn"), tIn = today && today.time_in, tOut = today && today.time_out;
        $("att-in").textContent = tIn || "—";
        $("att-out").textContent = tOut || "—";
        $("att-shift").textContent = s.shift || "—";
        $("att-shift").parentNode.hidden = !s.shift;
        $("att-place").hidden = !s.location;
        $("att-place-text").textContent = s.location || "";
        btn.disabled = false;

        function paint() {
            var start = mins(tIn), now = new Date(), end = tOut ? mins(tOut) : now.getHours() * 60 + now.getMinutes();
            var worked = start === null ? 0 : Math.max(0, end - start);
            $("att-clock").textContent = hm(worked);
            $("att-bar").style.width = Math.min(100, worked / target * 100) + "%";
        }

        if (!tIn) { setBadge($("att-chip"), "Not checked in"); btn.textContent = "Check in"; btn.dataset.mode = "in"; paint(); }
        else if (!tOut) { setBadge($("att-chip"), "Checked in"); btn.textContent = "Check out"; btn.dataset.mode = "out"; paint(); state.timer = setInterval(paint, 30000); }
        else { setBadge($("att-chip"), "Checked out"); btn.textContent = "Done for today"; btn.disabled = true; paint(); }

        renderRows("attendance-rows", rows, 3, "No attendance records yet.", function (a) {
            return [formatDate(a.work_date, SHORT), a.time_in, a.time_out];
        });
    }

    function renderBalance(s) {
        var box = $("balance-list"), bal = s.leave_balances || [];
        box.textContent = "";
        if (!bal.length) box.appendChild(el("p", "muted small", "Leave balances aren’t available yet."));
        bal.forEach(function (b, i) {
            var row = el("div", "bal"), top = el("div", "bal-top"), val = el("span");
            top.appendChild(el("span", "", b.type));
            var strong = el("strong", "", String(b.remaining));
            val.appendChild(strong); val.appendChild(document.createTextNode(" of " + b.total + " days"));
            top.appendChild(val);
            var bar = el("div", "bar c" + (i % 3)), fill = el("span");
            fill.style.width = (b.total ? b.remaining / b.total * 100 : 0) + "%";
            bar.appendChild(fill); row.appendChild(top); row.appendChild(bar); box.appendChild(row);
        });
        $("balance-note").textContent = "Current leave year: January – December " + new Date().getFullYear();
    }

    function renderPay(s) {
        var list = s.payslips || [], p = list[0];
        $("pay-body").hidden = !p;
        $("pay-empty").hidden = !!p;
        if (p) {
            $("pay-period").textContent = formatDate(p.pay_period, MONTH);
            $("pay-net").textContent = money(p.net_pay);
            $("pay-view").href = "/employee/payslips/" + p.id;
            $("pay-download").href = "/employee/payslips/" + p.id + "?download=1";
        }
        renderRows("payslip-rows", list, 4, "No payslips yet.", function (x) {
            return [formatDate(x.pay_period, MONTH), money(x.gross_pay), money(x.deductions), money(x.net_pay)];
        });
    }

    function renderNews(s) {
        var ul = $("news-list"), items = s.announcements || [];
        ul.textContent = "";
        $("bell-dot").hidden = !items.length;
        if (!items.length) { ul.appendChild(el("li", "muted small", "No announcements right now.")); return; }
        items.forEach(function (n, i) {
            var li = el("li"), body = el("div");
            li.appendChild(el("span", "swatch c" + (i % 3)));
            body.appendChild(el("strong", "", n.title));
            if (n.body) body.appendChild(el("p", "", n.body));
            body.appendChild(el("small", "muted", [n.author, n.date && formatDate(n.date, SHORT)].filter(Boolean).join(" · ")));
            li.appendChild(body); ul.appendChild(li);
        });
    }

    function renderActivity(s) {
        var ul = $("activity-list"), items = [], a = (s.attendance || [])[0], l = (s.leaves || [])[0], p = (s.payslips || [])[0];
        if (a && a.time_in) items.push(["You checked in", formatDate(a.work_date, SHORT) + " · " + a.time_in]);
        if (l) items.push([l.type + " requested", dateRange(l.start_date, l.end_date) + " · " + l.status]);
        if (p) items.push([formatDate(p.pay_period, MONTH) + " payslip ready", "Salary & payslips"]);
        ul.textContent = "";
        if (!items.length) ul.appendChild(el("li", "muted small", "Nothing to show yet."));
        items.forEach(function (it, i) {
            var li = el("li"), d = el("div");
            li.appendChild(el("span", "swatch c" + (i % 3)));
            d.appendChild(el("strong", "", it[0])); d.appendChild(el("small", "muted", it[1]));
            li.appendChild(d); ul.appendChild(li);
        });
    }

    function renderSummary(s) {
        state.summary = s;
        renderStats(s);
        renderAttendance(s);
        renderBalance(s);
        renderPay(s);
        renderNews(s);
        renderActivity(s);
        renderRows("leave-rows", s.leaves, 4, "No leave requests yet.", function (l) {
            return [l.type, dateRange(l.start_date, l.end_date), days(l.start_date, l.end_date), { badge: l.status }];
        });
    }

    /* ---------- actions ---------- */
    $("att-btn").addEventListener("click", function () {
        var btn = this, mode = btn.dataset.mode;
        btn.disabled = true;
        post("/api/employee/attendance/" + (mode === "out" ? "check-out" : "check-in"))
            .then(function (r) { toast(r.message || "Done."); return loadSummary(); })
            .catch(function (e) { btn.disabled = false; toast(e.message, true); });
    });

    var dlg = $("leave-dialog"), form = $("leave-form");
    $("open-leave").addEventListener("click", function () {
        var types = (state.summary && state.summary.leave_types) || ["Sick Leave"], sel = $("lv-type");
        sel.textContent = "";
        types.forEach(function (t) { var o = el("option", "", t); o.value = t; sel.appendChild(o); });
        form.reset();
        $("lv-start").min = $("lv-end").min = todayStr();
        $("lv-error").hidden = true;
        dlg.showModal();
    });
    $("lv-cancel").addEventListener("click", function () { dlg.close(); });
    form.addEventListener("submit", function (e) {
        e.preventDefault();
        var err = $("lv-error"), btn = $("lv-submit");
        if ($("lv-end").value < $("lv-start").value) { err.textContent = "The end date can’t be before the start date."; err.hidden = false; return; }
        btn.disabled = true;
        post("/api/employee/leaves", { type: $("lv-type").value, start_date: $("lv-start").value, end_date: $("lv-end").value })
            .then(function (r) { dlg.close(); toast(r.message || "Leave request sent."); return loadSummary(); })
            .catch(function (e2) { err.textContent = e2.message; err.hidden = false; })
            .then(function () { btn.disabled = false; });
    });

    /* ---------- load ---------- */
    function loadSummary() {
        return request("/api/employee/summary").then(renderSummary).catch(function (e) {
            showError(e.message);
            ["leave-rows", "attendance-rows", "payslip-rows"].forEach(function (id) {
                renderRows(id, [], 4, "Could not load this section.", function () { return []; });
            });
        });
    }

    $("today-date").textContent = new Date().toLocaleDateString(undefined, { weekday: "long", year: "numeric", month: "long", day: "numeric" });

    request("/api/employee/me").then(renderProfile).catch(function (e) {
        $("header-name").textContent = "Employee";
        $("greeting").textContent = "Welcome";
        showError(e.message);
    });
    loadSummary();
})();