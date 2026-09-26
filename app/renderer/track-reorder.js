'use strict';

// Pointer-based sorting: the real items occupy their new slots immediately, while
// FLIP animations bridge the layout change. One transaction per completed drag.
window.PulseTrackReorder = class PulseTrackReorder {
  constructor({ container, scroller, onCommit, onStart = () => {}, onFinish = () => {}, onHover = () => false, onDrop = () => false, isGrid = () => false, constrainGhost = p => p }) {
    Object.assign(this, { container, scroller, onCommit, onStart, onFinish, onHover, onDrop, isGrid, constrainGhost });
    this.drag = null;
    this.suppressUntil = 0;
    this.reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
    this.frame = 0;
    container.addEventListener('pointerdown', event => this.down(event));
    container.addEventListener('pointermove', event => this.move(event));
    container.addEventListener('pointerup', event => this.end(event, true));
    container.addEventListener('pointercancel', event => this.end(event, false));
    container.addEventListener('lostpointercapture', event => { if (this.drag?.id === event.pointerId) this.cancel(); });
    container.addEventListener('dragstart', event => { if (event.target.closest('[data-track-root]')) event.preventDefault(); });
    container.addEventListener('click', event => {
      if (performance.now() < this.suppressUntil) { event.preventDefault(); event.stopImmediatePropagation(); }
    }, true);
    addEventListener('pointerup', event => { if (this.drag && !this.drag.active) this.end(event, false); });
    addEventListener('blur', () => this.cancel());
    addEventListener('resize', () => this.cancel());
    document.addEventListener('keydown', event => {
      if (event.key === 'Escape' && this.drag?.active) {
        event.preventDefault(); event.stopImmediatePropagation(); this.cancel();
      }
    }, true);
  }

  items() { return [...this.container.querySelectorAll('[data-track-root]')]; }
  get active() { return !!this.drag?.active; }

  down(event) {
    if (event.button !== 0 || !event.isPrimary || this.drag) return;
    const node = event.target.closest('[data-track-root]');
    if (!node || event.target.closest('button,input,a,[contenteditable="true"]')) return;
    const rect = node.getBoundingClientRect();
    this.drag = { id: event.pointerId, node, startX: event.clientX, startY: event.clientY,
      x: event.clientX, y: event.clientY, grabX: event.clientX - rect.left, grabY: event.clientY - rect.top,
      width: rect.width, height: rect.height, active: false };
    // A plain click retains existing playback semantics. Capture only when a drag begins.
  }

  move(event) {
    const d = this.drag;
    if (!d || d.id !== event.pointerId) return;
    if (!d.active && Math.hypot(event.clientX - d.startX, event.clientY - d.startY) < 6) return;
    if (!d.active) this.start();
    event.preventDefault();
    d.x = event.clientX; d.y = event.clientY;
    this.positionGhost(); if(!this.onHover(d))this.reorderAtPointer();
  }

  start() {
    const d = this.drag;
    if (!d) return;
    d.active = true;
    d.original = this.items();
    d.before = d.original.map(node => node.dataset.id);
    d.scrollTop = this.scroller.scrollTop;
    d.slots = d.original.map(node => node.getBoundingClientRect());
    this.onStart(d);
    this.container.setPointerCapture(d.id);
    d.ghost = d.node.cloneNode(true);
    d.ghost.removeAttribute('data-track-root');
    d.ghost.removeAttribute('tabindex');
    d.ghost.setAttribute('aria-hidden', 'true');
    d.ghost.classList.add('track-drag-ghost');
    d.ghost.querySelectorAll('[id]').forEach(node => node.removeAttribute('id'));
    Object.assign(d.ghost.style, { width: `${d.width}px`, height: `${d.height}px` });
    document.body.append(d.ghost);
    d.node.classList.add('track-drag-placeholder');
    d.node.setAttribute('aria-grabbed', 'true');
    document.body.classList.add('track-reordering');
    this.positionGhost();
    this.autoScroll();
  }

  positionGhost() {
    const d = this.drag;
    if(d?.ghost){
      const visual=this.constrainGhost({x:d.x-d.grabX,y:d.y-d.grabY,width:d.width,height:d.height},d);
      // Only the visual clone is constrained. Real pointer coordinates stay untouched.
      d.ghost.style.transform=`translate3d(${visual.x}px, ${visual.y}px, 0)`;
    }
  }

  reorderAtPointer() {
    const d = this.drag;
    if (!d?.active) return;
    const x = d.x - d.grabX + d.width / 2;
    const y = d.y - d.grabY + d.height / 2 + this.scroller.scrollTop - d.scrollTop;
    let target = -1, distance = Infinity;
    d.slots.forEach((slot, i) => {
      const dx = this.isGrid() ? (x - slot.left - slot.width / 2) : 0;
      const dy = y - slot.top - slot.height / 2;
      const next = dx * dx + dy * dy * (this.isGrid() ? 2 : 1);
      if (next < distance) { target = i; distance = next; }
    });
    const nodes = this.items();
    const from = nodes.indexOf(d.node);
    if (from < 0 || target === from || target < 0) return;
    const before = new Map(nodes.map(node => [node, node.getBoundingClientRect()]));
    nodes.splice(from, 1); nodes.splice(target, 0, d.node);
    const nextNode = nodes[target + 1];
    if (nextNode) this.container.insertBefore(d.node, nextNode); else this.container.append(d.node);
    for (const node of nodes) {
      node._trackFlip?.cancel();
      if (node === d.node || this.reducedMotion.matches) continue;
      const previous = before.get(node), now = node.getBoundingClientRect();
      const dx = previous.left - now.left, dy = previous.top - now.top;
      if (Math.abs(dx) + Math.abs(dy) > 0.5) node._trackFlip = node.animate([
        { transform: `translate(${dx}px,${dy}px)` }, { transform: 'translate(0,0)' },
      ], { duration: 190, easing: 'cubic-bezier(.2,.8,.2,1)' });
    }
    this.renumber();
  }

  autoScroll() {
    if (!this.drag?.active) return;
    const d = this.drag;
    this.positionGhost();
    if(this.onHover(d)){this.frame=requestAnimationFrame(()=>this.autoScroll());return;}
    const bounds = this.scroller.getBoundingClientRect(), margin = 62;
    const speed = d.y < bounds.top + margin ? -Math.min(17, (bounds.top + margin - d.y) / 4)
      : d.y > bounds.bottom - margin ? Math.min(17, (d.y - bounds.bottom + margin) / 4) : 0;
    if (speed) { this.scroller.scrollTop += speed; this.reorderAtPointer(); }
    this.frame = requestAnimationFrame(() => this.autoScroll());
  }

  renumber() {
    this.items().forEach((node, index) => {
      const counter = node.querySelector('.list-index-number');
      if (counter) counter.textContent = index + 1;
    });
  }

  end(event, commit) {
    const d = this.drag;
    if (!d || (event && event.pointerId !== d.id)) return;
    if(event){d.x=event.clientX;d.y=event.clientY;}
    this.drag = null; // releasePointerCapture emits lostpointercapture; finish exactly once.
    cancelAnimationFrame(this.frame);
    if (d.active) {
      const dropped=commit && this.onDrop(d);
      if (!commit || dropped) for (const node of d.original) this.container.append(node);
      const after = this.items().map(node => node.dataset.id);
      this.suppressUntil = performance.now() + 320;
      d.node.classList.remove('track-drag-placeholder');
      d.node.removeAttribute('aria-grabbed');
      this.items().forEach(node => node._trackFlip?.cancel());
      d.ghost?.remove();
      document.body.classList.remove('track-reordering');
      this.renumber();
      if (commit && !dropped && JSON.stringify(d.before) !== JSON.stringify(after)) this.onCommit(d.before, after);
    }
    try { if (this.container.hasPointerCapture(d.id)) this.container.releasePointerCapture(d.id); } catch {}
    this.onFinish();
  }

  cancel() { this.end(null, false); }
};
