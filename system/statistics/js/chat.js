/* Biri-Go chat.
 *   GET  /api/chat/me | /people?q= | /conversations | /conversations/<id>/messages?before=
 *   POST /api/chat/direct { account_id }  |  /conversations/<id>/read
 *   Socket.IO: emit "send_message" { conversation_id, content }, listen for "new_message"
 * All message text is written with textContent, never innerHTML.
 */
(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const make = (tag, cls, text) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  };

  async function api(url, options = {}) {
    const token = document.querySelector('meta[name="csrf-token"]')?.content || '';
    const res = await fetch(url, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        'X-CSRF-Token': token,
        ...(options.headers || {})
      },
      credentials: 'same-origin'
    });
    if (res.status === 401) { window.location.href = '/'; return new Promise(() => {}); }
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || `Request failed (${res.status})`);
    return body;
  }

  const state = { me: null, convs: [], active: null, oldest: 0 };
  let searchSequence = 0;
  let loadingOlder = false;
  const socket = io({ transports: ['websocket', 'polling'] });
  let wasConnected = false;

  const mobile = () => window.matchMedia('(max-width: 760px)').matches;
  const nearBottom = (box) => box.scrollHeight - box.scrollTop - box.clientHeight < 80;
  const toBottom = () => { const b = $('messages'); b.scrollTop = b.scrollHeight; };

  function fmtTime(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    const t = d.toLocaleTimeString('en-PH', { hour: 'numeric', minute: '2-digit' });
    return d.toDateString() === new Date().toDateString()
      ? t
      : `${d.toLocaleDateString('en-PH', { month: 'short', day: 'numeric' })}, ${t}`;
  }

  function fmtConversationTime(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(today.getDate() - 1);
    if (d.toDateString() === today.toDateString()) {
      return d.toLocaleTimeString('en-PH', { hour: 'numeric', minute: '2-digit' });
    }
    if (d.toDateString() === yesterday.toDateString()) return 'Yesterday';
    return d.toLocaleDateString('en-PH', { month: 'short', day: 'numeric' });
  }

  function conversationInitials(title, type) {
    if (type === 'group') return 'GC';
    // Drop a trailing "(employee id)" so "System Admin (000000)" gives "SA", not "S(".
    const cleanTitle = String(title || '').replace(/\s*\([^)]*\)\s*$/, '');
    const words = cleanTitle.trim().split(/\s+/).filter(Boolean);
    if (!words.length) return '?';
    return (words.length === 1
      ? words[0].slice(0, 2)
      : words[0][0] + words[words.length - 1][0]).toUpperCase();
  }

  // Profile photo when the account has one, otherwise the initials. Falls back to
  // initials if the image fails to load.
  function makeAvatar(className, initials, avatarUrl) {
    const el = make('span', className);
    el.setAttribute('aria-hidden', 'true');
    const showInitials = () => { el.replaceChildren(); el.textContent = initials; el.classList.remove('has-photo'); };
    if (avatarUrl) {
      const img = document.createElement('img');
      img.className = 'avatar-img';
      img.alt = '';
      img.loading = 'lazy';
      img.src = avatarUrl;
      img.addEventListener('error', showInitials);
      el.classList.add('has-photo');
      el.append(img);
    } else {
      el.textContent = initials;
    }
    return el;
  }

  function setStatus(text, isError) {
    const s = $('conn-status');
    s.textContent = text || '';
    s.classList.toggle('is-error', !!isError);
  }

  /* ---------- conversation list ---------- */
  function renderConvs() {
    const ul = $('conv-list');
    ul.replaceChildren();
    if (!state.convs.length) {
      ul.append(make('li', 'empty conv-empty', 'No conversations yet. Search for a co-worker above.'));
      return;
    }

    state.convs.forEach((c) => {
      const active = !!(state.active && state.active.id === c.conversation_id);
      const b = make('button', 'conv' + (active ? ' is-active' : ''));
      b.type = 'button';
      b.setAttribute('aria-pressed', String(active));
      b.title = c.title || 'Conversation';

      const avatar = makeAvatar('conv-avatar' + (c.type === 'group' ? ' conv-avatar-group' : ''),
        conversationInitials(c.title, c.type), c.other && c.other.avatar_url);

      const content = make('span', 'conv-content');
      const top = make('span', 'conv-top');
      top.append(make('strong', 'conv-title', c.title || 'Conversation'));
      // The server prefixes attachment-only previews with an emoji; show plain text instead.
      const previewText = String(c.last_message || '').replace(/^\u{1F4CE}\s*/u, '') || 'No messages yet';
      const preview = make('span', 'conv-last', previewText);
      content.append(top, preview);

      const meta = make('span', 'conv-meta');
      const time = make('time', 'conv-time', fmtConversationTime(c.last_at));
      if (c.last_at) time.dateTime = c.last_at;
      if (time.textContent) meta.append(time);
      if (Number(c.unread) > 0) {
        const unread = make('span', 'badge', c.unread > 99 ? '99+' : String(c.unread));
        unread.setAttribute('aria-label', `${c.unread} unread message${c.unread === 1 ? '' : 's'}`);
        meta.append(unread);
      }
      b.append(avatar, content, meta);
      b.addEventListener('click', () => openConv(c));
      const li = make('li');
      li.append(b);
      ul.append(li);
    });
  }

  async function loadConvs() {
    if (!state.convs.length) {
      $('conv-list').replaceChildren(make('li', 'empty conv-empty', 'Loading conversations…'));
    }
    state.convs = await api('/api/chat/conversations');
    renderConvs();
  }

  /* ---------- messages ---------- */
  function formatBytes(bytes) {
    const n = Number(bytes) || 0;
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
    return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  }

  function bubble(m) {
    const mine = m.sender.account_id === state.me.account_id;
    const row = make('div', 'msg ' + (mine ? 'msg-mine' : 'msg-theirs'));
    row.dataset.id = m.message_id;
    if (!mine && state.active && state.active.type === 'group') {
      const who = make('span', 'msg-name');
      who.append(
        makeAvatar('msg-avatar', conversationInitials(m.sender.name, 'direct'), m.sender.avatar_url),
        make('span', '', m.sender.display_name),
      );
      row.append(who);
    }
    if (m.content) row.append(make('p', 'msg-text', m.content));

    (m.attachments || []).forEach((a) => {
      const card = make('div', 'msg-attachment');
      if (a.is_image) {
        const link = make('a', 'attachment-image-link');
        link.href = a.view_url;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        const img = make('img', 'attachment-image');
        img.src = a.view_url;
        img.alt = a.file_name;
        img.loading = 'lazy';
        link.append(img);
        card.append(link);
      }
      const details = make('div', 'attachment-details');
      const link = make('a', 'attachment-download', a.file_name);
      link.href = a.download_url;
      link.setAttribute('download', '');
      details.append(link, make('small', '', `${formatBytes(a.file_size)} · ${a.mime_type || 'File'}`));
      card.append(details);
      row.append(card);
    });

    row.append(make('time', 'msg-time', fmtTime(m.created_at)));
    return row;
  }

  async function loadMessages() {
    const id = state.active.id;
    const box = $('messages');
    box.replaceChildren(make('p', 'empty', 'Loading...'));
    $('load-older').hidden = true;
    try {
      const r = await api(`/api/chat/conversations/${id}/messages`);
      if (!state.active || state.active.id !== id) return;      // user switched chats meanwhile
      box.replaceChildren();
      state.oldest = r.messages.length ? r.messages[0].message_id : 0;
      r.messages.forEach((m) => box.append(bubble(m)));
      if (!r.messages.length) box.append(make('p', 'empty', 'No messages yet. Say hello.'));
      $('load-older').hidden = !r.has_more;
      toBottom();
    } catch (err) {
      box.replaceChildren(make('p', 'empty', err.message));
    }
  }

  async function loadOlder() {
    if (!state.active || !state.oldest || loadingOlder) return;
    const conversationId = state.active.id;
    const box = $('messages');
    const button = $('load-older');
    const before = box.scrollHeight;
    loadingOlder = true;
    button.disabled = true;
    button.textContent = 'Loading…';
    try {
      const r = await api(`/api/chat/conversations/${conversationId}/messages?before=${state.oldest}`);
      if (!state.active || state.active.id !== conversationId) return;
      const frag = document.createDocumentFragment();
      r.messages.forEach((m) => frag.append(bubble(m)));
      box.prepend(frag);
      box.scrollTop += box.scrollHeight - before;               // keep the view where it was
      if (r.messages.length) state.oldest = r.messages[0].message_id;
      button.hidden = !r.has_more;
    } catch (err) {
      setStatus(err.message, true);
    } finally {
      loadingOlder = false;
      button.disabled = false;
      button.textContent = 'Load older messages';
    }
  }

  async function markRead(id) {
    try {
      await api(`/api/chat/conversations/${id}/read`, { method: 'POST', body: '{}' });
      const c = state.convs.find((x) => x.conversation_id === id);
      if (c) { c.unread = 0; renderConvs(); }
    } catch (_) { /* not critical */ }
  }

  async function openConv(c) {
    state.active = { id: c.conversation_id, type: c.type, title: c.title };
    $('pane-title').textContent = c.title;
    $('composer').hidden = false;
    $('chat').classList.add('chat--open');
    setStatus('');
    renderConvs();
    await loadMessages();
    markRead(c.conversation_id);
    if (!mobile()) $('msg-input').focus();
  }

  /* ---------- sending ---------- */
  function autosize() {
    const t = $('msg-input');
    t.style.height = 'auto';
    t.style.height = Math.min(t.scrollHeight, 120) + 'px';
  }

  async function uploadAttachments(files, content) {
    if (!state.active) return;
    const form = new FormData();
    files.forEach((file) => form.append('files', file));
    if (content) form.append('content', content);

    const token = document.querySelector('meta[name="csrf-token"]')?.content || '';
    const res = await fetch(`/api/chat/conversations/${state.active.id}/attachments`, {
      method: 'POST',
      body: form,
      headers: { 'X-CSRF-Token': token },
      credentials: 'same-origin'
    });
    if (res.status === 401) { window.location.href = '/'; return; }
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || `Upload failed (${res.status})`);
    return body;
  }

  function renderSelectedFiles() {
    const list = $('selected-files');
    list.replaceChildren();
    const files = Array.from($('file-input').files || []);
    if (!files.length) {
      list.hidden = true;
      return;
    }
    files.forEach((file) => {
      list.append(make('span', 'selected-file', `${file.name} (${formatBytes(file.size)})`));
    });
    list.hidden = false;
  }

  $('composer').addEventListener('submit', async (e) => {
    e.preventDefault();
    const input = $('msg-input');
    const text = input.value.trim();
    const files = Array.from($('file-input').files || []);
    if (!text && !files.length) return;
    if (!state.active) return;

    $('send-btn').disabled = true;
    $('attach-btn').disabled = true;

    if (files.length) {
      try {
        setStatus('Uploading attachment(s)...');
        await uploadAttachments(files, text);
        input.value = '';
        $('file-input').value = '';
        renderSelectedFiles();
        autosize();
        setStatus('Attachment(s) sent.');
        await refresh();
        if (!mobile()) input.focus();
      } catch (err) {
        setStatus(err.message, true);
      } finally {
        $('send-btn').disabled = false;
        $('attach-btn').disabled = false;
      }
      return;
    }

    if (!socket.connected) {
      setStatus('Offline. Your message was not sent.', true);
      $('send-btn').disabled = false;
      $('attach-btn').disabled = false;
      return;
    }
    socket.emit('send_message', { conversation_id: state.active.id, content: text }, (ack) => {
      $('send-btn').disabled = false;
      $('attach-btn').disabled = false;
      if (!ack || !ack.ok) { setStatus((ack && ack.error) || 'Message not sent.', true); return; }
      input.value = '';
      autosize();
      setStatus('');
      input.focus();
    });
  });

  $('attach-btn').addEventListener('click', () => $('file-input').click());
  $('file-input').addEventListener('change', renderSelectedFiles);

  $('msg-input').addEventListener('input', autosize);
  $('msg-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); $('composer').requestSubmit(); }
  });

  /* ---------- live updates ---------- */
  async function refresh() {
    try { await loadConvs(); if (state.active) await loadMessages(); } catch (_) { /* retried on next event */ }
  }

  socket.on('connect', () => { setStatus(''); if (wasConnected) refresh(); wasConnected = true; });
  socket.on('disconnect', () => setStatus('Offline. Reconnecting...', true));
  socket.on('connect_error', () => setStatus('Cannot reach chat. Retrying...', true));

  socket.on('new_message', async (m) => {
    if (!state.me) return;
    if (state.active && m.conversation_id === state.active.id) {
      const box = $('messages');
      const stick = nearBottom(box);
      box.querySelector('.empty')?.remove();
      if (!box.querySelector(`[data-id="${m.message_id}"]`)) box.append(bubble(m));
      if (stick) toBottom();
      await markRead(m.conversation_id);
    }
    loadConvs().catch(() => {});      // also picks up a brand-new DM someone just opened with you
  });

  /* ---------- find a co-worker ---------- */
  let searchTimer;
  async function searchPeople() {
    const q = $('people-search').value.trim();
    const ul = $('people-results');
    const sequence = ++searchSequence;
    if (!q) {
      ul.hidden = true;
      $('people-search').setAttribute('aria-expanded', 'false');
      return;
    }

    ul.replaceChildren(make('li', 'empty search-state', 'Searching…'));
    ul.hidden = false;
    $('people-search').setAttribute('aria-expanded', 'true');
    try {
      const people = await api('/api/chat/people?q=' + encodeURIComponent(q));
      // Ignore stale responses when a newer search has already started.
      if (sequence !== searchSequence || $('people-search').value.trim() !== q) return;
      ul.replaceChildren();
      if (!people.length) ul.append(make('li', 'empty search-state', 'No co-worker found.'));
      people.forEach((p) => {
        const b = make('button', 'person');
        b.type = 'button';
        const label = make('span', 'person-label');
        label.append(
          makeAvatar('person-avatar', conversationInitials(p.name, 'direct'), p.avatar_url),
          make('span', '', p.display_name),
        );
        b.append(label, make('small', '', p.role || ''));
        b.addEventListener('click', () => startDirect(p.account_id));
        const li = make('li');
        li.append(b);
        ul.append(li);
      });
    } catch (err) {
      if (sequence === searchSequence) {
        ul.replaceChildren(make('li', 'empty search-state', err.message));
        setStatus(err.message, true);
      }
    }
  }

  async function startDirect(accountId) {
    try {
      const r = await api('/api/chat/direct', { method: 'POST', body: JSON.stringify({ account_id: accountId }) });
      $('people-results').hidden = true;
      $('people-search').setAttribute('aria-expanded', 'false');
      $('people-search').value = '';
      await loadConvs();
      openConv({ conversation_id: r.conversation_id, type: 'direct', title: r.title });
    } catch (err) { setStatus(err.message, true); }
  }

  $('people-search').setAttribute('aria-expanded', 'false');
  $('people-search').addEventListener('input', () => { clearTimeout(searchTimer); searchTimer = setTimeout(searchPeople, 250); });
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.search')) {
      $('people-results').hidden = true;
      $('people-search').setAttribute('aria-expanded', 'false');
    }
  });
  $('load-older').addEventListener('click', loadOlder);
  $('back-to-list').addEventListener('click', () => $('chat').classList.remove('chat--open'));
  window.addEventListener('resize', () => {
    if (!mobile()) $('chat').classList.remove('chat--open');
  });

  /* ---------- start ---------- */
  (async () => {
    try {
      state.me = await api('/api/chat/me');
      await loadConvs();
      const group = state.convs.find((c) => c.type === 'group');
      if (group && !mobile()) openConv(group);      // desktop opens the company chat; phones start on the list
    } catch (err) {
      $('messages').replaceChildren(make('p', 'empty', err.message));
    }
  })();
})();