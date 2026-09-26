'use strict';

// FLIP animates neighbours only, never supplies coordinates for hit testing.
// In 2.6.2 the dragged tab's CSS scale was repeatedly mixed with a translate
// animation, even when no slot changed. This accumulated lateral drift.
window.PulsePlaylistReorder = class PulsePlaylistReorder {
  constructor({ container, axis, onPress, onStart, onCommit, onFinish }) {
    Object.assign(this, { container, axis, onPress, onStart, onCommit, onFinish });
    this.pointer = null; this.frame = 0; this.timer = 0; this.suppressUntil = 0;
    this.reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
    container.addEventListener('pointerdown', e => this.down(e));
    container.addEventListener('pointermove', e => this.move(e));
    container.addEventListener('pointerup', e => this.end(e, true));
    container.addEventListener('pointercancel', e => this.end(e, false));
    container.addEventListener('lostpointercapture', e => this.end(e, false));
    container.addEventListener('dragstart', e => { if (e.target.closest('[data-category]')) e.preventDefault(); });
    container.addEventListener('click', e => {
      if (performance.now() < this.suppressUntil) { e.preventDefault(); e.stopImmediatePropagation(); }
    }, true);
    addEventListener('pointerup', e => { if (this.pointer && !this.pointer.active) this.end(e, false); });
    addEventListener('blur', () => this.end(null, false));
    addEventListener('resize', () => this.end(null, false));
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape' && this.pointer) { e.preventDefault(); e.stopImmediatePropagation(); this.end(null, false); }
    }, true);
  }
  items() { return [...this.container.querySelectorAll('[data-category]')]; }
  down(e) {
    if (e.button !== 0 || !e.isPrimary || this.pointer) return;
    const tab = e.target.closest('[data-category]');
    if (!tab || !this.container.contains(tab)) return;
    const r = tab.getBoundingClientRect();
    this.pointer = { id:e.pointerId, tab, startX:e.clientX, startY:e.clientY, x:e.clientX, y:e.clientY,
      original:this.items(), active:false, axis:this.axis(), grabX:e.clientX-r.left, grabY:e.clientY-r.top, rect:r };
    this.onPress();
    if (e.target.closest('[data-category-drag]')) this.start();
    // Hold is reserved for multi-selection; a quick movement still reorders.
  }
  start() {
    const p = this.pointer;
    if (!p || p.active) return;
    clearTimeout(this.timer); p.active = true;
    this.onStart(p.tab.dataset.category);
    this.items().forEach(el => el._playlistFlip?.cancel());
    this.container.classList.add('category-reordering');
    p.tab.classList.add('dragging-category');
    const r = p.tab.getBoundingClientRect(), css = getComputedStyle(p.tab);
    p.rect = r;
    p.ghost = p.tab.cloneNode(true);
    p.ghost.removeAttribute('data-category'); p.ghost.removeAttribute('id');
    p.ghost.removeAttribute('role'); p.ghost.removeAttribute('aria-selected');
    p.ghost.classList.remove('dragging-category'); p.ghost.classList.add('playlist-drag-ghost'); p.ghost.classList.toggle('playlist-drag-horizontal',p.axis==='x');
    p.ghost.classList.toggle('playlist-drag-from-sidebar',this.container.id==='categorySidebar');
    p.ghost.setAttribute('aria-hidden','true'); p.ghost.tabIndex = -1;
    Object.assign(p.ghost.style, {width:`${r.width}px`, height:`${r.height}px`, padding:css.padding, display:'flex', alignItems:'center', gap:css.gap});
    document.body.append(p.ghost);
    try { this.container.setPointerCapture(p.id); } catch {}
    this.positionGhost(); this.autoScroll();
  }
  move(e) {
    const p = this.pointer;
    if (!p || p.id !== e.pointerId) return;
    p.x = e.clientX; p.y = e.clientY;
    if (!p.active && Math.hypot(p.x-p.startX,p.y-p.startY) < 6) return;
    if (!p.active) this.start();
    e.preventDefault(); this.positionGhost(); this.reorder();
  }
  positionGhost() {
    const p = this.pointer;
    if (!p?.ghost) return;
    const rail = this.container.getBoundingClientRect();
    // A rail is one-dimensional: the copy cannot escape sideways/upwards.
    const clamp = (v,a,b) => Math.max(a,Math.min(Math.max(a,b),v));
    const x = p.axis === 'y' ? p.rect.left : clamp(p.x-p.grabX,rail.left,rail.right-p.rect.width);
    const y = p.axis === 'x' ? p.rect.top : clamp(p.y-p.grabY,rail.top,rail.bottom-p.rect.height);
    p.ghost.style.transform = `translate3d(${x}px,${y}px,0)`;
  }
  layoutRect(el) {
    const r = el.getBoundingClientRect();
    // During reorder CSS scale/hover transforms are suppressed. Only a FLIP
    // translation may remain; subtract it without restarting the animation.
    const matrix = new DOMMatrixReadOnly(getComputedStyle(el).transform);
    return {left:r.left-matrix.m41,top:r.top-matrix.m42,width:r.width,height:r.height};
  }
  reorder() {
    const p = this.pointer;
    if (!p?.active) return;
    const nodes = this.items(), rest = nodes.filter(el => el !== p.tab);
    const horizontal = p.axis === 'x', coordinate = horizontal ? p.x : p.y;
    const target = rest.find(el => { const r = this.layoutRect(el); return coordinate < (horizontal ? r.left+r.width/2 : r.top+r.height/2); });
    const from = nodes.indexOf(p.tab), to = target ? rest.indexOf(target) : rest.length;
    if (from === to) return; // No slot change: do NOT restart FLIP or remeasure a scaled box.
    const before = new Map(nodes.map(el => [el,el.getBoundingClientRect()]));
    nodes.forEach(el => el._playlistFlip?.cancel());
    this.container.insertBefore(p.tab,target || this.container.querySelector('[data-add-category]'));
    if (!this.reducedMotion.matches) for (const el of rest) {
      const old = before.get(el), now = el.getBoundingClientRect();
      const dx = horizontal ? old.left-now.left : 0, dy = horizontal ? 0 : old.top-now.top;
      if (Math.abs(dx)+Math.abs(dy) > .5) el._playlistFlip = el.animate([
        {transform:`translate(${dx}px,${dy}px)`}, {transform:'translate(0,0)'},
      ], {duration:190,easing:'cubic-bezier(.2,.8,.2,1)'});
    }
  }
  autoScroll() {
    const p = this.pointer;
    if (!p?.active) return;
    const r = this.container.getBoundingClientRect(), horizontal = p.axis === 'x';
    const coord = horizontal ? p.x : p.y, low = horizontal ? r.left : r.top, high = horizontal ? r.right : r.bottom;
    const margin = Math.min(44,(high-low)/4);
    const speed = coord < low+margin ? -Math.min(14,(low+margin-coord)/4)
      : coord > high-margin ? Math.min(14,(coord-high+margin)/4) : 0;
    if (speed) { if (horizontal) this.container.scrollLeft += speed; else this.container.scrollTop += speed; this.reorder(); }
    this.positionGhost(); this.frame = requestAnimationFrame(() => this.autoScroll());
  }
  end(e, commit) {
    const p = this.pointer;
    if (!p || (e && e.pointerId !== p.id)) return;
    this.pointer = null; clearTimeout(this.timer); cancelAnimationFrame(this.frame);
    if (p.active) {
      if (!commit) { const plus = this.container.querySelector('[data-add-category]'); for (const node of p.original) this.container.insertBefore(node,plus); }
      p.ghost?.remove(); p.tab.classList.remove('dragging-category'); this.container.classList.remove('category-reordering');
      this.items().forEach(el => el._playlistFlip?.cancel()); this.suppressUntil = performance.now()+360;
      const before = p.original.map(el => el.dataset.category), after = this.items().map(el => el.dataset.category);
      if (commit && JSON.stringify(before) !== JSON.stringify(after)) this.onCommit(after);
    }
    try { if (this.container.hasPointerCapture(p.id)) this.container.releasePointerCapture(p.id); } catch {}
    this.onFinish(p.active);
  }
};
