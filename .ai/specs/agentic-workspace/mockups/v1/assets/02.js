(() => {
  const app = document.querySelector(".split-demo");
  if (!app) return;
  const tabs = [...app.querySelectorAll("[data-pane-tab]")];
  const panes = [...app.querySelectorAll("[data-two-pane]")];
  const context = app.querySelector(".context-shell");
  const ownerLabel = app.querySelector("[data-context-owner]");
  const branchLabel = app.querySelector("[data-status-branch]");
  const pathLabel = app.querySelector("[data-status-path]");
  const runLabel = app.querySelector("[data-status-run]");
  const stateChip = app.querySelector("[data-context-run-state]");
  const summary = app.querySelector("[data-context-summary]");
  const contextBranch = app.querySelector("[data-context-branch]");
  const fileLabel = app.querySelector("[data-context-file]");
  const reviewRun = app.querySelector("[data-review-run]");
  const inspectorStatus = app.querySelector("[data-inspector-status]");
  const inspectorRunner = app.querySelector("[data-inspector-runner]");
  const toast = app.querySelector("[data-toast]");
  let toastTimer;

  const announce = (message) => {
    toast.textContent = message;
    toast.hidden = false;
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => { toast.hidden = true; }, 2600);
  };

  const activate = (tab) => {
    const paneId = tab.getAttribute("aria-controls");
    const pane = document.getElementById(paneId);
    if (!pane) return;
    tabs.forEach((item) => item.setAttribute("aria-selected", String(item === tab)));
    panes.forEach((item) => item.classList.toggle("is-active", item === pane));
    app.querySelectorAll("[data-pane-target]").forEach((item) => item.classList.toggle("is-active", item.dataset.paneTarget === paneId));
    context.dataset.ownerPane = paneId;
    context.setAttribute("aria-label", "Context for " + pane.dataset.title);
    ownerLabel.textContent = "for " + pane.dataset.title;
    branchLabel.textContent = pane.dataset.branch;
    pathLabel.textContent = pane.dataset.path;
    pathLabel.title = pane.dataset.path;
    runLabel.textContent = pane.dataset.status;
    stateChip.textContent = pane.dataset.status;
    summary.textContent = pane.dataset.summary;
    contextBranch.textContent = pane.dataset.branch;
    reviewRun.textContent = pane.dataset.title;
    inspectorStatus.textContent = pane.dataset.status;
    inspectorRunner.textContent = paneId === "pane-manager" ? "Codex · manager" : "Claude";
    fileLabel.textContent = paneId === "pane-manager" ? "retry-policy.ts" : "local-cache.md";
    announce("Context now follows: " + pane.dataset.title);
  };

  tabs.forEach((tab) => tab.addEventListener("click", () => activate(tab)));
  panes.forEach((pane) => pane.addEventListener("click", () => {
    const tab = tabs.find((item) => item.getAttribute("aria-controls") === pane.id);
    if (tab && tab.getAttribute("aria-selected") !== "true") activate(tab);
  }));
  app.querySelectorAll("[data-pane-target]").forEach((button) => button.addEventListener("click", () => {
    const tab = tabs.find((item) => item.getAttribute("aria-controls") === button.dataset.paneTarget);
    if (tab) activate(tab);
  }));
  app.querySelector("[data-two-pane-tabs]")?.addEventListener("keydown", (event) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    const current = tabs.indexOf(document.activeElement);
    const next = (current + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length;
    event.preventDefault();
    tabs[next].focus();
  });

  const paneSplitter = app.querySelector("[data-pane-splitter]");
  const splitWorkspace = app.querySelector("[data-split-workspace]");
  const setPaneWidth = (value) => {
    const min = Number(paneSplitter.getAttribute("aria-valuemin"));
    const max = Number(paneSplitter.getAttribute("aria-valuemax"));
    const bounded = Math.round(Math.min(max, Math.max(min, value)));
    splitWorkspace.style.setProperty("--pane-a-width", bounded + "%");
    paneSplitter.setAttribute("aria-valuenow", String(bounded));
    paneSplitter.setAttribute("aria-valuetext", bounded + " percent width for the manager pane");
  };
  let pointerId = null;
  paneSplitter.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    pointerId = event.pointerId;
    paneSplitter.classList.add("is-dragging");
    paneSplitter.focus({ preventScroll: true });
    try { paneSplitter.setPointerCapture(pointerId); } catch { /* Pointer capture is optional. */ }
    event.preventDefault();
  });
  paneSplitter.addEventListener("pointermove", (event) => {
    if (pointerId !== event.pointerId) return;
    const bounds = splitWorkspace.getBoundingClientRect();
    setPaneWidth(((event.clientX - bounds.left) / bounds.width) * 100);
  });
  const endDrag = (event) => {
    if (pointerId === null || (event && pointerId !== event.pointerId)) return;
    try {
      if (paneSplitter.hasPointerCapture(pointerId)) paneSplitter.releasePointerCapture(pointerId);
    } catch { /* Capture may already have ended. */ }
    pointerId = null;
    paneSplitter.classList.remove("is-dragging");
  };
  paneSplitter.addEventListener("pointerup", endDrag);
  paneSplitter.addEventListener("pointercancel", endDrag);
  paneSplitter.addEventListener("lostpointercapture", endDrag);
  paneSplitter.addEventListener("keydown", (event) => {
    const value = Number(paneSplitter.getAttribute("aria-valuenow"));
    const step = event.shiftKey ? 6 : 2;
    if (event.key === "ArrowLeft") setPaneWidth(value - step);
    else if (event.key === "ArrowRight") setPaneWidth(value + step);
    else if (event.key === "Home") setPaneWidth(Number(paneSplitter.getAttribute("aria-valuemin")));
    else if (event.key === "End") setPaneWidth(Number(paneSplitter.getAttribute("aria-valuemax")));
    else return;
    event.preventDefault();
  });

  app.querySelectorAll("[data-open-worker]").forEach((button) => button.addEventListener("click", (event) => {
    const mode = button.dataset.openWorker;
    const title = button.dataset.workerTitle;
    announce(mode === "tab"
      ? title + " opened in a task tab. Two conversation panes remain visible."
      : title + " opened in the second pane. Maximum visible panes: 2.");
  }));
  app.querySelectorAll("[data-composer-form]").forEach((form) => form.addEventListener("submit", (event) => {
    event.preventDefault();
    const pane = form.closest("[data-two-pane]");
    announce("Draft kept with " + pane.dataset.title + ".");
  }));
  app.querySelectorAll("[data-review-action]").forEach((button) => button.addEventListener("click", () => {
    const active = panes.find((pane) => pane.classList.contains("is-active"));
    announce(button.dataset.reviewAction === "pr"
      ? "Create PR is an explicit action for " + active.dataset.title + "."
      : "Finish is an explicit action for " + active.dataset.title + ".");
  }));

  // No focus, hover, pointer movement, or wheel listener changes the selected run.
})();
