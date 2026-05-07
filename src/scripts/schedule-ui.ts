import { formatDayHeading, formatDayWithYear } from "../lib/formatDay";
import type { ClientBootstrap } from "../lib/schedule";
import type { EnrichedEvent, Room, TagDefinition } from "../types/schedule";

const FAV_KEY = "fanfest-schedule-favorites";
const FILTER_KEY = "fanfest-schedule-filters";

type StoredFilters = { tagIds: string[]; roomIds: string[] };
/** `special` room only appears on Today when a session overlaps this window from “now”. */
const SPECIAL_ROOM_TODAY_WINDOW_MS = 6 * 60 * 60 * 1000;

/**
 * UTC milliseconds for wall-clock `hhmm` on calendar `ymd` in `timeZone`.
 * Minute-step scan around local noon (handles DST except extreme edge cases).
 */
function wallTimeToUtcMs(ymd: string, hhmm: string, timeZone: string): number {
  const [y, mo, d] = ymd.split("-").map(Number);
  const [h, mi] = hhmm.split(":").map(Number);
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const read = (ms: number) => {
    const p = fmt.formatToParts(new Date(ms));
    return {
      y: Number(p.find((x) => x.type === "year")!.value),
      mo: Number(p.find((x) => x.type === "month")!.value),
      d: Number(p.find((x) => x.type === "day")!.value),
      h: Number(p.find((x) => x.type === "hour")!.value),
      mi: Number(p.find((x) => x.type === "minute")!.value),
    };
  };
  const anchor = Date.UTC(y, mo - 1, d, 12, 0, 0);
  for (let deltaMin = -48 * 60; deltaMin <= 48 * 60; deltaMin++) {
    const ms = anchor + deltaMin * 60 * 1000;
    const w = read(ms);
    if (w.y === y && w.mo === mo && w.d === d && w.h === h && w.mi === mi)
      return ms;
  }
  return anchor;
}

function eventOverlapsUtcWindow(
  ev: EnrichedEvent,
  windowStartMs: number,
  windowEndMs: number,
  cache: (ymd: string, hhmm: string) => number,
): boolean {
  const startMs = cache(ev.day, ev.start);
  let endMs = !ev.end ? startMs : cache(ev.day, ev.end);
  if (endMs <= startMs) endMs = startMs + 60 * 1000;
  return startMs < windowEndMs && endMs > windowStartMs;
}

function roomShowsOnToday(
  room: Room,
  guideDay: string,
  bootstrap: ClientBootstrap,
  nowMs: number,
  cache: (ymd: string, hhmm: string) => number,
): boolean {
  if (room.id !== "special") return true;
  const windowEnd = nowMs + SPECIAL_ROOM_TODAY_WINDOW_MS;
  const roomEvents = bootstrap.events.filter(
    (e) => e.day === guideDay && e.roomId === room.id,
  );
  return roomEvents.some((ev) =>
    eventOverlapsUtcWindow(ev, nowMs, windowEnd, cache),
  );
}

function parseFavoriteIds(): Set<string> {
  try {
    const raw = localStorage.getItem(FAV_KEY);
    if (!raw) return new Set();
    const arr = JSON.parse(raw) as unknown;
    if (!Array.isArray(arr)) return new Set();
    return new Set(arr.filter((x): x is string => typeof x === "string"));
  } catch {
    return new Set();
  }
}

function saveFavoriteIds(ids: Set<string>) {
  localStorage.setItem(FAV_KEY, JSON.stringify([...ids]));
}

function syncFavoriteNavButton(favs: Set<string>) {
  const btn = document.getElementById("nav-favorites");
  btn?.toggleAttribute("data-has-favorites", favs.size > 0);
}

function getZonedParts(
  date: Date,
  timeZone: string,
): { ymd: string; minutes: number } {
  const dFmt = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const tFmt = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const ymd = dFmt.format(date);
  const tParts = tFmt.formatToParts(date);
  const hh = Number(tParts.find((p) => p.type === "hour")?.value ?? "0");
  const mm = Number(tParts.find((p) => p.type === "minute")?.value ?? "0");
  return { ymd, minutes: hh * 60 + mm };
}

function parseStoredFilters(): StoredFilters | null {
  try {
    const raw = localStorage.getItem(FILTER_KEY);
    if (!raw) return null;
    const o = JSON.parse(raw) as unknown;
    if (!o || typeof o !== "object") return null;
    const tagIds = (o as { tagIds?: unknown }).tagIds;
    const roomIds = (o as { roomIds?: unknown }).roomIds;
    return {
      tagIds: Array.isArray(tagIds)
        ? tagIds.filter((x): x is string => typeof x === "string")
        : [],
      roomIds: Array.isArray(roomIds)
        ? roomIds.filter((x): x is string => typeof x === "string")
        : [],
    };
  } catch {
    return null;
  }
}

