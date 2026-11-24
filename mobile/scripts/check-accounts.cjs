/* Real client store/sync modules with an in-memory API; no Metro or HTTP sockets. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const ts = require('typescript');
const root = path.resolve(__dirname, '../src');
const cache = new Map(), disk = new Map(), remote = new Map();
const A = '00000000-0000-4000-8000-000000000001', B = '00000000-0000-4000-8000-000000000002';
let counter = 100, user = A, offline = false, gate = null, readGate = null, started = null;
const uuid = () => `00000000-0000-4000-8000-${String(counter++).padStart(12,'0')}`;
const clone = x => JSON.parse(JSON.stringify(x));
const empty = () => ({version:3,conversations:[],activeId:null,newDraft:'',settings:{apiUrl:'',theme:'system'}});
const data = (title, id=uuid()) => { const d=empty(); d.activeId=id; d.conversations=[{id,title,createdAt:'2026-11-24T10:00:00Z',updatedAt:'2026-11-24T10:00:00Z',draft:'',messages:[]}];return d; };
const guest=data('Guest history'); disk.set('@legalintel/chats/v3',JSON.stringify(guest));
class AccountHTTPError extends Error { constructor(message,status,code){super(message);this.status=status;this.code=code;} }
const storage={getItem:async key=>disk.get(key)??null,setItem:async(key,value)=>{disk.set(key,value);},removeItem:async key=>{disk.delete(key);},multiRemove:async keys=>keys.forEach(k=>disk.delete(k))};
async function request(_path,payload){
  if(offline)throw new Error('Offline fixture');
  const owner=user;
  if(!payload){
    const captured=clone(remote.get(owner)??{revision:0,state:null,updated_at:null});
    if(readGate){const wait=readGate;readGate=null;started?.();await wait;}
    return captured;
  }
  const captured=clone(payload);
  if(gate){const wait=gate;gate=null;started?.();await wait;}
  const current=remote.get(owner)??{revision:0};
  if(captured.base_revision!==current.revision)throw new AccountHTTPError('Conflict',409,'sync_conflict');
  const result={revision:current.revision+1,state:captured.state,updated_at:'2026-11-24T10:00:00Z'};
  remote.set(owner,result);return {revision:result.revision,updated_at:result.updated_at};
}
function load(file){
  if(cache.has(file))return cache.get(file).exports;
  const module={exports:{}};cache.set(file,module);
  const source=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText;
  const req=name=>{
    if(name==='react')return {useSyncExternalStore:()=>undefined};
    if(name==='@react-native-async-storage/async-storage')return storage;
    if(name==='expo-crypto')return {randomUUID:uuid,CryptoDigestAlgorithm:{SHA256:'sha256'},digestStringAsync:async(_a,v)=>crypto.createHash('sha256').update(v).digest('hex')};
    if(name==='@/services/session')return {AccountHTTPError,accountRequest:request};
    if(name==='@/services/api')return {defaultApiUrl:()=>''};
    const resolved=name.startsWith('@/')?path.join(root,name.slice(2)):path.resolve(path.dirname(file),name);
    return load(resolved+'.ts');
  };
  vm.runInNewContext(source,{require:req,module,exports:module.exports,Date,JSON,Map,Set,Promise,AbortController,console,setTimeout,clearTimeout},{filename:file});
  return module.exports;
}
(async()=>{
  const store=load(path.join(root,'state/chatStore.ts')).chatStore;
  const sync=load(path.join(root,'state/accountSync.ts')).accountSync;
  const helpers=load(path.join(root,'domain/account.ts'));
  await store.bindAccount(A);
  assert.equal(store.getSnapshot().data.conversations.length,0,'guest history must not leak into an account');
  const a=data('Alice private');await store.replaceAccountData(A,a);await sync.start(A);
  assert.equal(sync.getSnapshot().status,'saved');
  assert.equal(remote.get(A).state.conversations[0].title,'Alice private');
  sync.stop();await store.bindAccount(B);user=B;
  assert.equal(store.getSnapshot().data.conversations.length,0,'Bob must not see Alice cache');
  await sync.start(B);assert.equal(remote.get(B).state.conversations.length,0);
  sync.stop();user=A;await store.bindAccount(A);await sync.start(A);
  assert.equal(store.getSnapshot().data.conversations[0].title,'Alice private');
  // Different device overwrites only its own newer revision; stale writer must stop.
  const base=remote.get(A);remote.set(A,{revision:base.revision+1,state:data('Other device',a.conversations[0].id),updated_at:base.updated_at});
  const local=clone(store.getSnapshot().data);local.conversations[0].title='Local edit';await store.replaceAccountData(A,local);await sync.refresh();
  assert.equal(sync.getSnapshot().status,'conflict');assert.equal(store.getSnapshot().data.conversations[0].title,'Local edit');
  await sync.mergeConflict();assert.equal(sync.getSnapshot().status,'saved');
  const titles=remote.get(A).state.conversations.map(c=>c.title);
  assert.ok(titles.includes('Other device'));assert.ok(titles.some(t=>t.startsWith('Local edit')));
  // Offline work stays local and is uploaded when explicitly retried.
  offline=true;const changed=clone(store.getSnapshot().data);changed.newDraft='Offline draft';await store.replaceAccountData(A,changed);await sync.refresh();
  assert.equal(sync.getSnapshot().status,'offline');assert.equal(store.getSnapshot().data.newDraft,'Offline draft');
  offline=false;await sync.refresh();assert.equal(remote.get(A).state.newDraft,'Offline draft');
  // Edits made while a write is pending must not be replaced by the old acknowledgement.
  let release,signal;gate=new Promise(r=>{release=r;});const sent=new Promise(r=>{signal=r;});started=signal;
  const first=clone(store.getSnapshot().data);first.newDraft='First edit';await store.replaceAccountData(A,first);
  const pending=sync.refresh();await sent;
  const second=clone(store.getSnapshot().data);second.newDraft='Newer edit';await store.replaceAccountData(A,second);
  release();await pending;assert.equal(store.getSnapshot().data.newDraft,'Newer edit');await sync.refresh();assert.equal(remote.get(A).state.newDraft,'Newer edit');
  // A read started before typing must not overwrite the newly typed draft.
  readGate=new Promise(r=>{release=r;});const reading=new Promise(r=>{signal=r;});started=signal;
  const pull=sync.refresh();await reading;
  const typed=clone(store.getSnapshot().data);typed.newDraft='Typed during download';await store.replaceAccountData(A,typed);
  release();await pull;assert.equal(store.getSnapshot().data.newDraft,'Typed during download');
  assert.notEqual(sync.getSnapshot().status,'syncing');await sync.refresh();
  await sync.importLegacy();assert.ok(store.getSnapshot().data.conversations.some(c=>c.title==='Guest history'));
  assert.equal(disk.get('@legalintel/chats/v3'),JSON.stringify(guest),'legacy source must remain untouched');
  const count=store.getSnapshot().data.conversations.length;await sync.importLegacy();assert.equal(store.getSnapshot().data.conversations.length,count);
  assert.notEqual(sync.getSnapshot().status,'syncing','repeated import must not leave the controls locked');
  // A late upload for A cannot acknowledge or replace B's active state.
  gate=new Promise(r=>{release=r;});const uploading=new Promise(r=>{signal=r;});started=signal;
  const lastA=clone(store.getSnapshot().data);lastA.newDraft='Last Alice edit';await store.replaceAccountData(A,lastA);
  const oldUpload=sync.refresh();await uploading;
  sync.stop();user=B;await store.bindAccount(B);await sync.start(B);assert.equal(sync.getSnapshot().legacyCount,0,'legacy import belongs to the chosen account');
  release();await oldUpload;assert.equal(store.getAccountId(),B);assert.equal(store.getSnapshot().data.newDraft,'');
  assert.ok(!store.getSnapshot().data.conversations.some(c=>c.title.includes('Alice')));
  sync.stop();
  const x=empty(),y=empty();x.newDraft='remote unsent';y.newDraft='local unsent';
  const merged=helpers.mergeCopies(x,y);assert.equal(merged.newDraft,'local unsent');assert.equal(merged.conversations[0].draft,'remote unsent');
  console.log('Offline account checks: PASS (separate caches, guest import, conflict copies, offline retry, edits during reads/writes, late old-account upload, both drafts retained)');
})().catch(error=>{console.error(error);const cached=cache.get(path.join(root,'state/accountSync.ts'));cached?.exports.accountSync.stop();process.exitCode=1;});
