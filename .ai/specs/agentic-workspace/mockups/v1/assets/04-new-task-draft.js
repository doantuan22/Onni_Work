(() => {
  const tab = document.querySelector("#tab-draft");
  const draftPane = document.querySelector("#panel-draft");
  const promotedPane = document.querySelector("#panel-promoted");
  const existingTab = document.querySelector("#tab-existing");
  const form = document.querySelector("#draft-form");
  const prompt = document.querySelector("#task-prompt");
  const dispatchToggle = document.querySelector("#dispatch-toggle");
  const roster = document.querySelector("#roster-editor");
  const toast = document.querySelector("[data-toast]");
  const showToast = (message) => {
    toast.textContent = message;
    toast.hidden = false;
    window.setTimeout(() => { toast.hidden = true; }, 3600);
  };
  dispatchToggle.addEventListener("change", () => { roster.hidden = !dispatchToggle.checked; });
  document.querySelector("[data-add-worker]").addEventListener("click", () => {
    const list = document.querySelector("[data-roster-list]");
    const count = list.children.length + 1;
    const row = document.createElement("div");
    row.className = "roster-row";
    row.innerHTML = '<span class="worker-avatar">W</span><label class="control-label">Worker ' + count + '<select><option>Claude Code</option><option>Codex</option><option>OpenCode</option></select></label><label class="control-label">Assignment<input value="Inspect an independent part of the task"></label><button class="btn btn-icon remove-worker" type="button" aria-label="Remove worker">×</button>';
    list.append(row);
  });
  document.querySelector("[data-roster-list]").addEventListener("click", (event) => {
    if (event.target.closest(".remove-worker")) event.target.closest(".roster-row").remove();
  });
  document.querySelector("[data-attach]").addEventListener("click", () => showToast("Attachments are not saved in drafts. Add them again after reopening."));
  const titleFromPrompt = (value) => value.trim().split(/[.!?\n]/)[0].slice(0, 46) || "New task";
  const typeText = (target, text) => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) { target.textContent = text; return; }
    let index = 0;
    const timer = window.setInterval(() => {
      target.textContent = text.slice(0, ++index);
      if (index >= text.length) window.clearInterval(timer);
    }, 18);
  };
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const id = "e5c8a120";
    const path = "/tasks/" + id;
    const taskTitle = titleFromPrompt(prompt.value);
    tab.dataset.title = taskTitle;
    tab.dataset.branch = "onni/ab12cd34";
    tab.dataset.path = ".ai/onni/worktrees/" + id;
    tab.dataset.status = "Running";
    delete tab.dataset.draft;
    tab.setAttribute("aria-controls", "panel-promoted");
    tab.setAttribute("aria-label", taskTitle + " · " + path);
    tab.querySelector("[data-tab-title]").textContent = path;
    tab.querySelector(".tab-dot")?.remove();
    const running = document.createElement("span");
    running.className = "status-dot status-dot-running";
    running.setAttribute("aria-label", "Running");
    tab.prepend(running);
    draftPane.hidden = true;
    promotedPane.hidden = false;
    document.querySelector("[data-promoted-title]").textContent = taskTitle;
    document.querySelector("[data-promoted-url]").textContent = path;
    document.querySelector("[data-promoted-prompt]").textContent = prompt.value;
    document.querySelector("[data-status-branch]").textContent = "onni/ab12cd34";
    document.querySelector("[data-status-path]").textContent = ".ai/onni/worktrees/" + id;
    document.querySelector("[data-route-label]").textContent = path;
    tab.setAttribute("aria-selected", "true");
    existingTab.setAttribute("aria-selected", "false");
    try { history.replaceState({ task: id }, "", "#" + path); } catch { window.location.hash = path; }
    const streaming = document.querySelector("[data-streaming-text]");
    typeText(streaming, "I’ll trace the task lifecycle, check how stale sessions are recorded, and add one focused regression case. This run is now streaming in the same draft tab.");
    document.querySelector("[data-active-task-title]").textContent = taskTitle;
    document.querySelector("[data-active-thread-status]").textContent = "Running";
    document.querySelector(".draft-status-hint").textContent = "Review and merge actions remain explicit.";
  });
  document.querySelector("[data-schedule]").addEventListener("click", () => {
    const date = document.querySelector("#schedule-date").value || "2026-11-11";
    const time = document.querySelector("#schedule-time").value || "09:00";
    const title = titleFromPrompt(prompt.value);
    const readableDate = new Date(date + "T" + time).toLocaleString("en", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
    document.querySelector("[data-scheduled-title]").textContent = title;
    document.querySelector("[data-scheduled-time]").textContent = readableDate;
    document.querySelector("[data-scheduled-entry]").hidden = false;
    tab.remove();
    draftPane.hidden = true;
    existingTab.click();
    showToast("Scheduled for " + readableDate + " · no run started");
  });
  document.querySelector("[data-existing-task]").addEventListener("click", () => existingTab.click());
  document.querySelector(".draft-search input").addEventListener("input", (event) => {
    const query = event.target.value.toLowerCase();
    document.querySelectorAll(".nav-section .nav-session").forEach((row) => {
      row.hidden = query.length > 0 && !row.textContent.toLowerCase().includes(query);
    });
  });
})();