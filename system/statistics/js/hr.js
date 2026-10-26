
async function api(url, options = {}) {
    const res = await fetch(url, {
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        ...options,
    });
    
    if (res.status === 401) {
        window.location.href = "/";
        return new Promise(() => {});
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || "Request failed (" + res.status + ")");
    return data;
}


document.addEventListener("DOMContentLoaded", async () => {
    const name = document.getElementById("hr-name");
    const status = document.getElementById("hr-status");
    try {
        const me = await api("/api/hr/me");
        name.textContent = me.name;
        status.textContent = "sarap ni howard lance a arca bscs2a";
    } catch (err) {
        name.textContent = "HR";
        status.textContent = "Connection problem: " + err.message;
    }
});