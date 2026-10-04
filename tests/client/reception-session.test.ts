import type { LiveCallbacks, LiveServerMessage } from "@google/genai";
import { describe, expect, it, vi } from "vitest";
import { ReceptionSessionController } from "../../src/client/voice/receptionSession";
import type { ReceptionCommand, ReceptionSnapshot } from "../../src/shared/reception";
import { openReceptionDatabase } from "../../src/server/reception/database";
import { ReceptionService } from "../../src/server/reception/service";
import { createApp } from "../../src/server/app";
import request from "supertest";

const json = (body: unknown) => new Response(JSON.stringify(body), { headers: { "Content-Type": "application/json" } });
const snapshot = (): ReceptionSnapshot => ({ sessionId: "s", version: 0, status: "active", clock: { nowIso: "2026-10-03T10:00:00Z", timeZone: "Asia/Riyadh", localDate: "2026-10-03" }, directory: [], clinic: {}, contact: { rawChunks: [], digits: "", version: 0, source: "dictated" }, offers: [], operations: [] });
async function harness(options: Record<string, unknown> = {}) {
  let callbacks: LiveCallbacks | undefined;
  let state = snapshot();
  const commands: ReceptionCommand[] = [], requests: Array<{ url: string; body: any }> = [];
  const port = { sendRealtimeInput: vi.fn(), sendClientContent: vi.fn(), sendToolResponse: vi.fn(), close: vi.fn() };
  const fetch = vi.fn(async (url: any, init?: RequestInit) => {
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    requests.push({ url: String(url), body });
    if (url === "/api/gemini/live-token") return json({ token: "token", model: "gemini-3.8-live", voiceName: "Kore", expiresAt: new Date(Date.now() + 60000).toISOString() });
    if (String(url).endsWith("/tools")) {
      commands.push(body); state = { ...state, version: state.version + 1 };
      return json({ status: body.tool === "end_session" ? "ok" : "updated", ...(body.tool === 'end_session' ? {facts:{closeRequested:true}} : {}), snapshot: state });
    }
    if (String(url).endsWith("/close")) { state = { ...state, status: "closed", version: state.version + 1 }; return json({ status: "closed", snapshot: state }); }
    if (String(url).endsWith("/events")) return json({ status: "ok" });
    return json(state);
  });
  const controller = new ReceptionSessionController({ fetch, connectLive: async (_token, _model, _config, cb) => { callbacks = cb; return port; }, ...options });
  await controller.connect();
  return { controller, commands, requests, fetch, port, emit: (message: unknown) => callbacks?.onmessage(message as LiveServerMessage), closeProvider: () => callbacks?.onclose?.({} as any) };
}
const tool = (name: string, id = name, args: Record<string, unknown> = {}) => ({ toolCall: { functionCalls: [{ name, id, args }] } });

it("does not let an older delayed tool snapshot reopen a fenced session", async () => {
  let release: (response: Response) => void = () => undefined;
  let creates=0, admitted=false;
  const fetch=vi.fn(async (url:any,init?:RequestInit)=>{
    if(url==='/api/reception/sessions'){creates++;return json(snapshot());}
    if(String(url).endsWith('live-token'))return json({token:'token',model:'gemini-3.8-live',voiceName:'Kore',expiresAt:new Date(Date.now()+60000).toISOString()});
    if(String(url).endsWith('/close'))return json({status:'closed',snapshot:{...snapshot(),version:5,status:'closed'}});
    if(String(url).endsWith('/events'))return json({status:'ok'});
    if(String(url).endsWith('/tools')){admitted=true;return await new Promise<Response>(resolve=>{release=resolve;});}
    return json(snapshot());
  });
  const h=await harness({fetch});h.controller.sendText('name');h.emit(tool('set_booking_details','delay',{patientName:'Saved'}));
  await vi.waitFor(()=>expect(admitted).toBe(true));await h.controller.stop();
  release(json({status:'updated',snapshot:{...snapshot(),version:1}}));
  await new Promise(resolve=>setTimeout(resolve,0));
  await h.controller.connect();expect(creates).toBe(2);
});