function saveFilterState(tags: Set<string>, rooms: Set<string>) {
  const payload: StoredFilters = {
    tagIds: [...tags],
    roomIds: [...rooms],
  };
  localStorage.setItem(FILTER_KEY, JSON.stringify(payload));
}

function restoreFilterChipsFromLocalStorage() {
  const stored = parseStoredFilters();
  if (!stored) return;
  document
    .querySelectorAll<HTMLButtonElement>(".tag-chip[data-tag-id]")
    .forEach((b) => {
      const id = b.dataset.tagId ?? "";
      b.dataset.active = stored.tagIds.includes(id) ? "true" : "false";
    });
  document
    .querySelectorAll<HTMLButtonElement>(".tag-chip[data-room-id]")
    .forEach((b) => {
      const id = b.dataset.roomId ?? "";
      b.dataset.active = stored.roomIds.includes(id) ? "true" : "false";
    });
}

function syncFilterNavButton() {
  const btn = document.getElementById("nav-filters");
  if (!btn) return;
  const active = readSelectedTags().size > 0 || readSelectedRooms().size > 0;
  btn.toggleAttribute("data-filters-active", active);
}

/** Sum of page widths before `ymd` in `#day-carousel-strip`. */
function scrollScheduleStripToDay(bootstrap: ClientBootstrap, ymd: string) {
  const strip = document.getElementById("day-carousel-strip");
  if (!strip) return;
  const idx = bootstrap.days.indexOf(ymd);
  if (idx < 0) return;
  const pages = strip.querySelectorAll<HTMLElement>(
    ".day-carousel__page[data-day]",
  );
  let left = 0;
  for (let i = 0; i < idx && i < pages.length; i++) {
    left += pages[i]!.offsetWidth;
  }
  strip.scrollLeft = left;
}

/** If “today” in con timezone is a con day, scroll the schedule day carousel to that page. */
function scrollScheduleCarouselToTodayIfNeeded(bootstrap: ClientBootstrap) {
  const { ymd } = getZonedParts(new Date(), bootstrap.meta.timezone);
  const idx = bootstrap.days.indexOf(ymd);
  if (idx <= 0) return;
  scrollScheduleStripToDay(bootstrap, ymd);
}

function findRoomByLocationQuery(rooms: Room[], q: string): Room | undefined {
  const lower = q.trim().toLowerCase();
  if (!lower) return undefined;
  return rooms.find(
    (r) =>
      r.id.toLowerCase() === lower ||
      r.label.toLowerCase() === lower ||
      r.shortLabel?.toLowerCase() === lower,
  );
}

function findTagByQuery(tags: TagDefinition[], q: string): TagDefinition | undefined {
  const lower = q.trim().toLowerCase();
  if (!lower) return undefined;
  return tags.find(
    (t) => t.id.toLowerCase() === lower || t.label.toLowerCase() === lower,
  );
}

/** Single-room deep link: only `room.id` chip active; empty clears room filters. */
function applyLocationQueryParam(bootstrap: ClientBootstrap, q: string) {
  const room = findRoomByLocationQuery(bootstrap.rooms, q);
  if (!room && q.trim() !== "") return;
  document
    .querySelectorAll<HTMLButtonElement>(".tag-chip[data-room-id]")
    .forEach((b) => {
      const id = b.dataset.roomId ?? "";
      b.dataset.active = room && id === room.id ? "true" : "false";
    });
}

/** Single-tag deep link: only `tag.id` chip active; empty clears tag filters. */
function applyTagQueryParam(bootstrap: ClientBootstrap, q: string) {
  const tag = findTagByQuery(bootstrap.tags, q);
  if (!tag && q.trim() !== "") return;
  document
    .querySelectorAll<HTMLButtonElement>(".tag-chip[data-tag-id]")
    .forEach((b) => {
      const id = b.dataset.tagId ?? "";
      b.dataset.active = tag && id === tag.id ? "true" : "false";
    });
}

function roomById(rooms: Room[], id: string): Room | undefined {
  return rooms.find((r) => r.id === id);
}

function tagById(tags: TagDefinition[], id: string): TagDefinition | undefined {
  return tags.find((t) => t.id === id);
}

function appendTagPill(wrap: HTMLElement, tid: string, tags: TagDefinition[]) {
  const td = tagById(tags, tid);
  const label = td?.label ?? tid;
  const pill =
    td?.description !== undefined && td.description !== ""
      ? document.createElement("button")
      : document.createElement("span");
  pill.className = "event-tag-pill";
  pill.textContent = label;
  if (td?.color) {
    pill.style.color = td.color;
    pill.style.border = "1px solid rgba(255,255,255,0.12)";
  }
  if (pill instanceof HTMLButtonElement && td?.description) {
    pill.type = "button";
    pill.dataset.tagDescription = td.description;
    pill.setAttribute("aria-label", `${label}: show description`);
  }
  wrap.appendChild(pill);
}

