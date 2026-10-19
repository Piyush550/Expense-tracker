// Applies the saved theme before first paint (kept out of index.html so the CSP needs no inline scripts).
try { if (localStorage.getItem("expense-tracker-theme") === "dark") document.documentElement.setAttribute("data-theme", "dark"); } catch (e) { /* storage blocked */ }