describe("thin reception transport", () => {
  it('does not bind a broad availability window to an older exact-time offer', async () => {
    const media: any[] = [];
    let slotSearch = 0;
    const offer = { offerId: 'exact-offer', draftId: 'draft', action: 'book', subjectKey: 'patient', subjectRevision: 0, selectionRevision: 0, doctorId: 'doctor', slotIds: ['slot'], startsAtUtc: '2026-10-04T06:00:00.000Z', doctorNameAr: 'د. ندى', doctorNameEn: 'Dr Nada', issuedInputSequence: 1, expiresAt: '2026-10-04T05:00:00.000Z', labels: {} };
    const h = await harness({ fetch: vi.fn(async (url: any, init?: RequestInit) => {
      const body = init?.body ? JSON.parse(String(init.body)) : undefined;
      if (url === '/api/gemini/live-token') return json({ token: 'token', model: 'gemini-3.8-live', voiceName: 'Kore', expiresAt: new Date(Date.now() + 60000).toISOString() });
      if (String(url).endsWith('/tools')) {
        if (body?.tool === 'find_available_slots') {
          slotSearch++;
          return slotSearch === 1
            ? json({ status: 'offers', facts: { offers: [offer] }, snapshot: { ...snapshot(), version: 1, offers: [offer] } })
            : json({ status: 'availability', facts: { availabilityWindows: [{ startTime: '09:00', lastStartTime: '11:00' }] }, snapshot: { ...snapshot(), version: 2, offers: [] } });
        }
        return json({ status: 'updated', snapshot: { ...snapshot(), version: 1 } });
      }
      if (String(url).endsWith('/events')) { media.push(body); return json({ status: 'ok' }); }
      return json(snapshot());
    }) });

    h.controller.sendText('Is nine available?');
    h.emit(tool('find_available_slots', 'exact', { exactTime: '09:00' }));
    await vi.waitFor(() => expect(h.port.sendToolResponse).toHaveBeenCalledOnce());
    h.emit({ serverContent: { outputTranscription: { text: 'Nine is available.', finished: true }, turnComplete: true } });

    h.controller.sendText('What is the available time window?');
    h.emit(tool('find_available_slots', 'window', {}));
    await vi.waitFor(() => expect(h.port.sendToolResponse).toHaveBeenCalledTimes(2));
    h.emit({ serverContent: { outputTranscription: { text: 'You can choose a time from nine to eleven.', finished: true }, turnComplete: true } });
    h.controller.sendText('Tell me the clinic name.');
    h.emit(tool('clinic_information', 'clinic'));
    await vi.waitFor(() => expect(h.port.sendToolResponse).toHaveBeenCalledTimes(3));

    expect(media.map(event => event.offerIds)).toEqual([['exact-offer'], []]);
  });

  it('preserves a microphone suffix after turnComplete under the original caption ID',async()=>{
    const patients:any[]=[];const h=await harness({onPatientTranscript:(...args:unknown[])=>patients.push(args)});
    h.controller.beginMicrophoneTurn();h.emit({serverContent:{inputTranscription:{text:'First'}}});
    h.emit({serverContent:{turnComplete:true}});h.emit({serverContent:{inputTranscription:{text:' words',finished:true}}});
    expect(patients.at(-1)[0]).toBe('First words');expect(new Set(patients.map(p=>p[3])).size).toBe(1);
  });
  it('retires an empty completed owner at the next onset before a real caption arrives',async()=>{
    const patients:any[]=[],diagnostics:any[]=[];const h=await harness({onPatientTranscript:(...args:unknown[])=>patients.push(args),onDiagnostic:(event:unknown)=>diagnostics.push(event)});
    h.controller.beginMicrophoneTurn();h.emit({serverContent:{turnComplete:true}});h.controller.beginMicrophoneTurn();
    h.emit({serverContent:{inputTranscription:{text:'Second',finished:true}}});
    const onsets=diagnostics.filter(d=>d.event==='reception_input_onset');
    expect(patients[0][3]).toBe(onsets[1].details.inputTurnId);expect(patients[0][3]).not.toBe(onsets[0].details.inputTurnId);
  });
  it('keeps orphan caption chunks visible and uncertain without creating or changing consent activity',async()=>{
    const patients:any[]=[],diagnostics:any[]=[];const h=await harness({onPatientTranscript:(...args:unknown[])=>patients.push(args),onDiagnostic:(event:unknown)=>diagnostics.push(event)});
    h.controller.sendText('Known caller turn');
    h.emit(tool('clinic_information','before-orphan'));await vi.waitFor(()=>expect(h.commands).toHaveLength(1));
    h.emit({serverContent:{inputTranscription:{text:'Orphan'}}});h.emit({serverContent:{inputTranscription:{text:' words',finished:true}}});
    expect(patients.at(-1)[0]).toBe('Orphan words');expect(patients.at(-2)[3]).toBe(patients.at(-1)[3]);
    expect(patients.at(-1)[3]).not.toBe(patients[0][3]);
    h.emit(tool('clinic_information','after-orphan'));await vi.waitFor(()=>expect(h.commands).toHaveLength(2));
    expect(h.commands[1].context).toMatchObject({inputTurnId:h.commands[0].context.inputTurnId,inputSequence:1,inputStartedEventSequence:h.commands[0].context.inputStartedEventSequence,attribution:'known'});
    expect(diagnostics.filter(d=>d.event==='reception_input_onset')).toHaveLength(1);
    expect(diagnostics.filter(d=>d.event==='reception_input_transcription').every(d=>d.details.attribution==='uncertain')).toBe(true);
    h.emit({serverContent:{inputTranscription:{text:'Unfinished orphan'}}});
    h.controller.beginMicrophoneTurn();h.emit({serverContent:{inputTranscription:{text:'Fresh',finished:true}}});
    expect(patients.at(-1)[0]).toBe('Fresh');expect(patients.at(-1)[3]).not.toBe(patients.at(-2)[3]);
  });
  it('keeps consecutive captions without final markers separate and publishes assistant chunks immediately', async () => {
    const patients:any[] = [], assistants:any[] = [], diagnostics:any[]=[];
    const h=await harness({onPatientTranscript:(...args:unknown[])=>patients.push(args),onAssistantTranscript:(...args:unknown[])=>assistants.push(args),onDiagnostic:(event:unknown)=>diagnostics.push(event)});
    h.controller.beginMicrophoneTurn();
    h.emit({serverContent:{inputTranscription:{text:'أحمد'}}});
    h.emit({serverContent:{outputTranscription:{text:'أهلًا '}}});
    expect(assistants.map(a=>a[0])).toEqual(['أهلًا']);
    h.emit({serverContent:{outputTranscription:{text:'أحمد'},turnComplete:true}});
    h.controller.beginMicrophoneTurn();
    h.emit({serverContent:{inputTranscription:{text:'Another question'}}});
    h.emit({serverContent:{turnComplete:true}});
    expect(patients.filter(p=>p[1]).map(p=>p[0])).toEqual(['أحمد','Another question']);
    expect(patients[0][3]).toBeTruthy();expect(patients[0][3]).not.toBe(patients.at(-1)[3]);
    expect(assistants.at(-1)[0]).toBe('أهلًا أحمد');expect(assistants[0][3]).toBe(assistants.at(-1)[3]);
    expect(diagnostics.some(d=>d.event==='reception_input_transcription'&&d.details.text==='أحمد'&&d.details.inputTurnId===patients[0][3])).toBe(true);
  });
  it('does not let repeated empty onsets swallow the next real caption', async()=>{
    const patients:any[]=[];const h=await harness({onPatientTranscript:(...args:unknown[])=>patients.push(args)});
    h.controller.beginMicrophoneTurn();h.controller.beginMicrophoneTurn();
    h.emit({serverContent:{inputTranscription:{text:'First'}}});h.emit({serverContent:{generationComplete:true}});
    h.emit({serverContent:{inputTranscription:{text:' words'},turnComplete:true}});
    h.controller.beginMicrophoneTurn();h.emit({serverContent:{inputTranscription:{text:'Second'},turnComplete:true}});
    expect(patients.at(-1)[0]).toBe('Second');expect(patients.some(p=>p[0]==='First words')).toBe(true);
  });
  it('attaches the first caption after audio-only turnComplete to the original output',async()=>{
    const captions:any[]=[],records:any[]=[];
    const h=await harness({onAssistantTranscript:(...args:unknown[])=>captions.push(args),onRecordedOutput:(...args:unknown[])=>records.push(args)});
    h.controller.sendText('hello');
    h.emit({serverContent:{modelTurn:{parts:[{inlineData:{data:'AAAA',mimeType:'audio/pcm;rate=24000'}}]},turnComplete:true}});
    h.emit({serverContent:{outputTranscription:{text:'Hello there',finished:true}}});
    expect(captions[0][3]).toBe(records[0][0]);expect(records.at(-1)[1]).toMatchObject({transcript:'Hello there',audio:[{data:'AAAA'}]});
  });
  it('keeps a caption suffix after turnComplete on its original output but starts a new reply after new tool activity',async()=>{
    const captions:any[]=[],records:any[]=[];
    const h=await harness({onAssistantTranscript:(...args:unknown[])=>captions.push(args),onRecordedOutput:(...args:unknown[])=>records.push(args)});
    h.controller.sendText('hello');
    h.emit({serverContent:{modelTurn:{parts:[{inlineData:{data:'AAAA',mimeType:'audio/pcm;rate=24000'}}]},outputTranscription:{text:'Hello '},turnComplete:true}});
    h.emit({serverContent:{outputTranscription:{text:'there',finished:true}}});
    expect(captions.map(c=>c[0])).toEqual(['Hello','Hello there']);expect(captions[1][3]).toBe(captions[0][3]);
    expect(records.at(-1)[1]).toMatchObject({transcript:'Hello there',audio:[{data:'AAAA'}]});
    h.emit(tool('clinic_information','new-response'));
    await vi.waitFor(()=>expect(h.port.sendToolResponse).toHaveBeenCalledOnce());
    h.emit({serverContent:{outputTranscription:{text:'Clinic facts'},turnComplete:true}});
    expect(captions.at(-1)[0]).toBe('Clinic facts');expect(captions.at(-1)[3]).not.toBe(captions[0][3]);
  });
  it('keeps a trailing caption on an output that continued through tool activity',async()=>{
    const captions:any[]=[];const h=await harness({onAssistantTranscript:(...args:unknown[])=>captions.push(args)});
    h.controller.sendText('clinic');h.emit({serverContent:{outputTranscription:{text:'Checking '}}});
    h.emit(tool('clinic_information'));await vi.waitFor(()=>expect(h.port.sendToolResponse).toHaveBeenCalledOnce());
    h.emit({serverContent:{outputTranscription:{text:'the clinic'},turnComplete:true}});
    h.emit({serverContent:{outputTranscription:{text:' now',finished:true}}});
    expect(captions.at(-1)[0]).toBe('Checking the clinic now');expect(new Set(captions.map(c=>c[3])).size).toBe(1);
  });
  it('publishes progressive text with one presentation event and diagnoses unattributed raw captions',async()=>{
    const diagnostics:any[]=[];const h=await harness({onDiagnostic:(event:unknown)=>diagnostics.push(event)});
    h.controller.sendText('hello');
    h.emit({serverContent:{inputTranscription:{text:'unattributed'}}});
    for(const text of ['Hello',' there','!'])h.emit({serverContent:{outputTranscription:{text}}});
    h.emit({serverContent:{turnComplete:true}});h.controller.sendText('next');h.emit(tool('clinic_information'));
    await vi.waitFor(()=>expect(h.commands).toHaveLength(1));
    expect(h.requests.filter(r=>r.url.endsWith('/events')&&r.body.medium==='text')).toHaveLength(1);
    expect(diagnostics.find(d=>d.event==='reception_input_transcription').details).toMatchObject({text:'unattributed',finished:false,attribution:'uncertain'});
    expect(diagnostics.find(d=>d.event==='reception_input_transcription').details.providerEventId).toBeTruthy();
  });
  it('does not carry unresolved commands into a new session after explicit Stop',async()=>{
    const h=await harness();const original=h.fetch.getMockImplementation()!;let lost=true;
    h.fetch.mockImplementation(async(url:any,init?:RequestInit)=>{
      const body=init?.body?JSON.parse(String(init.body)):{};
      if(body.tool==='record_followup'&&lost)throw new Error('unknown');
      if(String(url).includes('/events/'))return json({status:'unresolved',snapshot:snapshot()});
      return original(url,init);
    });
    h.controller.sendText('callback');h.emit(tool('record_followup','old',{kind:'callback'}));
    await vi.waitFor(()=>expect(h.port.sendToolResponse).toHaveBeenCalledOnce());
    await h.controller.stop();await h.controller.connect();lost=false;
    h.controller.sendText('my name');h.emit(tool('set_booking_details','new',{patientName:'New Synthetic'}));
    await vi.waitFor(()=>expect(h.port.sendToolResponse).toHaveBeenCalledTimes(2));
    expect(h.port.sendToolResponse.mock.calls[1][0].functionResponses[0].response.status).toBe('updated');
  });
  it('retries only the same ready operation after a lost unadmitted commit',async()=>{
    const h=await harness();const original=h.fetch.getMockImplementation()!;let attempts=0;
    h.fetch.mockImplementation(async(url:any,init?:RequestInit)=>{
      const body=init?.body?JSON.parse(String(init.body)):{};
      if(body.tool==='commit_request'){attempts++;if(attempts<=2)throw new Error('not admitted');return json({status:'committed',operationId:'op',result:{appointmentId:'saved'},snapshot:{...snapshot(),version:1}});}
      if(body.tool==='get_operation')return json({status:'ready',operationId:'op',snapshot:snapshot()});
      return original(url,init);
    });
    h.controller.sendText('book');h.emit(tool('commit_request','first',{operationId:'op'}));
    await vi.waitFor(()=>expect(h.port.sendToolResponse).toHaveBeenCalledOnce());
    h.emit(tool('commit_request','retry',{operationId:'op'}));
    await vi.waitFor(()=>expect(h.port.sendToolResponse).toHaveBeenCalledTimes(2));
    expect(h.port.sendToolResponse.mock.calls[1][0].functionResponses[0].response.status).toBe('committed');
  });
  it('does not close after a rejected farewell request',async()=>{
    let finished:()=>void=()=>undefined;
    const h=await harness({onStreamStart:(_id:string,_start:unknown,done:()=>void)=>{finished=done;}});
    h.fetch.mockImplementationOnce(async()=>json({status:'conflict',snapshot:snapshot()}));
    h.controller.sendText('bye');h.emit(tool('end_session','rejected',{outcome:'completed'}));
    await vi.waitFor(()=>expect(h.port.sendToolResponse).toHaveBeenCalledOnce());
    h.emit({serverContent:{modelTurn:{parts:[{inlineData:{data:'AAAA',mimeType:'audio/pcm;rate=24000'}}]},turnComplete:true}});finished();
    await new Promise(resolve=>setTimeout(resolve,0));
    expect(h.requests.some(r=>r.url.endsWith('/close'))).toBe(false);
  });
  it('admits an emergency fence even when pending media telemetry fails',async()=>{
    let started:()=>void=()=>undefined;const h=await harness({onStreamStart:(_id:string,start:()=>void)=>{started=start;}});
    const original=h.fetch.getMockImplementation()!;
    h.fetch.mockImplementation(async(url:any,init?:RequestInit)=>String(url).endsWith('/events')?Promise.reject(new Error('media unavailable')):original(url,init));
    h.controller.sendText('question');h.emit({serverContent:{modelTurn:{parts:[{inlineData:{data:'AAAA',mimeType:'audio/pcm;rate=24000'}}]},turnComplete:true}});started();
    h.controller.sendText('emergency');h.emit(tool('set_emergency','fence',{active:true}));
    await vi.waitFor(()=>expect(h.port.sendToolResponse).toHaveBeenCalledOnce());
    expect(h.commands.some(c=>c.tool==='set_emergency'&&c.args.active)).toBe(true);
  });
  it('binds recovered real offers to exposure and commits exactly one real appointment',async()=>{
    const db=openReceptionDatabase(':memory:');const service=new ReceptionService(db,{clock:()=>new Date('2026-10-03T05:00:00Z')});
    const app=createApp({receptionService:service,geminiTokenIssuer:async()=>({token:'token',voiceName:'Kore',expiresAt:new Date(Date.now()+60000).toISOString()})});
    let callbacks:LiveCallbacks|undefined;let started:()=>void=()=>undefined;let lost=0;
    const port={sendRealtimeInput:vi.fn(),sendClientContent:vi.fn(),sendToolResponse:vi.fn(),close:vi.fn()};
    const transport=async(url:any,init?:RequestInit)=>{
      const body=init?.body?JSON.parse(String(init.body)):undefined;
      const res=body?await request(app).post(String(url)).send(body):await request(app).get(String(url));
      if(body?.tool==='find_available_slots'&&lost++<2)throw new Error('lost after admission');
      return new Response(JSON.stringify(res.body),{status:res.status,headers:{'Content-Type':'application/json'}});
    };
    const c=new ReceptionSessionController({fetch:transport,connectLive:async(_t,_m,_cfg,cb)=>{callbacks=cb;return port;},onStreamStart:(_id,start)=>{started=start;}});
    try{
      await c.connect({simulatedCallingNumber:'0501234567'});c.sendText('doctor opening');callbacks!.onmessage(tool('find_available_slots','offers',{doctorIdentifier:'doc-001',dateExpression:'tomorrow',exactTime:'09:00'}) as LiveServerMessage);
      await vi.waitFor(()=>expect(port.sendToolResponse).toHaveBeenCalledOnce());
      const offer=(port.sendToolResponse.mock.calls[0][0] as any).functionResponses[0].response.facts.offers[0];
      callbacks!.onmessage({serverContent:{modelTurn:{parts:[{inlineData:{data:'AAAA',mimeType:'audio/pcm;rate=24000'}}]},turnComplete:true}} as LiveServerMessage);started();
      c.sendText('yes, book that opening');callbacks!.onmessage({toolCall:{functionCalls:[{id:'name',name:'set_booking_details',args:{patientName:'Synthetic'}},{id:'accept',name:'accept_offer',args:{offerId:offer.offerId,decision:'accept',detailsCommunicated:true}}]}} as unknown as LiveServerMessage);
      await vi.waitFor(()=>expect(port.sendToolResponse).toHaveBeenCalledTimes(2));
      const approved=(port.sendToolResponse.mock.calls[1][0] as any).functionResponses[1].response;
      expect(approved.status).toBe('ready');
      callbacks!.onmessage(tool('commit_request','commit',{operationId:approved.operationId}) as LiveServerMessage);
      await vi.waitFor(()=>expect(port.sendToolResponse).toHaveBeenCalledTimes(3));
      expect(service.activity().appointments).toHaveLength(1);
      expect((port.sendToolResponse.mock.calls[2][0] as any).functionResponses[0].response.status).toBe('committed');
    }finally{await c.stop(false);db.close();}
  });
  it('recovers a refreshed offer after the name turn and commits only after a fresh caller decision',async()=>{
    const db=openReceptionDatabase(':memory:');const service=new ReceptionService(db,{clock:()=>new Date('2026-10-03T05:00:00Z')});
    const app=createApp({receptionService:service,geminiTokenIssuer:async()=>({token:'token',voiceName:'Kore',expiresAt:new Date(Date.now()+60000).toISOString()})});
    let callbacks:LiveCallbacks|undefined;const diagnostics:any[]=[];
    const port={sendRealtimeInput:vi.fn(),sendClientContent:vi.fn(),sendToolResponse:vi.fn(),close:vi.fn()};
    const transport=async(url:any,init?:RequestInit)=>{
      const body=init?.body?JSON.parse(String(init.body)):undefined;
      const res=body?await request(app).post(String(url)).send(body):await request(app).get(String(url));
      return new Response(JSON.stringify(res.body),{status:res.status,headers:{'Content-Type':'application/json'}});
    };
    const c=new ReceptionSessionController({fetch:transport,connectLive:async(_t,_m,_cfg,cb)=>{callbacks=cb;return port;},onDiagnostic:(event:any)=>diagnostics.push(event)});
    const response=(call:number,index=0)=>(port.sendToolResponse.mock.calls[call][0] as any).functionResponses[index].response;
    const count=(table:string)=>Number((db.prepare(`SELECT COUNT(*) n FROM ${table}`).get() as {n:number}).n);
    const assistant=(text:string)=>callbacks!.onmessage({serverContent:{outputTranscription:{text,finished:true},turnComplete:true}} as LiveServerMessage);
    try{
      await c.connect({simulatedCallingNumber:'0501234567'});
      c.sendText('ابغى موعد مع الدكتور');callbacks!.onmessage(tool('find_available_slots','old-search',{doctorIdentifier:'doc-002',date:'2026-10-04',exactTime:'09:00'}) as LiveServerMessage);
      await vi.waitFor(()=>expect(port.sendToolResponse).toHaveBeenCalledOnce());
      const oldOffer=response(0).facts.offers[0];assistant('لقيت موعدًا متاحًا.');

      c.sendText('لا، أبغى الدكتورة ندى الساعة تسعة');callbacks!.onmessage(tool('find_available_slots','refresh',{doctorIdentifier:'doc-028',date:'2026-10-04',exactTime:'09:00'}) as LiveServerMessage);
      await vi.waitFor(()=>expect(port.sendToolResponse).toHaveBeenCalledTimes(2));
      const freshOffer=response(1).facts.offers[0];
      expect(freshOffer.doctorNameAr).toBe('د. ندى الخطيب');expect(freshOffer.startsAtUtc).toBe('2026-10-04T06:00:00.000Z');
      callbacks!.onmessage(tool('accept_offer','stale',{offerId:oldOffer.offerId,decision:'accept',detailsCommunicated:true}) as LiveServerMessage);
      await vi.waitFor(()=>expect(port.sendToolResponse).toHaveBeenCalledTimes(3));
      expect(response(2).status).toBe('conflict');
      callbacks!.onmessage(tool('accept_offer','same-turn-fresh',{offerId:freshOffer.offerId,decision:'accept',detailsCommunicated:true}) as LiveServerMessage);
      await vi.waitFor(()=>expect(port.sendToolResponse).toHaveBeenCalledTimes(4));
      expect(response(3).status).toBe('needs_clarification');
      expect(count('reception_appointments')).toBe(0);expect(count('reception_effects')).toBe(0);
      assistant('هذا الموعد المتاح يوم الأحد الساعة تسعة صباحًا. هل يناسبك؟');

      c.sendText('لا، تستاهل، لا ما فيش مشكلة');
      assistant('تمام، عشان نثبت الموعد، ممكن تعطيني اسم المريض؟');
      c.sendText('اسم المريض بدر');callbacks!.onmessage({toolCall:{functionCalls:[
        {id:'name',name:'set_booking_details',args:{patientName:'بدر'}},
        {id:'premature-accept',name:'accept_offer',args:{offerId:freshOffer.offerId,decision:'accept',detailsCommunicated:true}},
      ]}} as unknown as LiveServerMessage);
      await vi.waitFor(()=>expect(port.sendToolResponse).toHaveBeenCalledTimes(5));
      expect(response(4,1)).toMatchObject({status:'needs_clarification',issues:['offer_requires_presented_details_and_subsequent_known_turn']});
      expect(response(4,1).facts).toMatchObject({offerAccepted:false,bookingStatus:'not_booked',appointmentSaved:false,slotReserved:false});
      expect(count('reception_appointments')).toBe(0);expect(count('reception_effects')).toBe(0);

      const clarificationText='الموعد مع د. ندى الخطيب يوم الأحد ٤ أكتوبر، الساعة ٩ الصباح، يناسبك؟';
      assistant(clarificationText);
      const clarificationTranscript=diagnostics.find(d=>d.event==='reception_output_transcription'&&d.details.text===clarificationText);
      expect(clarificationTranscript).toBeTruthy();expect(clarificationTranscript.details.text).toContain('ندى الخطيب');expect(clarificationTranscript.details.text).toContain('٤ أكتوبر');expect(clarificationTranscript.details.text).toContain('٩ الصباح');
      const clarificationExposure=diagnostics.find(d=>d.event==='reception_exposure'&&d.details.outputId===clarificationTranscript.details.outputId&&d.details.offerIds.includes(freshOffer.offerId));
      expect(clarificationExposure).toBeTruthy();
      c.sendText('ايه، احجزه');callbacks!.onmessage(tool('accept_offer','clear-yes',{offerId:freshOffer.offerId,decision:'accept',detailsCommunicated:true}) as LiveServerMessage);
      await vi.waitFor(()=>expect(port.sendToolResponse).toHaveBeenCalledTimes(6));
      const ready=response(5);expect(ready.status).toBe('ready');
      expect(count('reception_appointments')).toBe(0);expect(count('reception_effects')).toBe(0);
      callbacks!.onmessage(tool('commit_request','commit',{operationId:ready.operationId}) as LiveServerMessage);
      await vi.waitFor(()=>expect(port.sendToolResponse).toHaveBeenCalledTimes(7));
      expect(response(6).status).toBe('committed');
      expect(service.activity().appointments).toHaveLength(1);
      expect(db.prepare('SELECT doctor_id, starts_at_utc FROM reception_appointments').get()).toEqual({doctor_id:'doc-028',starts_at_utc:'2026-10-04T06:00:00.000Z'});
      expect(count('reception_appointments')).toBe(1);expect(count('reception_effects')).toBe(1);
    }finally{await c.stop(false);db.close();}
  });
  it('forwards accepted-but-unbooked contact repair facts and writes only after commit',async()=>{
    const db=openReceptionDatabase(':memory:');const service=new ReceptionService(db,{clock:()=>new Date('2026-10-03T05:00:00Z')});
    const app=createApp({receptionService:service,geminiTokenIssuer:async()=>({token:'token',voiceName:'Kore',expiresAt:new Date(Date.now()+60000).toISOString()})});
    let callbacks:LiveCallbacks|undefined;let started:()=>void=()=>undefined;
    const port={sendRealtimeInput:vi.fn(),sendClientContent:vi.fn(),sendToolResponse:vi.fn(),close:vi.fn()};
    const transport=async(url:any,init?:RequestInit)=>{
      const body=init?.body?JSON.parse(String(init.body)):undefined;
      const res=body?await request(app).post(String(url)).send(body):await request(app).get(String(url));
      return new Response(JSON.stringify(res.body),{status:res.status,headers:{'Content-Type':'application/json'}});
    };
    const c=new ReceptionSessionController({fetch:transport,connectLive:async(_t,_m,_cfg,cb)=>{callbacks=cb;return port;},onStreamStart:(_id,start)=>{started=start;}});
    const response=(call:number,index=0)=>(port.sendToolResponse.mock.calls[call][0] as any).functionResponses[index].response;
    const appointmentCount=()=>Number((db.prepare('SELECT COUNT(*) n FROM reception_appointments').get() as {n:number}).n);
    const effectCount=()=>Number((db.prepare('SELECT COUNT(*) n FROM reception_effects').get() as {n:number}).n);
    const occupancyCount=()=>Number((db.prepare('SELECT COUNT(*) n FROM reception_occupancy').get() as {n:number}).n);
    try{
      await c.connect();
      c.sendText('My name is Ahmed and my phone number is one three three.');
      callbacks!.onmessage({toolCall:{functionCalls:[
        {id:'name',name:'set_booking_details',args:{patientName:'Ahmed'}},
        {id:'partial',name:'capture_contact',args:{mode:'replace',rawText:'133'}},
      ]}} as unknown as LiveServerMessage);
      await vi.waitFor(()=>expect(port.sendToolResponse).toHaveBeenCalledOnce());
      expect(response(0,1).status).toBe('invalid_contact');
      callbacks!.onmessage({serverContent:{turnComplete:true}} as LiveServerMessage);

      c.sendText('Find an opening');callbacks!.onmessage(tool('find_available_slots','offers',{doctorIdentifier:'doc-001',dateExpression:'tomorrow',exactTime:'09:00'}) as LiveServerMessage);
      await vi.waitFor(()=>expect(port.sendToolResponse).toHaveBeenCalledTimes(2));
      const offer=response(1).facts.offers[0];
      callbacks!.onmessage({serverContent:{modelTurn:{parts:[{inlineData:{data:'AAAA',mimeType:'audio/pcm;rate=24000'}}]},turnComplete:true}} as LiveServerMessage);started();

      c.sendText('Yes, that time works');callbacks!.onmessage(tool('accept_offer','accept',{offerId:offer.offerId,decision:'accept',detailsCommunicated:true}) as LiveServerMessage);
      await vi.waitFor(()=>expect(port.sendToolResponse).toHaveBeenCalledTimes(3));
      const incomplete=response(2);
      expect(incomplete).toMatchObject({status:'invalid_contact',facts:{offerAccepted:true,bookingStatus:'not_booked',appointmentSaved:false,slotReserved:false,capacityHeld:false,requiredFunction:'capture_contact'}});
      expect(incomplete.operationId).toBeUndefined();expect(incomplete.snapshot.draft.acceptedOfferId).toBe(offer.offerId);
      expect(incomplete.snapshot.contact.rawChunks).toBeUndefined();
      expect(appointmentCount()).toBe(0);expect(effectCount()).toBe(0);expect(occupancyCount()).toBe(0);
      callbacks!.onmessage({serverContent:{turnComplete:true}} as LiveServerMessage);

      c.sendText('The full number is zero five zero one two three four five six seven');
      callbacks!.onmessage(tool('capture_contact','full-contact',{mode:'replace',rawText:'0501234567'}) as LiveServerMessage);
      await vi.waitFor(()=>expect(port.sendToolResponse).toHaveBeenCalledTimes(4));
      const captured=response(3);
      expect(captured).toMatchObject({status:'needs_details',facts:{offerAccepted:true,bookingStatus:'not_booked',appointmentSaved:false,slotReserved:false,capacityHeld:false,requiredFunction:'confirm_contact'}});
      expect(appointmentCount()).toBe(0);expect(effectCount()).toBe(0);expect(occupancyCount()).toBe(0);
      callbacks!.onmessage({serverContent:{turnComplete:true}} as LiveServerMessage);
      c.sendText('Yes, that number is correct');callbacks!.onmessage(tool('confirm_contact','confirm',{contactVersion:captured.snapshot.contact.version,decision:'accept'}) as LiveServerMessage);
      await vi.waitFor(()=>expect(port.sendToolResponse).toHaveBeenCalledTimes(5));
      const ready=response(4);
      expect(ready).toMatchObject({status:'ready',facts:{offerAccepted:true,bookingStatus:'not_booked',appointmentSaved:false,slotReserved:false,capacityHeld:false,requiredFunction:'commit_request'}});
      expect(ready.operationId).toBeTruthy();expect(ready.snapshot.draft.acceptedOfferId).toBe(offer.offerId);
      expect(appointmentCount()).toBe(0);expect(effectCount()).toBe(0);expect(occupancyCount()).toBe(0);
      callbacks!.onmessage({serverContent:{turnComplete:true}} as LiveServerMessage);

      c.sendText('Save the appointment');callbacks!.onmessage(tool('commit_request','commit',{operationId:ready.operationId}) as LiveServerMessage);
      await vi.waitFor(()=>expect(port.sendToolResponse).toHaveBeenCalledTimes(6));
      expect(response(5).status).toBe('committed');
      expect(appointmentCount()).toBe(1);expect(effectCount()).toBe(1);expect(occupancyCount()).toBe(2);
    }finally{await c.stop(false);db.close();}
  });
  it('returns current request facts to Gemini without repeating historical results and the whole directory',async()=>{
    const h=await harness();
    h.fetch.mockImplementationOnce(async()=>json({status:'needs_clarification',issues:['offer_not_accepted'],snapshot:{...snapshot(),version:1,directory:[{doctorId:'d',nameAr:'اسم',nameEn:'Name',specialtyId:'s',specialtyAr:'تخصص',specialtyEn:'Specialty'}],operations:[{operationId:'old',status:'committed',result:{status:'active'}}]}}));
    h.controller.sendText('cancel');h.emit(tool('accept_offer'));
    await vi.waitFor(()=>expect(h.port.sendToolResponse).toHaveBeenCalledOnce());
    const sent=h.port.sendToolResponse.mock.calls[0][0] as any;
    expect(sent.functionResponses[0].response.snapshot.directory).toBeUndefined();
    expect(sent.functionResponses[0].response.snapshot.operations).toBeUndefined();
    expect(sent.functionResponses[0].response.status).toBe('needs_clarification');
  });
  it("binds token to server session and serializes dependent tools with updated server versions", async () => {
    const h = await harness();
    expect(h.requests.find((r) => r.url.endsWith("live-token"))?.body).toEqual({ sessionId: "s" });
    h.controller.sendText("book please");
    h.emit({ toolCall: { functionCalls: [{ id: "a", name: "set_booking_details", args: { patientName: "Demo" } }, { id: "b", name: "capture_contact", args: { mode: "append", rawText: "123" } }] } });
    await vi.waitFor(() => expect(h.port.sendToolResponse).toHaveBeenCalledOnce());
    expect(h.commands.map((c) => c.expectedVersion)).toEqual([0, 1]);
    expect(h.commands[0].context.inputTurnId).toBe(h.commands[1].context.inputTurnId);
    expect(h.commands[0].context.attribution).toBe("known");
  });

  it("streams before captions and flushes actual exposure before a subsequent acceptance", async () => {
    let started: () => void = () => undefined;
    const chunks: string[] = [], records: any[] = [];
    const h = await harness({ onStreamStart: (_id: string, start: () => void) => { started = start; }, onStreamChunk: (_id: string, chunk: any) => chunks.push(chunk.data), onRecordedOutput: (id: string, record: unknown) => records.push({ id, record }) });
    h.controller.sendText("what time?");
    h.emit({ serverContent: { modelTurn: { parts: [{ inlineData: { data: "AAAA", mimeType: "audio/pcm;rate=24000" } }] } } });
    expect(chunks).toEqual(["AAAA"]);
    started();
    h.emit({ serverContent: { outputTranscription: { text: "At five", finished: true }, turnComplete: true } });
    h.controller.sendText("yes");
    h.emit(tool("accept_offer", "accept", { offerId: "offer", decision: "accept", detailsCommunicated: true }));
    await vi.waitFor(() => expect(h.commands).toHaveLength(1));
    const media = h.requests.filter((r) => r.url.endsWith("/events"));
    expect(media.some((r) => r.body.medium === "audio" && r.body.exposure === "started")).toBe(true);
    expect(h.commands[0].context.inputStartedEventSequence).toBeGreaterThan(media[0].body.eventSequence);
    expect(records[0].record.transcript).toBe("At five");
    expect(records[0].id).toBe(h.commands[0].context.outputId);
  });

  it("does not treat a late old tool as a fresh caller approval", async () => {
    const h = await harness();
    h.controller.sendText("first");
    h.emit({ serverContent: { outputTranscription: { text: "An offer" } } });
    h.controller.beginMicrophoneTurn();
    h.emit(tool("accept_offer", "late"));
    await vi.waitFor(() => expect(h.commands).toHaveLength(1));
    expect(h.commands[0].context.attribution).toBe("uncertain");
  });

  it("requests farewell first and fences only after playback drain", async () => {
    let finished: () => void = () => undefined;
    const h = await harness({ onStreamStart: (_id: string, _start: unknown, done: () => void) => { finished = done; } });
    h.controller.sendText("bye"); h.emit(tool("end_session", "bye", { outcome: "completed" }));
    await vi.waitFor(() => expect(h.commands).toHaveLength(1));
    h.emit({ serverContent: { modelTurn: { parts: [{ inlineData: { data: "AAAA", mimeType: "audio/pcm;rate=24000" } }] }, turnComplete: true } });
    expect(h.requests.some((r) => r.url.endsWith("/close"))).toBe(false);
    finished();
    await vi.waitFor(() => expect(h.requests.some((r) => r.url.endsWith("/close"))).toBe(true));
  });

  it("new input cancels farewell closing; explicit stop fences immediately", async () => {
    let finished: () => void = () => undefined;
    const h = await harness({ onStreamStart: (_id: string, _start: unknown, done: () => void) => { finished = done; } });
    h.controller.sendText("bye"); h.emit(tool("end_session", "bye", { outcome: "completed" }));
    await vi.waitFor(() => expect(h.commands).toHaveLength(1));
    h.emit({ serverContent: { modelTurn: { parts: [{ inlineData: { data: "AAAA", mimeType: "audio/pcm;rate=24000" } }] }, turnComplete: true } });
    h.controller.sendText("wait"); finished();
    expect(h.requests.some((r) => r.url.endsWith("/close"))).toBe(false);
    await h.controller.stop();
    expect(h.requests.filter((r) => r.url.endsWith("/close"))).toHaveLength(1);
  });

  it("retrieves a lost followup by identical event ID and blocks writes while unresolved", async () => {
    const h = await harness();
    const original = h.fetch.getMockImplementation()!;
    h.fetch.mockImplementation(async (url: any, init?: RequestInit) => {
      if (String(url).endsWith("/tools")) { h.commands.push(JSON.parse(String(init?.body))); throw new Error("lost"); }
      if (String(url).includes("/events/")) return json({ status: "unresolved", snapshot: snapshot() });
      return original(url, init);
    });
    h.controller.sendText("callback"); h.emit(tool("record_followup", "effect", { kind: "callback" }));
    await vi.waitFor(() => expect(h.port.sendToolResponse).toHaveBeenCalledOnce());
    expect(h.commands).toHaveLength(2);
    expect(h.commands[0]).toEqual(h.commands[1]);
    h.emit(tool("set_booking_details", "new", { patientName: "New" }));
    await vi.waitFor(() => expect(h.port.sendToolResponse).toHaveBeenCalledTimes(2));
    expect(h.commands).toHaveLength(2);
    expect(h.port.sendToolResponse.mock.calls[1][0].functionResponses[0].response.status).toBe("outcome_unknown");
  });

  it("muted stream completion reports text exposure without inventing audio exposure", async () => {
    let finished: () => void = () => undefined;
    const h = await harness({ onStreamStart: (_id: string, _start: unknown, done: () => void) => { finished = done; }, onAssistantTranscript: () => undefined });
    h.controller.sendText("time?");
    h.emit({ serverContent: { modelTurn: { parts: [{ inlineData: { data: "AAAA", mimeType: "audio/pcm;rate=24000" } }] }, outputTranscription: { text: "Five", finished: true }, turnComplete: true } });
    finished(); h.controller.sendText("yes"); h.emit(tool("accept_offer", "muted"));
    await vi.waitFor(() => expect(h.commands).toHaveLength(1));
    const events = h.requests.filter((r) => r.url.endsWith("/events")).map((r) => r.body);
    expect(events.some((e) => e.medium === "text" && e.exposure === "started")).toBe(true);
    expect(events.some((e) => e.medium === "audio" && e.exposure !== "not_started")).toBe(false);
  });

  it("reconnects once from snapshot retaining monotonic input/event sequences without write replay", async () => {
    const states: string[] = [];
    const h = await harness({ onState: (state: string) => states.push(state) });
    h.controller.sendText("first"); h.emit(tool("clinic_information", "one"));
    await vi.waitFor(() => expect(h.commands).toHaveLength(1));
    h.emit({ serverContent: { turnComplete: true } });
    h.closeProvider();
    await vi.waitFor(() => expect(h.requests.filter((r) => r.url.endsWith("live-token"))).toHaveLength(2));
    h.controller.sendText("next"); h.emit(tool("clinic_information", "two"));
    await vi.waitFor(() => expect(h.commands).toHaveLength(2));
    expect(h.commands[1].context.inputSequence).toBe(2);
    expect(h.commands[1].context.eventSequence).toBeGreaterThan(h.commands[0].context.eventSequence);
    expect(h.commands[1].context.connectionId).not.toBe(h.commands[0].context.connectionId);
    h.closeProvider();
    await vi.waitFor(() => expect(states.at(-1)).toBe("error"));
    expect(h.requests.filter((r) => r.url.endsWith("live-token"))).toHaveLength(2);
    expect(h.requests.some((r) => r.url.endsWith("/close"))).toBe(false);
  });

  it("reconciles a lost commit using its same operation ID before admitting a new mutation", async () => {
    const h = await harness(); const original = h.fetch.getMockImplementation()!;
    const sent: any[] = [];
    h.fetch.mockImplementation(async (url: any, init?: RequestInit) => {
      if (String(url).endsWith("/tools")) {
        const command = JSON.parse(String(init?.body)); sent.push(command);
        if (command.tool === "commit_request") throw new Error("lost commit");
        if (command.tool === "get_operation") return json({ status: "committed", operationId: "op", result: { appointmentId: "saved" }, snapshot: { ...snapshot(), version: 1 } });
      }
      return original(url, init);
    });
    h.controller.sendText("book"); h.emit(tool("commit_request", "write", { operationId: "op" }));
    await vi.waitFor(() => expect(h.port.sendToolResponse).toHaveBeenCalledOnce());
    expect(sent.map((c) => c.tool)).toEqual(["commit_request", "commit_request", "get_operation"]);
    expect(sent[2].args).toEqual({ operationId: "op" });
    expect(h.port.sendToolResponse.mock.calls[0][0].functionResponses[0].response.status).toBe("committed");
  });

  it("retries a stale UI close with the returned server version before reporting ended", async () => {
    const states: string[] = [];
    const h = await harness({ onState: (state: string) => states.push(state) });
    const original = h.fetch.getMockImplementation()!; const closes: any[] = [];
    h.fetch.mockImplementation(async (url: any, init?: RequestInit) => {
      if (String(url).endsWith("/close")) {
        closes.push(JSON.parse(String(init?.body)));
        return json({ status: closes.length === 1 ? "conflict" : "closed", snapshot: { ...snapshot(), version: closes.length === 1 ? 7 : 8, status: closes.length === 1 ? "active" : "closed" } });
      }
      return original(url, init);
    });
    await h.controller.stop();
    expect(closes.map((c) => c.expectedVersion)).toEqual([0, 7]);
    expect(states.at(-1)).toBe("ended");
  });

  it("cross-onset captions prefer current activity and orphan fragments remain visible without manufacturing consent", async () => {
    const patients: any[] = [];
    const h = await harness({ onPatientTranscript: (...args: unknown[]) => patients.push(args) });
    h.controller.beginMicrophoneTurn(); h.emit(tool("clinic_information", "mic-one"));
    await vi.waitFor(() => expect(h.commands).toHaveLength(1));
    h.emit({ serverContent: { turnComplete: true } });
    h.controller.beginMicrophoneTurn();
    h.emit({ serverContent: { inputTranscription: { text: "earlier words", finished: true } } });
    h.emit({ serverContent: { inputTranscription: { text: "new words", finished: true } } });
    h.emit(tool("accept_offer", "mic-two"));
    await vi.waitFor(() => expect(h.commands).toHaveLength(2));
    expect(h.commands.map((c) => c.context.inputSequence)).toEqual([1, 2]);
    expect(h.commands[1].context.attribution).toBe("known");
    expect(patients.filter((p) => p[1]).map(p=>p.slice(0,3))).toEqual([["earlier words", true, "microphone"], ["new words", true, "microphone"]]);
    expect(patients[0][3]).toBe(h.commands[1].context.inputTurnId);
    expect(patients[1][3]).not.toBe(h.commands[0].context.inputTurnId);
    expect(patients[1][3]).not.toBe(h.commands[1].context.inputTurnId);
  });

  it("a caption trailing generation completion uses the same recorded output and full transcript", async () => {
    const captions: any[] = [], records: any[] = [];
    const h = await harness({ onAssistantTranscript: (...args: unknown[]) => captions.push(args), onRecordedOutput: (...args: unknown[]) => records.push(args) });
    h.controller.sendText("hello");
    h.emit({ serverContent: { modelTurn: { parts: [{ inlineData: { data: "AAAA", mimeType: "audio/pcm;rate=24000" } }] }, outputTranscription: { text: "Hello " }, generationComplete: true } });
    h.emit({ serverContent: { outputTranscription: { text: "there", finished: true }, turnComplete: true } });
    expect(captions.map(c=>c[0])).toEqual(['Hello','Hello there']);
    expect(captions[0][3]).toBe(records[0][0]);
    expect(records.at(-1)[1]).toMatchObject({ transcript: "Hello there", audio: [{ data: "AAAA" }] });
  });

  it("exports correlated tool diagnostics and latency without credentials or PCM", async () => {
    const diagnostics: any[] = [];
    const h = await harness({ onDiagnostic: (event: unknown) => diagnostics.push(event) });
    h.controller.sendText("name"); h.emit(tool("set_booking_details", "diagnostic", { patientName: "Demo", apiKey: "secret" }));
    await vi.waitFor(() => expect(h.commands).toHaveLength(1));
    const result = diagnostics.find((d) => d.event === "reception_tool_result");
    expect(result).toMatchObject({ sessionId: "s", turnId: 1, details: { command: { tool: "set_booking_details", expectedVersion: 0, args: { patientName: "Demo", apiKey: "[omitted]" } }, result: { status: "updated" } } });
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
    expect(JSON.stringify(diagnostics)).not.toContain('"token":"token"');
    expect(JSON.stringify(diagnostics)).not.toContain("secret");
  });

  it("starts a separate output after provider interruption rather than appending to the cancelled audio", async () => {
    const starts: string[] = [];
    const h = await harness({ onStreamStart: (outputId: string) => starts.push(outputId) });
    h.controller.sendText("first");
    h.emit({ serverContent: { modelTurn: { parts: [{ inlineData: { data: "AAAA", mimeType: "audio/pcm;rate=24000" } }] } } });
    h.controller.beginMicrophoneTurn();
    h.emit({ serverContent: { interrupted: true } });
    h.emit({ serverContent: { modelTurn: { parts: [{ inlineData: { data: "BBBB", mimeType: "audio/pcm;rate=24000" } }] }, turnComplete: true } });
    expect(starts).toHaveLength(2);
    expect(starts[1]).not.toBe(starts[0]);
  });

  it("failed farewell playback leaves domain session active and exposes restart instead of ending", async () => {
    const states: string[] = []; let failed: () => void = () => undefined;
    const h = await harness({ onState: (s: string) => states.push(s), onStreamStart: (_id: string, _start: unknown, _done: unknown, error: () => void) => { failed = error; } });
    h.controller.sendText("bye"); h.emit(tool("end_session", "failure", { outcome: "completed" }));
    await vi.waitFor(() => expect(h.commands).toHaveLength(1));
    h.emit({ serverContent: { modelTurn: { parts: [{ inlineData: { data: "AAAA", mimeType: "audio/pcm;rate=24000" } }] }, turnComplete: true } });
    failed();
    expect(h.requests.some((r) => r.url.endsWith("/close"))).toBe(false);
    expect(states.at(-1)).toBe("error");
  });

  it("generation completion alone does not attribute a trailing old tool to newer microphone input", async () => {
    const h = await harness();
    h.controller.sendText("first");
    h.emit({ serverContent: { outputTranscription: { text: "Offer" }, generationComplete: true } });
    h.controller.beginMicrophoneTurn(); h.emit(tool("accept_offer", "after-generation"));
    await vi.waitFor(() => expect(h.commands).toHaveLength(1));
    expect(h.commands[0].context.attribution).toBe("uncertain");
  });

  it("missed microphone VAD supplies uncertain audio activity without waiting for captions", async () => {
    const h = await harness();
    h.controller.sendMicrophoneAudio("AAAA");
    h.emit(tool("accept_offer", "no-vad"));
    await vi.waitFor(() => expect(h.commands).toHaveLength(1));
    expect(h.commands[0].context).toMatchObject({ source: "microphone", attribution: "uncertain", inputSequence: 1 });
  });

  it("unresolved commit blocks a lookup that could replace contact", async () => {
    const h = await harness(); const original = h.fetch.getMockImplementation()!;
    const tools: string[] = [];
    h.fetch.mockImplementation(async (url: any, init?: RequestInit) => {
      if (String(url).endsWith("/tools")) {
        const command = JSON.parse(String(init?.body)); tools.push(command.tool);
        if (command.tool === "commit_request") throw new Error("lost");
        if (command.tool === "get_operation") return json({ status: "unresolved", snapshot: snapshot() });
      }
      return original(url, init);
    });
    h.controller.sendText("commit"); h.emit(tool("commit_request", "unknown", { operationId: "same" }));
    await vi.waitFor(() => expect(h.port.sendToolResponse).toHaveBeenCalledOnce());
    h.emit(tool("find_my_appointments", "lookup", { phone: "0555555555" }));
    await vi.waitFor(() => expect(h.port.sendToolResponse).toHaveBeenCalledTimes(2));
    expect(tools).not.toContain("find_my_appointments");
    expect(h.port.sendToolResponse.mock.calls[1][0].functionResponses[0].response).toMatchObject({ status: "outcome_unknown", snapshot: { contact: { digits: "" } } });
  });

  it("allows an emergency pause while a commit is unresolved and retains that operation for recovery", async () => {
    const h = await harness(); const original = h.fetch.getMockImplementation()!;
    const commands: any[] = [];
    h.fetch.mockImplementation(async (url: any, init?: RequestInit) => {
      if (String(url).endsWith("/tools")) {
        const command = JSON.parse(String(init?.body)); commands.push(command);
        if (command.tool === "commit_request") throw new Error("lost");
        if (command.tool === "get_operation") return json({ status: "unresolved", snapshot: snapshot() });
        if (command.tool === "set_emergency") return json({ status: "paused", snapshot: { ...snapshot(), status: "paused", version: 1 } });
      }
      return original(url, init);
    });
    h.controller.sendText("commit"); h.emit(tool("commit_request", "pending-commit", { operationId: "pending" }));
    await vi.waitFor(() => expect(h.port.sendToolResponse).toHaveBeenCalledOnce());
    h.emit(tool("set_emergency", "pause", { active: true }));
    await vi.waitFor(() => expect(h.port.sendToolResponse).toHaveBeenCalledTimes(2));
    expect(commands.some((c) => c.tool === "set_emergency" && c.args.active)).toBe(true);
    h.emit(tool("set_emergency", "resume", { active: false }));
    await vi.waitFor(() => expect(h.port.sendToolResponse).toHaveBeenCalledTimes(3));
    expect(commands.filter((c) => c.tool === "set_emergency")).toHaveLength(1);
    expect(commands.filter((c) => c.tool === "get_operation").every((c) => c.args.operationId === "pending")).toBe(true);
  });
});