function positionTagDescPopover(pop: HTMLElement, trigger: Element) {
  const margin = 8;
  const tr = trigger.getBoundingClientRect();
  const pr = pop.getBoundingClientRect();
  const vw = window.innerWidth;
  const vh = window.innerHeight;

  let top = tr.bottom + margin;
  let left = tr.left + tr.width / 2 - pr.width / 2;
  left = Math.max(margin, Math.min(left, vw - pr.width - margin));

  if (top + pr.height > vh - margin) {
    top = tr.top - pr.height - margin;
  }
  if (top < margin) {
    top = margin;
  }

  pop.style.top = `${Math.round(top)}px`;
  pop.style.left = `${Math.round(left)}px`;
  pop.style.right = "auto";
  pop.style.bottom = "auto";
}

function wireTagDescriptionPopover() {
  const shell = document.getElementById("schedule-app");
  const pop = document.getElementById("tag-desc-popover") as HTMLElement & {
    showPopover?: () => void;
  };
  if (!shell || !pop) return;
  shell.addEventListener("click", (e) => {
    const trigger = (e.target as HTMLElement).closest("[data-tag-description]");
    if (!trigger || !shell.contains(trigger)) return;
    const desc = trigger.getAttribute("data-tag-description");
    if (!desc) return;
    e.preventDefault();
    e.stopPropagation();
    pop.textContent = desc;
    if (typeof pop.showPopover !== "function") return;
    pop.showPopover();
    requestAnimationFrame(() => {
      requestAnimationFrame(() => positionTagDescPopover(pop, trigger));
    });
  });
}

function roomsUsedOnDay(
  events: EnrichedEvent[],
  day: string,
  roomOrder: Room[],
): string[] {
  const ids = new Set(events.filter((e) => e.day === day).map((e) => e.roomId));
  return roomOrder.map((r) => r.id).filter((id) => ids.has(id));
}

function eventsForRoomDay(
  events: EnrichedEvent[],
  day: string,
  roomId: string,
): EnrichedEvent[] {
  return events
    .filter((e) => e.day === day && e.roomId === roomId)
    .sort(
      (a, b) => a.startMinutes - b.startMinutes || a.id.localeCompare(b.id),
    );
}

/** Latest end time (minutes) of any event on this calendar day. */
function lastEventEndMinutesOnDay(
  events: EnrichedEvent[],
  day: string,
): number | null {
  const list = events.filter((e) => e.day === day);
  if (list.length === 0) return null;
  return Math.max(...list.map((e) => e.endMinutes));
}

/**
 * First slot: live session if any, otherwise the next upcoming session (no empty “error” state).
 * Second slot: the session after that (by start ≥ end of what’s in the first slot).
 */
function findPrimaryAndFollowing(
  list: EnrichedEvent[],
  nowMin: number,
): {
  primary: EnrichedEvent | null;
  primaryIsLive: boolean;
  following: EnrichedEvent | null;
} {
  let live: EnrichedEvent | null = null;
  for (const ev of list) {
    if (ev.startMinutes <= nowMin && nowMin < ev.endMinutes) {
      live = ev;
      break;
    }
  }
  const firstUpcoming = list.find((ev) => ev.startMinutes > nowMin) ?? null;

  if (live) {
    const following =
      list.find((ev) => ev.startMinutes >= live!.endMinutes) ?? null;
    return { primary: live, primaryIsLive: true, following };
  }
  if (firstUpcoming) {
    const following =
      list.find((ev) => ev.startMinutes >= firstUpcoming.endMinutes) ?? null;
    return { primary: firstUpcoming, primaryIsLive: false, following };
  }
  return { primary: null, primaryIsLive: false, following: null };
}

function readSelectedTags(): Set<string> {
  const out = new Set<string>();
  document
    .querySelectorAll<HTMLButtonElement>(".tag-chip[data-active='true']")
    .forEach((b) => {
      const id = b.dataset.tagId;
      if (id) out.add(id);
    });
  return out;
}

function readSelectedRooms(): Set<string> {
  const out = new Set<string>();
  document
    .querySelectorAll<HTMLButtonElement>(
      ".tag-chip[data-room-id][data-active='true']",
    )
    .forEach((b) => {
      const id = b.dataset.roomId;
      if (id) out.add(id);
    });
  return out;
}

function tagMatch(eventTags: string[], selected: Set<string>): boolean {
  if (selected.size === 0) return true;
  return eventTags.some((t) => selected.has(t));
}

