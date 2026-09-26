'use strict';
// Shared translation engine. No UI language, filesystem access, HTML evaluation,
// source-language fallback, or dependency on the user's song/playlist data.
(function(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.PulseI18nCore = api;
})(typeof globalThis === 'object' ? globalThis : this, () => {
  const own = (o, k) => Object.prototype.hasOwnProperty.call(o || {}, k);
  const record = o => o && typeof o === 'object' && !Array.isArray(o);
  const cleanKey = key => String(key ?? '').trim().replace(/^[\s'"`]+|[\s'"`]+$/g, '');
  const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const ERROR_MARKER = 'PULSE_I18N_ERROR:';
  function safeLocale(locale) {
    try { return Intl.getCanonicalLocales(String(locale || 'en'))[0] || 'en'; }
    catch { return 'en'; }
  }
  class Engine {
    constructor(snapshot = {}) { this.install(snapshot); }
    install(snapshot = {}) {
      this.language = typeof snapshot.language === 'string' ? snapshot.language : 'en';
      this.catalogs = record(snapshot.catalogs) ? snapshot.catalogs : {};
      this.languages = Array.isArray(snapshot.languages) ? snapshot.languages : [];
      this.diagnostics = Array.isArray(snapshot.diagnostics) ? snapshot.diagnostics : [];
      this.locale = safeLocale(this.catalogs[this.language]?.meta?.locale || this.language);
      this.directory = String(snapshot.directory || '');
      return this;
    }
    snapshot() { return {language:this.language, catalogs:this.catalogs, languages:this.languages, diagnostics:this.diagnostics, directory:this.directory}; }
    setLanguage(code) { this.language = String(code || 'en'); this.locale = safeLocale(this.catalogs[this.language]?.meta?.locale || this.language); return this; }
    value(catalog, key, params) {
      const messages = catalog?.messages;
      if (!record(messages) || !own(messages, key)) return undefined;
      const value = messages[key];
      if (typeof value === 'string' && value.trim()) return value;
      if (record(value) && own(params, 'count')) {
        const count = Number(params.count);
        if (!Number.isFinite(count)) return undefined;
        const locale = safeLocale(catalog.meta?.locale || catalog.meta?.code || 'en');
        let form; try { form = new Intl.PluralRules(locale).select(count); } catch { form = 'other'; }
        const choice = own(value, form) ? value[form] : value.other;
        if (typeof choice === 'string' && choice.trim()) return choice;
      }
      return undefined;
    }
    catalog(code) { return own(this.catalogs,code) ? this.catalogs[code] : undefined; }
    t(key, params = {}, depth = 0) {
      if (depth > 12) return '';
      key = cleanKey(key); params = record(params) ? params : {};
      // Exact requested language -> en.json -> cleaned key. Nothing else.
      const text = this.value(this.catalog(this.language), key, params)
        ?? this.value(this.catalog('en'), key, params) ?? key;
      const result = text.replace(/\{([A-Za-z][\w]*)\}/g, (token, name) => own(params, name) ? this.param(params[name], depth + 1) : token);
      this.recentTranslations ||= new Map();
      this.recentTranslations.set(result, {key, params});
      if (this.recentTranslations.size > 4096) this.recentTranslations.delete(this.recentTranslations.keys().next().value);
      return result;
    }
    capture(value) { const p=this.recentTranslations?.get(String(value)); return p ? this.msg(p.key,p.params) : value; }
    msg(key, params = {}) { return {__pulseTranslation:true,key:cleanKey(key),params}; }
    param(value, depth=0) {
      if(depth>12)return '';
      if(record(value) && value.__pulseTranslation === true && typeof value.key === 'string') return this.t(value.key,value.params,depth + 1);
      return String(value ?? '');
    }
    h(key, params) { return escape(this.t(key, params)); }
    attrArgs(params) { return escape(JSON.stringify(params || {})); }
    number(value, options = {}) { return new Intl.NumberFormat(this.locale, options).format(value); }
    keyForText(text) {
      if (typeof text !== 'string') return '';
      if (Object.hasOwn(this.catalogs[this.language]?.messages || {}, text) || Object.hasOwn(this.catalogs.en?.messages || {}, text)) return text;
      for (const catalog of Object.values(this.catalogs)) for (const [key, value] of Object.entries(catalog.messages || {})) if (typeof value === 'string' && value === text) return key;
      return '';
    }
    error(key, params = {}) {
      const error = new Error(this.t(key, params));
      error.i18nKey = cleanKey(key); error.i18nParams = params;
      return error;
    }
    errorPacket(error) {
      if (error?.i18nKey) return {key:cleanKey(error.i18nKey), params:record(error.i18nParams) ? error.i18nParams : {}};
      const message = String(error?.message ?? error ?? '');
      const at = message.indexOf(ERROR_MARKER);
      if (at >= 0) {
        try { const packet = JSON.parse(message.slice(at + ERROR_MARKER.length)); if (typeof packet.key === 'string') return {key:packet.key,params:record(packet.params)?packet.params:{}}; } catch {}
      }
      const known = this.keyForText(message); if (known) return {key:known,params:{}};
      return {key:'ErrorDetails', params:{detail:message.replace(/^Error invoking remote method ['"][^'"]+['"]:\s*(?:Error:\s*)?/, '')}};
    }
    encodeError(error) { return ERROR_MARKER + JSON.stringify(this.errorPacket(error)); }
    fromErrorPacket(packet) { return this.error(packet?.key || 'UnexpectedError', record(packet?.params) ? packet.params : {}); }
    errorMessage(error) { const p = this.errorPacket(error); return this.t(p.key, p.params); }
  }
  return {Engine, escape, cleanKey, safeLocale, ERROR_MARKER};
});
