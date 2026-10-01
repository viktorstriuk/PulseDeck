/* Reconcile only owned navigation markup. No HTML received from remote services.
 * Reuses keyed buttons AND their SVG/text nodes on ordinary selection changes. */
(() => {
  'use strict';
  const keys = ['data-category','data-folder-open','data-folder-back','data-add-folder',
    'data-add-category','data-restore-category','data-category-drag'];
  const key = n => {
    if(n.nodeType!==1)return null;
    for(const attr of keys)if(n.hasAttribute(attr))return n.tagName+':'+attr+':'+n.getAttribute(attr);
    return null;
  };
  function sync(current, next) {
    if(current.nodeType!==next.nodeType || current.nodeName!==next.nodeName){current.replaceWith(next);return next;}
    if(current.nodeType!==1){if(current.nodeValue!==next.nodeValue)current.nodeValue=next.nodeValue;return current;}
    // Preserve selection controller's transient classes while refreshing owned classes.
    const transient=[...current.classList].filter(c=>['selected','selection-anchor','dragging','drag-over'].includes(c));
    for(const a of [...current.attributes])if(!next.hasAttribute(a.name)&&!a.name.startsWith('data-selection'))current.removeAttribute(a.name);
    for(const a of next.attributes)if(current.getAttribute(a.name)!==a.value)current.setAttribute(a.name,a.value);
    for(const c of transient)current.classList.add(c);
    children(current,[...next.childNodes]);return current;
  }
  function children(parent, incoming) {
    const old=[...parent.childNodes], keyed=new Map(old.map(n=>[key(n),n]).filter(([k])=>k!==null)), used=new Set();
    let cursor=parent.firstChild;
    for(let index=0;index<incoming.length;index++){
      const next=incoming[index], id=key(next);
      let node=id!==null?keyed.get(id):old[index];
      if(node && (used.has(node)||key(node)!==id||node.nodeName!==next.nodeName))node=null;
      if(node){used.add(node);node=sync(node,next);}else node=next;
      if(node!==cursor)parent.insertBefore(node,cursor);
      cursor=node.nextSibling;
    }
    for(const node of old)if(!used.has(node)&&node.parentNode===parent)node.remove();
  }
  function patch(parent,markup) {
    const template=document.createElement('template');template.innerHTML=markup;
    children(parent,[...template.content.childNodes]);
  }
  window.PulseKeyedDOM={patch};
})();