function applyScheduleFilters() {
  const scheduleRoot = document.getElementById("view-schedule");
  if (!scheduleRoot) return;

  const tagSel = readSelectedTags();
  const roomSel = readSelectedRooms();

  const allCards = [
    ...scheduleRoot.querySelectorAll<HTMLElement>("[data-event-card]"),
  ];

  scheduleRoot
    .querySelectorAll<HTMLElement>("[data-room-column]")
    .forEach((col) => {
      const roomId = col.dataset.roomId ?? "";

      const colBaseVisible = roomSel.size === 0 || roomSel.has(roomId);

      const cards = [...col.querySelectorAll<HTMLElement>("[data-event-card]")];
      let visibleCount = 0;

      for (const card of cards) {
        const evTags = (card.dataset.tags ?? "").split(" ").filter(Boolean);
        const ok = colBaseVisible && tagMatch(evTags, tagSel);
        card.classList.toggle("is-hidden", !ok);
        if (ok) visibleCount++;
      }

      const hasCards = cards.length > 0;
      if (!colBaseVisible) {
        col.classList.add("is-hidden");
      } else if (hasCards) {
        col.classList.toggle("is-hidden", visibleCount === 0);
      } else {
        col.classList.remove("is-hidden");
      }
    });

  const hint = document.getElementById("filter-empty");
  if (hint) {
    const total = allCards.length;
    const visible = allCards.filter(
      (c) => !c.classList.contains("is-hidden"),
    ).length;
    hint.dataset.visible = total > 0 && visible === 0 ? "true" : "false";
  }

  syncFilterNavButton();
}

function applyNowHighlights(bootstrap: ClientBootstrap, now: Date) {
  const { ymd, minutes } = getZonedParts(now, bootstrap.meta.timezone);
  const daySet = new Set(bootstrap.days);
  document
    .querySelectorAll<HTMLElement>("[data-event-card]")
    .forEach((card) => {
      const day = card.dataset.day ?? "";
      const sm = Number(card.dataset.startMin ?? "0");
      const em = Number(card.dataset.endMin ?? "0");
      const on =
        daySet.has(ymd) && day === ymd && sm <= minutes && minutes < em;
      card.classList.toggle("event-card--now", on);
    });
}

function syncFavoriteToggleButtons(favs: Set<string>) {
  document
    .querySelectorAll<HTMLButtonElement>("[data-favorite-toggle]")
    .forEach((btn) => {
      const id = btn.dataset.eventId ?? "";
      btn.dataset.favorite = favs.has(id) ? "true" : "false";
    });
}

function wireFavorites(bootstrap: ClientBootstrap) {
  const shell = document.getElementById("schedule-app");
  if (!shell) return;

  let favs = parseFavoriteIds();
  syncFavoriteToggleButtons(favs);
  syncFavoriteNavButton(favs);

  shell.addEventListener("click", (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLButtonElement>(
      "[data-favorite-toggle]",
    );
    if (!btn || !shell.contains(btn)) return;
    const id = btn.dataset.eventId ?? "";
    if (!id) return;
    e.stopPropagation();
    if (favs.has(id)) favs.delete(id);
    else favs.add(id);
    saveFavoriteIds(favs);
    syncFavoriteToggleButtons(favs);
    syncFavoriteNavButton(favs);
    const favView = document.getElementById("view-favorites");
    if (favView && !favView.hidden) renderFavoritesView(bootstrap);
  });
}

function wireChipToggles(rerender: () => void) {
  const toggle = (b: HTMLButtonElement) => {
    const active = b.dataset.active === "true";
    b.dataset.active = active ? "false" : "true";
    rerender();
  };
  document
    .querySelectorAll<HTMLButtonElement>(".tag-chip[data-tag-id]")
    .forEach((b) => {
      b.addEventListener("click", () => toggle(b));
    });
  document
    .querySelectorAll<HTMLButtonElement>(".tag-chip[data-room-id]")
    .forEach((b) => {
      b.addEventListener("click", () => toggle(b));
    });
}

function wireFilters(bootstrap: ClientBootstrap) {
  const rerender = () => {
    applyScheduleFilters();
    applyNowHighlights(bootstrap, new Date());
    saveFilterState(readSelectedTags(), readSelectedRooms());
  };
  wireChipToggles(rerender);
  rerender();
}

function closeFilterPanel() {
  const panel = document.getElementById("filter-panel");
  const btn = document.getElementById("nav-filters");
  if (panel) panel.hidden = true;
  if (btn) {
    btn.setAttribute("aria-expanded", "false");
    btn.setAttribute("aria-label", "Open filters");
  }
}

function wireFilterPanel() {
  const panel = document.getElementById("filter-panel");
  const btn = document.getElementById(
    "nav-filters",
  ) as HTMLButtonElement | null;
  if (!panel || !btn) return;

  btn.addEventListener("click", () => {
    if (btn.disabled) return;
    const open = btn.getAttribute("aria-expanded") === "true";
    if (open) {
      closeFilterPanel();
      return;
    }
    panel.hidden = false;
    btn.setAttribute("aria-expanded", "true");
    btn.setAttribute("aria-label", "Close filters");
  });
}

