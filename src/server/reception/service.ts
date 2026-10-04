import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import type { ReceptionOptions } from "./database";
import type { ReceptionClose, ReceptionCommand, ReceptionContact, ReceptionDraft, ReceptionMediaEvent, ReceptionOffer, ReceptionResult, ReceptionSnapshot } from "../../shared/reception";
import { captureReceptionContact, confirmReceptionContact, createReceptionContact, isReceptionContactValid, type ReceptionContactCapture } from "../../shared/receptionContact";
import { appointmentLabels } from "../../shared/appointmentLabels";
import { normalizeCommonRelativeDate } from "../../shared/relativeDate";
import { resolveAlias } from "../services/aliasResolver";
import type { DoctorRecord } from "../repositories/doctorRepository";
import { resolveRelativeReceptionWindow } from "./windows";

type Envelope = { id: string; version: number; status: ReceptionSnapshot["status"]; callingNumber?: string; patientName?: string; callerName?:string; relationship?:string; serviceId?:string; contact: ReceptionContact; draft?: ReceptionDraft; captureInputSequence: number; latestInputSequence: number; lookupIds: string[]; preferences?: Record<string, unknown>; pendingClose?: Record<string, unknown> };
type Operation = { id: string; session_id: string; status: "ready" | "committed" | "rejected"; payload: string; result: string | null };
type Payload = { draft: ReceptionDraft; offer: ReceptionOffer; contact: ReceptionContact };
type Appointment = { id: string; subject_id: string; doctor_id: string; service_id: string; starts_at_utc: string; version: number; status: "active" | "cancelled"; classification?: string; data: string };
type Outcome = Omit<ReceptionResult, "snapshot">;
const stringify = (value: unknown): string => JSON.stringify(value, (_key, item) => item && typeof item === "object" && !Array.isArray(item) ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b))) : item);
const localDate = (now: Date) => new Date(now.getTime() + 3 * 3_600_000).toISOString().slice(0, 10);
const nextDate = (date: string, days = 1) => new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
const validDate = (date: string) => /^\d{4}-\d{2}-\d{2}$/.test(date) && Number.isFinite(Date.parse(`${date}T00:00:00Z`)) && new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) === date;
const validTime = (time: string) => /^([01]\d|2[0-3]):[0-5]\d$/.test(time);

