'use strict';
// Select-only combobox: selection is committed by click, Enter/Space/Tab, not by arrows.
// Catalog names use textContent; icons arrive as validated image URLs from the main process.
window.SetupLanguagePicker=class {
  constructor({languages,value,label,onChange}){
    this.root=document.querySelector('#languageSwitch');this.trigger=document.querySelector('#languageTrigger');
    this.list=document.querySelector('#languageList');this.flag=document.querySelector('#languageFlag');this.code=document.querySelector('#languageCode');
    this.languages=languages;this.value=value;this.label=label;this.onChange=onChange;this.active=0;this.opened=false;this.disabled=false;this.typeahead='';this.typedAt=0;
    this.options=languages.map((language,index)=>{
      const item=document.createElement('button');item.type='button';item.id='setup-language-'+index;item.tabIndex=-1;item.setAttribute('role','option');item.dataset.language=language.code;item.lang=language.locale||language.code;
      const flag=this.image(language),name=document.createElement('span'),code=document.createElement('small');name.textContent=language.name;code.textContent=language.code.toUpperCase();item.append(flag,name,code);
      item.addEventListener('mousedown',e=>e.preventDefault());item.addEventListener('click',()=>{if(!this.disabled){this.active=index;this.commit();this.close();this.trigger.focus();}});
      return item;
    });this.list.replaceChildren(...this.options);this.setValue(value,label);
    this.trigger.addEventListener('click',()=>{if(!this.disabled)this.opened?this.close():this.open();});
    this.trigger.addEventListener('keydown',e=>this.key(e));
    document.addEventListener('pointerdown',e=>{if(!this.root.contains(e.target))this.close();});
    this.trigger.addEventListener('blur',()=>this.close());
  }
  image(language){
    const host=document.createElement('span');host.className='language-flag';host.setAttribute('aria-hidden','true');
    if(language.iconUrl){try{const u=new URL(language.iconUrl,document.baseURI);if(['file:','http:','https:'].includes(u.protocol)){
      const img=document.createElement('img');img.alt='';img.src=u.href;img.draggable=false;img.addEventListener('error',()=>{const parent=img.parentElement;img.remove();parent?.classList.add('missing-flag');});host.append(img);
    }}catch{}}
    if(!host.children.length)host.classList.add('missing-flag');return host;
  }
  setValue(value,label=this.label){
    this.value=value;this.label=label;const selected=this.languages.find(l=>l.code===value)||this.languages[0];if(!selected)return;
    this.flag.replaceChildren(...this.image(selected).childNodes);this.flag.classList.toggle('missing-flag',!this.flag.children.length);this.code.textContent=selected.code.toUpperCase();
    this.trigger.setAttribute('aria-label',label+': '+selected.name);this.list.setAttribute('aria-label',label);
    if(!this.opened)this.active=Math.max(0,this.languages.indexOf(selected));this.paint();
  }
  paint(){this.options.forEach((item,index)=>{item.classList.toggle('active',this.opened&&index===this.active);item.setAttribute('aria-selected',String(this.opened?index===this.active:item.dataset.language===this.value));});
    if(this.opened){this.trigger.setAttribute('aria-activedescendant',this.options[this.active]?.id||'');this.options[this.active]?.scrollIntoView({block:'nearest'});}else this.trigger.removeAttribute('aria-activedescendant');
  }
  open(){if(this.disabled||!this.options.length)return;this.opened=true;this.active=Math.max(0,this.languages.findIndex(l=>l.code===this.value));this.list.hidden=false;this.trigger.setAttribute('aria-expanded','true');this.paint();}
  close(){this.opened=false;this.list.hidden=true;this.trigger.setAttribute('aria-expanded','false');this.paint();}
  commit(){const selected=this.languages[this.active];if(selected&&selected.code!==this.value){this.value=selected.code;this.onChange(selected.code);}}
  setDisabled(disabled){this.disabled=!!disabled;if(disabled)this.close();this.trigger.disabled=!!disabled;this.options.forEach(n=>n.disabled=!!disabled);this.root.setAttribute('aria-disabled',String(!!disabled));}
  key(e){
    if(this.disabled)return;
    if(e.key==='Tab'){if(this.opened){this.commit();this.close();}return;}
    if(e.key==='Escape'){if(this.opened){e.preventDefault();e.stopPropagation();this.close();}return;}
    if(e.key==='Enter'||e.key===' '){e.preventDefault();if(this.opened){this.commit();this.close();}else this.open();return;}
    if(['ArrowDown','ArrowUp','Home','End','PageDown','PageUp'].includes(e.key)){
      e.preventDefault();const wasOpen=this.opened;if(!wasOpen)this.open();
      if(e.key==='Home')this.active=0;else if(e.key==='End')this.active=this.options.length-1;
      else if(wasOpen){const delta=e.key==='ArrowUp'?-1:e.key==='PageUp'?-10:e.key==='PageDown'?10:1;this.active=Math.max(0,Math.min(this.options.length-1,this.active+delta));}
      this.paint();return;
    }
    if(e.key.length===1&&!e.ctrlKey&&!e.metaKey&&!e.altKey){e.preventDefault();if(!this.opened)this.open();const now=Date.now();this.typeahead=now-this.typedAt>700?e.key:this.typeahead+e.key;this.typedAt=now;
      const query=this.typeahead.toLocaleLowerCase();let i=this.languages.findIndex(l=>l.name.toLocaleLowerCase().startsWith(query)||l.code.toLowerCase().startsWith(query));
      if(i<0&&new Set(query).size===1){for(let step=1;step<=this.languages.length;step++){const n=(this.active+step)%this.languages.length,l=this.languages[n];if(l.name.toLocaleLowerCase().startsWith(query[0])||l.code.toLowerCase().startsWith(query[0])){i=n;break;}}}
      if(i>=0){this.active=i;this.paint();}
    }
  }
};
