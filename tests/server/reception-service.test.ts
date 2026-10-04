import { afterEach, describe, expect, it } from "vitest";
import type Database from "better-sqlite3";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openReceptionDatabase } from "../../src/server/reception/database";
import { ReceptionService } from "../../src/server/reception/service";
import type { ReceptionCommand, ReceptionSnapshot } from "../../src/shared/reception";

const connections: Database.Database[] = [];
const clock = () => new Date("2026-10-03T05:00:00.000Z");
function setup(testClock = clock, path = ":memory:") {
  const db = openReceptionDatabase(path, { clock:testClock }); connections.push(db);
  const service = new ReceptionService(db, { clock:testClock });
  let snapshot = service.createSession("0501234567"); let sequence = 0, outputSequence = 0, mediaSequence = 0;
  let activeOutputId = "output-0";
  const command = (tool: string, args: Record<string, unknown> = {}, overrides: Partial<ReceptionCommand> = {}) => {
    sequence++;
    const request: ReceptionCommand = { eventId: `event-${sequence}`, expectedVersion: snapshot.version, tool, args,
      context: { connectionId: "connection", inputTurnId: `input-${sequence}`, inputSequence: sequence,
        eventSequence: sequence * 10, inputStartedEventSequence: sequence * 10 - 1,
        source: "text", attribution: "known", outputId: activeOutputId }, ...overrides };
    const result = service.execute(snapshot.sessionId, request); snapshot = result.snapshot;
    return { ...result, request };
  };
  const expose = (offers = snapshot.offers) => {
    const outputId = activeOutputId = `output-${++outputSequence}`;
    service.recordMediaEvent(snapshot.sessionId, { eventId: `media-${++mediaSequence}`, connectionId: "connection", outputId, inputSequence: sequence,
      eventSequence: sequence * 10 + 1, medium: "audio", exposure: "started", offerIds: offers.map(o => o.offerId) });
    return outputId;
  };
  const assistantOutput = () => {
    const outputId = activeOutputId = `output-${++outputSequence}`;
    service.recordMediaEvent(snapshot.sessionId, { eventId: `media-${++mediaSequence}`, connectionId: "connection", outputId, inputSequence: sequence,
      eventSequence: sequence * 10 + 2, medium: "text", exposure: "started", offerIds: [] });
    return outputId;
  };
  const prepare = (doctorIdentifier = "doc-001") => {
    command("set_booking_details", { patientName: "Test Caller" });
    command("find_available_slots", { doctorIdentifier, dateExpression:"tomorrow", exactTime:"09:00" }); expose();
    return command("accept_offer", { offerId: snapshot.offers[0].offerId, decision: "accept", detailsCommunicated: true });
  };
  return { db, service, command, expose, assistantOutput, prepare, snapshot: () => snapshot };
}
afterEach(() => { for (const db of connections.splice(0)) if (db.open) db.close(); });
const count = (db: Database.Database, table: string) => (db.prepare(`SELECT COUNT(*) n FROM ${table}`).get() as {n:number}).n;

