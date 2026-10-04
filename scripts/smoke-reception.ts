import "dotenv/config";
import { GoogleGenAI } from "@google/genai";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { createApp } from "../src/server/app";
import { openReceptionDatabase } from "../src/server/reception/database";
import { ReceptionService } from "../src/server/reception/service";
import { createGeminiTokenIssuer } from "../src/server/services/geminiTokenService";
import { ReceptionSessionController, type RecordedOutput } from "../src/client/voice/receptionSession";
import type { SessionDiagnostic } from "../src/client/logging/sessionDiagnostic";
import {
  RECEPTION_CALLER_TURNS,
  assertRecordedAgentReply,
  assertSavedBookingMatchesAcceptedOffer,
  loadReceptionAudioFixture,
  receptionAudioFixturePath,
  replayPcm16Mono16kWav,
  type RecordedAgentReply,
} from "./receptionAudio";

// Actual new controller/provider/audio. Only disposable synthetic SQLite effects.
const language = process.argv.includes("--english") ? "en" : "ar";
const dictated = process.argv.includes("--dictated");
const regressions = process.argv.includes('--regressions');
const audioMode = process.argv.includes("--audio");
const usesDictated = dictated || audioMode;
const rounds = Number(process.argv.find(arg => arg.startsWith("--rounds="))?.split("=")[1] ?? 2);
if (!Number.isInteger(rounds) || rounds < 1 || rounds > 3) throw new Error("rounds must be between 1 and 3");
if (audioMode && regressions) throw new Error("--regressions is available only in the existing typed smoke mode.");
const callerAudio = new Map<string, { path: string; wav: Buffer }>();
if (audioMode) {
  for (const turn of RECEPTION_CALLER_TURNS[language]) {
    const path = receptionAudioFixturePath(language, turn.id);
    try {
      callerAudio.set(turn.id, { path, wav: loadReceptionAudioFixture(path) });
    } catch (cause) {
      const detail = cause instanceof Error ? cause.message : "invalid WAV fixture";
      throw new Error(`Cannot replay caller turn ${turn.id}: ${path} (${detail}). Generate or repair the fixture first.`);
    }
  }
}
const apiKey = process.env.GEMINI_API_KEY?.trim();
if (!apiKey) throw new Error("Live credentials are not configured.");
const directory = resolve(`output/reception-live/${new Date().toISOString().replaceAll(/[:.]/g,"-")}-${language}-${usesDictated?"dictated":"known"}${audioMode?"-audio":""}`);
mkdirSync(directory,{recursive:true});
const reports: Array<Record<string, unknown>> = [];
let failures = 0;
for(let round=1;round<=rounds;round++) {
  const fixtureClock=regressions?()=>new Date('2026-10-03T05:00:00Z'):undefined;
  const db=openReceptionDatabase(":memory:",{clock:fixtureClock});const service=new ReceptionService(db,{clock:fixtureClock});
  const issuer=createGeminiTokenIssuer(new GoogleGenAI({apiKey,apiVersion:"v1beta"}).authTokens);
  const server=createApp({receptionService:service,geminiTokenIssuer:issuer}).listen(0,"127.0.0.1");
  await new Promise<void>(done=>server.once("listening",done));
  const address=server.address();if(!address||typeof address==='string')throw new Error("No local fixture address");
  const base=`http://127.0.0.1:${address.port}`;
  const dialogue:Array<Record<string,unknown>>=[],diagnostics:SessionDiagnostic[]=[],records=new Map<string,RecordedOutput>();
  const bookingTransitions:Array<Record<string,any>>=[];
  const patientCaptions:Array<{text:string;final:boolean;source:string;inputTurnId:string|undefined}> = [];
  let activeReplyOutputIds = new Set<string>();
  let acceptedOffer:{doctorId:string;startsAtUtc:string;offerId:string}|undefined;
  const streams=new Map<string,{started:number;bytes:number;finish:()=>void}>();
  let finish:(()=>void)|undefined,latest='',toolResults:Array<{toolName:string;status:string}>=[];
  let currentSessionId='',stage='initial connection',errorReason:string|undefined;
  let lastSnapshot:Record<string,any>|undefined;
  const count=()=>Number((db.prepare('SELECT COUNT(*) n FROM reception_appointments').get() as {n:number}).n);
  const effectCount=()=>Number((db.prepare('SELECT COUNT(*) n FROM reception_effects').get() as {n:number}).n);
  const occupancyCount=()=>Number((db.prepare('SELECT COUNT(*) n FROM reception_occupancy').get() as {n:number}).n);
  const controller=new ReceptionSessionController({
    fetch:async(input,init)=>globalThis.fetch(typeof input==='string'&&input.startsWith('/')?`${base}${input}`:input,init),
    onDiagnostic(event){
      diagnostics.push(event);
      if(event.event==='reception_connected')currentSessionId=event.sessionId;
      if(event.event==='reception_tool_result'){
        const details=event.details as Record<string,any>|undefined;
        const result=details?.result as Record<string,any>|undefined;
        const command=details?.command as Record<string,any>|undefined;
        const snapshot=result?.snapshot as Record<string,any>|undefined;
        lastSnapshot=snapshot;
        const acceptedOfferId=snapshot?.draft?.acceptedOfferId;
        const offer=command?.tool==='accept_offer'?snapshot?.offers?.find((candidate:any)=>candidate.offerId===acceptedOfferId):undefined;
        if(offer)acceptedOffer={doctorId:String(offer.doctorId),startsAtUtc:String(offer.startsAtUtc),offerId:String(offer.offerId)};
        if(command&&result&&['accept_offer','capture_contact','confirm_contact','commit_request'].includes(String(command.tool))&&['needs_details','invalid_contact','ready','committed'].includes(String(result.status))){
          bookingTransitions.push({inputTurnId:command.context?.inputTurnId,stage,tool:command.tool,status:result.status,offerAccepted:Boolean(acceptedOfferId),acceptedOfferId:acceptedOfferId??null,operationId:result.operationId??null,facts:result.facts??{},missingFields:result.missingFields??[],issues:result.issues??[],appointmentCount:count(),effectCount:effectCount(),occupancyCount:occupancyCount()});
        }
      }
    },
    onPatientTranscript(text,final,source,inputTurnId){if(audioMode)patientCaptions.push({text,final,source,inputTurnId});},
    onAssistantTranscript(text,_language,_final,outputId){latest=text;if(outputId)activeReplyOutputIds.add(outputId);},
    onRecordedOutput(id,output){if(output.transcript&&records.get(id)?.transcript!==output.transcript)console.info(`AGENT: ${output.transcript}`);records.set(id,output);},
    onStreamStart(id,onStarted,onFinished){streams.set(id,{started:Date.now(),bytes:0,finish:onFinished});onStarted();},
    onStreamChunk(id,chunk){const stream=streams.get(id);if(stream)stream.bytes+=Buffer.from(chunk.data,'base64').length;},
    onStreamEnd(id){const stream=streams.get(id);if(stream)setTimeout(()=>{stream.finish();finish?.();},Math.max(0,stream.bytes/48-(Date.now()-stream.started))+150);},
    onToolResult(event){toolResults.push(event);console.info(`FUNCTION: ${event.toolName} -> ${event.status}`);},
    onError(){failures++;finish?.();console.error("Live media/transport error; see sanitized diagnostics.");},
  });
  async function reply(stage:string,action:()=>void|Promise<void>):Promise<RecordedAgentReply[]> {
    activeReplyOutputIds=new Set();
    let timer:ReturnType<typeof setTimeout>;
    const completed=new Promise<void>((done,reject)=>{finish=done;timer=setTimeout(()=>reject(new Error("Reply timeout")),45_000);});
    try{await action();await completed;await new Promise(done=>setTimeout(done,400));}
    catch(cause){
      if(audioMode&&cause instanceof Error&&cause.message==="Reply timeout"){
        const outputs=[...activeReplyOutputIds].map(outputId=>{const output=records.get(outputId);return{outputId,transcript:output?.transcript??"",audioBytes:output?.audio.reduce((total,chunk)=>total+Buffer.from(chunk.data,"base64").length,0)??0};});
        assertRecordedAgentReply(stage,outputs);
        throw new Error(`Agent audio reply timed out during ${stage}.`);
      }
      throw cause;
    }
    finally{clearTimeout(timer!);finish=undefined;}
    if(!audioMode)return [];
    const outputs=[...activeReplyOutputIds].map(outputId=>{const output=records.get(outputId);return{outputId,transcript:output?.transcript??"",audioBytes:output?.audio.reduce((total,chunk)=>total+Buffer.from(chunk.data,"base64").length,0)??0};});
    assertRecordedAgentReply(stage,outputs);
    return outputs;
  }
  const callerName=language==='ar'?'أحمد':'Ahmed';
  const typedTurns=language==='ar'?[
    "إيش تخصصات العيادة؟",
    regressions?'أبغى موعد عند ندى الخطيب بكرة الساعة تسعة صباحًا.':'إيش أقرب مواعيد ندى الخطيب الأسبوع الجاي؟',
    "أول موعد عرضتيه مناسب، احجزيه لي.",
    `اسمي ${callerName}.`,
    ...(dictated?["رقم جوالي واحد ثلاثة ثلاثة.","إيه، هذا اللي قلته.","رقمي كامل صفر خمسة صفر واحد اثنين ثلاثة أربعة خمسة ستة سبعة.","إيه، رقم الجوال اللي قريتيه صحيح."]:[]),
  ]:[
    "What specialties are in your clinic?",
    regressions?"I want an appointment with Dr Nada Al-Khatib tomorrow at 9 AM.":"What is Dr Nada Al-Khatib's earliest opening next week?",
    "The first appointment you offered works. Please book that one.",
    `My name is ${callerName}.`,
    ...(dictated?["My mobile is one three three.","Yes, that is what I said.","The full number is zero five zero one two three four five six seven.","Yes, the phone number you read is correct."]:[]),
  ];
  const turns=audioMode?RECEPTION_CALLER_TURNS[language].map(turn=>turn.text):typedTurns;
  let error=false;
  try {
    await reply('initial connection',()=>controller.connect({simulatedCallingNumber:usesDictated?undefined:'0501234567'}));
    for(const [index,text]of turns.entries()){
      const audioTurn=audioMode?RECEPTION_CALLER_TURNS[language][index]:undefined;
      stage=`booking turn ${index+1}${audioTurn?` (${audioTurn.id})`:''}`;
      latest='';toolResults=[];patientCaptions.length=0;console.info(`CALLER: ${text}`);
      const transitionStart=bookingTransitions.length;
      const agentOutputs=await reply(stage,async()=>{
        if(audioTurn){const fixture=callerAudio.get(audioTurn.id)!;await replayPcm16Mono16kWav(controller,fixture.wav);return;}
        if(!controller.sendText(text))throw new Error("Voice not connected");
      });
      for(const transition of bookingTransitions.slice(transitionStart)){
        transition.caller=text;transition.assistant=latest;transition.agentOutputs=agentOutputs;
      }
      const turnCaptions=patientCaptions.map(caption=>({...caption}));
      if(audioMode&&!turnCaptions.some(caption=>caption.source==='microphone'&&caption.text.trim()))throw new Error(`No patient microphone transcript was captured for ${stage}.`);
      dialogue.push({caller:text,...(audioTurn?{inputAudioFixture:callerAudio.get(audioTurn.id)!.path,patientCaptions:turnCaptions,agentOutputs}:{}),assistant:latest,tools:toolResults,appointmentCount:count()});
      if(index===0&&service.activity().appointments.length)throw new Error("Browsing booked an appointment");
      if(usesDictated&&(index===4||index===5)&&(count()!==0||effectCount()!==0||occupancyCount()!==0))throw new Error("Partial contact changed booking storage");
      if(usesDictated&&index===4){
        const incomplete=bookingTransitions.filter(transition=>transition.offerAccepted&&transition.acceptedOfferId&&['invalid_contact','needs_details'].includes(transition.status));
        if(!incomplete.length)throw new Error('Accepted offer incomplete-contact transition was not captured.');
        for(const transition of incomplete){
          const facts=transition.facts as Record<string,any>;
          if(facts.bookingStatus!=='not_booked'||facts.appointmentSaved!==false||facts.slotReserved!==false||facts.capacityHeld!==false||transition.operationId||transition.appointmentCount!==0||transition.effectCount!==0||transition.occupancyCount!==0)throw new Error('Accepted offer lifecycle facts or database effects were not truthful before contact repair.');
        }
      }
    }
    if(usesDictated){
      const accepted=bookingTransitions.find(transition=>transition.offerAccepted&&transition.status==='invalid_contact');
      const ready=bookingTransitions.find(transition=>transition.offerAccepted&&transition.status==='ready'&&transition.acceptedOfferId===accepted?.acceptedOfferId);
      const committed=bookingTransitions.find(transition=>transition.status==='committed'&&transition.operationId===ready?.operationId);
      if(!accepted||!ready||!committed)throw new Error('Accepted contact-repair lifecycle did not reach invalid_contact, ready, and committed results.');
      if(ready.appointmentCount!==0||ready.effectCount!==0||ready.occupancyCount!==0)throw new Error('Ready operation changed booking storage before commit.');
      if(committed.appointmentCount!==1||committed.effectCount!==1||committed.occupancyCount!==2)throw new Error('Committed result does not match the saved appointment and capacity effects.');
    }
    if(audioMode){
      stage='audio booking database verification';
      if(!acceptedOffer)throw new Error('The accepted database offer facts were not captured.');
      assertSavedBookingMatchesAcceptedOffer(stage,service.activity().appointments,acceptedOffer,callerName,'0501234567');
    }else if(count()!==1){failures++;error=true;console.error(`Expected one saved appointment; actual=${count()}`);}
    if(regressions&&!error){
      stage='first-name and Saudi time persistence';
      const saved=service.activity().appointments[0];
      if(saved.patientName!==callerName||saved.startsAtUtc!=='2026-10-04T06:00:00.000Z')throw new Error('First-name or Saudi appointment storage mismatch');
      const storedBefore=JSON.stringify(db.prepare('SELECT * FROM reception_appointments').all());
      await controller.stop();
      stage='fresh session connection';
      await reply('fresh session connection',()=>controller.connect({simulatedCallingNumber:'0501234567'}));
      latest='';toolResults=[];
      const text=language==='ar'?'أبغى أراجع موعدي المحفوظ. متى التاريخ والساعة؟':'Please look up my saved appointment. What is its date and time?';
      stage='fresh session appointment lookup';
      console.info(`CALLER (FRESH SESSION): ${text}`);await reply('fresh session appointment lookup',()=>{controller.sendText(text);});
      dialogue.push({freshSession:true,caller:text,assistant:latest,tools:toolResults,activity:service.activity()});
      if(!toolResults.some(t=>t.toolName==='find_my_appointments'&&t.status==='ok'))throw new Error('Fresh-session appointment lookup did not return stored facts');
      // This narrow fixture assertion catches the observed 6 AM UTC report.
      // It permits ordinary digits or spoken hour words; it is not a runtime output gate.
      const normalized=latest.replace(/[٠-٩]/g,digit=>String('٠١٢٣٤٥٦٧٨٩'.indexOf(digit)));
      const nine=language==='ar'?/(?:9(?:[:٫]00)?|تسعة|التاسعة)/.test(normalized):/\b(?:9(?::00)?|nine)\b/i.test(normalized);
      const morning=language==='ar'?/صباح/.test(normalized):/\b(?:a\.?m\.?|morning)\b/i.test(normalized);
      if(!nine||!morning)throw new Error('Fresh-session spoken lookup did not report 9 AM Saudi local time');
      dialogue.at(-1)!.spokenSaudiTimePassed=true;
      if(JSON.stringify(db.prepare('SELECT * FROM reception_appointments').all())!==storedBefore)throw new Error('Lookup changed appointment storage');
    }
    // Query and cancel using semantic offer acceptance; independent DB status is authoritative.
    if(!error&&!audioMode){
      for(const text of language==='ar'?["أبغى أراجع موعدي اللي حجزناه.","أبغى ألغي الموعد.","إيه، ألغي الموعد اللي وضحتيه."]:["Please find the appointment we just booked.","I want to cancel that appointment.","Yes, cancel the appointment you described."]){
        stage='lookup and cancellation';
        latest='';toolResults=[];console.info(`CALLER: ${text}`);await reply('lookup and cancellation',()=>{controller.sendText(text);});dialogue.push({caller:text,assistant:latest,tools:toolResults,activity:service.activity()});
      }
      if(service.activity().appointments[0]?.status!=='cancelled'){failures++;error=true;console.error("Cancellation was not saved.");}
      latest='';toolResults=[];
      const goodbye=language==='ar'?'لا، ما أحتاج شيء ثاني. شكرًا، مع السلامة.':'No, I do not need anything else. Thank you, goodbye.';
      stage='farewell closure';
      console.info(`CALLER: ${goodbye}`);await reply('farewell closure',()=>{controller.sendText(goodbye);});
      const envelope=JSON.parse((db.prepare('SELECT data FROM reception_sessions WHERE id=?').get(currentSessionId) as {data:string}).data);
      dialogue.push({caller:goodbye,assistant:latest,tools:toolResults,sessionId:currentSessionId,sessionStatus:envelope.status});
      if(envelope.status!=='closed'){failures++;error=true;console.error('Farewell did not close the server session after playback.');}
    }
  }catch(cause){
    const known=['Reply timeout','Voice not connected','First-name or Saudi appointment storage mismatch','Fresh-session appointment lookup did not return stored facts','Fresh-session spoken lookup did not report 9 AM Saudi local time','Lookup changed appointment storage','Partial contact changed booking storage','Accepted offer incomplete-contact transition was not captured.','Accepted offer lifecycle facts or database effects were not truthful before contact repair.','Accepted contact-repair lifecycle did not reach invalid_contact, ready, and committed results.','Ready operation changed booking storage before commit.','Committed result does not match the saved appointment and capacity effects.'];
    const message=cause instanceof Error?cause.message:'';
    const safeAudioDiagnosis=/^(?:No recorded agent reply|No agent transcript was recorded|Agent reply for|Agent audio reply timed out|No patient microphone transcript|audio booking database verification:|The accepted database offer facts|Partial contact booked)/.test(message);
    errorReason=known.includes(message)||safeAudioDiagnosis?message:'Live scenario error (provider details omitted)';
    failures++;error=true;console.error(`Live scenario failed during ${stage}: ${errorReason}`);
  }
  finally{
    await controller.stop();
    for(const[id,output]of records){
      const pcm=Buffer.concat(output.audio.map(chunk=>Buffer.from(chunk.data,'base64')));if(!pcm.length)continue;
      const header=Buffer.alloc(44);header.write('RIFF',0);header.writeUInt32LE(pcm.length+36,4);header.write('WAVEfmt ',8);header.writeUInt32LE(16,16);header.writeUInt16LE(1,20);header.writeUInt16LE(1,22);header.writeUInt32LE(24000,24);header.writeUInt32LE(48000,28);header.writeUInt16LE(2,32);header.writeUInt16LE(16,34);header.write('data',36);header.writeUInt32LE(pcm.length,40);
      writeFileSync(join(directory,`${round}-${id}.wav`),Buffer.concat([header,pcm]));
    }
    reports.push({round,language,dictated:usesDictated,regressions,audioMode,effectsPassed:!error,...(errorReason?{errorReason,failedStage:stage}:{}),dialogue,bookingTransitions,...(audioMode?{patientCaptions:dialogue.flatMap(entry=>Array.isArray(entry.patientCaptions)?entry.patientCaptions:[])}:{}),diagnostics,activity:service.activity(),lastSnapshot,audio:[...records].map(([id,out])=>({outputId:id,transcript:out.transcript,audioBytes:out.audio.reduce((n,c)=>n+Buffer.from(c.data,'base64').length,0),path:join(directory,`${round}-${id}.wav`)})),limits:audioMode?'TTS-generated caller audio is replayed through the Live microphone interface. Actual recognition, saved DB facts and agent audio are recorded; TTS speech does not evaluate real Saudi-accent recognition or human voice quality.':'Typed input with simulated streaming playback timing; actual generated audio saved. DB effect checks are automated; spoken semantic review and microphone/accent evaluation are separate.'});
    await new Promise<void>(done=>server.close(()=>done()));db.close();
  }
}
writeFileSync(join(directory,'report.json'),JSON.stringify({createdAt:new Date().toISOString(),failures,reports},null,2));
console.info(`Report: ${join(directory,'report.json')}`);
process.exitCode=failures?1:0;
