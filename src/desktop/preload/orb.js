// Renderer for the floating orb. It has no Node access: everything it knows comes
// from the narrow bridge exposed by the preload script.
(() => {
  const orb = document.getElementById('orb');
  const panel = document.getElementById('panel');
  const bridge = window.taskflow;

  const orbCount = document.getElementById('orb-count');
  const orbOverdue = document.getElementById('orb-overdue');
  const statToday = document.getElementById('stat-today');
  const statOverdue = document.getElementById('stat-overdue');
  const nextTitle = document.getElementById('next-title');
  const nextReason = document.getElementById('next-reason');
  const panelAi = document.getElementById('panel-ai');

  // A drag moves the window, so a plain click must be distinguished from one.
  const DRAG_THRESHOLD_PX = 4;
  let pointerStart = null;

  orb.addEventListener('pointerdown', (event) => {
    pointerStart = { x: event.screenX, y: event.screenY, moved: false };
  });

  orb.addEventListener('pointermove', (event) => {
    if (!pointerStart) return;
    const distance = Math.hypot(event.screenX - pointerStart.x, event.screenY - pointerStart.y);
    // Anything beyond the threshold is a drag, so suppress the click that follows.
    if (distance > DRAG_THRESHOLD_PX) pointerStart.moved = true;
  });

  orb.addEventListener('pointerup', () => {
    const start = pointerStart;
    pointerStart = null;
    // A click only counts when the pointer barely moved, so dragging the orb
    // around the screen never opens the panel.
    if (start && !start.moved) bridge.state().then(render);
  });

  orb.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      bridge.state().then(render);
    }
  });

  document.getElementById('collapse').addEventListener('click', () => bridge.collapse());
  document.getElementById('quit').addEventListener('click', () => bridge.quit());

  /** Renders a read-only snapshot; the panel is only shown when expanded. */
  function render(state) {
    if (!state) return;
    orbCount.textContent = String(state.todayCount);
    statToday.textContent = String(state.todayCount);
    statOverdue.textContent = String(state.overdueCount);
    orbOverdue.hidden = state.overdueCount === 0;
    orbOverdue.textContent = state.overdueCount > 9 ? '9+' : String(state.overdueCount);
    orbOverdue.style.background = state.overdueCount > 0 ? 'var(--warn)' : 'var(--amber)';

    nextTitle.textContent = state.nextTitle ?? 'Nothing scheduled.';
    nextReason.textContent = state.nextReason ?? '';
    panelAi.textContent = state.aiConnected ? `AI ready · ${state.aiModel}` : 'AI off · run “add AI” in the terminal';

    setExpanded(state.expanded);
  }

  function setExpanded(value) {
    if (value) {
      orb.hidden = true;
      panel.hidden = false;
    } else {
      orb.hidden = false;
      panel.hidden = true;
    }
  }

  // Keep the counts fresh while the orb sits on screen.
  const refresh = () => bridge.state().then(render).catch(() => undefined);
  setInterval(refresh, 5000);
  bridge.onExpanded(setExpanded);
  refresh();
})();