describe("resource reception", () => {
  it('refreshes restored offer labels across Riyadh midnight without changing the saved offer',()=>{
    let now=new Date('2026-10-03T20:59:00Z');const f=setup(()=>now);
    f.command('find_available_slots',{doctorIdentifier:'doc-001',date:'2026-10-04',exactTime:'09:00'});
    const stored=f.db.prepare('SELECT data FROM reception_offers').all();
    expect((f.snapshot().offers[0].labels.en as any).relativeDays).toBe(1);
    now=new Date('2026-10-03T21:01:00Z');
    const restored=f.service.getSnapshot(f.snapshot().sessionId)!;
    expect((restored.offers[0].labels.en as any).relativeDateTime).toBe('today at 9:00');
    expect(restored.version).toBe(f.snapshot().version);expect(f.db.prepare('SELECT data FROM reception_offers').all()).toEqual(stored);
  });
  it('projects fresh Riyadh labels for lookup, selection and recovered results without rewriting storage',()=>{
    let now=new Date('2026-10-03T05:00:00Z');const f=setup(()=>now);
    f.command('set_booking_details',{patientName:'Ahmed'});
    f.command('find_available_slots',{doctorIdentifier:'doc-001',date:'2026-10-04',exactTime:'09:00'});f.expose();
    const ready=f.command('accept_offer',{offerId:f.snapshot().offers[0].offerId,decision:'accept',detailsCommunicated:true});
    const saved=f.command('commit_request',{operationId:ready.operationId});
    const before=f.db.prepare('SELECT * FROM reception_appointments').get();
    const operationBefore=f.db.prepare('SELECT result FROM reception_operations WHERE id=?').get(ready.operationId);
    expect(saved.result).toMatchObject({startsAtUtc:'2026-10-04T06:00:00.000Z',labels:{en:{relativeDays:1,relativeDateTime:'tomorrow at 9:00'}}});
    const fresh=f.service.createSession('0501234567');
    const call=(tool:string,args:Record<string,unknown>,sequence:number)=>f.service.execute(fresh.sessionId,{eventId:`fresh-${sequence}`,expectedVersion:f.service.getSnapshot(fresh.sessionId)!.version,tool,args,context:{connectionId:'fresh',inputTurnId:`fresh-${sequence}`,inputSequence:sequence,eventSequence:sequence,inputStartedEventSequence:sequence,source:'text',attribution:'known'}});
    const lookup=call('find_my_appointments',{},1);const appointment=(lookup.facts!.appointments as any[])[0];
    expect(appointment.labels.en.spokenDateTime).toContain('4 October');expect(appointment.labels.en.spokenDateTime).toContain('9:00');
    expect(appointment.labels.ar.spokenHijriDateTime).toBeTruthy();
    expect(call('select_appointment',{appointmentId:appointment.appointmentId,action:'reschedule'},2).facts!.appointment).toMatchObject({labels:appointment.labels});
    now=new Date('2026-10-04T05:00:00Z');
    expect(f.command('get_operation',{operationId:ready.operationId}).result).toMatchObject({labels:{en:{relativeDays:0,relativeDateTime:'today at 9:00'}}});
    expect(f.service.getSnapshot(f.snapshot().sessionId)!.operations[0].result).toMatchObject({labels:{en:{relativeDays:0}}});
    expect(f.service.getEvent(f.snapshot().sessionId,saved.request.eventId)).toMatchObject({result:{labels:{en:{relativeDays:0}}}});
    expect(f.db.prepare('SELECT * FROM reception_appointments').get()).toEqual(before);
    expect(f.db.prepare('SELECT result FROM reception_operations WHERE id=?').get(ready.operationId)).toEqual(operationBefore);
  });
  it('rejects old lookup candidates after contact changes',()=>{
    const f=setup();const ready=f.prepare();const saved=f.command('commit_request',{operationId:ready.operationId});
    f.command('find_my_appointments');
    f.command('capture_contact',{mode:'replace',rawText:'0555555555'});
    f.command('confirm_contact',{contactVersion:f.snapshot().contact.version,decision:'accept'});
    expect(f.command('select_appointment',{appointmentId:saved.result!.appointmentId,action:'cancel'}).status).toBe('not_found');
    expect(f.service.activity().appointments[0].status).toBe('active');
  });
  it('clears the previous subject service selection while retaining household contact',()=>{
    const f=setup();f.command('find_available_slots',{doctorIdentifier:'doc-001',serviceId:'extended_consultation'});
    f.command('set_booking_details',{newSubject:true,patientName:'Another Synthetic'});
    expect(f.snapshot().draft?.serviceId).toBeUndefined();expect(f.snapshot().draft?.doctorId).toBeUndefined();
    expect(f.snapshot().contact.digits).toBe('0501234567');
  });
  it("requests repair before confirmation of incomplete contact and keeps accepted offer", () => {
    const f=setup(); f.command("capture_contact",{mode:"replace",rawText:"133"});
    const acceptedResult=f.prepare();
    expect(acceptedResult).toMatchObject({status:"invalid_contact",facts:{offerAccepted:true,bookingStatus:"not_booked",appointmentSaved:false,slotReserved:false,capacityHeld:false,requiredFunction:"capture_contact"}});
    expect(acceptedResult.operationId).toBeUndefined();
    expect(count(f.db,"reception_appointments")).toBe(0);expect(count(f.db,"reception_effects")).toBe(0);
    const accepted=f.snapshot().draft?.acceptedOfferId;
    const partial=f.command("capture_contact",{mode:"replace",rawText:"133"});
    expect(partial).toMatchObject({status:"invalid_contact",facts:{digitCount:3,expectedDigitCount:10,confirmationRequired:false,requiredFunction:"capture_contact"}});
    const missing=f.command("commit_request",{operationId:"not-issued"});
    expect(missing.facts?.requiredFunction).toBe("capture_contact");
    expect(f.snapshot().draft?.acceptedOfferId).toBe(accepted);
    const complete=f.command("capture_contact",{mode:"replace",rawText:"0501234567"});
    expect(complete.facts).toMatchObject({confirmationRequired:true,requiredFunction:"confirm_contact"});
    const ready=f.command("confirm_contact",{contactVersion:f.snapshot().contact.version,decision:"accept"});
    expect(ready).toMatchObject({status:"ready",facts:{offerAccepted:true,bookingStatus:"not_booked",appointmentSaved:false,slotReserved:false,capacityHeld:false,requiredFunction:"commit_request"}});
    expect(f.snapshot().draft?.acceptedOfferId).toBe(accepted);
    expect(count(f.db,"reception_appointments")).toBe(0);expect(count(f.db,"reception_effects")).toBe(0);
    expect(f.command("commit_request",{operationId:ready.operationId}).status).toBe("committed");
    expect(count(f.db,"reception_appointments")).toBe(1);expect(count(f.db,"reception_effects")).toBe(1);
  });
  it("explains same-turn contact rejection and preserves accepted offer during an unissued-operation repair",()=>{
    const f=setup();f.command('capture_contact',{mode:'restart'});f.prepare();
    const captured=f.command('capture_contact',{mode:'replace',rawText:'0501234567'});
    const acceptedOfferId=f.snapshot().draft?.acceptedOfferId;
    const rejected=f.command('confirm_contact',{contactVersion:f.snapshot().contact.version,decision:'accept'},{context:captured.request.context});
    expect(rejected.facts).toMatchObject({confirmed:false,contactVersion:3,requiredFunction:'confirm_contact'});
    const unissued=f.command('commit_request',{operationId:'invented'});
    expect(unissued.missingFields).toContain('confirmed_contact');expect(unissued.facts?.acceptedOfferId).toBe(acceptedOfferId);
    const confirmed=f.command('confirm_contact',{contactVersion:f.snapshot().contact.version,decision:'accept'});
    expect(confirmed.status).toBe('ready');expect(f.snapshot().draft?.acceptedOfferId).toBe(acceptedOfferId);
  });
  it("returns unknown monetary consequence and unchanged appointment for a cancellation offer",()=>{
    const f=setup();f.command("set_booking_details",{patientName:"Test Caller"});f.command("find_available_slots",{doctorIdentifier:"doc-001",date:"2026-10-03",exactTime:"09:00"});f.expose();const ready=f.command("accept_offer",{offerId:f.snapshot().offers[0].offerId,decision:"accept",detailsCommunicated:true});const saved=f.command('commit_request',{operationId:ready.operationId});
    f.command('find_my_appointments');const offer=f.command('select_appointment',{appointmentId:saved.result?.appointmentId,action:'cancel'});
    expect(offer.facts).toMatchObject({appointmentUnchanged:true,policy:{financialPenalty:'unknown',classification:'late_no_show'}});
    expect(f.service.activity().appointments[0].status).toBe('active');
  });
  it("returns grounded directory facts without identity intake and injected Riyadh dates", () => {
    const f = setup(); const result = f.command("clinic_information", {});
    expect(result.snapshot.directory).toHaveLength(30); expect(result.snapshot.clock.localDate).toBe("2026-10-03");
    expect(result.snapshot.draft).toBeUndefined(); expect(f.command("clinic_information", {query: "unknown-price"}).status).toBe("unknown");
  });
  it("accepts one presented opening and commits exactly one atomic appointment and simulated effect", () => {
    const f = setup(); const ready = f.prepare(); expect(ready.status).toBe("ready");
    const committed = f.command("commit_request", {operationId: ready.operationId}); expect(committed.status).toBe("committed");
    expect(count(f.db, "reception_appointments")).toBe(1); expect(count(f.db, "reception_effects")).toBe(1);
    expect(count(f.db, "reception_occupancy")).toBe(2);
    expect(f.service.execute(f.snapshot().sessionId, committed.request)).toMatchObject({status: "committed", operationId: ready.operationId});
    expect(f.command("commit_request", {operationId: ready.operationId}, {expectedVersion: 0}).status).toBe("committed");
    expect(count(f.db, "reception_appointments")).toBe(1);
  });
  it("refuses unseen or same-turn approval and uncertain attribution", () => {
    const f = setup(); f.command("find_available_slots", {doctorIdentifier:"doc-001",dateExpression:"tomorrow",exactTime:"09:00"});
    const args = {offerId:f.snapshot().offers[0].offerId, decision:"accept",detailsCommunicated:true};
    expect(f.command("accept_offer",args).status).toBe("needs_clarification"); f.expose();
    expect(f.command("accept_offer",args,{context:{connectionId:"connection",inputTurnId:"uncertain",inputSequence:8,eventSequence:80,inputStartedEventSequence:79,source:"microphone",attribution:"uncertain",outputId:"output"}}).status).toBe("needs_clarification");
    expect(count(f.db,"reception_appointments")).toBe(0);
  });
  it("does not treat a different intervening assistant output as presentation of the same offer", () => {
    const f=setup();f.command("set_booking_details",{patientName:"Test Caller"});f.command("find_available_slots",{doctorIdentifier:"doc-001",dateExpression:"tomorrow",exactTime:"09:00"});
    const offer=f.snapshot().offers[0];const presentedOutput=f.expose();const interveningOutput=f.assistantOutput();
    expect(interveningOutput).not.toBe(presentedOutput);
    const rejected=f.command("accept_offer",{offerId:offer.offerId,decision:"accept",detailsCommunicated:true});
    expect(rejected).toMatchObject({status:"needs_clarification",issues:["offer_requires_presented_details_and_subsequent_known_turn"]});
    expect(rejected.facts).toMatchObject({offerAccepted:false,bookingStatus:"not_booked",appointmentSaved:false,slotReserved:false});
    expect(f.snapshot().draft?.acceptedOfferId).toBeUndefined();expect(count(f.db,"reception_appointments")).toBe(0);expect(count(f.db,"reception_effects")).toBe(0);
  });
  it("preserves accepted selection through contact repair and same-subject name changes", () => {
    const f = setup(); f.command("capture_contact",{mode:"replace",rawText:"050"}); const prepared=f.prepare();
    expect(prepared.status).toBe("invalid_contact"); const offerId=f.snapshot().draft?.acceptedOfferId;
    f.command("capture_contact",{mode:"append",rawText:"1234567"});
    expect(f.snapshot().draft?.acceptedOfferId).toBe(offerId);
    const confirmation=f.command("confirm_contact",{contactVersion:f.snapshot().contact.version,decision:"accept"});
    expect(confirmation.status).toBe("ready"); f.command("set_booking_details",{patientName:"Corrected Name"});
    expect(f.snapshot().draft?.acceptedOfferId).toBe(offerId);
    const committed=f.command("commit_request",{operationId:f.snapshot().draft?.operationId});
    expect(committed.status).toBe("committed"); expect(committed.result?.patientName).toBe("Corrected Name");
  });
  it("deduplicates contact events before stale versions and rejects changed payload", () => {
    const f=setup(); const result=f.command("capture_contact",{mode:"replace",rawText:"050"});
    expect(f.service.execute(f.snapshot().sessionId,result.request).snapshot.contact.digits).toBe("050");
    expect(f.service.execute(f.snapshot().sessionId,{...result.request,args:{mode:"append",rawText:"9"}}).status).toBe("conflict");
  });
  it("serializes close and emergency against pending commits while preserving committed recovery", () => {
    const f=setup(); const ready=f.prepare(); const id=f.snapshot().sessionId;
    expect(f.service.closeSession(id,{eventId:"close",expectedVersion:f.snapshot().version,outcome:"declined"}).status).toBe("closed");
    expect(f.command("commit_request",{operationId:ready.operationId}).status).not.toBe("committed"); expect(count(f.db,"reception_appointments")).toBe(0);
    const g=setup(); const ready2=g.prepare(); g.command("set_emergency",{active:true});
    expect(g.command("commit_request",{operationId:ready2.operationId}).status).not.toBe("committed");
    expect(g.command("set_emergency",{active:false}).snapshot.patientName).toBe("Test Caller");
    expect(g.snapshot().draft?.acceptedOfferId).toBeUndefined();
  });
  it("returns earliest openings inside an explicit window with duration capacity", () => {
    const f=setup(); const result=f.command("find_available_slots",{doctorIdentifier:"doc-001",date:"2026-10-04",fromTime:"10:15",toTime:"11:00"});
    expect(result.status).toBe("availability");expect(result.facts?.availabilityWindows).toMatchObject([{date:"2026-10-04",startTime:"10:15",lastStartTime:"10:45",stepMinutes:15,serviceDurationMinutes:30}]);
    expect(result.facts?.offers).toBeUndefined();expect(result.snapshot.offers).toEqual([]);
    expect(f.command("find_available_slots",{doctorIdentifier:"doc-001",dateExpression:"next special holiday"}).status).toBe("needs_clarification");
  });
  it("returns appointment-start windows split around an occupied booking instead of offering an unchosen time",()=>{
    const f=setup();f.command("set_booking_details",{patientName:"Existing Patient"});
    f.command("find_available_slots",{doctorIdentifier:"doc-001",date:"2026-10-04",exactTime:"12:00"});
    const occupiedOffer=f.snapshot().offers[0];f.expose();
    const accepted=f.command("accept_offer",{offerId:occupiedOffer.offerId,decision:"accept",detailsCommunicated:true});
    expect(accepted.status).toBe("ready");
    expect(f.command("commit_request",{operationId:accepted.operationId}).status).toBe("committed");

    const result=f.command("find_available_slots",{doctorIdentifier:"doc-001",date:"2026-10-04"});
    expect(result.status).toBe("availability");
    expect(result.facts?.availabilityWindows).toMatchObject([
      {date:"2026-10-04",startTime:"09:00",lastStartTime:"11:30",stepMinutes:15,serviceDurationMinutes:30},
      {date:"2026-10-04",startTime:"12:30",lastStartTime:"16:30",stepMinutes:15,serviceDurationMinutes:30},
    ]);
    expect((result.facts?.availabilityWindows as any[])[0].timeLabels.ar).toMatchObject({startTime:"٩:٠٠ صباحًا",lastStartTime:"١١:٣٠ صباحًا"});
    expect(result.facts?.offers).toBeUndefined();
    expect(result.snapshot.offers).toEqual([]);
    expect(count(f.db,"reception_appointments")).toBe(1);

    const selected=f.command("find_available_slots",{doctorIdentifier:"doc-001",date:"2026-10-04",exactTime:"12:30"});
    expect(selected.status).toBe("offers");expect(selected.facts?.offers).toMatchObject([{startsAtUtc:"2026-10-04T09:30:00.000Z"}]);
    expect(count(f.db,"reception_appointments")).toBe(1);
  });
  it.each([
    ["omitted date",{}],
    ["multi-day explicit range",{fromDate:"2026-10-04",toDate:"2026-10-06"}],
    ["multi-day relative range",{dateExpression:"next week"}],
  ] as const)("requires one specific date for exact-time searches with a %s",(_case,dateArgs)=>{
    const f=setup();
    const result=f.command("find_available_slots",{doctorIdentifier:"doc-001",exactTime:"09:00",...dateArgs});
    expect(result).toMatchObject({status:"needs_clarification",issues:["exact_time_requires_single_date"]});
    expect(result.snapshot.offers).toEqual([]);
    expect(count(f.db,"reception_offers")).toBe(0);
    expect(count(f.db,"reception_appointments")).toBe(0);
  });
  it("stores a broad synthetic schedule but never offers a persisted past opening",()=>{
    const f=setup(()=>new Date("2026-10-04T09:30:00.000Z"));
    const past=f.command("find_available_slots",{doctorIdentifier:"doc-001",date:"2026-10-04",exactTime:"09:00"});
    expect(past.status).toBe("unavailable");
    expect(f.db.prepare("SELECT id FROM reception_capacity WHERE doctor_id='doc-001' AND starts_at_utc='2026-10-04T06:00:00.000Z'").get()).toBeTruthy();
    expect(count(f.db,"reception_capacity")).toBe(31*32);

    const current=f.command("find_available_slots",{doctorIdentifier:"doc-001",date:"2026-10-04"});
    expect(current.status).toBe("availability");
    expect((current.facts?.availabilityWindows as any[]).map(window=>window.startTime)).toEqual(["13:30"]);
    expect(current.snapshot.offers).toEqual([]);
    expect(count(f.db,"reception_appointments")).toBe(0);
  });
  it.each([
    ["unclear answer","unclear",true],
    ["qualified yes asking for a later time","change",false],
    ["clear decline","decline",false],
  ] as const)("does not accept an offer after a %s",(_case,decision,offerRetained)=>{
    const f=setup();f.command("set_booking_details",{patientName:"Test Caller"});
    f.command("find_available_slots",{doctorIdentifier:"doc-001",date:"2026-10-04",exactTime:"09:00"});f.expose();
    const offerId=f.snapshot().offers[0].offerId;
    const result=f.command("accept_offer",{offerId,decision,detailsCommunicated:true});
    expect(result.status).toBe("needs_clarification");
    expect(Boolean(f.snapshot().offers.find(offer=>offer.offerId===offerId))).toBe(offerRetained);
    expect(f.snapshot().draft?.acceptedOfferId).toBeUndefined();
    expect(count(f.db,"reception_appointments")).toBe(0);expect(count(f.db,"reception_effects")).toBe(0);expect(count(f.db,"reception_occupancy")).toBe(0);
  });
  it("rejects a ready booking when the caller changes the selected doctor and time",()=>{
    const f=setup();f.command("set_booking_details",{patientName:"Test Caller"});
    f.command("find_available_slots",{doctorIdentifier:"doc-001",date:"2026-10-04",exactTime:"09:00"});f.expose();
    const ready=f.command("accept_offer",{offerId:f.snapshot().offers[0].offerId,decision:"accept",detailsCommunicated:true});
    expect(ready.status).toBe("ready");
    f.command("find_available_slots",{doctorIdentifier:"doc-002",date:"2026-10-04",exactTime:"10:30"});
    expect(f.command("commit_request",{operationId:ready.operationId})).toMatchObject({status:"rejected",result:{issue:"superseded"}});
    expect(count(f.db,"reception_appointments")).toBe(0);expect(count(f.db,"reception_effects")).toBe(0);expect(count(f.db,"reception_occupancy")).toBe(0);
  });
  it("rolls back appointment and occupancy when persistence fails", () => {
    const f=setup(); const ready=f.prepare();
    f.db.exec("CREATE TRIGGER fail_effect BEFORE INSERT ON reception_effects BEGIN SELECT RAISE(ABORT, 'effect failure'); END");
    const failed=f.command("commit_request",{operationId:ready.operationId});expect(failed.status).toBe("error");
    expect(f.service.getEvent(f.snapshot().sessionId,failed.request.eventId)?.status).toBe("unresolved");
    expect(count(f.db,"reception_appointments")).toBe(0); expect(count(f.db,"reception_occupancy")).toBe(0);
    f.db.exec("DROP TRIGGER fail_effect"); expect(f.service.execute(f.snapshot().sessionId,failed.request).status).toBe("committed");
  });
  it("retrieves committed results after a database restart and a subsequent close", () => {
    const directory=mkdtempSync(join(tmpdir(),"reception-restart-"));
    try {
      const f=setup(clock,join(directory,"demo.sqlite"));const ready=f.prepare();const committed=f.command("commit_request",{operationId:ready.operationId});const id=f.snapshot().sessionId;f.db.close();
      const db=openReceptionDatabase(join(directory,"demo.sqlite"),{clock});connections.push(db);const service=new ReceptionService(db,{clock});
      service.closeSession(id,{eventId:"close-after-restart",expectedVersion:service.getSnapshot(id)!.version,outcome:"completed"});
      expect(service.execute(id,committed.request)).toMatchObject({status:"committed",result:{appointmentId:committed.result?.appointmentId}});
      expect(service.getEvent(id,committed.request.eventId)?.status).toBe("committed");expect(count(db,"reception_appointments")).toBe(1);db.close();
    } finally {rmSync(directory,{recursive:true,force:true});}
  });
  it("requires actual exposure preceding caller onset even for completed and muted output", () => {
    const f=setup();f.command("find_available_slots",{doctorIdentifier:"doc-001",dateExpression:"tomorrow",exactTime:"09:00"});const offerId=f.snapshot().offers[0].offerId;
    f.service.recordMediaEvent(f.snapshot().sessionId,{eventId:"muted",connectionId:"connection",outputId:"muted",inputSequence:1,eventSequence:11,medium:"audio",exposure:"not_started",offerIds:[offerId]});
    const args={offerId,decision:"accept",detailsCommunicated:true};
    expect(f.command("accept_offer",args,{context:{connectionId:"connection",inputTurnId:"input2",inputSequence:2,eventSequence:20,inputStartedEventSequence:19,source:"microphone",attribution:"known",outputId:"muted"}}).status).toBe("needs_clarification");
    f.service.recordMediaEvent(f.snapshot().sessionId,{eventId:"late-exposure",connectionId:"connection",outputId:"late",inputSequence:2,eventSequence:35,medium:"text",exposure:"completed",offerIds:[offerId]});
    expect(f.command("accept_offer",args,{context:{connectionId:"connection",inputTurnId:"input3",inputSequence:3,eventSequence:40,inputStartedEventSequence:30,source:"text",attribution:"known",outputId:"late"}}).status).toBe("needs_clarification");
  });
  it("keeps shared household contact separate from patient identity and preserves partial family success", () => {
    const f=setup();const ready=f.prepare();f.command("commit_request",{operationId:ready.operationId});
    f.command("set_booking_details",{newSubject:true,patientName:"Family Member",callerName:"Test Caller",relationship:"sibling"});expect(f.snapshot().contact.digits).toBe("0501234567");expect(f.snapshot().contact.confirmedVersion).toBe(f.snapshot().contact.version);expect(f.snapshot().callingNumber).toBe("0501234567");
    f.command("find_available_slots",{doctorIdentifier:"doc-002",dateExpression:"tomorrow",exactTime:"09:30"});f.expose();const second=f.command("accept_offer",{offerId:f.snapshot().offers[0].offerId,decision:"accept",detailsCommunicated:true});
    expect(f.command("commit_request",{operationId:second.operationId}).status).toBe("committed");expect(count(f.db,"reception_subjects")).toBe(2);
    const lookup=f.command("find_my_appointments",{});expect(lookup.status).toBe("ambiguous");expect((lookup.facts?.appointments as unknown[])).toHaveLength(2);
    f.command("set_booking_details",{newSubject:true,patientName:"Third Member"});f.command("capture_contact",{mode:"replace",rawText:"050"});expect(f.command("record_followup",{kind:"callback"}).status).toBe("invalid_contact");expect(count(f.db,"reception_appointments")).toBe(2);
  });
  it("preserves appointment identity and old occupancy on a conflicting reschedule", () => {
    const f=setup();const first=f.prepare();const committed=f.command("commit_request",{operationId:first.operationId});const id=String(committed.result?.appointmentId);const oldSlots=(committed.result?.slotIds as string[]);
    f.command("find_my_appointments",{});f.command("select_appointment",{appointmentId:id,action:"reschedule"});f.command("find_available_slots",{doctorIdentifier:"doc-002",dateExpression:"tomorrow",exactTime:"09:30"});const offer=f.snapshot().offers[0];f.expose();const ready=f.command("accept_offer",{offerId:offer.offerId,decision:"accept",detailsCommunicated:true});
    f.db.prepare("INSERT INTO reception_appointments SELECT ?,subject_id,doctor_id,service_id,starts_at_utc,version,status,classification,data FROM reception_appointments WHERE id=?").run("competing-appointment",id);
    f.db.prepare("INSERT INTO reception_occupancy VALUES (?,?)").run(offer.slotIds[0],"competing-appointment");
    expect(f.command("commit_request",{operationId:ready.operationId})).toMatchObject({status:"rejected",result:{issue:"capacity_conflict"}});
    expect((f.db.prepare("SELECT slot_id FROM reception_occupancy WHERE appointment_id=? ORDER BY slot_id").all(id) as {slot_id:string}[]).map(r=>r.slot_id)).toEqual([...oldSlots].sort());
    f.command("find_available_slots",{doctorIdentifier:"doc-003",dateExpression:"tomorrow",exactTime:"09:30"});f.expose();const retry=f.command("accept_offer",{offerId:f.snapshot().offers[0].offerId,decision:"accept",detailsCommunicated:true});
    expect(f.command("commit_request",{operationId:retry.operationId}).result).toMatchObject({appointmentId:id,doctorId:"doc-003",version:2});
  });
  it("saves followup once, recovers by event ID and distinguishes admitted unresolved events", () => {
    const f=setup();f.command("set_booking_details",{patientName:"Callback Caller"});const result=f.command("record_followup",{kind:"callback",reason:"hours question"});
    expect(result.status).toBe("committed");expect(f.service.execute(f.snapshot().sessionId,result.request).status).toBe("committed");expect(count(f.db,"reception_effects")).toBe(1);
    expect(f.service.getEvent(f.snapshot().sessionId,result.request.eventId)).toMatchObject({status:"committed",result:{simulated:true,delivered:false}});
    expect(f.service.getEvent(f.snapshot().sessionId,"never-admitted")?.status).toBe("not_found");
    f.db.prepare("INSERT INTO reception_events VALUES (?,?,?,NULL)").run(f.snapshot().sessionId,"admitted","fingerprint");expect(f.service.getEvent(f.snapshot().sessionId,"admitted")?.status).toBe("unresolved");
    expect(f.command("record_followup",{kind:"waitlist"}).status).toBe("needs_details");f.command("find_available_slots",{doctorIdentifier:"doc-001",dateExpression:"tomorrow",exactTime:"23:00"});
    expect(f.command("record_followup",{kind:"waitlist"}).result).toMatchObject({simulated:true,booked:false,preferences:{doctorId:"doc-001",exactTime:"23:00"}});
  });
  it("does not treat an explicit new lookup phone as already confirmed", () => {
    const f=setup();expect(f.command("find_my_appointments",{phone:"0509876543"}).status).toBe("needs_details");expect(f.snapshot().contact.confirmedVersion).toBeUndefined();
    expect(f.command("find_my_appointments",{phone:"123"}).status).toBe("invalid_contact");
  });
  it("collects session contact/name for a callback without creating a booking draft",()=>{
    const f=setup();f.command("set_booking_details",{patientName:"Callback Caller"});expect(f.snapshot().draft).toBeUndefined();
    expect(f.command("record_followup",{kind:"callback"}).status).toBe("committed");expect(count(f.db,"reception_appointments")).toBe(0);
  });
  it("retains committed results after an emergency and cannot close a paused session late",()=>{
    const f=setup();const ready=f.prepare();f.command("commit_request",{operationId:ready.operationId});f.command("set_emergency",{active:true});
    expect(f.command("get_operation",{operationId:ready.operationId}).status).toBe("committed");
    expect(f.service.closeSession(f.snapshot().sessionId,{eventId:"emergency-close",expectedVersion:f.snapshot().version,outcome:"emergency"}).status).toBe("closed");expect(count(f.db,"reception_appointments")).toBe(1);
  });
  it("preserves consent when malformed semantic decisions arrive",()=>{
    const f=setup();f.prepare();const old=f.snapshot().draft?.acceptedOfferId;
    expect(f.command("accept_offer",{offerId:old,decision:"nonsense",detailsCommunicated:true}).status).toBe("needs_clarification");expect(f.snapshot().draft?.acceptedOfferId).toBe(old);
  });
  it("resolves relative/Hijri dates and updates clock context across Riyadh midnight and year rollover",()=>{
    const f=setup();expect(f.command("find_available_slots",{doctorIdentifier:"doc-001",date:"1448-04-23",calendar:"hijri",exactTime:"09:00"}).snapshot.offers[0].startsAtUtc).toBe("2026-10-04T06:00:00.000Z");
    let now=new Date("2026-12-31T20:59:00Z");const g=setup(()=>now);expect(g.snapshot().clock.localDate).toBe("2026-12-31");
    now=new Date("2026-12-31T21:01:00Z");expect(g.service.getSnapshot(g.snapshot().sessionId)?.clock.localDate).toBe("2027-01-01");
    expect(g.command("find_available_slots",{doctorIdentifier:"doc-001",dateExpression:"tomorrow",exactTime:"09:00"}).snapshot.offers[0].startsAtUtc).toBe("2027-01-02T06:00:00.000Z");
  });
  it.each([
    ["next week","2026-10-04","2026-10-11"],
    ["الأسبوع الجاي","2026-10-04","2026-10-11"],
    ["الأسبوع القادم","2026-10-04","2026-10-11"],
    ["in two weeks","2026-10-17","2026-10-24"],
    ["بعد اسبوعين","2026-10-17","2026-10-24"],
    ["بعد أسبوعين","2026-10-17","2026-10-24"],
    ["earliest","2026-10-03","2026-11-03"],
    ["أقرب موعد","2026-10-03","2026-11-03"],
  ])("resolves %s as the complete local window %s through %s",(dateExpression,fromDate,toDate)=>{
    const f=setup();const result=f.command("find_available_slots",{doctorIdentifier:"doc-001",dateExpression});
    expect(result.status).toBe("availability");expect(result.facts?.window).toEqual({fromDate,toDate});
    expect((result.facts?.availabilityWindows as any[])[0].date).toBe(fromDate);expect(result.snapshot.offers).toEqual([]);
  });
  it("searches later in next week when the first date has no remaining capacity",()=>{
    const f=setup();const ready=f.prepare();const booked=f.command("commit_request",{operationId:ready.operationId});
    f.db.prepare("INSERT OR IGNORE INTO reception_occupancy SELECT id,? FROM reception_capacity WHERE doctor_id='doc-001' AND starts_at_utc >= '2026-10-04T06:00:00.000Z' AND starts_at_utc < '2026-10-04T14:00:00.000Z'").run(booked.result?.appointmentId);
    const result=f.command("find_available_slots",{doctorIdentifier:"doc-001",dateExpression:"next week"});
    expect(result.status).toBe("availability");expect((result.facts?.availabilityWindows as any[])[0]).toMatchObject({date:"2026-10-05",startTime:"09:00",lastStartTime:"16:30"});
  });
  it.each(["tomorrow","بكرة"])("resolves relative %s even when Hijri labels were requested",dateExpression=>{
    const f=setup();const result=f.command("find_available_slots",{doctorIdentifier:"doc-001",dateExpression,calendar:"hijri"});
    expect(result.status).toBe("availability");expect(result.facts?.window).toEqual({fromDate:"2026-10-04",toDate:"2026-10-05"});
    expect(result.facts?.availabilityWindows).toMatchObject([{date:"2026-10-04",startTime:"09:00",lastStartTime:"16:30"}]);
  });
  it("honors explicit date bounds over a relative window and requires a day before exact lookup",()=>{
    const f=setup();const range=f.command("find_available_slots",{doctorIdentifier:"doc-001",dateExpression:"next week",fromDate:"2026-10-06",toDate:"2026-10-08",exactTime:"09:00"});
    expect(range).toMatchObject({status:"needs_clarification",issues:["exact_time_requires_single_date"]});expect(range.snapshot.offers).toEqual([]);
    const result=f.command("find_available_slots",{doctorIdentifier:"doc-001",date:"2026-10-06",exactTime:"09:00"});
    expect(result.facts?.window).toEqual({fromDate:"2026-10-06",toDate:"2026-10-07"});expect(result.snapshot.offers[0].startsAtUtc).toBe("2026-10-06T06:00:00.000Z");
    const g=setup(()=>new Date("2026-12-31T21:01:00Z"));expect(g.command("find_available_slots",{doctorIdentifier:"doc-001",dateExpression:"next week"}).facts?.window).toEqual({fromDate:"2027-01-03",toDate:"2027-01-10"});
  });
  it.each(["completed","interrupted"] as const)("does not infer presentation from a lone %s media event",exposure=>{
    const f=setup();f.command("set_booking_details",{patientName:"Test Caller"});f.command("find_available_slots",{doctorIdentifier:"doc-001",dateExpression:"tomorrow",exactTime:"09:00"});const offerId=f.snapshot().offers[0].offerId;
    f.service.recordMediaEvent(f.snapshot().sessionId,{eventId:"no-start",connectionId:"connection",outputId:"output",inputSequence:2,eventSequence:21,medium:"audio",exposure,offerIds:[offerId]});
    expect(f.command("accept_offer",{offerId,decision:"accept",detailsCommunicated:true}).status).toBe("needs_clarification");expect(count(f.db,"reception_appointments")).toBe(0);
  });
  it("accepts a genuinely started presentation even when later interrupted",()=>{
    const f=setup();f.command("set_booking_details",{patientName:"Test Caller"});f.command("find_available_slots",{doctorIdentifier:"doc-001",dateExpression:"tomorrow",exactTime:"09:00"});f.expose();const offerId=f.snapshot().offers[0].offerId;
    f.service.recordMediaEvent(f.snapshot().sessionId,{eventId:"interrupted-after-start",connectionId:"connection",outputId:"output",inputSequence:2,eventSequence:22,medium:"audio",exposure:"interrupted",offerIds:[offerId]});
    expect(f.command("accept_offer",{offerId,decision:"accept",detailsCommunicated:true}).status).toBe("ready");
  });
  it.each(["close","emergency"])("retains a committed result when %s fences a later pending operation",fence=>{
    const f=setup();const first=f.prepare();const saved=f.command("commit_request",{operationId:first.operationId});const next=f.prepare("doc-002");
    if(fence==="close")f.service.closeSession(f.snapshot().sessionId,{eventId:"fence",expectedVersion:f.snapshot().version,outcome:"completed"});else f.command("set_emergency",{active:true});
    expect(f.command("commit_request",{operationId:next.operationId})).toMatchObject({status:"rejected",result:{issue:"superseded"}});
    expect(f.command("get_operation",{operationId:first.operationId})).toMatchObject({status:"committed",result:{appointmentId:saved.result?.appointmentId}});
    expect(count(f.db,"reception_appointments")).toBe(1);expect(count(f.db,"reception_effects")).toBe(1);
  });
  it("makes farewell a pending media close while a real close remains fenced", () => {
    const f=setup();expect(f.command("end_session",{outcome:"completed"}).snapshot.status).toBe("active");expect(f.command("set_booking_details",{patientName:"Continued Caller"}).status).toBe("updated");
  });
  it.each([["2026-10-04T05:00:00.000Z","on_time"],["2026-10-04T04:59:59.000Z","late_no_show"]])("classifies cancellation at %s as %s and releases capacity for rebooking",(starts,classification)=>{
    let now=new Date("2026-10-03T03:00:00Z");const f=setup(()=>now);const ready=f.prepare();const committed=f.command("commit_request",{operationId:ready.operationId});const id=String(committed.result?.appointmentId);
    f.db.prepare("UPDATE reception_appointments SET starts_at_utc=? WHERE id=?").run(starts,id);now=clock();
    f.command("find_my_appointments",{});f.command("select_appointment",{appointmentId:id,action:"cancel"});expect(f.snapshot().offers[0].consequence).toBe(classification);f.expose();const cancel=f.command("accept_offer",{offerId:f.snapshot().offers[0].offerId,decision:"accept",detailsCommunicated:true});
    const result=f.command("commit_request",{operationId:cancel.operationId});expect(result.result).toMatchObject({status:"cancelled",classification});expect(count(f.db,"reception_occupancy")).toBe(0);
    const another=f.prepare();expect(f.command("commit_request",{operationId:another.operationId}).status).toBe("committed");expect(count(f.db,"reception_appointments")).toBe(2);
  });
  it("selects a summary-link target and requires offer acceptance without exposing clinical data",()=>{
    const f=setup();const ready=f.prepare();const saved=f.command("commit_request",{operationId:ready.operationId});f.command("find_my_appointments",{});
    expect(f.command("select_appointment",{appointmentId:"wrong-target",action:"summary_link"}).status).toBe("not_found");
    f.command("select_appointment",{appointmentId:saved.result?.appointmentId,action:"summary_link"});f.expose();const accepted=f.command("accept_offer",{offerId:f.snapshot().offers[0].offerId,decision:"accept",detailsCommunicated:true});const summary=f.command("commit_request",{operationId:accepted.operationId});
    expect(summary.result).toMatchObject({appointmentId:saved.result?.appointmentId,simulated:true,containsClinicalContent:false});expect(count(f.db,"reception_appointments")).toBe(1);expect(f.service.activity().effects[0].kind).toBe("summary_link");
  });
});