export class ReceptionService {
  private clock: () => Date;
  constructor(private db: Database.Database, options: ReceptionOptions = {}) { this.clock = options.clock ?? (() => new Date()); }
  private load(id: string): Envelope | undefined { const row = this.db.prepare("SELECT data FROM reception_sessions WHERE id=?").get(id) as {data:string} | undefined; return row ? JSON.parse(row.data) : undefined; }
  private save(session: Envelope) { this.db.prepare("UPDATE reception_sessions SET data=? WHERE id=?").run(JSON.stringify(session), session.id); }
  private doctors(): DoctorRecord[] { return (this.db.prepare("SELECT data FROM reception_doctors ORDER BY id").all() as {data:string}[]).map(row => JSON.parse(row.data)); }
  private clinic(): Record<string, unknown> { return JSON.parse((this.db.prepare("SELECT value FROM reception_metadata WHERE key='clinic'").get() as {value:string}).value); }
  /** Presentation is refreshed at read boundaries; durable appointment truth stays UTC. */
  private projectDates<T>(value: T, now = this.clock()): T {
    if (Array.isArray(value)) return value.map(item => this.projectDates(item, now)) as T;
    if (!value || typeof value !== 'object') return value;
    const data = Object.fromEntries(Object.entries(value).map(([key,item]) => [key,this.projectDates(item,now)]));
    if (typeof data.startsAtUtc === 'string' && Number.isFinite(Date.parse(data.startsAtUtc))) data.labels = {ar:appointmentLabels(data.startsAtUtc,'ar',now),en:appointmentLabels(data.startsAtUtc,'en',now)};
    return data as T;
  }
  createSession(callingNumber?: string): ReceptionSnapshot {
    const contact = createReceptionContact(callingNumber);
    if (callingNumber?.trim() && !isReceptionContactValid(contact)) throw new Error("invalid_calling_number");
    const session: Envelope = { id: randomUUID(), version: 0, status: "active", callingNumber: callingNumber?.trim() ? contact.digits : undefined, contact, captureInputSequence: 0, latestInputSequence: 0, lookupIds: [] };
    this.db.prepare("INSERT INTO reception_sessions VALUES (?,?)").run(session.id, JSON.stringify(session)); return this.getSnapshot(session.id)!;
  }
  getSnapshot(id: string): ReceptionSnapshot | undefined {
    const s = this.load(id); if (!s) return undefined;
    const now = this.clock();
    const offers = (this.db.prepare("SELECT data FROM reception_offers WHERE session_id=? ORDER BY rowid").all(id) as {data:string}[]).map(row => JSON.parse(row.data) as ReceptionOffer).filter(offer => offer.draftId === s.draft?.draftId && offer.subjectRevision === s.draft.subjectRevision && offer.selectionRevision === s.draft.selectionRevision);
    const operations = (this.db.prepare("SELECT * FROM reception_operations WHERE session_id=? ORDER BY rowid").all(id) as Operation[]).map(op => ({ operationId: op.id, status: op.status, ...(op.result ? {result: JSON.parse(op.result)} : {}) }));
    return this.projectDates({ sessionId: s.id, version: s.version, status: s.status, callingNumber: s.callingNumber,
      clock: { nowIso: now.toISOString(), timeZone: "Asia/Riyadh", localDate: localDate(now) },
      directory: this.doctors().map(d => ({ doctorId:d.id, nameAr:d.nameAr, nameEn:d.nameEn, specialtyId:d.specialtyId, specialtyAr:d.specialtyAr, specialtyEn:d.specialtyEn })),
      clinic: this.clinic(), patientName:s.patientName, contact:s.contact, draft:s.draft ? {...s.draft,contact:s.contact} : undefined, offers, operations }, now);
  }
  private response(id: string, outcome: Outcome): ReceptionResult {
    const snapshot=this.getSnapshot(id)!;
    const pending=snapshot.draft&&['availability','offers','ready','needs_details','invalid_contact','needs_clarification'].includes(outcome.status);
    const facts=this.projectDates(outcome.facts,new Date(snapshot.clock.nowIso));
    const missingFields=outcome.missingFields??[];
    const requiredFunction=facts?.requiredFunction??(outcome.status==='ready'?'commit_request':undefined)??
      (missingFields.includes('confirmed_contact')?(snapshot.contact.issue||!snapshot.contact.digits?'capture_contact':'confirm_contact'):undefined)??
      (outcome.status==='invalid_contact'?'capture_contact':undefined)??
      (missingFields.includes('patientName')?'set_booking_details':undefined);
    return {...this.projectDates(outcome,new Date(snapshot.clock.nowIso)),...(pending?{facts:{...facts,action:snapshot.draft!.action,...(snapshot.draft!.action==='book'?{offerAccepted:Boolean(snapshot.draft!.acceptedOfferId),bookingStatus:'not_booked'}:{}),effectCommitted:false,currentRequestSaved:false,appointmentSaved:false,slotReserved:false,capacityHeld:false,appointmentUnchanged:true,...(requiredFunction?{requiredFunction}:{})}}:{}),snapshot};
  }
  getEvent(id: string, eventId: string): ReceptionResult | {status:"unresolved";snapshot:ReceptionSnapshot} | undefined {
    if (!this.load(id)) return undefined;
    const row = this.db.prepare("SELECT result FROM reception_events WHERE session_id=? AND id=?").get(id,eventId) as {result:string|null} | undefined;
    if(row && !row.result) return {status:"unresolved",snapshot:this.getSnapshot(id)!};
    return this.response(id, row ? JSON.parse(row.result!) : {status:"not_found"});
  }
  recordMediaEvent(id: string, event: ReceptionMediaEvent): {status:string} {
    return this.db.transaction(() => {
      if (!this.load(id)) return {status:"not_found"};
      const fingerprint=stringify(event); const old=this.db.prepare("SELECT fingerprint FROM reception_media WHERE session_id=? AND id=?").get(id,event.eventId) as {fingerprint:string}|undefined;
      if(old) return {status:old.fingerprint===fingerprint?"ok":"conflict"};
      this.db.prepare("INSERT INTO reception_media VALUES (?,?,?,?)").run(id,event.eventId,fingerprint,JSON.stringify(event)); return {status:"ok"};
    }).immediate();
  }
  execute(id: string, command: ReceptionCommand): ReceptionResult {
    if (!this.load(id)) throw new Error("session_not_found");
    try {
      return this.db.transaction(() => {
        const s=this.load(id)!; const fingerprint=stringify(command);
        const prior=this.db.prepare("SELECT fingerprint,result FROM reception_events WHERE session_id=? AND id=?").get(id,command.eventId) as {fingerprint:string;result:string|null}|undefined;
        if(prior && (prior.fingerprint!==fingerprint||prior.result)) return this.response(id,prior.fingerprint!==fingerprint?{status:"conflict",issues:["event_payload_changed"]}:JSON.parse(prior.result!));
        // Recovery of a durable operation precedes all stale-version and admission checks.
        const op=command.tool==="commit_request"||command.tool==="get_operation"?this.operation(s.id,String(command.args.operationId)):undefined;
        let outcome: Outcome;
        if(op?.status==="committed"||op?.status==="rejected") outcome={status:op.status,operationId:op.id,result:op.result?JSON.parse(op.result):undefined};
        else if(command.tool!=="get_operation" && command.expectedVersion!==s.version) outcome={status:"conflict",issues:["stale_session_version"]};
        else if(s.status!=="active"&&!['get_operation','set_emergency','clinic_information','__close'].includes(command.tool)) outcome={status:s.status};
        else {
          const before=JSON.stringify(s);
          const late=command.context.inputSequence<s.latestInputSequence;
          s.latestInputSequence=Math.max(s.latestInputSequence,command.context.inputSequence);
          if(s.pendingClose && command.context.inputSequence>Number(s.pendingClose.inputSequence)) delete s.pendingClose;
          const effective=late?{...command,context:{...command.context,attribution:"uncertain" as const}}:command;
          outcome=this.handle(s,effective);
          if(JSON.stringify(s)!==before) { s.version++; this.save(s); }
        }
        this.db.prepare("INSERT INTO reception_events VALUES (?,?,?,?) ON CONFLICT(session_id,id) DO UPDATE SET result=excluded.result").run(id,command.eventId,fingerprint,JSON.stringify(outcome));
        return this.response(id,outcome);
      }).immediate();
    } catch {
      // A failed transaction leaves its operation ready and can be retried by the same ID.
      this.db.prepare("INSERT OR IGNORE INTO reception_events VALUES (?,?,?,NULL)").run(id,command.eventId,stringify(command));
      return this.response(id,{status:"error",issues:["transaction_failed_retry_same_operation"]});
    }
  }
  closeSession(id: string, close: ReceptionClose): ReceptionResult {
    return this.execute(id,{eventId:close.eventId,expectedVersion:close.expectedVersion,tool:"__close",args:close,context:{connectionId:"close",inputTurnId:"close",inputSequence:0,eventSequence:0,inputStartedEventSequence:0,source:"text",attribution:"known"}});
  }
  private operation(sessionId:string,id:string): Operation|undefined { return this.db.prepare("SELECT * FROM reception_operations WHERE id=? AND session_id=?").get(id,sessionId) as Operation|undefined; }
  private invalidate(s:Envelope, selection=false) {
    if(s.draft) { delete s.draft.operationId; if(selection){delete s.draft.acceptedOfferId;s.draft.selectionRevision++;} }
    this.db.prepare("UPDATE reception_operations SET status='rejected',result=? WHERE session_id=? AND status='ready'").run(JSON.stringify({issue:"superseded"}),s.id);
  }
  private draft(s:Envelope): ReceptionDraft {
    if(!s.draft) s.draft={draftId:randomUUID(),action:"book",subjectKey:randomUUID(),subjectRevision:0,selectionRevision:0,patientName:s.patientName,callerName:s.callerName,relationship:s.relationship,serviceId:s.serviceId,contact:s.contact};
    return s.draft;
  }
  private ready(s:Envelope): Outcome {
    if(!s.draft?.acceptedOfferId) return {status:"updated"};
    const d=s.draft;
    if(!isReceptionContactValid(s.contact)&&d.action!=="summary_link") return {status:s.contact.issue?"invalid_contact":"needs_details",issues:s.contact.issue?[s.contact.issue]:undefined,missingFields:["confirmed_contact"]};
    if(!d.patientName?.trim()&&d.action==="book") return {status:"needs_details",missingFields:["patientName"]};
    if(!d.operationId) {
      const row=this.db.prepare("SELECT data FROM reception_offers WHERE id=? AND session_id=?").get(d.acceptedOfferId,s.id) as {data:string}|undefined;
      if(!row) return {status:"conflict",issues:["offer_missing"]};
      d.operationId=randomUUID();
      this.db.prepare("INSERT INTO reception_operations VALUES (?,?, 'ready', ?, NULL)").run(d.operationId,s.id,JSON.stringify({draft:d,offer:JSON.parse(row.data),contact:s.contact}));
    }
    return {status:"ready",operationId:d.operationId};
  }
  private handle(s:Envelope,c:ReceptionCommand): Outcome {
    const a=c.args;
    switch(c.tool) {
      case "clinic_information": return this.information(a);
      case "find_available_slots": return this.availability(s,c);
      case "set_booking_details": {
        if(a.serviceId!==undefined&&!this.service(String(a.serviceId)))return {status:"not_found",issues:["service_not_found"]};
        if(!s.draft && a.newSubject!==true) {
          for(const key of ["patientName","callerName","relationship"] as const)if(typeof a[key]==="string"&&a[key].trim())s[key]=a[key].trim();
          if(a.serviceId!==undefined)s.serviceId=String(a.serviceId);
          return {status:"updated"};
        }
        const d=this.draft(s);
        if(a.newSubject===true) {this.invalidate(s,true);d.subjectKey=randomUUID();d.subjectRevision++;d.action="book";delete d.targetAppointmentId;delete d.patientName;delete d.callerName;delete d.relationship;delete d.doctorId;delete d.serviceId;delete s.serviceId;s.patientName=undefined;s.callerName=undefined;s.relationship=undefined;s.lookupIds=[];delete s.preferences;}
        this.invalidate(s);
        for(const key of ["patientName","callerName","relationship"] as const) if(typeof a[key]==="string"&&a[key].trim()) d[key]=a[key].trim();
        if(d.patientName) s.patientName=d.patientName;s.callerName=d.callerName;s.relationship=d.relationship;
        if(a.serviceId!==undefined&&a.serviceId!==d.serviceId) {this.invalidate(s,true);d.serviceId=String(a.serviceId);}
        d.contact=s.contact; return this.ready(s);
      }
      case "capture_contact": {
        if(!["append","replace","restart","correct"].includes(String(a.mode))) return {status:"needs_clarification",issues:["invalid_capture_mode"]};
        this.invalidate(s);s.lookupIds=[];s.contact=captureReceptionContact(s.contact,a as ReceptionContactCapture);s.captureInputSequence=c.context.inputSequence;
        if(s.draft)s.draft.contact=s.contact;
        return {...this.ready(s),facts:{digits:s.contact.digits,digitCount:s.contact.digits.length,expectedDigitCount:10,contactVersion:s.contact.version,readback:s.contact.digits.split("").join(" "),confirmed:false,confirmationRequired:!s.contact.issue,requiredFunction:s.contact.issue?'capture_contact':'confirm_contact',confirmationMustFollowCallerReply:true},...(s.contact.issue?{status:"invalid_contact" as const,issues:[s.contact.issue]}:{})};
      }
      case "confirm_contact": {
        if(!["accept","decline","unclear"].includes(String(a.decision))||!Number.isInteger(a.contactVersion))return {status:"needs_clarification",issues:["invalid_contact_decision"]};
        if(c.context.attribution!=="known"||c.context.inputSequence<=s.captureInputSequence) return {status:"needs_clarification",issues:["contact_confirmation_requires_subsequent_caller_turn"],missingFields:['confirmed_contact'],facts:{digits:s.contact.digits,contactVersion:s.contact.version,confirmed:false,requiredFunction:'confirm_contact',confirmationMustFollowCallerReply:true}};
        this.invalidate(s);s.contact=confirmReceptionContact(s.contact,{contactVersion:Number(a.contactVersion),decision:a.decision as "accept"|"decline"|"unclear"});if(s.draft)s.draft.contact=s.contact;
        return s.contact.issue?{status:"invalid_contact",issues:[s.contact.issue]}:this.ready(s);
      }
      case "accept_offer": return this.accept(s,c);
      case "commit_request": return this.commit(s,String(a.operationId));
      case "get_operation": {const op=this.operation(s.id,String(a.operationId));return op?{status:op.status,operationId:op.id,result:op.result?JSON.parse(op.result):undefined}:{status:"not_found"};}
      case "find_my_appointments": return this.lookup(s,c);
      case "select_appointment": return this.select(s,c);
      case "record_followup": return this.followup(s,c);
      case "set_emergency": {
        if(typeof a.active!=="boolean") return {status:"needs_clarification"};
        if(s.status==="closed") return {status:"closed"};
        this.invalidate(s,true);s.status=a.active?"paused":"active";delete s.pendingClose;
        return {status:a.active?"paused":"updated",facts:a.active?{guidance:"nearest_hospital_emergency_department",assistanceDispatched:false}:{resumed:true}};
      }
      case "end_session": if(!["completed","declined","unresolved","emergency"].includes(String(a.outcome)))return {status:"needs_clarification",issues:["invalid_end_outcome"]};s.pendingClose={intent:a.intent,outcome:a.outcome,inputSequence:c.context.inputSequence};return {status:"ok",facts:{closeRequested:true,intent:a.intent,outcome:a.outcome}};
      case "__close": this.invalidate(s,true);s.status="closed";s.pendingClose={intent:a.intent,outcome:a.outcome};return {status:"closed",facts:{intent:a.intent,outcome:a.outcome}};
      default:return {status:"unknown",issues:["unknown_tool"]};
    }
  }
  private information(a:Record<string,unknown>): Outcome {
    const doctors=this.doctors();
    if(typeof a.doctorIdentifier==="string") {
      const match=this.resolve(a.doctorIdentifier); return match.status==="matched"?{status:"ok",facts:{doctor:match.value}}:match.status==="ambiguous"?{status:"ambiguous",facts:{candidates:match.values}}:{status:"not_found"};
    }
    if(typeof a.specialty==="string") {
      const identifier=a.specialty.toLowerCase(); const selected=doctors.filter(d=>[d.specialtyId,d.specialtyEn,d.specialtyAr].some(v=>v.toLowerCase()===identifier));
      return selected.length?{status:"ok",facts:{doctors:selected}}:{status:"not_found"};
    }
    const query=String(a.query??"").trim().toLowerCase(); const clinic=this.clinic();
    if(!query||["clinic","directory","doctors","services","prices","hours","location","insurance","policies","العيادة","الأطباء","الخدمات","الأسعار","الدوام","الموقع","التأمين","السياسات"].includes(query)) return {status:"ok",facts:{clinic,doctors,services:(this.db.prepare("SELECT data FROM reception_services").all() as {data:string}[]).map(r=>JSON.parse(r.data))}};
    const routing=(clinic.routing as {queryAr:string;queryEn:string;specialtyId:string}[]).filter(r=>query.includes(r.queryAr)||query.includes(r.queryEn));
    return routing.length?{status:"ok",facts:{routing,administrativeOnly:true,maxClarifications:2}}:{status:"unknown",issues:["fact_not_in_catalog"]};
  }
  private resolve(identifier:string) {
    const doctors=this.doctors();const byId=doctors.find(d=>d.id===identifier.trim().toLowerCase());
    return byId?{status:"matched" as const,value:byId}:resolveAlias(identifier,doctors.map(d=>({id:d.id,aliases:[d.nameAr,d.nameEn,...d.aliasesAr,...d.aliasesEn],value:d})));
  }
  private service(id:string) {return this.db.prepare("SELECT * FROM reception_services WHERE id=?").get(id) as {id:string;duration_minutes:number;lead_minutes:number;horizon_days:number;data:string}|undefined;}
  private resolveDate(value:string,calendar:unknown): string|undefined {
    if(calendar!=="hijri"||!/^\d{4}-\d{2}-\d{2}$/.test(value)) return normalizeCommonRelativeDate(value,this.clock());
    if(!/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
    const [year,month,day]=value.split("-").map(Number); const formatter=new Intl.DateTimeFormat("en-US-u-ca-islamic-umalqura-nu-latn",{timeZone:"Asia/Riyadh",year:"numeric",month:"numeric",day:"numeric"});
    const approx=Date.UTC(622+Math.floor((year-1)*354.367/365.2425),0,1);
    for(let i=-400;i<800;i++) {const candidate=new Date(approx+i*86_400_000); const parts=formatter.formatToParts(candidate);const part=(type:string)=>Number(parts.find(p=>p.type===type)?.value);if(part("year")===year&&part("month")===month&&part("day")===day)return localDate(candidate);}
    return undefined;
  }
  private ensureCapacity(doctorId:string,from:string,days:number) {
    const insert=this.db.prepare("INSERT OR IGNORE INTO reception_capacity VALUES (?,?,?)");
    for(let day=0;day<days;day++) {const date=nextDate(from,day);for(let minute=9*60;minute<17*60;minute+=15){const time=`${String(Math.floor(minute/60)).padStart(2,"0")}:${String(minute%60).padStart(2,"0")}`;const starts=new Date(`${date}T${time}:00+03:00`).toISOString();insert.run(`${doctorId}:${starts}`,doctorId,starts);}}
  }
  private availability(s:Envelope,c:ReceptionCommand): Outcome {
    const a=c.args;const match=this.resolve(String(a.doctorIdentifier??""));
    if(match.status!=="matched")return match.status==="ambiguous"?{status:"ambiguous",facts:{candidates:match.values}}:{status:"not_found",issues:["doctor_not_found"]};
    const serviceId=String(a.serviceId??s.draft?.serviceId??"consultation");const service=this.service(serviceId);if(!service)return {status:"not_found",issues:["service_not_found"]};
    const now=this.clock();const today=localDate(now);const expression=a.date??a.dateExpression;
    const relative=expression===undefined?undefined:resolveRelativeReceptionWindow(String(expression),today,service.horizon_days);
    const expressionDate=expression===undefined?undefined:this.resolveDate(String(expression),a.calendar);
    const from=a.fromDate!==undefined?this.resolveDate(String(a.fromDate),a.calendar):relative?.fromDate??expressionDate??(expression===undefined?today:undefined);
    const to=a.toDate!==undefined?this.resolveDate(String(a.toDate),a.calendar):relative?.toDate??(expressionDate?nextDate(expressionDate):expression===undefined?nextDate(today,service.horizon_days+1):undefined);
    if(!from||!to||!validDate(from)||!validDate(to)||from>=to)return {status:"needs_clarification",issues:["unsupported_or_invalid_date_window"]};
    if(a.exactTime!==undefined&&to!==nextDate(from))return {status:"needs_clarification",issues:["exact_time_requires_single_date"]};
    for(const key of ["fromTime","toTime","exactTime"])if(a[key]!==undefined&&!validTime(String(a[key])))return {status:"needs_clarification",issues:["invalid_time_window"]};
    const fromTime=String(a.fromTime??"00:00"),toTime=String(a.toTime??"24:00");if(fromTime>=toTime)return {status:"needs_clarification",issues:["invalid_time_window"]};
    const d=this.draft(s);this.invalidate(s,true);d.doctorId=match.value.id;d.serviceId=serviceId;
    if(d.action!=="reschedule") {d.action="book";delete d.targetAppointmentId;}
    s.preferences={doctorId:d.doctorId,serviceId,fromDate:from,toDate:to,fromTime,toTime,exactTime:a.exactTime};
    this.ensureCapacity(match.value.id,today,service.horizon_days+1);
    const rows=this.db.prepare("SELECT c.id,c.starts_at_utc,o.appointment_id FROM reception_capacity c LEFT JOIN reception_occupancy o ON o.slot_id=c.id WHERE c.doctor_id=? AND c.starts_at_utc>=? AND c.starts_at_utc<? ORDER BY c.starts_at_utc").all(d.doctorId,new Date(`${from}T00:00:00+03:00`).toISOString(),new Date(`${to}T00:00:00+03:00`).toISOString()) as {id:string;starts_at_utc:string;appointment_id:string|null}[];
    const capacityByTime=new Map(rows.map(row=>[row.starts_at_utc,row]));const duration=service.duration_minutes/15;
    const availableStarts:{date:string;time:string;startsAtUtc:string;slotIds:string[]}[]=[];
    for(const row of rows) {
      const starts=Date.parse(row.starts_at_utc);const local=new Date(starts+3*3_600_000).toISOString();const date=local.slice(0,10);const time=local.slice(11,16);
      if(starts<now.getTime()+service.lead_minutes*60_000||row.starts_at_utc>=new Date(`${nextDate(today,service.horizon_days+1)}T00:00:00+03:00`).toISOString()||time<fromTime||time>=toTime||(a.exactTime!==undefined&&time!==a.exactTime))continue;
      const slotIds:string[]=[];
      for(let i=0;i<duration;i++) {
        const unit=new Date(starts+i*15*60_000).toISOString();const unitLocal=new Date(Date.parse(unit)+3*3_600_000).toISOString();
        if(unitLocal.slice(0,10)!==date||unitLocal.slice(11,16)>="17:00")break;
        const capacity=capacityByTime.get(unit);
        if(!capacity||(capacity.appointment_id&&capacity.appointment_id!==d.targetAppointmentId))break;
        slotIds.push(capacity.id);
      }
      if(slotIds.length===duration)availableStarts.push({date,time,startsAtUtc:row.starts_at_utc,slotIds});
    }
    if(a.exactTime!==undefined) {
      const target=d.targetAppointmentId?this.appointment(d.targetAppointmentId):undefined;
      const offers=availableStarts.slice(0,3).map(candidate=>this.makeOffer(s,c,match.value,candidate.startsAtUtc,candidate.slotIds,target?.version));
      return offers.length?{status:"offers",facts:{offers,service:JSON.parse(service.data),window:{fromDate:from,toDate:to}}}:{status:"unavailable",facts:{preferences:s.preferences,window:{fromDate:from,toDate:to}}};
    }
    const ranges:{date:string;first:{date:string;time:string;startsAtUtc:string;slotIds:string[]};last:{date:string;time:string;startsAtUtc:string;slotIds:string[]}}[]=[];
    for(const candidate of availableStarts) {
      const last=ranges[ranges.length-1];
      if(last&&last.date===candidate.date&&Date.parse(candidate.startsAtUtc)-Date.parse(last.last.startsAtUtc)===15*60_000)last.last=candidate;
      else ranges.push({date:candidate.date,first:candidate,last:candidate});
    }
    const availabilityWindows=ranges.slice(0,3).map(range=>{
      const arStart=appointmentLabels(range.first.startsAtUtc,"ar",now),arEnd=appointmentLabels(range.last.startsAtUtc,"ar",now);
      const enStart=appointmentLabels(range.first.startsAtUtc,"en",now),enEnd=appointmentLabels(range.last.startsAtUtc,"en",now);
      return {date:range.date,startTime:range.first.time,lastStartTime:range.last.time,stepMinutes:15,serviceDurationMinutes:service.duration_minutes,firstStartAtUtc:range.first.startsAtUtc,lastStartAtUtc:range.last.startsAtUtc,timeLabels:{ar:{date:arStart.spokenDate,startTime:arStart.spokenTime,lastStartTime:arEnd.spokenTime},en:{date:enStart.spokenDate,startTime:enStart.spokenTime,lastStartTime:enEnd.spokenTime}}};
    });
    return availabilityWindows.length?{status:"availability",facts:{availabilityWindows,doctor:{id:match.value.id,nameAr:match.value.nameAr,nameEn:match.value.nameEn},service:JSON.parse(service.data),window:{fromDate:from,toDate:to}}}:{status:"unavailable",facts:{preferences:s.preferences,window:{fromDate:from,toDate:to}}};
  }
  private makeOffer(s:Envelope,c:ReceptionCommand,doctor:DoctorRecord,startsAtUtc:string,slotIds:string[],appointmentVersion?:number,consequence?:string):ReceptionOffer {
    const d=s.draft!;const offer:ReceptionOffer={offerId:randomUUID(),draftId:d.draftId,action:d.action,subjectKey:d.subjectKey,subjectRevision:d.subjectRevision,selectionRevision:d.selectionRevision,appointmentVersion,doctorId:doctor.id,doctorNameAr:doctor.nameAr,doctorNameEn:doctor.nameEn,startsAtUtc,slotIds,issuedInputSequence:c.context.inputSequence,expiresAt:new Date(this.clock().getTime()+10*60_000).toISOString(),labels:{ar:appointmentLabels(startsAtUtc,"ar",this.clock()),en:appointmentLabels(startsAtUtc,"en",this.clock())},consequence};
    this.db.prepare("INSERT INTO reception_offers VALUES (?,?,?)").run(offer.offerId,s.id,JSON.stringify(offer));return offer;
  }
  private accept(s:Envelope,c:ReceptionCommand): Outcome {
    if(!["accept","decline","change","unclear"].includes(String(c.args.decision))||typeof c.args.detailsCommunicated!=="boolean")return {status:"needs_clarification",issues:["invalid_offer_decision"]};
    const row=this.db.prepare("SELECT data FROM reception_offers WHERE id=? AND session_id=?").get(String(c.args.offerId),s.id) as {data:string}|undefined;
    if(!row)return {status:"needs_clarification",issues:["offer_not_issued"]};
    const offer=JSON.parse(row.data) as ReceptionOffer;const d=s.draft;
    if(!d||offer.draftId!==d.draftId||offer.subjectKey!==d.subjectKey||offer.subjectRevision!==d.subjectRevision||offer.selectionRevision!==d.selectionRevision||offer.action!==d.action||Date.parse(offer.expiresAt)<=this.clock().getTime())return {status:"conflict",issues:["stale_offer"]};
    if(d.targetAppointmentId&&this.appointment(d.targetAppointmentId)?.version!==offer.appointmentVersion)return {status:"conflict",issues:["stale_appointment"]};
    if(c.args.decision!=="accept") {if(["decline","change"].includes(String(c.args.decision)))this.invalidate(s,true);return {status:"needs_clarification",issues:["offer_not_accepted"]};}
    const media=(this.db.prepare("SELECT data FROM reception_media WHERE session_id=?").all(s.id) as {data:string}[]).map(r=>JSON.parse(r.data) as ReceptionMediaEvent);
    const exposure=media.some(e=>e.outputId===c.context.outputId&&e.offerIds.includes(offer.offerId)&&e.exposure==="started"&&e.eventSequence<c.context.inputStartedEventSequence);
    if(c.context.attribution!=="known"||!c.args.detailsCommunicated||c.context.inputSequence<=offer.issuedInputSequence||!exposure)return {status:"needs_clarification",issues:["offer_requires_presented_details_and_subsequent_known_turn"]};
    this.invalidate(s);d.acceptedOfferId=offer.offerId;return this.ready(s);
  }
  private appointment(id:string):Appointment|undefined {return this.db.prepare("SELECT * FROM reception_appointments WHERE id=?").get(id) as Appointment|undefined;}
  private commit(s:Envelope,id:string): Outcome {
    const op=this.operation(s.id,id);if(!op)return {status:"not_found",issues:['operation_not_issued'],missingFields:[...(!isReceptionContactValid(s.contact)?['confirmed_contact']:[]),...(!s.draft?.patientName?.trim()?['patientName']:[])],facts:{currentRequestSaved:false,acceptedOfferId:s.draft?.acceptedOfferId,readyOperationId:s.draft?.operationId??null,contactVersion:s.contact.version,requiredFunction:!isReceptionContactValid(s.contact)?s.contact.issue?'capture_contact':'confirm_contact':s.draft?.operationId?'commit_request':'set_booking_details',doNotRefreshUnchangedAcceptedOffer:true}};
    const payload=JSON.parse(op.payload) as Payload;const d=s.draft;const offer=payload.offer;const service=this.service(payload.draft.serviceId??"consultation")!;
    const reject=(issue:string):Outcome=>{const result={issue};this.db.prepare("UPDATE reception_operations SET status='rejected',result=? WHERE id=?").run(JSON.stringify(result),id);if(d?.operationId===id)delete d.operationId;return {status:"rejected",operationId:id,result};};
    if(s.status!=="active"||!d||d.operationId!==id||d.acceptedOfferId!==offer.offerId||stringify({...d,contact:s.contact})!==stringify({...payload.draft,contact:payload.contact}))return reject("superseded");
    if(Date.parse(offer.expiresAt)<=this.clock().getTime())return reject("offer_expired");
    const target=d.targetAppointmentId?this.appointment(d.targetAppointmentId):undefined;
    if(d.action!=="book"&&(!target||target.version!==offer.appointmentVersion||target.status!=="active"))return reject("appointment_conflict");
    if(d.action==="book"||d.action==="reschedule") {
      if(Date.parse(offer.startsAtUtc)<this.clock().getTime()+service.lead_minutes*60_000||localDate(new Date(offer.startsAtUtc))>nextDate(localDate(this.clock()),service.horizon_days))return reject("outside_service_window");
      for(const slotId of offer.slotIds){const taken=this.db.prepare("SELECT appointment_id FROM reception_occupancy WHERE slot_id=?").get(slotId) as {appointment_id:string}|undefined;if(taken&&taken.appointment_id!==target?.id)return reject("capacity_conflict");}
      if(!isReceptionContactValid(s.contact)||!d.patientName?.trim())return reject("invalid_details");
    }
    let result:Record<string,unknown>;
    if(d.action==="book") {
      const appointmentId=randomUUID();const data={appointmentId,patientName:d.patientName,callerName:d.callerName,relationship:d.relationship,phone:s.contact.digits,doctorId:offer.doctorId,doctorNameAr:offer.doctorNameAr,doctorNameEn:offer.doctorNameEn,serviceId:service.id,startsAtUtc:offer.startsAtUtc,slotIds:offer.slotIds,simulated:true};
      this.db.prepare("INSERT INTO reception_subjects VALUES (?,?,?,?,?)").run(d.subjectKey,d.patientName!,s.contact.digits,d.callerName??null,d.relationship??null);
      this.db.prepare("INSERT INTO reception_appointments VALUES (?,?,?,?,?,1,'active',NULL,?)").run(appointmentId,d.subjectKey,offer.doctorId,service.id,offer.startsAtUtc,JSON.stringify(data));
      this.occupy(appointmentId,offer.slotIds);this.history(appointmentId,"book",data);this.effect(s,"notification",data);result={...data,status:"active",version:1};
    } else if(d.action==="reschedule") {
      const data={...JSON.parse(target!.data),doctorId:offer.doctorId,doctorNameAr:offer.doctorNameAr,doctorNameEn:offer.doctorNameEn,serviceId:service.id,startsAtUtc:offer.startsAtUtc,slotIds:offer.slotIds};
      this.db.prepare("DELETE FROM reception_occupancy WHERE appointment_id=?").run(target!.id);this.occupy(target!.id,offer.slotIds);
      this.db.prepare("UPDATE reception_appointments SET doctor_id=?,service_id=?,starts_at_utc=?,version=version+1,data=? WHERE id=?").run(offer.doctorId,service.id,offer.startsAtUtc,JSON.stringify(data),target!.id);
      this.history(target!.id,"reschedule",{before:JSON.parse(target!.data),after:data});this.effect(s,"notification",data);result={...data,status:"active",version:target!.version+1};
    } else if(d.action==="cancel") {
      const late=Date.parse(target!.starts_at_utc)-this.clock().getTime()<24*3_600_000;const classification=late?"late_no_show":"on_time";
      // The policy consequence must be accepted at its current boundary, not silently changed.
      if(offer.consequence!==classification)return reject("policy_changed_reoffer_required");
      this.db.prepare("DELETE FROM reception_occupancy WHERE appointment_id=?").run(target!.id);
      this.db.prepare("UPDATE reception_appointments SET status='cancelled',classification=?,version=version+1 WHERE id=?").run(classification,target!.id);
      result={...JSON.parse(target!.data),status:"cancelled",classification,version:target!.version+1};this.history(target!.id,"cancel",result);this.effect(s,"notification",result);
    } else {result={appointmentId:target!.id,phone:JSON.parse(target!.data).phone,simulated:true,containsClinicalContent:false};this.effect(s,"summary_link",result);}
    this.db.prepare("UPDATE reception_operations SET status='committed',result=? WHERE id=?").run(JSON.stringify(result),id);
    delete s.draft;return {status:"committed",operationId:id,result};
  }
  private occupy(id:string,slotIds:string[]) {for(const slot of slotIds)this.db.prepare("INSERT INTO reception_occupancy VALUES (?,?)").run(slot,id);}
  private history(id:string,action:string,data:unknown) {this.db.prepare("INSERT INTO reception_history (appointment_id,action,created_at_utc,data) VALUES (?,?,?,?)").run(id,action,this.clock().toISOString(),JSON.stringify(data));}
  private effect(s:Envelope,kind:string,data:unknown):string {const id=randomUUID();this.db.prepare("INSERT INTO reception_effects VALUES (?,?,?,?,?)").run(id,s.id,kind,this.clock().toISOString(),JSON.stringify(data));return id;}
  private lookup(s:Envelope,c:ReceptionCommand):Outcome {
    if(c.args.phone!==undefined) {const phone=createReceptionContact(String(c.args.phone));if(phone.digits!==s.contact.digits||!isReceptionContactValid(s.contact)){this.invalidate(s);s.lookupIds=[];s.contact=captureReceptionContact(s.contact,{mode:"replace",rawText:String(c.args.phone)});s.captureInputSequence=c.context.inputSequence;return {status:s.contact.issue?"invalid_contact":"needs_details",missingFields:["confirmed_contact"]};}}
    if(!isReceptionContactValid(s.contact))return {status:s.contact.issue?"invalid_contact":"needs_details",missingFields:["confirmed_contact"]};
    const name=typeof c.args.patientName==="string"?c.args.patientName.trim():undefined;
    const candidates=(this.db.prepare("SELECT a.* FROM reception_appointments a JOIN reception_subjects p ON p.id=a.subject_id WHERE p.phone=? AND a.status='active' ORDER BY a.starts_at_utc").all(s.contact.digits) as Appointment[]).map(a=>({...JSON.parse(a.data),version:a.version,status:a.status})).filter(a=>!name||a.patientName.toLowerCase()===name.toLowerCase());
    s.lookupIds=candidates.map(a=>a.appointmentId);return {status:candidates.length>1?"ambiguous":candidates.length?"ok":"not_found",facts:{appointments:candidates}};
  }
  private select(s:Envelope,c:ReceptionCommand):Outcome {
    const id=String(c.args.appointmentId);if(!s.lookupIds.includes(id))return {status:"not_found",issues:["appointment_not_in_lookup"],facts:{requiredFunction:'find_my_appointments',selectionRequiresReturnedCandidate:true,doesNotProveAppointmentMissing:true}};
    const target=this.appointment(id);if(!target||target.status!=="active")return {status:"conflict"};
    if(!isReceptionContactValid(s.contact)||JSON.parse(target.data).phone!==s.contact.digits)return {status:"not_found",issues:["appointment_not_in_lookup"]};
    if(!["reschedule","cancel","summary_link"].includes(String(c.args.action)))return {status:"needs_clarification"};
    this.invalidate(s,true);const data=JSON.parse(target.data);s.patientName=data.patientName;
    s.draft={draftId:randomUUID(),subjectKey:target.subject_id,subjectRevision:0,selectionRevision:0,action:c.args.action as ReceptionDraft["action"],targetAppointmentId:target.id,patientName:data.patientName,callerName:data.callerName,relationship:data.relationship,doctorId:target.doctor_id,serviceId:target.service_id,contact:s.contact};
    if(c.args.action==="reschedule")return {status:"updated",facts:{appointment:data}};
    const doctor=this.doctors().find(d=>d.id===target.doctor_id)!;const consequence=c.args.action==="cancel"?(Date.parse(target.starts_at_utc)-this.clock().getTime()<24*3_600_000?"late_no_show":"on_time"):"simulated_summary_without_clinical_content";
    const offer=this.makeOffer(s,c,doctor,target.starts_at_utc,[],target.version,consequence);return {status:"offers",facts:{offers:[offer],appointment:data,appointmentUnchanged:true,...(c.args.action==='cancel'?{policy:{classification:consequence,lateBelowHours:24,financialPenalty:'unknown',classificationDoesNotEstablishMonetaryConsequence:true}}:{})}};
  }
  private followup(s:Envelope,c:ReceptionCommand):Outcome {
    const kind=String(c.args.kind);if(!["waitlist","callback","transfer"].includes(kind))return {status:"needs_clarification",issues:["invalid_followup_kind"]};
    if(c.context.attribution!=="known")return {status:"needs_clarification",issues:["uncertain_caller_turn"]};
    if(!isReceptionContactValid(s.contact)||!s.patientName?.trim())return {status:!isReceptionContactValid(s.contact)?"invalid_contact":"needs_details",missingFields:[...(!s.patientName?["patientName"]:[]),...(!isReceptionContactValid(s.contact)?["confirmed_contact"]:[])]};
    if(kind==="waitlist"&&!s.preferences)return {status:"needs_details",missingFields:["appointment_preferences"]};
    const result={kind,patientName:s.patientName,phone:s.contact.digits,reason:typeof c.args.reason==="string"?c.args.reason:undefined,preferences:kind==="waitlist"?s.preferences:undefined,simulated:true,delivered:false,booked:false};const effectId=this.effect(s,kind,result);return {status:"committed",result:{...result,effectId}};
  }
  activity() {
    return {effects:(this.db.prepare("SELECT id,kind,created_at_utc,data FROM reception_effects ORDER BY rowid DESC LIMIT 50").all() as {id:string;kind:string;created_at_utc:string;data:string}[]).map(e=>({effectId:e.id,kind:e.kind,createdAtUtc:e.created_at_utc,...JSON.parse(e.data)})),appointments:(this.db.prepare("SELECT * FROM reception_appointments ORDER BY rowid DESC LIMIT 50").all() as Appointment[]).map(a=>({...JSON.parse(a.data),status:a.status,classification:a.classification,version:a.version}))};
  }
}