function wireNav(bootstrap: ClientBootstrap) {
  const schedule = document.getElementById("view-schedule");
  const favorites = document.getElementById("view-favorites");
  const today = document.getElementById("view-today");
  const bFav = document.getElementById("nav-favorites");
  const bSched = document.getElementById("nav-schedule");
  const bToday = document.getElementById("nav-today");
  const filterBtn = document.getElementById(
    "nav-filters",
  ) as HTMLButtonElement | null;

  const go = (view: "schedule" | "favorites" | "today") => {
    const isSched = view === "schedule";
    const isFav = view === "favorites";
    const isToday = view === "today";

    if (schedule) schedule.hidden = !isSched;
    if (favorites) favorites.hidden = !isFav;
    if (today) today.hidden = !isToday;

    bFav?.setAttribute("aria-pressed", isFav ? "true" : "false");
    bSched?.setAttribute("aria-pressed", isSched ? "true" : "false");
    bToday?.setAttribute("aria-pressed", isToday ? "true" : "false");

    if (filterBtn) {
      filterBtn.disabled = !isSched;
      filterBtn.setAttribute("aria-hidden", isSched ? "false" : "true");
      if (!isSched) closeFilterPanel();
    }

    if (isToday) renderToday(bootstrap);
    if (isFav) renderFavoritesView(bootstrap);
  };

  bFav?.addEventListener("click", () => go("favorites"));
  bSched?.addEventListener("click", () => go("schedule"));
  bToday?.addEventListener("click", () => go("today"));
}

/** Horizontal pan targets only the day strips (see schedule.css: single outer scroller). */
function horizontalStripFromTarget(
  target: EventTarget | null,
): HTMLElement | null {
  if (!target || !(target instanceof Element)) return null;

  const dayStrip = target.closest("#day-carousel-strip, #favorites-day-strip");
  const overflows = (el: HTMLElement) => el.scrollWidth > el.clientWidth + 1;

  if (dayStrip instanceof HTMLElement && overflows(dayStrip)) return dayStrip;
  return null;
}

function isStripDragBlockedTarget(target: EventTarget | null): boolean {
  if (!target || !(target instanceof Element)) return false;
  return Boolean(
    target.closest(
      "button, a, input, textarea, select, label, [data-tag-description]",
    ),
  );
}

/** Mouse click-and-drag on horizontal day strips (pointerType === "mouse"). */
function wireMouseDragHorizontalScroll() {
  const app = document.getElementById("schedule-app");
  if (!app) return;

  type DragState =
    | { mode: "idle" }
    | {
        mode: "pending";
        strip: HTMLElement;
        pointerId: number;
        x0: number;
        y0: number;
        sl0: number;
      }
    | {
        mode: "dragging";
        strip: HTMLElement;
        pointerId: number;
        x0: number;
        sl0: number;
      };

  let state: DragState = { mode: "idle" };
  let suppressNextClick = false;

  const removeWindowListeners = () => {
    window.removeEventListener("pointermove", onWindowPointerMove);
    window.removeEventListener("pointerup", onWindowPointerEnd);
    window.removeEventListener("pointercancel", onWindowPointerEnd);
  };

  const onWindowPointerMove = (e: PointerEvent) => {
    if (state.mode === "idle") return;

    if (state.mode === "pending") {
      if (e.pointerId !== state.pointerId) return;
      const dx = e.clientX - state.x0;
      const dy = e.clientY - state.y0;
      const ax = Math.abs(dx);
      const ay = Math.abs(dy);
      if (ax >= 8 && ax > ay) {
        const { strip, pointerId, x0, sl0 } = state;
        strip.setPointerCapture(pointerId);
        strip.classList.add("is-drag-scroll--active");
        state = { mode: "dragging", strip, pointerId, x0, sl0 };
        e.preventDefault();
        strip.scrollLeft = sl0 - (e.clientX - x0);
        return;
      }
      if (ay >= 8 && ay > ax) {
        removeWindowListeners();
        state = { mode: "idle" };
      }
      return;
    }

    if (state.mode === "dragging") {
      if (e.pointerId !== state.pointerId) return;
      e.preventDefault();
      state.strip.scrollLeft = state.sl0 - (e.clientX - state.x0);
    }
  };

  const onWindowPointerEnd = (e: PointerEvent) => {
    if (state.mode === "idle") return;
    if (e.pointerId !== state.pointerId) return;

    if (state.mode === "dragging") {
      suppressNextClick = true;
      try {
        state.strip.releasePointerCapture(e.pointerId);
      } catch {
        /* already released */
      }
      state.strip.classList.remove("is-drag-scroll--active");
    }

    removeWindowListeners();
    state = { mode: "idle" };
  };

  app.addEventListener(
    "pointerdown",
    (e: PointerEvent) => {
      if (e.pointerType !== "mouse" || e.button !== 0) return;
      if (state.mode !== "idle") return;

      const strip = horizontalStripFromTarget(e.target);
      if (!strip) return;
      if (strip.scrollWidth <= strip.clientWidth + 1) return;
      if (isStripDragBlockedTarget(e.target)) return;

      state = {
        mode: "pending",
        strip,
        pointerId: e.pointerId,
        x0: e.clientX,
        y0: e.clientY,
        sl0: strip.scrollLeft,
      };

      window.addEventListener("pointermove", onWindowPointerMove);
      window.addEventListener("pointerup", onWindowPointerEnd);
      window.addEventListener("pointercancel", onWindowPointerEnd);
    },
    true,
  );

  app.addEventListener(
    "click",
    (e: MouseEvent) => {
      if (!suppressNextClick) return;
      suppressNextClick = false;
      e.preventDefault();
      e.stopPropagation();
    },
    true,
  );
}

