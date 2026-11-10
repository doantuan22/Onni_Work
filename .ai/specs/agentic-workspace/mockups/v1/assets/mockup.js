/* Small, dependency-free interactions shared by the standalone mockup pages. */
(() => {
  const root = document.documentElement;
  const body = document.body;

  document.querySelectorAll('[data-action="theme"]').forEach((button) => {
    const label = button.querySelector("[data-theme-label]");
    const update = () => {
      const nextTheme = root.classList.contains("light") ? "dark" : "light";
      button.setAttribute("aria-label", "Switch to " + nextTheme + " theme");
      button.setAttribute("title", "Switch to " + nextTheme + " theme");
      if (label) label.textContent = (nextTheme === "light" ? "Light" : "Dark") + " theme";
    };
    update();
    button.addEventListener("click", () => {
      root.classList.toggle("light");
      update();
    });
  });

  document.querySelectorAll('[data-action="annotations"]').forEach((button) => {
    const update = () => {
      const shown = body.classList.contains("show-annotations");
      button.setAttribute("aria-pressed", String(shown));
      button.textContent = shown ? "Hide annotations" : "Show annotations";
    };
    update();
    button.addEventListener("click", () => {
      body.classList.toggle("show-annotations");
      update();
    });
  });

  const workspace = document.querySelector(".workspace-app");
  if (!workspace) return;

  const navSplitter = document.querySelector('[data-splitter="navigator"]');
  const contextSplitter = document.querySelector('[data-splitter="context"]');
  const navToggle = document.querySelector('[data-action="collapse-navigator"]');
  const responsiveWidth = (property) => {
    const value = Number.parseFloat(getComputedStyle(workspace).getPropertyValue(property));
    return Number.isFinite(value) ? value : 0;
  };
  let expandedNavWidth = responsiveWidth("--nav-width") >= 130 ? responsiveWidth("--nav-width") : 264;
  let navWasManuallySet = false;
  let contextWasManuallySet = false;
  let activePaneId = document.querySelector('[role="tab"][aria-selected="true"]')
    ?.getAttribute("aria-controls");

  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
  const setWidth = (splitter, value) => {
    const min = Number(splitter.getAttribute("aria-valuemin"));
    const max = Number(splitter.getAttribute("aria-valuemax"));
    const bounded = Math.round(clamp(value, min, max));
    const kind = splitter.dataset.splitter;
    const property = kind === "navigator" ? "--nav-width" : "--context-width";
    workspace.style.setProperty(property, String(bounded) + "px");
    if (kind === "navigator") navWasManuallySet = true;
    else contextWasManuallySet = true;
    splitter.setAttribute("aria-valuenow", String(bounded));
    splitter.setAttribute("aria-valuetext", (kind === "navigator" ? "Navigator" : "Context area") + " width " + bounded + " pixels");
    if (kind === "navigator") {
      workspace.classList.toggle("nav-collapsed", bounded < 130);
      if (bounded >= 130) expandedNavWidth = bounded;
      if (navToggle) {
        navToggle.setAttribute("aria-expanded", String(bounded >= 130));
        navToggle.setAttribute("aria-label", bounded >= 130 ? "Collapse navigator to icon rail" : "Expand navigator");
        navToggle.title = bounded >= 130 ? "Collapse navigator" : "Expand navigator";
      }
    }
    return bounded;
  };

  const splitterValue = (splitter) => {
    const raw = splitter.getAttribute("aria-valuenow");
    return raw === null ? 0 : Number(raw);
  };

  const syncResponsiveRanges = () => {
    if (navSplitter && !navWasManuallySet) {
      const width = responsiveWidth("--nav-width");
      setRangeValue(navSplitter, width);
      workspace.classList.toggle("nav-collapsed", width < 130);
      if (width >= 130) expandedNavWidth = width;
      if (navToggle) {
        navToggle.setAttribute("aria-expanded", String(width >= 130));
        navToggle.setAttribute("aria-label", width >= 130 ? "Collapse navigator to icon rail" : "Expand navigator");
      }
    }
    if (contextSplitter && !contextWasManuallySet) {
      const width = responsiveWidth("--context-width");
      if (width > 0) setRangeValue(contextSplitter, width);
    }
  };

  function setRangeValue(splitter, width) {
    const min = Number(splitter.getAttribute("aria-valuemin"));
    const max = Number(splitter.getAttribute("aria-valuemax"));
    const bounded = Math.round(clamp(width, min, max));
    const kind = splitter.dataset.splitter;
    splitter.setAttribute("aria-valuenow", String(bounded));
    splitter.setAttribute("aria-valuetext", (kind === "navigator" ? "Navigator" : "Context area") + " width " + bounded + " pixels");
  }

  syncResponsiveRanges();
  window.addEventListener("resize", syncResponsiveRanges);

  [navSplitter, contextSplitter].filter(Boolean).forEach((splitter) => {
    let pointerId = null;
    splitter.addEventListener("pointerdown", (event) => {
      if (event.button !== 0) return;
      pointerId = event.pointerId;
      splitter.classList.add("is-dragging");
      splitter.focus({ preventScroll: true });
      try { splitter.setPointerCapture(pointerId); } catch { /* Pointer capture is optional in older browsers. */ }
      event.preventDefault();
    });
    splitter.addEventListener("pointermove", (event) => {
      if (pointerId === null || event.pointerId !== pointerId) return;
      const bounds = workspace.getBoundingClientRect();
      const next = splitter.dataset.splitter === "navigator"
        ? event.clientX - bounds.left
        : bounds.right - event.clientX;
      setWidth(splitter, next);
    });
    const finishDrag = (event) => {
      if (pointerId === null || (event && event.pointerId !== pointerId)) return;
      try {
        if (splitter.hasPointerCapture(pointerId)) splitter.releasePointerCapture(pointerId);
      } catch { /* Capture may already have been released by the browser. */ }
      pointerId = null;
      splitter.classList.remove("is-dragging");
    };
    splitter.addEventListener("pointerup", finishDrag);
    splitter.addEventListener("pointercancel", finishDrag);
    splitter.addEventListener("lostpointercapture", finishDrag);
    splitter.addEventListener("keydown", (event) => {
      const kind = splitter.dataset.splitter;
      const step = event.shiftKey ? 40 : 16;
      const current = splitterValue(splitter);
      let next = current;
      if (kind === "navigator") {
        if (event.key === "ArrowLeft") next -= step;
        else if (event.key === "ArrowRight") next += step;
        else if (event.key === "Home") next = Number(splitter.getAttribute("aria-valuemin"));
        else if (event.key === "End") next = Number(splitter.getAttribute("aria-valuemax"));
        else return;
      } else {
        // The context is the panel after the handle: moving left makes that panel wider.
        if (event.key === "ArrowLeft") next += step;
        else if (event.key === "ArrowRight") next -= step;
        else if (event.key === "Home") next = Number(splitter.getAttribute("aria-valuemax"));
        else if (event.key === "End") next = Number(splitter.getAttribute("aria-valuemin"));
        else return;
      }
      event.preventDefault();
      setWidth(splitter, next);
    });
  });

  navToggle?.addEventListener("click", () => {
    const isCollapsed = workspace.classList.contains("nav-collapsed");
    if (isCollapsed) {
      setWidth(navSplitter, expandedNavWidth);
    } else {
      setWidth(navSplitter, Number(navSplitter.getAttribute("aria-valuemin")));
    }
  });

  const context = document.querySelector(".context-shell");
  const contextOwnerLabel = document.querySelector("[data-context-owner]");
  const statusBranch = document.querySelector("[data-status-branch]");
  const statusPath = document.querySelector("[data-status-path]");
  const reviewActions = document.querySelector("[data-run-actions]");
  const paneTabs = [...document.querySelectorAll('[data-pane-tabs] [role="tab"]')];

  const activateTab = (tab) => {
    const targetId = tab.getAttribute("aria-controls");
    const targetPane = document.getElementById(targetId);
    if (!targetPane) return;
    paneTabs.forEach((candidate) => {
      candidate.setAttribute("aria-selected", String(candidate === tab));
    });
    document.querySelectorAll("[data-pane-panel]").forEach((panel) => {
      panel.hidden = panel !== targetPane;
    });
    activePaneId = targetId;
    const title = tab.dataset.title || "Active conversation";
    const isDraft = tab.dataset.draft === "true";
    workspace.classList.toggle("context-closed", isDraft);
    if (context) {
      context.dataset.ownerPane = targetId;
      context.setAttribute("aria-label", "Context for " + title);
    }
    if (contextOwnerLabel) contextOwnerLabel.textContent = isDraft ? "Draft has no run context" : "for " + title;
    if (statusBranch) statusBranch.textContent = tab.dataset.branch || "Draft · branch created on launch";
    if (statusPath) statusPath.textContent = tab.dataset.path || "Worktree created when this task starts";
    if (statusPath) statusPath.title = statusPath.textContent;
    if (reviewActions) reviewActions.hidden = isDraft;
    document.querySelectorAll("[data-nav-target]").forEach((row) => {
      row.classList.toggle("is-active", row.dataset.navTarget === targetId);
    });
    const titleTarget = document.querySelector("[data-active-task-title]");
    if (titleTarget) titleTarget.textContent = isDraft ? "New task draft" : title;
    const statusThread = document.querySelector("[data-active-thread-status]");
    if (statusThread) statusThread.textContent = isDraft ? "Draft" : (tab.dataset.status || "Running");
  };

  paneTabs.forEach((tab) => tab.addEventListener("click", () => activateTab(tab)));

  document.querySelectorAll("[data-nav-target]").forEach((row) => {
    row.addEventListener("click", () => {
      const matching = paneTabs.find((tab) => tab.getAttribute("aria-controls") === row.dataset.navTarget);
      if (matching) activateTab(matching);
    });
  });

  const contextTablist = document.querySelector("[data-context-tabs]");
  const contextTabs = [...(contextTablist?.querySelectorAll('[role="tab"]') || [])];
  const activateContextTab = (tab) => {
    const selectedId = tab.getAttribute("aria-controls");
    contextTabs.forEach((candidate) => candidate.setAttribute("aria-selected", String(candidate === tab)));
    document.querySelectorAll("[data-context-view]").forEach((view) => {
      view.hidden = view.id !== selectedId;
    });
  };
  contextTabs.forEach((tab) => tab.addEventListener("click", () => activateContextTab(tab)));

  document.querySelectorAll("[data-comment]").forEach((button) => {
    button.addEventListener("click", () => {
      const ownerId = context?.dataset.ownerPane || activePaneId;
      const composer = document.querySelector("#" + ownerId + " textarea");
      if (!composer) return;
      const lineReference = button.dataset.comment;
      const existing = composer.value.trim();
      composer.value = existing
        ? existing + "\n\nPlease review " + lineReference + ": "
        : "Please review " + lineReference + ": ";
      composer.focus();
      composer.setSelectionRange(composer.value.length, composer.value.length);
    });
  });

  // The selected pane is set by click only; focus, hover and pointer movement never switch threads.
})();
