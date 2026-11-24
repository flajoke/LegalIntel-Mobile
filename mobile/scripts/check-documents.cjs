/* Offline checks of real store/repository code; no Metro, browser or sockets. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const ts = require('typescript');
const root = path.resolve(__dirname, '../src');
const cache = new Map();
let raw, writes = 0;
let counter = 1;
const id = () => `00000000-0000-4000-8000-${String(counter++).padStart(12, '0')}`;
const caseValue = {version:1,description:'Synthetic case',answers:{jurisdiction:'russia',employment_type:'employment',due_date:'2026-11-10',as_of_date:'2026-11-23'},confirmed:true,status:'complete',question:null,fields:[],progress:{answered:4,total:4},summary:[],notices:[],metrics:{delay_days:13,remaining_amount:'45000.00',as_of_date:'2026-11-23'},sources:[],corpus:{version:'test',checked_on:'2026-11-23',documents:0,chunks:0}};
const conversationId = id();
const initial = {version:3,conversations:[{id:conversationId,title:'Test',createdAt:'2026-11-23T10:00:00Z',updatedAt:'2026-11-23T10:00:00Z',draft:'',messages:[],scenario:'salary_delay',salaryCase:caseValue}],activeId:conversationId,newDraft:'',settings:{apiUrl:'',theme:'system'}};
raw = JSON.stringify(initial);
function load(file) {
  if (cache.has(file)) return cache.get(file).exports;
  const module = {exports:{}}; cache.set(file,module);
  const source = ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText;
  const req = name => {
    if (name === 'react') return {useSyncExternalStore:()=>undefined};
    if (name === 'expo-crypto') return {randomUUID:id};
    if (name === '@react-native-async-storage/async-storage') return {getItem:async()=>raw,setItem:async(_k,v)=>{raw=v;writes++;},multiRemove:async()=>{}};
    if (name === '@/services/api') return {defaultApiUrl:()=>'',sendSalaryTurn:async(_base,payload)=>({mode:'guided',case:{...payload.state,confirmed:false},message:{id:id(),role:'assistant',content:'Updated',created_at:'2026-11-23T11:00:00Z'}})};
    const base = name.startsWith('@/') ? path.join(root,name.slice(2)) : path.resolve(path.dirname(file),name);
    return load(base+'.ts');
  };
  vm.runInNewContext(source,{require:req,module,exports:module.exports,Date,JSON,Map,Set,Promise,AbortController,console,setTimeout,clearTimeout},{filename:file});
  return module.exports;
}
(async()=>{
  const repository = load(path.join(root,'data/chatRepository.ts')).chatRepository;
  assert.equal((await repository.load()).conversations.length,1,'old v3 without documents must load');
  const domain = load(path.join(root,'domain/documents.ts'));
  const analysis = load(path.join(root,'domain/analysis.ts'));
  const store = load(path.join(root,'state/chatStore.ts')).chatStore;
  await store.initialize();
  const draft = {id:id(),template:'employer',templateVersion:'test',title:'Test',text:'Synthetic document '.repeat(8),details:domain.emptyLetterDetails(),caseFingerprint:analysis.caseFingerprint(caseValue),createdAt:'2026-11-23T10:00:00Z',updatedAt:'2026-11-23T10:00:00Z',reviewed:true,warnings:[],sources:[]};
  assert.equal(await store.addDocumentDraft(conversationId,draft),true);
  assert.equal(await store.addDocumentDraft(conversationId,draft),false,'duplicate must not be inserted');
  await store.editDocumentDraft(conversationId,draft.id,{text:draft.text+'edited'});
  let current=store.getSnapshot().data.conversations[0].documentDrafts[0];
  assert.equal(current.reviewed,false,'editing must revoke review');
  await store.editDocumentDraft(conversationId,draft.id,{reviewed:true});
  assert.equal((await repository.load()).conversations[0].documentDrafts[0].reviewed,true,'review and edits must survive reload');
  assert.equal(await store.addDocumentDraft(conversationId,{...draft,id:id(),caseFingerprint:'outdated'}),false,'late generation for old facts must be rejected');
  await store.removeDocumentDraft(conversationId,draft.id);
  assert.equal(store.getSnapshot().data.conversations[0].documentDrafts.length,0);
  await store.remove(conversationId);
  assert.equal(await store.addDocumentDraft(conversationId,{...draft,id:id()}),false,'late result must not restore deleted chat');
  assert.equal(store.getSnapshot().data.conversations.length,0);
  assert.ok(writes>0);
  assert.equal(domain.hasDocumentPlaceholders('[Укажите ФИО]'),true);
  assert.equal(domain.hasDocumentPlaceholders('Filled document'),false);
  console.log('Offline document storage checks: PASS (legacy history, persistence, review reset, deduplication, stale/deleted case protection)');
})().catch(error=>{console.error(error);process.exitCode=1;});