function clearEl(el: HTMLElement) {
  while (el.firstChild) el.removeChild(el.firstChild);
}

function setEventCardTimeContent(container: HTMLElement, ev: EnrichedEvent) {
  container.replaceChildren();
  if (!ev.end) {
    container.textContent = ev.start;
    return;
  }
  const start = document.createElement("span");
  start.className = "event-card__time-part";
  start.textContent = ev.start;
  const end = document.createElement("span");
  end.className = "event-card__time-part";
  end.textContent = ev.end;
  container.append(start, end);
}

function roomColumnHeadClass(room: Room): string {
  return room.headerTextColor === "light"
    ? "room-column__head room-column__head--light"
    : "room-column__head room-column__head--dark";
}

function buildFavoriteEventCard(
  ev: EnrichedEvent,
  room: Room,
  tags: TagDefinition[],
  hasTimeConflict: boolean,
): HTMLElement {
  const article = document.createElement("article");
  article.className = [
    "event-card",
    ev.highlight ? "event-card--highlight" : "",
    hasTimeConflict ? "event-card--favorite-conflict" : "",
  ]
    .filter(Boolean)
    .join(" ");
  if (ev.highlight) article.style.setProperty("--room-accent", room.accent);
  article.dataset.eventCard = "";
  article.dataset.eventId = ev.id;
  article.dataset.day = ev.day;
  article.dataset.roomId = ev.roomId;
  article.dataset.tags = ev.tags.join(" ");
  article.dataset.startMin = String(ev.startMinutes);
  article.dataset.endMin = String(ev.endMinutes);

  const layout = document.createElement("div");
  layout.className = "event-card__layout";

  const timeStack = document.createElement("div");
  timeStack.className = "event-card__time-stack";

  const timeEl = document.createElement("div");
  timeEl.className = "event-card__time";
  setEventCardTimeContent(timeEl, ev);

  const favBtn = document.createElement("button");
  favBtn.type = "button";
  favBtn.className = "event-card__fav";
  favBtn.dataset.favoriteToggle = "";
  favBtn.setAttribute("aria-label", "Favorite");
  favBtn.dataset.eventId = ev.id;
  favBtn.textContent = "★";

  timeStack.appendChild(timeEl);
  timeStack.appendChild(favBtn);

  const main = document.createElement("div");
  main.className = "event-card__main";

  const title = document.createElement("h3");
  title.className = "event-card__title";
  title.textContent = ev.title;
  main.appendChild(title);

  if (ev.speakers?.length) {
    const sp = document.createElement("p");
    sp.className = "event-card__speakers";
    sp.style.color = room.accent;
    sp.textContent = ev.speakers.join(" · ");
    main.appendChild(sp);
  }
  if (ev.notes) {
    const notes = document.createElement("p");
    notes.className = "event-card__speakers";
    notes.style.color = "var(--muted)";
    notes.textContent = ev.notes;
    main.appendChild(notes);
  }
  if (ev.tags.length) {
    const wrap = document.createElement("div");
    wrap.className = "event-card__tags";
    for (const tid of ev.tags) appendTagPill(wrap, tid, tags);
    main.appendChild(wrap);
  }

  layout.appendChild(timeStack);
  layout.appendChild(main);
  article.appendChild(layout);

  const favs = parseFavoriteIds();
  favBtn.dataset.favorite = favs.has(ev.id) ? "true" : "false";

  return article;
}

