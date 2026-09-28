// Local checkpoints contain fingerprints, not a second copy of conversation text.
const CaptureState = {
  key: 'capture_checkpoints_v1',
  async hash(text) {
    const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
    return Array.from(new Uint8Array(bytes), b => b.toString(16).padStart(2, '0')).join('');
  },
  async prepare(url, messages, scope = '') {
    const source = new URL(url); source.hash = '';
    const key = await this.hash(source.href+(scope?'\n'+scope:''));
    const stored = (await chrome.storage.local.get(this.key))[this.key] || {};
    const hashes = await Promise.all(messages.map(m => this.hash(JSON.stringify([m.role, m.content.replace(/\r\n/g, '\n').trim()]))));
    const previous = stored[key]?.hashes || [];
    let first = 0;
    // A virtualized page may expose a contiguous subset of a previously saved chat.
    // Only use an unambiguous overlap; ambiguity means reprocess, never drop text.
    const offsets = previous.flatMap((hash, i) => hash === hashes[0] ? [i] : []);
    if (offsets.length === 1) {
      const offset = offsets[0];
      while (first < hashes.length && hashes[first] === previous[offset + first]) first++;
    }
    const changed = first;
    if (first < messages.length) {
      // Always include the question for a changed/regenerated answer.
      while (first > 0 && messages[first]?.role !== 'user') first--;
    }
    const start = Math.max(0, first - 4);
    const conversation = messages.slice(start).map((m, i) => ({...m, context_only: start + i < first}));
    return {unchanged: changed === hashes.length, first, conversation, key, hashes, stored};
  },
  update(state) {
    const stored = {...state.stored, [state.key]: {hashes: state.hashes, at: Date.now()}};
    const entries = Object.entries(stored).sort((a,b) => b[1].at - a[1].at);
    // Bound local metadata. Eviction only causes reprocessing, never lost notes.
    return {[this.key]: Object.fromEntries(entries.slice(0, 100))};
  },
  brief(messages) {
    return messages.map(m => m.role === 'user'
      ? {role: 'user', question: m.content, context_only: !!m.context_only}
      : {role: 'assistant', headings: (m.headings || []).slice(0, 24), headings_missing: !m.headings?.length, context_only: !!m.context_only});
  }
};
