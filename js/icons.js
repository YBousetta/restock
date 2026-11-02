const s = (d, extra = '') =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" ${extra}>${d}</svg>`;

export const icons = {
  list: s('<path d="M9 6h11M9 12h11M9 18h11"/><circle cx="4.5" cy="6" r="1.2" fill="currentColor"/><circle cx="4.5" cy="12" r="1.2" fill="currentColor"/><circle cx="4.5" cy="18" r="1.2" fill="currentColor"/>'),
  items: s('<path d="M3.5 9.5h17l-1.6 9.1a2 2 0 0 1-2 1.6H7.1a2 2 0 0 1-2-1.6z"/><path d="M8 9.5l3-6M16 9.5l-3-6"/><path d="M9 13.5v3M12 13.5v3M15 13.5v3"/>'),
  viewList: s('<rect x="3.5" y="4" width="17" height="6" rx="1.5"/><rect x="3.5" y="14" width="17" height="6" rx="1.5"/>'),
  viewGrid: s('<rect x="3.5" y="3.5" width="7" height="7" rx="1.5"/><rect x="13.5" y="3.5" width="7" height="7" rx="1.5"/><rect x="3.5" y="13.5" width="7" height="7" rx="1.5"/><rect x="13.5" y="13.5" width="7" height="7" rx="1.5"/>'),
  viewCompact: s('<path d="M4 5h16M4 9.7h16M4 14.3h16M4 19h16"/>'),
  meals: s('<path d="M7 3v8M4.5 3v5a2.5 2.5 0 0 0 5 0V3M7 11v10"/><path d="M17 21V3c-2.2 1.2-3.5 4-3.5 7.5V13H17"/>'),
  gear: s('<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>'),
  plus: s('<path d="M12 5v14M5 12h14"/>'),
  plusCircle: s('<circle cx="12" cy="12" r="9.5"/><path d="M12 8v8M8 12h8"/>', 'stroke-width="1.6"'),
  checkCircle: s('<circle cx="12" cy="12" r="10" fill="currentColor" stroke="none"/><path d="M7.5 12.5l3 3 6-6.5" stroke="#000" stroke-width="2.2"/>'),
  check: s('<path d="M5 12.5l4.5 4.5L19 7.5"/>', 'stroke-width="3" style="color:#000"'),
  chevron: s('<path d="M9 5l7 7-7 7"/>', 'stroke-width="2.5"'),
  up: s('<path d="M6 15l6-6 6 6"/>'),
  down: s('<path d="M6 9l6 6 6-6"/>'),
  search: s('<circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/>'),
  sync: s('<path d="M20 11a8 8 0 0 0-14.3-4.9L4 8M4 4v4h4M4 13a8 8 0 0 0 14.3 4.9L20 16M20 20v-4h-4"/>'),
  share: s('<path d="M12 3v12M8 7l4-4 4 4"/><path d="M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7"/>'),
};
