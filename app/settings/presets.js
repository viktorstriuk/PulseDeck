'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {JsonSettingsStore,writeFileDurable}=require('../settings-store'),M=require('../shared/presets'),I=require('../i18n');
/** The journal contains ONLY schema-whitelisted settings. Interrupted applies
 * restore the complete previous selection before windows open on next launch. */
class PresetStore {
  constructor({directory,read,readExternal,write,writeExternal,validate=async()=>{},effects=async()=>{},beforeRead=()=>{}}){
    Object.assign(this,{read,readExternal,write,writeExternal,validate,effects,beforeRead});
    this.store=new JsonSettingsStore({file:path.join(directory,'presets.json'),normalize:M.normalize});
    this.journal=path.join(directory,'preset-apply.json');this.active=false;
  }
  list(){return this.store.get().presets.map(p=>({...p}));}
  async save({id,name,sections}){
    await this.beforeRead();if(this.active)throw I.error('PresetsBusy');
    const list=this.list(),old=id?list.find(p=>p.id===id):null;
    if(id&&!old)throw I.error('PresetsMissing');
    if(!old&&list.length>=100)throw I.error('PresetsLimit');
    const p=M.cleanPreset({id:old?.id||crypto.randomUUID(),name,createdAt:old?.createdAt||Date.now(),updatedAt:Date.now(),...M.capture(this.read(),this.readExternal(),sections)});
    if(!p)throw I.error('PresetsInvalid');
    this.store.set({presets:[...list.filter(x=>x.id!==p.id),p]});return this.list();
  }
  rename({id,name}){
    if(this.active)throw I.error('PresetsBusy');const list=this.list(),old=list.find(p=>p.id===id);if(!old)throw I.error('PresetsMissing');
    const next=M.cleanPreset({...old,name,updatedAt:Date.now()});if(!next)throw I.error('PresetsInvalid');this.store.set({presets:list.map(p=>p.id===id?next:p)});return this.list();
  }
  remove(id){if(this.active)throw I.error('PresetsBusy');const list=this.list();if(!list.some(p=>p.id===id))throw I.error('PresetsMissing');this.store.set({presets:list.filter(p=>p.id!==id)});return this.list();}
  async recover(){
    if(!fs.existsSync(this.journal))return false;
    if(fs.statSync(this.journal).size>4*1024*1024)throw I.error('PresetsRecoveryFailed');
    const j=JSON.parse(fs.readFileSync(this.journal,'utf8'));if(j.schema!==1||!j.before)throw I.error('PresetsRecoveryFailed');
    const before=M.capture(j.before.settings||{},j.before.external||{},j.before.sections);
    await this.writeExternal(before.external);await this.write(before.settings);fs.unlinkSync(this.journal);return true;
  }
  async apply(id){
    if(this.active)throw I.error('PresetsBusy');
    const selected=this.list().find(p=>p.id===id);if(!selected)throw I.error('PresetsMissing');
    this.active=true;let before,journaled=false;
    try{
      await this.beforeRead();await this.validate(selected);
      before=M.capture(this.read(),this.readExternal(),selected.sections);
      writeFileDurable(this.journal,JSON.stringify({schema:1,before})+'\n');journaled=true;
      await this.writeExternal(selected.external);const settings=await this.write(selected.settings);
      const warnings=await this.effects(selected.settings,settings)||[];
      fs.unlinkSync(this.journal);return {settings:this.read(),warnings};
    }catch(error){
      if(journaled){try{await this.writeExternal(before.external);const settings=await this.write(before.settings);await this.effects(before.settings,settings);fs.unlinkSync(this.journal);}catch(rollback){error=I.error('PresetsRecoveryFailed');error.cause=rollback;}}
      throw error;
    }finally{this.active=false;}
  }
}
module.exports={PresetStore};