function favoriteTimeConflictKeys(
  events: EnrichedEvent[],
  favIds: Set<string>,
): Set<string> {
  const counts = new Map<string, number>();
  for (const ev of events) {
    if (!favIds.has(ev.id)) continue;
    const key = `${ev.day}:${ev.startMinutes}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  return new Set(
    [...counts.entries()]
      .filter(([, count]) => count > 1)
      .map(([key]) => key),
  );
}

function renderFavoritesView(bootstrap: ClientBootstrap) {
  const strip = document.getElementById("favorites-day-strip");
  if (!strip) return;

  const favIds = parseFavoriteIds();
  const conflictKeys = favoriteTimeConflictKeys(bootstrap.events, favIds);
  clearEl(strip);

  if (favIds.size === 0) {
    const page = document.createElement("section");
    page.className = "day-carousel__page favorites-empty-page";
    const p = document.createElement("p");
    p.className = "off-season";
    p.textContent = "No favorites yet. Star sessions in Schedule.";
    page.appendChild(p);
    strip.appendChild(page);
    return;
  }

  const tz = bootstrap.meta.timezone;

  for (const day of bootstrap.days) {
    const hasFavoritesForDay = bootstrap.events.some(
      (ev) => ev.day === day && favIds.has(ev.id),
    );
    if (!hasFavoritesForDay) continue;

    const page = document.createElement("section");
    page.className = "day-carousel__page";
    page.dataset.day = day;
    page.setAttribute("aria-label", formatDayHeading(day, tz));

    const headingWrap = document.createElement("div");
    headingWrap.className = "day-carousel__heading-wrap";
    const h2 = document.createElement("h2");
    h2.className = "day-carousel__heading";
    h2.draggable = false;
    h2.textContent = formatDayHeading(day, tz);
    headingWrap.appendChild(h2);
    page.appendChild(headingWrap);

    const roomStrip = document.createElement("div");
    roomStrip.className = "room-strip";
    roomStrip.toggleAttribute("data-room-strip", true);

    let anyColumn = false;
    for (const room of bootstrap.rooms) {
      const list = eventsForRoomDay(bootstrap.events, day, room.id).filter(
        (ev) => favIds.has(ev.id),
      );
      if (list.length === 0) continue;
      anyColumn = true;

      const col = document.createElement("div");
      col.className = "room-column";
      col.dataset.roomColumn = "";
      col.dataset.roomId = room.id;
      col.dataset.day = day;

      const head = document.createElement("div");
      head.className = roomColumnHeadClass(room);
      head.style.background = room.accent;
      head.textContent = room.label;
      col.appendChild(head);

      const body = document.createElement("div");
      body.className = "room-column__body";
      for (const ev of list) {
        const key = `${ev.day}:${ev.startMinutes}`;
        body.appendChild(
          buildFavoriteEventCard(
            ev,
            room,
            bootstrap.tags,
            conflictKeys.has(key),
          ),
        );
      }
      col.appendChild(body);
      roomStrip.appendChild(col);
    }

    if (!anyColumn) {
      const empty = document.createElement("p");
      empty.className = "favorites-empty-day";
      empty.textContent = "No favorites this day.";
      page.appendChild(empty);
    } else {
      page.appendChild(roomStrip);
    }

    strip.appendChild(page);
  }
}

function renderEventMini(
  root: HTMLElement,
  ev: EnrichedEvent,
  room: Room | undefined,
  tags: TagDefinition[],
) {
  const block = document.createElement("div");
  block.className = ev.highlight
    ? "event-card event-card--highlight"
    : "event-card";
  if (ev.highlight && room)
    block.style.setProperty("--room-accent", room.accent);
  const row = document.createElement("div");
  row.className = "event-card__row";
  const time = document.createElement("div");
  time.className = "event-card__time";
  setEventCardTimeContent(time, ev);
  const main = document.createElement("div");
  main.className = "event-card__main";
  const title = document.createElement("h3");
  title.className = "event-card__title";
  title.textContent = ev.title;
  main.appendChild(title);
  if (ev.speakers?.length) {
    const sp = document.createElement("p");
    sp.className = "event-card__speakers";
    if (room?.accent) sp.style.color = room.accent;
    sp.textContent = ev.speakers.join(" · ");
    main.appendChild(sp);
  }
  if (ev.tags.length) {
    const wrap = document.createElement("div");
    wrap.className = "event-card__tags";
    for (const tid of ev.tags) appendTagPill(wrap, tid, tags);
    main.appendChild(wrap);
  }
  row.appendChild(time);
  row.appendChild(main);
  block.appendChild(row);
  root.appendChild(block);
}

function renderToday(bootstrap: ClientBootstrap) {
  const root = document.getElementById("today-root");
  if (!root) return;

  const now = new Date();
  const { ymd, minutes } = getZonedParts(now, bootstrap.meta.timezone);
  const daySet = new Set(bootstrap.days);

  clearEl(root);

  const firstDay = bootstrap.days[0];
  if (!firstDay) {
    const p = document.createElement("p");
    p.className = "off-season";
    p.textContent = "No schedule days configured.";
    root.appendChild(p);
    return;
  }

  /** True calendar “today” is a con day — use live clock. Otherwise preview day 1 from the start of the day. */
  const onConDay = daySet.has(ymd);
  const guideDay = onConDay ? ymd : firstDay;
  const guideMinutes = onConDay ? minutes : -1;

  if (!onConDay) {
    const banner = document.createElement("p");
    banner.className = "today-preview-banner";
    const dateLabel = formatDayWithYear(firstDay, bootstrap.meta.timezone);
    banner.textContent = `No events today, showing the first events for ${dateLabel}.`;
    root.appendChild(banner);
  }

  if (onConDay) {
    const dayLastEnd = lastEventEndMinutesOnDay(bootstrap.events, guideDay);
    if (dayLastEnd !== null && guideMinutes >= dayLastEnd) {
      const p = document.createElement("p");
      p.className = "today-farewell";
      p.textContent = "See you next Fanfest!";
      root.appendChild(p);
      return;
    }
  }

  const strip = document.createElement("div");
  strip.className = "today-strip";

  const tz = bootstrap.meta.timezone;
  const wallUtcCache = new Map<string, number>();
  const wallUtc = (ymd: string, hhmm: string) => {
    const key = `${ymd}|${hhmm}`;
    let ms = wallUtcCache.get(key);
    if (ms === undefined) {
      ms = wallTimeToUtcMs(ymd, hhmm, tz);
      wallUtcCache.set(key, ms);
    }
    return ms;
  };

  const nowMs = now.getTime();
  const used = roomsUsedOnDay(
    bootstrap.events,
    guideDay,
    bootstrap.rooms,
  ).filter((roomId) => {
    const room = roomById(bootstrap.rooms, roomId);
    return room && roomShowsOnToday(room, guideDay, bootstrap, nowMs, wallUtc);
  });
  for (const roomId of used) {
    const room = roomById(bootstrap.rooms, roomId);
    if (!room) continue;
    const list = eventsForRoomDay(bootstrap.events, guideDay, roomId);
    const { primary, primaryIsLive, following } = findPrimaryAndFollowing(
      list,
      guideMinutes,
    );

    const col = document.createElement("div");
    col.className = "today-column";

    const head = document.createElement("div");
    head.className = `room-column__head ${room.headerTextColor === "light" ? "room-column__head--light" : "room-column__head--dark"}`;
    head.style.background = room.accent;
    head.textContent = room.label;
    col.appendChild(head);

    const primaryBlock = document.createElement("div");
    primaryBlock.className = "today-block";
    const primaryLabel = document.createElement("p");
    primaryLabel.className = "today-block__label";
    primaryLabel.textContent = primaryIsLive ? "Now" : "Up next";
    primaryBlock.appendChild(primaryLabel);
    if (primary) renderEventMini(primaryBlock, primary, room, bootstrap.tags);
    else {
      const p = document.createElement("p");
      p.className = "today-empty";
      p.textContent =
        list.length === 0
          ? "Nothing scheduled in this room."
          : "All done here for today.";
      primaryBlock.appendChild(p);
    }
    col.appendChild(primaryBlock);

    const nextBlock = document.createElement("div");
    nextBlock.className = "today-block";
    const nextLabel = document.createElement("p");
    nextLabel.className = "today-block__label";
    nextLabel.textContent = "Next";
    nextBlock.appendChild(nextLabel);
    if (following) renderEventMini(nextBlock, following, room, bootstrap.tags);
    else {
      const p = document.createElement("p");
      p.className = "today-empty";
      p.textContent = "No further sessions in this room today.";
      nextBlock.appendChild(p);
    }
    col.appendChild(nextBlock);

    strip.appendChild(col);
  }

  root.appendChild(strip);
}

export function initScheduleUi(bootstrap: ClientBootstrap) {
  const params = new URLSearchParams(window.location.search);
  const urlDateRaw = params.get("date")?.trim() ?? "";
  const urlLocationRaw = params.get("location")?.trim();
  const urlTagRaw = params.get("tag")?.trim();

  wireNav(bootstrap);
  wireMouseDragHorizontalScroll();
  wireFilterPanel();
  wireFavorites(bootstrap);
  restoreFilterChipsFromLocalStorage();
  if (params.has("location")) applyLocationQueryParam(bootstrap, urlLocationRaw ?? "");
  if (params.has("tag")) applyTagQueryParam(bootstrap, urlTagRaw ?? "");
  wireFilters(bootstrap);
  wireTagDescriptionPopover();
  renderToday(bootstrap);
  renderFavoritesView(bootstrap);

  const tick = () => {
    applyNowHighlights(bootstrap, new Date());
    const todayView = document.getElementById("view-today");
    if (todayView && !todayView.hidden) renderToday(bootstrap);
  };
  window.setInterval(tick, 60_000);
  tick();

  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      if (urlDateRaw && bootstrap.days.includes(urlDateRaw)) {
        scrollScheduleStripToDay(bootstrap, urlDateRaw);
      } else {
        scrollScheduleCarouselToTodayIfNeeded(bootstrap);
      }
    });
  });
}
